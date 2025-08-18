// lib/monday-client.ts - COMPLETELY FIXED with proper method implementations
import {
  MondayBoard,
  MondayItem,
  MondayApiResponse,
  MondayClientConfig,
  MondayColumnValues,
  MondayDealData,
  MondayAccountData,
  MondayContactData,
  MondayDealStage,
} from "@/types/monday";

export class MondayClient {
  private apiToken: string;
  private endpoint = "https://api.monday.com/v2";

  constructor(config: MondayClientConfig) {
    this.apiToken = config.apiToken;
  }

  async query<T>(
    query: string,
    variables: Record<string, any> = {}
  ): Promise<T> {
    console.log(
      `[Monday API] Executing query:`,
      query.substring(0, 100) + "..."
    );

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          Authorization: this.apiToken,
          "Content-Type": "application/json",
          "API-Version": "2024-04",
        },
        body: JSON.stringify({
          query,
          variables,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401) {
          throw new Error("Monday.com authentication failed - check API token");
        }
        throw new Error(
          `Monday.com API error ${response.status}: ${response.statusText}. ${errorText}`
        );
      }

      const result: MondayApiResponse<T> = await response.json();

      if (result.errors && result.errors.length > 0) {
        const errorMessages = result.errors.map((e) => e.message).join(", ");
        throw new Error(`Monday.com GraphQL errors: ${errorMessages}`);
      }

      console.log(`[Monday API] Query completed successfully`);
      return result.data;
    } catch (error) {
      console.error(`[Monday API] Query failed:`, error);
      throw error;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const query = `
        query {
          me {
            id
            name
            email
          }
        }
      `;

      await this.query(query);

      return {
        success: true,
        message: "Connected to Monday.com successfully",
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Unknown connection error",
      };
    }
  }

  // ✅ FIXED: Implement createItem method
  async createItem(
    boardId: string,
    itemName: string,
    columnValues: MondayColumnValues = {}
  ): Promise<MondayItem> {
    const mutation = `
      mutation createItem($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
        create_item(
          board_id: $boardId,
          item_name: $itemName,
          column_values: $columnValues
        ) {
          id
          name
          column_values {
            id
            text
            value
          }
        }
      }
    `;

    console.log(`[Monday] Creating item "${itemName}" on board ${boardId}`);
    console.log(
      `[Monday] Column values:`,
      JSON.stringify(columnValues, null, 2)
    );

    const data = await this.query<{ create_item: MondayItem }>(mutation, {
      boardId,
      itemName,
      columnValues: JSON.stringify(columnValues),
    });

    console.log(`[Monday] Created item ${data.create_item.id}: ${itemName}`);
    return data.create_item;
  }

  // ✅ FIXED: Implement updateItem method
  async updateItem(
    itemId: string,
    columnValues: MondayColumnValues
  ): Promise<MondayItem> {
    const mutation = `
      mutation updateItem($itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(
          item_id: $itemId,
          board_id: null,
          column_values: $columnValues
        ) {
          id
          name
          column_values {
            id
            text
            value
          }
        }
      }
    `;

    const data = await this.query<{
      change_multiple_column_values: MondayItem;
    }>(mutation, {
      itemId,
      columnValues: JSON.stringify(columnValues),
    });

    return data.change_multiple_column_values;
  }

  // ✅ FIXED: Implement findItemBySimProId method
  async findItemBySimProId(
    boardId: string,
    simproId: number,
    entityType: "customer" | "contact" | "quote"
  ): Promise<MondayItem | null> {
    const columnMapping = {
      customer: "text_mktyvanj", // Account SimPro ID column
      contact: "text_mkty91sr", // Contact SimPro ID column
      quote: "text_mktyqrhd", // Deal SimPro ID column
    };

    const columnId = columnMapping[entityType];
    const simproIdStr = simproId.toString();

    console.log(
      `[Monday] 🔍 Searching for SimPro ID ${simproId} in column ${columnId} on board ${boardId}`
    );

    try {
      let cursor: string | null = null;
      let totalSearched = 0;

      do {
        const query = `
          query ($boardId: ID!, $cursor: String) {
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

        const response: {
          boards: Array<{
            items_page: {
              cursor: string | null;
              items: MondayItem[];
            };
          }>;
        } = await this.query(query, { boardId, cursor });

        const itemsPage:
          | {
              cursor: string | null;
              items: MondayItem[];
            }
          | undefined = response.boards?.[0]?.items_page;
        if (!itemsPage) break;

        totalSearched += itemsPage.items.length;
        console.log(
          `[Monday] 📄 Searching page (${itemsPage.items.length} items, total searched: ${totalSearched})`
        );

        // Search through items for matching SimPro ID
        for (const item of itemsPage.items) {
          const simproIdColumn = item.column_values?.find(
            (col) => col.id === columnId
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

  // Account operations
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
        company_description: `Customer from SimPro
Email: ${accountData.description || "Not provided"}
Phone: Not provided
Address: Not provided`,
        text_mktrez5x: `SimPro Customer ID: ${accountData.simproCustomerId}
Last Sync: ${new Date().toISOString()}
Source: SimPro Webhook`,
        text_mktyvanj: accountData.simproCustomerId.toString(),
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

  // ✅ FIXED: Contact operations with email/phone backfill
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

        // ✅ EFFICIENT: Only backfill missing email/phone data
        if (contactData.email || contactData.phone) {
          await this.updateMissingContactFields(
            existing.id,
            boardId,
            contactData
          );
        }

        return {
          success: true,
          itemId: existing.id,
        };
      }

      // Create new contact with full data
      console.log(`🔍 [MONDAY DEBUG] Creating contact with data:`, {
        contactName: contactData.contactName,
        email: contactData.email,
        phone: contactData.phone,
        simproContactId: contactData.simproContactId,
      });

      const columnValues: MondayColumnValues = {};

      // Email field - CLEAN AND VALIDATE
      if (contactData.email) {
        const cleanEmail = contactData.email.trim().toLowerCase();

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (emailRegex.test(cleanEmail)) {
          console.log(`📧 [MONDAY DEBUG] Setting clean email: ${cleanEmail}`);
          columnValues["contact_email"] = {
            email: cleanEmail,
            text: cleanEmail,
          };
        } else {
          console.warn(
            `⚠️ [MONDAY DEBUG] Invalid email format, skipping: "${contactData.email}"`
          );
        }
      }

      // Phone field - CLEAN AND VALIDATE
      if (contactData.phone) {
        const rawPhone = contactData.phone.trim();
        const cleanPhone = rawPhone.replace(/\s+/g, "").replace(/[^\d+]/g, "");

        if (cleanPhone.length >= 8) {
          // Minimum phone length
          console.log(
            `📞 [MONDAY DEBUG] Setting clean phone: ${cleanPhone} (from "${rawPhone}")`
          );
          columnValues["contact_phone"] = {
            phone: cleanPhone,
            countryShortName: "AU",
          };
        } else {
          console.warn(
            `⚠️ [MONDAY DEBUG] Invalid phone format, skipping: "${contactData.phone}"`
          );
        }
      }

      // Notes column with SimPro tracking
      columnValues["text_mktr67s0"] = `SimPro Contact ID: ${
        contactData.simproContactId
      }
Contact Type: ${contactData.contactType || "customer"}
Department: ${contactData.department || "Not specified"}
Position: ${contactData.position || "Not specified"}
Email: ${contactData.email || "Not provided"}
Phone: ${contactData.phone || "Not provided"}
Last Sync: ${new Date().toISOString()}`;

      // Store SimPro ID in dedicated column
      columnValues["text_mkty91sr"] = contactData.simproContactId.toString();

      const item = await this.createItem(
        boardId,
        contactData.contactName,
        columnValues
      );

      console.log(
        `[Monday] ✅ Created new contact: ${contactData.contactName} (${item.id})`
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

  // ✅ NEW: Efficiently backfill missing email/phone for existing contacts
  private async updateMissingContactFields(
    contactId: string,
    boardId: string,
    contactData: MondayContactData
  ): Promise<void> {
    try {
      console.log(
        `🔍 [MONDAY] Backfilling contact ${contactId} with latest email/phone data`
      );

      const updates: Array<{ columnId: string; value: any; field: string }> =
        [];

      // Email backfill - CLEAN AND VALIDATE
      if (contactData.email) {
        const cleanEmail = contactData.email.trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (emailRegex.test(cleanEmail)) {
          updates.push({
            columnId: "contact_email",
            value: {
              email: cleanEmail,
              text: cleanEmail,
            },
            field: "email",
          });
        } else {
          console.warn(
            `⚠️ [MONDAY] Invalid email format for backfill, skipping: "${contactData.email}"`
          );
        }
      }

      // Phone backfill - CLEAN AND VALIDATE
      if (contactData.phone) {
        const rawPhone = contactData.phone.trim();
        const cleanPhone = rawPhone.replace(/\s+/g, "").replace(/[^\d+]/g, "");

        if (cleanPhone.length >= 8) {
          updates.push({
            columnId: "contact_phone",
            value: {
              phone: cleanPhone,
              countryShortName: "AU",
            },
            field: "phone",
          });
        } else {
          console.warn(
            `⚠️ [MONDAY] Invalid phone format for backfill, skipping: "${contactData.phone}"`
          );
        }
      }

      // Only make API calls if we have data to update
      if (updates.length > 0) {
        console.log(
          `🔄 [MONDAY] Applying ${updates.length} backfill updates for contact ${contactId}`
        );

        for (const update of updates) {
          await this.updateColumnValue(
            contactId,
            boardId,
            update.columnId,
            update.value
          );
          console.log(`  ✅ Backfilled ${update.field}`);
        }

        // Update notes to reflect the backfill
        const updatedNotes = `SimPro Contact ID: ${contactData.simproContactId}
Contact Type: ${contactData.contactType || "customer"}
Department: ${contactData.department || "Not specified"}
Position: ${contactData.position || "Not specified"}
Email: ${contactData.email || "Not provided"}
Phone: ${contactData.phone || "Not provided"}
Last Sync: ${new Date().toISOString()}
Source: SimPro Webhook (Backfilled)`;

        await this.updateColumnValue(
          contactId,
          boardId,
          "text_mktr67s0",
          updatedNotes
        );

        console.log(`✅ [MONDAY] Contact ${contactId} backfilled successfully`);
      } else {
        console.log(
          `✅ [MONDAY] Contact ${contactId} - no email/phone data to backfill`
        );
      }
    } catch (error) {
      // Don't fail the webhook if backfill fails - just log it
      console.warn(
        `⚠️ [MONDAY] Failed to backfill contact ${contactId}, continuing...`,
        error
      );
    }
  }

  // ✅ HELPER: Update a single column value
  private async updateColumnValue(
    itemId: string,
    boardId: string,
    columnId: string,
    value: any
  ): Promise<void> {
    const mutation = `
      mutation ($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
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

    await this.query(mutation, {
      itemId,
      boardId,
      columnId,
      value: JSON.stringify(value),
    });
  }

  // Deal operations
  async createDeal(
    boardId: string,
    dealData: MondayDealData
  ): Promise<{ success: boolean; itemId?: string; error?: string }> {
    try {
      const existing = await this.findItemBySimProId(
        boardId,
        dealData.simproQuoteId,
        "quote"
      );
      if (existing) {
        console.log(
          `[Monday] ✅ Using existing deal: ${existing.name} (${existing.id})`
        );
        return {
          success: true,
          itemId: existing.id,
        };
      }

      const columnValues: MondayColumnValues = {};

      if (dealData.dealValue) {
        columnValues["deal_value"] = dealData.dealValue;
      }

      const statusMapping: { [key: string]: string } = {
        "Quote: Sent": "Quote: Sent",
        "Quote: Won": "Quote: Won",
        "Quote: On Hold": "Quote: On Hold",
        "Quote: To Be Scheduled": "Quote: To Be Scheduled",
        "Quote: To Write": "Quote: To Write",
        "Quote: To Be Assigned": "Quote: To Be Assigned",
        "Quote Visit Scheduled": "Quote Visit Scheduled",
        "Quote: Due Date Reached": "Quote: Due Date Reached",
      };

      const mondayStatus = statusMapping[dealData.stage] || "Quote: Sent";
      columnValues["color_mktrw6k3"] = { label: mondayStatus };

      if (dealData.closeDate) {
        columnValues["deal_expected_close_date"] = dealData.closeDate;
      }

      columnValues["text_mktrtr9b"] = `SimPro Quote ID: ${
        dealData.simproQuoteId
      }
Customer: ${dealData.accountName}
Salesperson: ${dealData.salesperson || "Not specified"}
Site: ${dealData.siteName || "Not specified"}
Last Sync: ${new Date().toISOString()}`;

      columnValues["text_mktyqrhd"] = dealData.simproQuoteId.toString();

      const item = await this.createItem(
        boardId,
        dealData.dealName,
        columnValues
      );

      console.log(
        `[Monday] ✅ Created new deal: ${dealData.dealName} (${item.id})`
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
        status: { label: newStage },
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
}
