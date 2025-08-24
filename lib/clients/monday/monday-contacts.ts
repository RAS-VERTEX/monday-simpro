// lib/clients/monday/monday-contacts.ts - FIXED: Proper SimPro ID assignment, no notes
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

      // ✅ CRITICAL FIX: Set the SimPro Contact ID in the correct column
      columnValues["text_mktzxzhy"] = contactData.simproContactId.toString();
      logger.info(
        `[Monday Contacts] 🆔 Setting SimPro Contact ID: ${contactData.simproContactId}`
      );

      // Contact type
      if (contactData.contactType) {
        const typeMapping = {
          customer: "Customer Contact",
          site: "Site Contact",
        };
        const mappedType =
          typeMapping[contactData.contactType as keyof typeof typeMapping];
        if (mappedType) {
          columnValues[this.columnIds.contacts.type] = {
            labels: [mappedType],
          };
          logger.debug(
            `[Monday Contacts] 🏷️ Setting contact type: ${mappedType}`
          );
        }
      }

      // Email field - CLEAN AND VALIDATE
      if (contactData.email) {
        const cleanEmail = contactData.email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (emailRegex.test(cleanEmail)) {
          logger.info(
            `[Monday Contacts] 📧 Setting clean email: ${cleanEmail}`
          );
          columnValues[this.columnIds.contacts.email] = {
            email: cleanEmail,
            text: cleanEmail,
          };
        } else {
          logger.warn(
            `[Monday Contacts] ⚠️ Invalid email format, skipping: "${contactData.email}"`
          );
        }
      }

      // Phone field - CLEAN AND VALIDATE
      if (contactData.phone) {
        const rawPhone = contactData.phone.trim();
        const cleanPhone = rawPhone.replace(/\s+/g, "").replace(/[^\d+]/g, "");

        if (cleanPhone.length >= 8) {
          logger.info(
            `[Monday Contacts] 📞 Setting clean phone: ${cleanPhone} (from "${rawPhone}")`
          );
          columnValues[this.columnIds.contacts.phone] = {
            phone: cleanPhone,
            countryShortName: "AU",
          };
        } else {
          logger.warn(
            `[Monday Contacts] ⚠️ Invalid phone format, skipping: "${contactData.phone}"`
          );
        }
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

      // ✅ REMOVED: Do NOT set notes - keep notes column empty
      // columnValues[this.columnIds.contacts.notes] = notes; // DELETED

      const item = await this.createItem(
        boardId,
        contactData.contactName,
        columnValues
      );

      logger.info(
        `[Monday Contacts] ✅ Contact created successfully: ${contactData.contactName} (${item.id}) with SimPro Contact ID: ${contactData.simproContactId}`
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

  // ✅ FIXED: Efficiently backfill missing email/phone with validation (NO NOTES)
  private async updateMissingContactFields(
    contactId: string,
    boardId: string,
    contactData: MondayContactData,
    accountId?: string
  ): Promise<void> {
    try {
      const updates: Array<{
        columnId: string;
        value: any;
        field: string;
      }> = [];

      // Check if we need to add email
      if (contactData.email) {
        const cleanEmail = contactData.email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (emailRegex.test(cleanEmail)) {
          updates.push({
            columnId: this.columnIds.contacts.email,
            value: {
              email: cleanEmail,
              text: cleanEmail,
            },
            field: "email",
          });
        }
      }

      // Check if we need to add phone
      if (contactData.phone) {
        const rawPhone = contactData.phone.trim();
        const cleanPhone = rawPhone.replace(/\s+/g, "").replace(/[^\d+]/g, "");

        if (cleanPhone.length >= 8) {
          updates.push({
            columnId: this.columnIds.contacts.phone,
            value: {
              phone: cleanPhone,
              countryShortName: "AU",
            },
            field: "phone",
          });
        }
      }

      // Check if we need to add account link
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

        // ✅ REMOVED: NO NOTES UPDATES
        // const updatedNotes = `SimPro Contact ID...`; // DELETED
        // await this.updateColumnValue(...); // DELETED

        logger.info(
          `[Monday Contacts] ✅ Contact ${contactId} backfilled successfully (no notes updated)`
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
                column_values(ids: ["text_mktzxzhy"]) {
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
        const response: {
          data?: {
            boards: Array<{
              items_page: {
                cursor: string | null;
                items: MondayItem[];
              };
            }>;
          };
        } = await this.api.query(query, {
          boardId,
          cursor,
        });

        const itemsPage = response.data?.boards?.[0]?.items_page;
        if (!itemsPage) break;

        // Search through items for matching SimPro ID
        for (const item of itemsPage.items) {
          const simproIdColumn = item.column_values?.find(
            (col: any) => col.id === "text_mktzxzhy" // Contact SimPro ID column
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
}
