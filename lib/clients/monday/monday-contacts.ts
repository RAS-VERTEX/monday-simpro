// lib/clients/monday/monday-contacts.ts - FIXED: Email/phone backfill for existing contacts
import { MondayApi } from "./monday-api";
import { MondayColumnIds } from "./monday-config";
import { MondayContactData, MondayItem } from "@/types/monday";
import { logger } from "@/lib/utils/logger";

export class MondayContacts {
  constructor(private api: MondayApi, private columnIds: MondayColumnIds) {}

  async createContact(
    boardId: string,
    contactData: MondayContactData,
    accountId?: string
  ): Promise<{ success: boolean; itemId?: string; error?: string }> {
    try {
      // Check if contact already exists
      const existing = await this.findContactBySimProId(
        contactData.simproContactId,
        boardId
      );

      if (existing) {
        logger.info(
          `[Monday Contacts] ✅ Using existing contact: "${existing.name}" (${existing.id})`
        );

        // ✅ EFFICIENT: Only backfill missing email/phone data
        if (contactData.email || contactData.phone) {
          await this.updateMissingContactFields(
            existing.id,
            boardId,
            contactData,
            accountId
          );
        }

        return { success: true, itemId: existing.id };
      }

      logger.info(
        `[Monday Contacts] Creating new contact: "${contactData.contactName}"`
      );

      // Prepare column values for new contact
      const columnValues: any = {};

      // Email field
      if (contactData.email) {
        logger.info(`[Monday Contacts] 📧 Setting email: ${contactData.email}`);
        columnValues[this.columnIds.contacts.email] = {
          email: contactData.email,
          text: contactData.email,
        };
      }

      // Phone field
      if (contactData.phone) {
        logger.info(`[Monday Contacts] 📞 Setting phone: ${contactData.phone}`);
        const cleanPhone = contactData.phone
          .replace(/\s+/g, "")
          .replace(/[^\d+]/g, "");

        columnValues[this.columnIds.contacts.phone] = {
          phone: cleanPhone,
          countryShortName: "AU",
        };
      }

      // Link to account if provided
      if (accountId) {
        columnValues[this.columnIds.contacts.accounts_relation] = {
          item_ids: [parseInt(accountId)],
        };
        logger.debug(
          `[Monday Contacts] 🔗 Linking contact to account: ${accountId}`
        );
      }

      // Add SimPro tracking info
      const notes = `SimPro Contact ID: ${
        contactData.simproContactId
      }\nSimPro Customer ID: ${contactData.simproCustomerId}\nDepartment: ${
        contactData.department || "Not specified"
      }\nPosition: ${contactData.position || "Not specified"}\nEmail: ${
        contactData.email || "Not provided"
      }\nPhone: ${
        contactData.phone || "Not provided"
      }\nLast Sync: ${new Date().toISOString()}\nSource: SimPro`;

      columnValues[this.columnIds.contacts.notes] = notes;

      const item = await this.createItem(
        boardId,
        contactData.contactName,
        columnValues
      );

      logger.info(
        `[Monday Contacts] ✅ Contact created successfully: ${item.id}`
      );
      return { success: true, itemId: item.id };
    } catch (error) {
      logger.error(`[Monday Contacts] Failed to create contact`, {
        error,
        contactData,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ✅ NEW: Efficiently backfill missing email/phone for existing contacts
  private async updateMissingContactFields(
    contactId: string,
    boardId: string,
    contactData: MondayContactData,
    accountId?: string
  ): Promise<void> {
    try {
      logger.info(
        `[Monday Contacts] 🔍 Backfilling contact ${contactId} with latest data`
      );

      const updates: Array<{ columnId: string; value: any; field: string }> =
        [];

      // Email backfill
      if (contactData.email) {
        updates.push({
          columnId: this.columnIds.contacts.email,
          value: {
            email: contactData.email,
            text: contactData.email,
          },
          field: "email",
        });
      }

      // Phone backfill
      if (contactData.phone) {
        const cleanPhone = contactData.phone
          .replace(/\s+/g, "")
          .replace(/[^\d+]/g, "");

        updates.push({
          columnId: this.columnIds.contacts.phone,
          value: {
            phone: cleanPhone,
            countryShortName: "AU",
          },
          field: "phone",
        });
      }

      // Account linking backfill
      if (accountId) {
        updates.push({
          columnId: this.columnIds.contacts.accounts_relation,
          value: {
            item_ids: [parseInt(accountId)],
          },
          field: "account_link",
        });
      }

      // Only make API calls if we have data to update
      if (updates.length > 0) {
        logger.info(
          `[Monday Contacts] 🔄 Applying ${updates.length} backfill updates for contact ${contactId}`
        );

        for (const update of updates) {
          await this.updateColumnValue(
            contactId,
            boardId,
            update.columnId,
            update.value
          );
          logger.debug(`[Monday Contacts] ✅ Backfilled ${update.field}`);
        }

        // Update notes to reflect the backfill
        const updatedNotes = `SimPro Contact ID: ${
          contactData.simproContactId
        }\nSimPro Customer ID: ${contactData.simproCustomerId}\nDepartment: ${
          contactData.department || "Not specified"
        }\nPosition: ${contactData.position || "Not specified"}\nEmail: ${
          contactData.email || "Not provided"
        }\nPhone: ${
          contactData.phone || "Not provided"
        }\nLast Sync: ${new Date().toISOString()}\nSource: SimPro (Backfilled)`;

        await this.updateColumnValue(
          contactId,
          boardId,
          this.columnIds.contacts.notes,
          updatedNotes
        );

        logger.info(
          `[Monday Contacts] ✅ Contact ${contactId} backfilled successfully`
        );
      } else {
        logger.info(
          `[Monday Contacts] ✅ Contact ${contactId} - no data to backfill`
        );
      }
    } catch (error) {
      // Don't fail the operation if backfill fails - just log it
      logger.warn(
        `[Monday Contacts] ⚠️ Failed to backfill contact ${contactId}, continuing...`,
        { error }
      );
    }
  }

  // Helper method to find contact by SimPro ID
  private async findContactBySimProId(
    simproContactId: number,
    boardId: string
  ): Promise<MondayItem | null> {
    try {
      const query = `
        query FindContact($boardId: ID!, $cursor: String) {
          boards(ids: [$boardId]) {
            items_page(limit: 100, cursor: $cursor) {
              cursor
              items {
                id
                name
                column_values {
                  id
                  text
                  value
                }
              }
            }
          }
        }
      `;

      let cursor: string | null = null;
      const simproIdStr = simproContactId.toString();

      do {
        const response = await this.api.query(query, {
          boardId,
          cursor,
        });

        const itemsPage = response.data?.boards?.[0]?.items_page;
        if (!itemsPage) break;

        // Search through items for matching SimPro ID
        for (const item of itemsPage.items) {
          const simproIdColumn = item.column_values?.find(
            (col: any) => col.id === "text_mkty91sr" // Contact SimPro ID column
          );

          if (simproIdColumn?.text === simproIdStr) {
            logger.debug(
              `[Monday Contacts] Found contact by SimPro ID ${simproContactId}: ${item.name} (${item.id})`
            );
            return {
              id: item.id,
              name: item.name,
              column_values: item.column_values,
            };
          }
        }

        cursor = itemsPage.cursor;
      } while (cursor);

      return null;
    } catch (error) {
      logger.error(
        `[Monday Contacts] Failed to find contact by SimPro ID ${simproContactId}`,
        { error }
      );
      return null;
    }
  }

  // Helper method to create item
  private async createItem(
    boardId: string,
    itemName: string,
    columnValues: any
  ): Promise<{ id: string; name: string }> {
    const mutation = `
      mutation CreateItem($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
        create_item(
          board_id: $boardId
          item_name: $itemName
          column_values: $columnValues
        ) {
          id
          name
        }
      }
    `;

    const response = await this.api.query(mutation, {
      boardId,
      itemName,
      columnValues: JSON.stringify(columnValues),
    });

    if (!response.create_item) {
      throw new Error("Failed to create item");
    }

    return response.create_item;
  }

  // Helper method to update column value
  private async updateColumnValue(
    itemId: string,
    boardId: string,
    columnId: string,
    value: any
  ): Promise<void> {
    const mutation = `
      mutation UpdateColumn($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(
          item_id: $itemId
          board_id: $boardId
          column_id: $columnId
          value: $value
        ) {
          id
        }
      }
    `;

    await this.api.query(mutation, {
      itemId,
      boardId,
      columnId,
      value: JSON.stringify(value),
    });
  }

  // Link contact to deal
  async linkContactToDeal(
    contactId: string,
    dealId: string,
    dealBoardId: string
  ): Promise<void> {
    try {
      await this.updateColumnValue(
        dealId,
        dealBoardId,
        this.columnIds.deals.contacts_relation,
        {
          item_ids: [parseInt(contactId)],
        }
      );

      logger.info(
        `[Monday Contacts] 🔗 Linked contact ${contactId} to deal ${dealId}`
      );
    } catch (error) {
      logger.error(`[Monday Contacts] Failed to link contact to deal`, {
        error,
        contactId,
        dealId,
      });
      throw error;
    }
  }
}
