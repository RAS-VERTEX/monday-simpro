// lib/monday-client.ts - FIXED with safe null checks

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

  // ✅ EXPOSED: Make query method public for linking operations
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

    const data = await this.query<{ create_item: MondayItem }>(mutation, {
      boardId,
      itemName,
      columnValues: JSON.stringify(columnValues),
    });

    console.log(`[Monday] Created item ${data.create_item.id}: ${itemName}`);
    return data.create_item;
  }

  async updateItem(
    itemId: string,
    columnValues: MondayColumnValues
  ): Promise<MondayItem> {
    const mutation = `
      mutation updateItem($itemId: ID!, $columnValues: JSON!) {
        change_multiple_column_values(
          item_id: $itemId,
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

    console.log(`[Monday] Updating item ${itemId}`);

    const data = await this.query<{
      change_multiple_column_values: MondayItem;
    }>(mutation, {
      itemId,
      columnValues: JSON.stringify(columnValues),
    });

    return data.change_multiple_column_values;
  }

  async createAccount(
    boardId: string,
    accountData: MondayAccountData
  ): Promise<{ success: boolean; itemId?: string; error?: string }> {
    try {
      // ✅ FIRST: Check if account already exists
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

      // ✅ Create new account with proper notes for tracking
      const columnValues: MondayColumnValues = {
        company_description: `Customer from SimPro
Email: ${accountData.description || "Not provided"}
Phone: Not provided
Address: Not provided`,
        text_mktrez5x: `SimPro Customer ID: ${accountData.simproCustomerId}
Last Sync: ${new Date().toISOString()}
Source: SimPro Webhook`,
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
      // ✅ FIRST: Check if contact already exists
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

      // ✅ Create new contact with proper columns and notes
      const columnValues: MondayColumnValues = {};

      // Email column
      if (contactData.email) {
        columnValues["contact_email"] = {
          email: contactData.email,
          text: contactData.email,
        };
      }

      // Phone column
      if (contactData.phone) {
        const cleanPhone = contactData.phone
          .replace(/\s+/g, "")
          .replace(/[^\d+]/g, "");
        columnValues["contact_phone"] = cleanPhone;
      }

      // Notes column with SimPro tracking
      columnValues["text_mktr67s0"] = `SimPro Contact ID: ${
        contactData.simproContactId
      }
Contact Type: ${contactData.contactType || "customer"}
Department: ${contactData.department || "Not specified"}
Position: ${contactData.position || "Not specified"}
Last Sync: ${new Date().toISOString()}`;

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

  async createDeal(
    boardId: string,
    dealData: MondayDealData
  ): Promise<{ success: boolean; itemId?: string; error?: string }> {
    try {
      // ✅ FIRST: Check if deal already exists
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

      // ✅ Create new deal with proper columns
      const columnValues: MondayColumnValues = {};

      // Deal value
      if (dealData.dealValue) {
        columnValues["deal_value"] = dealData.dealValue;
      }

      // Status/Stage mapping
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

      // Close date
      if (dealData.closeDate) {
        columnValues["deal_expected_close_date"] = dealData.closeDate;
      }

      // Notes with SimPro tracking
      columnValues["text_mktrtr9b"] = `SimPro Quote ID: ${
        dealData.simproQuoteId
      }
Customer: ${dealData.accountName}
Salesperson: ${dealData.salesperson || "Not specified"}
Site: ${dealData.siteName || "Not specified"}
Last Sync: ${new Date().toISOString()}`;

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

  // ✅ FIXED: Updated GraphQL query for Monday API v2024-04
  async findItemBySimProId(
    boardId: string,
    simproId: number,
    idField: "quote" | "customer" | "contact" = "quote"
  ): Promise<MondayItem | null> {
    const searchTerm = `SimPro ${
      idField === "quote"
        ? "Quote"
        : idField === "customer"
        ? "Customer"
        : "Contact"
    } ID: ${simproId}`;

    const query = `
      query ($boardId: ID!) {
        boards(ids: [$boardId]) {
          items_page(limit: 50) {
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

    try {
      const data = await this.query<{
        boards: Array<{ items_page: { items: MondayItem[] } }>;
      }>(query, { boardId });

      if (!data.boards || data.boards.length === 0) {
        return null;
      }

      const items = data.boards[0].items_page?.items || [];

      for (const item of items) {
        // ✅ SAFE NULL CHECK: Check if column_values exists before iterating
        if (item.column_values && Array.isArray(item.column_values)) {
          for (const columnValue of item.column_values) {
            // ✅ SAFE NULL CHECK: Check if columnValue and text exist
            if (columnValue?.text && columnValue.text.includes(searchTerm)) {
              return item;
            }
          }
        }
      }

      return null;
    } catch (error) {
      console.error(`[Monday] Error finding item by SimPro ID:`, error);
      return null;
    }
  }
}
