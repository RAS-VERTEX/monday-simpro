// lib/monday-client.ts - Complete updated file with all fixes
import { MondayApi } from "@/lib/clients/monday/monday-api";
import { MONDAY_COLUMN_IDS } from "@/lib/clients/monday/monday-config";
import {
  MondayAccountData,
  MondayContactData,
  MondayDealData,
  MondayDealStage,
} from "@/types/monday";

export interface MondayColumnValues {
  [key: string]: any;
}

export interface MondayItem {
  id: string;
  name: string;
  column_values?: Array<{
    id: string;
    text: string;
    value?: string;
  }>;
}

interface ContactTypeMapping {
  customer: string;
  site: string;
}

export class MondayClient {
  private api: MondayApi;

  constructor(config: { apiToken: string }) {
    this.api = new MondayApi(config.apiToken);
  }

  async query<T = any>(query: string, variables?: any): Promise<T> {
    return this.api.query<T>(query, variables);
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    return this.api.testConnection();
  }

  private async createItem(
    boardId: string,
    itemName: string,
    columnValues: MondayColumnValues
  ): Promise<MondayItem> {
    console.log(`[Monday] Creating item "${itemName}" on board ${boardId}`);
    console.log(
      `[Monday] Column values:`,
      JSON.stringify(columnValues, null, 2)
    );

    const mutation = `
      mutation createItem($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
        create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
          id
          name
        }
      }
    `;

    const result: any = await this.api.query(mutation, {
      boardId,
      itemName,
      columnValues: JSON.stringify(columnValues),
    });

    const item = result.create_item;
    console.log(`[Monday] Created item ${item.id}: ${item.name}`);
    return item;
  }

  private async updateItem(
    itemId: string,
    columnValues: MondayColumnValues
  ): Promise<void> {
    const mutation = `
      mutation updateItem($itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(item_id: $itemId, column_values: $columnValues) {
          id
        }
      }
    `;

    await this.api.query(mutation, {
      itemId,
      columnValues: JSON.stringify(columnValues),
    });
  }

  async updateColumnValue(
    itemId: string,
    boardId: string,
    columnId: string,
    value: any
  ): Promise<void> {
    console.log(
      `[Monday] 🔄 Updating column ${columnId} for item ${itemId} with value:`,
      value
    );

    const mutation = `
      mutation ($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(item_id: $itemId, board_id: $boardId, column_id: $columnId, value: $value) {
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

  // ✅ FIXED: Updated with correct column mapping from board discovery
  async findItemBySimProId(
    boardId: string,
    simproId: number,
    itemType: "customer" | "contact" | "quote"
  ): Promise<MondayItem | null> {
    const columnMapping = {
      customer: "text_mktzqxk", // ✅ Accounts SimPro ID
      contact: "text_mktzxzhy", // ✅ Contacts SimPro ID
      quote: "text_mktzc7e6", // ✅ Deals SimPro ID
    };

    const columnId = columnMapping[itemType];
    const simproIdStr = simproId.toString();

    console.log(
      `[Monday] 🔍 Searching for SimPro ID ${simproId} in column ${columnId} on board ${boardId}`
    );

    try {
      let cursor: string | null = null;
      let totalSearched = 0;

      do {
        const query = `
          query searchItems($boardId: ID!, $cursor: String, $limit: Int!) {
            boards(ids: [$boardId]) {
              items_page(limit: $limit, cursor: $cursor) {
                cursor
                items {
                  id
                  name
                  column_values(ids: ["${columnId}"]) {
                    id
                    text
                    value
                  }
                }
              }
            }
          }
        `;

        const result: any = await this.api.query(query, {
          boardId,
          cursor,
          limit: 25,
        });

        const itemsPage: any = result.boards?.[0]?.items_page;

        if (!itemsPage) break;

        totalSearched += itemsPage.items.length;
        console.log(
          `[Monday] 📄 Searching page (${itemsPage.items.length} items, total searched: ${totalSearched})`
        );

        for (const item of itemsPage.items) {
          const simproIdColumn = item.column_values?.find(
            (col: { id: string; text: string; value?: string }) =>
              col.id === columnId
          );

          if (simproIdColumn?.text === simproIdStr) {
            console.log(
              `[Monday] ✅ Found existing item by SimPro ID ${simproId}: ${item.name} (${item.id}) after searching ${totalSearched} items`
            );
            return item;
          }
        }

        cursor = itemsPage.cursor;
      } while (cursor);

      console.log(
        `[Monday] ❌ No item found with SimPro ID ${simproId} after searching ${totalSearched} items`
      );
      return null;
    } catch (error) {
      console.error(
        `[Monday] Failed to search for SimPro ID ${simproId}:`,
        error
      );
      return null;
    }
  }

  async createAccount(
    boardId: string,
    accountData: MondayAccountData
  ): Promise<{ success: boolean; itemId?: string; error?: string }> {
    try {
      const existing = await this.findItemBySimProId(
        boardId,
        accountData.simproCustomerId,
        "customer"
      );
      if (existing) {
        console.log(
          `[Monday] ✅ Using existing account: ${existing.name} (${existing.id})`
        );
        return {
          success: true,
          itemId: existing.id,
        };
      }

      const columnValues: MondayColumnValues = {
        // ✅ FIXED: Use correct SimPro ID column for accounts
        text_mktzqxk: accountData.simproCustomerId.toString(),
      };

      const item = await this.createItem(
        boardId,
        accountData.accountName,
        columnValues
      );

      console.log(
        `[Monday] ✅ Created new account: ${accountData.accountName} (${item.id})`
      );
      return {
        success: true,
        itemId: item.id,
      };
    } catch (error) {
      console.error(`[Monday] Failed to create account:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async createContact(
    boardId: string,
    contactData: MondayContactData
  ): Promise<{ success: boolean; itemId?: string; error?: string }> {
    try {
      const existing = await this.findItemBySimProId(
        boardId,
        contactData.simproContactId,
        "contact"
      );
      if (existing) {
        console.log(
          `[Monday] ✅ Using existing contact: ${existing.name} (${existing.id})`
        );
        return {
          success: true,
          itemId: existing.id,
        };
      }

      console.log(`🔍 [MONDAY DEBUG] Creating contact with data:`, {
        contactName: contactData.contactName,
        email: contactData.email,
        phone: contactData.phone,
        contactType: contactData.contactType,
        simproContactId: contactData.simproContactId,
      });

      const columnValues: MondayColumnValues = {};

      // Contact type mapping
      const contactTypeMapping: ContactTypeMapping = {
        customer: "Customer Contact",
        site: "Site Contact",
      };

      if (contactData.contactType) {
        const mappedType = contactTypeMapping[contactData.contactType];
        console.log(
          `🏷️ [MONDAY DEBUG] Setting contact type: "${contactData.contactType}" → "${mappedType}"`
        );
        columnValues["title5"] = {
          labels: [mappedType],
        };
      }

      // Email
      if (contactData.email) {
        const cleanEmail = contactData.email.toLowerCase().trim();
        console.log(`📧 [MONDAY DEBUG] Setting clean email: ${cleanEmail}`);
        columnValues["contact_email"] = {
          email: cleanEmail,
          text: cleanEmail,
        };
      }

      // Phone
      if (contactData.phone) {
        const cleanPhone = contactData.phone.replace(/\s+/g, "");
        console.log(
          `📞 [MONDAY DEBUG] Setting clean phone: ${cleanPhone} (from "${contactData.phone}")`
        );
        columnValues["contact_phone"] = {
          phone: cleanPhone,
          countryShortName: "AU",
        };
      }

      // ✅ FIXED: Use correct SimPro ID column for contacts
      columnValues["text_mktzxzhy"] = contactData.simproContactId.toString();

      const item = await this.createItem(
        boardId,
        contactData.contactName,
        columnValues
      );

      console.log(
        `[Monday] ✅ Created new contact: ${contactData.contactName} (${item.id}) with type "${contactData.contactType}"`
      );
      return {
        success: true,
        itemId: item.id,
      };
    } catch (error) {
      console.error(`[Monday] Failed to create contact:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ✅ MAJOR UPDATE: Enable owner assignment and fix duplicate detection
  async createDeal(
    boardId: string,
    dealData: MondayDealData,
    accountId?: string,
    contactIds?: string[]
  ): Promise<{ success: boolean; itemId?: string; error?: string }> {
    try {
      const existing = await this.findItemBySimProId(
        boardId,
        dealData.simproQuoteId,
        "quote"
      );

      if (existing) {
        console.log(
          `[Monday] 🔄 Updating existing deal: ${existing.name} (${existing.id})`
        );

        // ✅ ENABLE: Try to update owner for existing deals
        if (dealData.dealOwnerId) {
          try {
            await this.updateColumnValue(existing.id, boardId, "deal_owner", {
              personsAndTeams: [{ id: dealData.dealOwnerId, kind: "person" }],
            });
            console.log(
              `[Monday] ✅ Updated deal owner to "${dealData.salesperson}" (User ${dealData.dealOwnerId})`
            );
          } catch (ownerError) {
            console.warn(
              `[Monday] ⚠️ Could not assign owner "${dealData.salesperson}" - continuing: ${ownerError}`
            );
          }
        }

        const dealStatus = dealData.stage;
        if (
          dealStatus === "Quote: Won" ||
          dealStatus === "Quote: Archived - Not Won" ||
          dealStatus === "Quote : Archived - Not Won"
        ) {
          console.log(
            `[Monday] 🎯 Updating deal status to "${dealStatus}" - Monday automation will move to appropriate board`
          );

          // ✅ FIXED: Use correct stage column
          await this.updateColumnValue(existing.id, boardId, "deal_stage", {
            label: dealStatus,
          });

          console.log(
            `[Monday] ✅ Deal ${existing.id} status updated to "${dealStatus}"`
          );
        }

        return {
          success: true,
          itemId: existing.id,
        };
      }

      const columnValues: MondayColumnValues = {};

      if (dealData.dealValue) {
        columnValues["deal_value"] = dealData.dealValue;
      }

      // ✅ ENABLE: Deal owner assignment
      if (dealData.dealOwnerId) {
        try {
          columnValues["deal_owner"] = {
            personsAndTeams: [{ id: dealData.dealOwnerId, kind: "person" }],
          };
          console.log(
            `[Monday] 👤 Will assign owner: "${dealData.salesperson}" (User ${dealData.dealOwnerId})`
          );
        } catch (ownerError) {
          console.warn(
            `[Monday] ⚠️ Could not prepare owner assignment for "${dealData.salesperson}" - continuing without: ${ownerError}`
          );
          delete columnValues["deal_owner"];
        }
      }

      // Status mapping - keep the existing mapping you have
      const statusMapping: { [key: string]: string } = {
        "Quote: Sent": "Quote: Sent",
        "Quote: On Hold": "Quote: On Hold",
        "Quote: To Be Scheduled": "Quote: To Be Scheduled",
        "Quote: To Write": "Quote: To Write",
        "Quote: To Be Assigned": "Quote: To Be Assigned",
        "Quote Visit Scheduled": "Quote Visit Scheduled",
        "Quote: Due Date Reached": "Quote: Due Date Reached",
        "Quote: Won": "Quote: Won",
        "Quote : Won": "Quote: Won",
        "Quote: Archived - Not Won": "Quote : Archived - Not Won",
        "Quote : Archived - Not Won": "Quote : Archived - Not Won",
      };

      const mondayStatus = statusMapping[dealData.stage] || "Quote: Sent";
      // ✅ FIXED: Use correct stage column from board discovery
      columnValues["deal_stage"] = { label: mondayStatus };

      console.log(
        `[Monday] 🎯 Setting deal status: "${dealData.stage}" → "${mondayStatus}"`
      );

      if (dealData.closeDate) {
        columnValues["deal_expected_close_date"] = dealData.closeDate;
      }

      // ✅ FIXED: Use correct SimPro ID column for deals
      columnValues["text_mktzc7e6"] = dealData.simproQuoteId.toString();

      const item = await this.createItem(
        boardId,
        dealData.dealName,
        columnValues
      );

      console.log(
        `[Monday] ✅ Created new deal: ${dealData.dealName} (${
          item.id
        }) with status "${mondayStatus}"${
          dealData.dealOwnerId
            ? ` assigned to User ${dealData.dealOwnerId}`
            : " (no owner assignment)"
        }`
      );

      return {
        success: true,
        itemId: item.id,
      };
    } catch (error) {
      console.error(`[Monday] Failed to create deal:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async updateDealStage(
    itemId: string,
    newStage: MondayDealStage
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const columnValues: MondayColumnValues = {
        // ✅ FIXED: Use correct stage column
        deal_stage: { label: newStage },
      };

      await this.updateItem(itemId, columnValues);

      return { success: true };
    } catch (error) {
      console.error(`[Monday] Failed to update deal stage:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async linkItems(
    parentItemId: string,
    childItemId: string,
    parentBoardId: string,
    relationColumnId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(
        `[Monday] 🔗 Linking item ${childItemId} to ${parentItemId} via column ${relationColumnId}`
      );

      const mutation = `
        mutation linkItems($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
          change_column_value(
            item_id: $itemId,
            board_id: $boardId,
            column_id: $columnId,
            value: $value
          ) {
            id
          }
        }
      `;

      await this.api.query(mutation, {
        itemId: parentItemId,
        boardId: parentBoardId,
        columnId: relationColumnId,
        value: JSON.stringify({
          item_ids: [parseInt(childItemId)],
        }),
      });

      console.log(
        `[Monday] ✅ Successfully linked ${childItemId} to ${parentItemId}`
      );
      return { success: true };
    } catch (error) {
      console.error(`[Monday] Failed to link items:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async linkMultipleItems(
    parentItemId: string,
    childItemIds: string[],
    parentBoardId: string,
    relationColumnId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(
        `[Monday] 🔗 Linking multiple items ${childItemIds.join(
          ", "
        )} to ${parentItemId} via column ${relationColumnId}`
      );

      const mutation = `
        mutation linkMultipleItems($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
          change_column_value(
            item_id: $itemId,
            board_id: $boardId,
            column_id: $columnId,
            value: $value
          ) {
            id
          }
        }
      `;

      await this.api.query(mutation, {
        itemId: parentItemId,
        boardId: parentBoardId,
        columnId: relationColumnId,
        value: JSON.stringify({
          item_ids: childItemIds.map((id) => parseInt(id)),
        }),
      });

      console.log(
        `[Monday] ✅ Successfully linked ${childItemIds.length} items to ${parentItemId}`
      );
      return { success: true };
    } catch (error) {
      console.error(`[Monday] Failed to link multiple items:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
