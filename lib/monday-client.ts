// lib/monday-client.ts - Fixed TypeScript errors

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

// ✅ FIXED: Type-safe contact type mapping
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

    console.log(`[Monday] ✅ Column ${columnId} updated successfully`);
  }

  private async findItemBySimProId(
    boardId: string,
    simproId: number,
    type: "customer" | "contact" | "quote"
  ): Promise<MondayItem | null> {
    const columnMapping = {
      customer: "text_mktyvanj", // Accounts SimPro ID column
      contact: "text_mkty91sr", // Contacts SimPro ID column
      quote: "text_mktyqrhd", // Deals SimPro ID column
    };

    const columnId = columnMapping[type];
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
                  }
                }
              }
            }
          }
        `;

        const result = (await this.api.query(query, {
          boardId,
          cursor,
        })) as any;
        const itemsPage = result.boards?.[0]?.items_page;

        if (!itemsPage) break;

        totalSearched += itemsPage.items.length;
        console.log(
          `[Monday] 📄 Searching page (${itemsPage.items.length} items, total searched: ${totalSearched})`
        );

        // Search through items for matching SimPro ID
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

  // ✅ FIXED: Contact operations with proper typing
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

        // Update contact type for existing contacts
        if (contactData.contactType) {
          try {
            await this.updateContactType(
              existing.id,
              boardId,
              contactData.contactType
            );
          } catch (typeError) {
            console.warn(
              `[Monday] ⚠️ Could not update contact type: ${typeError}`
            );
          }
        }

        // Backfill missing email/phone data
        if (contactData.email || contactData.phone) {
          await this.updateMissingContactFields(
            existing.id,
            boardId,
            contactData
          );
        }

        return { success: true, itemId: existing.id };
      }

      // Create new contact with full data
      console.log(`🔍 [MONDAY DEBUG] Creating contact with data:`, {
        contactName: contactData.contactName,
        email: contactData.email,
        phone: contactData.phone,
        contactType: contactData.contactType,
        simproContactId: contactData.simproContactId,
      });

      const columnValues: MondayColumnValues = {};

      // ✅ FIXED: Set contact type dropdown with proper typing
      if (contactData.contactType) {
        const typeMapping: ContactTypeMapping = {
          customer: "Customer Contact",
          site: "Site Contact",
        };

        // Use type assertion to ensure contactType is a valid key
        const contactType = contactData.contactType as keyof ContactTypeMapping;
        const mondayTypeLabel = typeMapping[contactType] || "Customer Contact";

        columnValues["title5"] = {
          label: mondayTypeLabel,
        };

        console.log(
          `🏷️ [MONDAY DEBUG] Setting contact type: "${contactData.contactType}" → "${mondayTypeLabel}"`
        );
      }

      // Email field - CLEAN AND VALIDATE
      if (contactData.email) {
        const cleanEmail = contactData.email.trim().toLowerCase();
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
Last Sync: ${new Date().toISOString()}
Source: SimPro`;

      // Store SimPro ID in dedicated column
      columnValues["text_mkty91sr"] = contactData.simproContactId.toString();

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

  // ✅ FIXED: Helper method to update contact type with proper typing
  private async updateContactType(
    contactId: string,
    boardId: string,
    contactType: "customer" | "site"
  ): Promise<void> {
    try {
      const typeMapping: ContactTypeMapping = {
        customer: "Customer Contact",
        site: "Site Contact",
      };

      const mondayTypeLabel = typeMapping[contactType];

      await this.updateColumnValue(contactId, boardId, "title5", {
        label: mondayTypeLabel,
      });

      console.log(
        `[Monday] ✅ Updated contact ${contactId} type to "${mondayTypeLabel}"`
      );
    } catch (error) {
      console.warn(`[Monday] ⚠️ Failed to update contact type: ${error}`);
      throw error;
    }
  }

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

  // ✅ UPDATED: Deal operations with owner assignment (dealOwnerId is now in the interface)
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
          `[Monday] 🔄 Updating existing deal: ${existing.name} (${existing.id})`
        );

        // Try to update owner for existing deals
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

        // Update deal status for Won/Lost quotes
        const dealStatus = dealData.stage;
        if (
          dealStatus === "Quote: Won" ||
          dealStatus === "Quote: Archived - Not Won" ||
          dealStatus === "Quote : Archived - Not Won"
        ) {
          console.log(
            `[Monday] 🎯 Updating deal status to "${dealStatus}" - Monday automation will move to appropriate board`
          );

          await this.updateColumnValue(existing.id, boardId, "color_mktrw6k3", {
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

      // Create new deal
      const columnValues: MondayColumnValues = {};

      if (dealData.dealValue) {
        columnValues["deal_value"] = dealData.dealValue;
      }

      // Try to assign deal owner
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

      // Enhanced status mapping with Won/Archived support
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
        "Quote: Archived - Not Won": "Quote : Archived - Not Won", // Use Monday's exact format
        "Quote : Archived - Not Won": "Quote : Archived - Not Won",
      };

      const mondayStatus = statusMapping[dealData.stage] || "Quote: Sent";
      columnValues["color_mktrw6k3"] = { label: mondayStatus };

      console.log(
        `[Monday] 🎯 Setting deal status: "${dealData.stage}" → "${mondayStatus}"`
      );

      if (dealData.closeDate) {
        columnValues["deal_expected_close_date"] = dealData.closeDate;
      }

      const ownerInfo = dealData.dealOwnerId
        ? `\nDeal Owner: Assigned to "${dealData.salesperson}" (User ${dealData.dealOwnerId})`
        : "\nDeal Owner: Not assigned (no mapping available)";

      columnValues["text_mktrtr9b"] = `SimPro Quote ID: ${
        dealData.simproQuoteId
      }
Customer: ${dealData.accountName}
Salesperson: ${dealData.salesperson || "Not specified"}${ownerInfo}
Site: ${dealData.siteName || "Not specified"}
Last Sync: ${new Date().toISOString()}`;

      columnValues["text_mktyqrhd"] = dealData.simproQuoteId.toString();

      const item = await this.createItem(
        boardId,
        dealData.dealName,
        columnValues
      );

      const finalOwnerInfo = dealData.dealOwnerId
        ? ` with owner "${dealData.salesperson}"`
        : ` (no owner assigned)`;

      console.log(
        `[Monday] ✅ Created new deal: ${dealData.dealName} (${item.id}) with status "${mondayStatus}"${finalOwnerInfo}`
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
