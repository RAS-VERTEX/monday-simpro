// lib/clients/monday/monday-contacts.ts - Contact operations only
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
        return { success: true, itemId: existing.id };
      }

      logger.info(
        `[Monday Contacts] Creating new contact: "${contactData.contactName}"`
      );

      // Prepare column values
      const columnValues: any = {};

      if (contactData.email) {
        columnValues[this.columnIds.contacts.email] = {
          email: contactData.email,
          text: contactData.email,
        };
      }

      if (contactData.phone) {
        columnValues[this.columnIds.contacts.phone] = contactData.phone;
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
      }\nSimPro Customer ID: ${
        contactData.simproCustomerId
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

  private async findContactBySimProId(
    simproContactId: number,
    boardId: string
  ): Promise<MondayItem | null> {
    try {
      const query = `
        query FindContact($boardId: ID!) {
          boards(ids: [$boardId]) {
            items_page(limit: 50) {
              items {
                id
                name
                column_values {
                  id
                  text
                }
              }
            }
          }
        }
      `;

      const result = await this.api.query(query, { boardId });
      const items = result.boards[0]?.items_page?.items || [];

      // Search for contact by SimPro Contact ID in notes
      for (const item of items) {
        const notesColumn = item.column_values.find(
          (cv: any) => cv.id === this.columnIds.contacts.notes
        );
        if (
          notesColumn?.text?.includes(`SimPro Contact ID: ${simproContactId}`)
        ) {
          return item;
        }
      }

      return null;
    } catch (error) {
      logger.error("[Monday Contacts] Error finding contact by SimPro ID", {
        error,
        simproContactId,
      });
      return null;
    }
  }

  private async createItem(
    boardId: string,
    itemName: string,
    columnValues: any
  ): Promise<MondayItem> {
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

    const result = await this.api.query(mutation, {
      boardId,
      itemName,
      columnValues: JSON.stringify(columnValues),
    });

    return result.create_item;
  }
}
