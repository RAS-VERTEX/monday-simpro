// lib/clients/monday/monday-accounts.ts - Complete fixed version with name matching
import { MondayApi } from "./monday-api";
import { MondayColumnIds } from "./monday-config";
import { MondayAccountData, MondayItem } from "@/types/monday";
import { logger } from "@/lib/utils/logger";

export class MondayAccounts {
  constructor(private api: MondayApi, private columnIds: MondayColumnIds) {}

  async createAccount(
    boardId: string,
    accountData: MondayAccountData
  ): Promise<{ success: boolean; itemId?: string; error?: string }> {
    try {
      // STEP 1: Check for exact name match first (case-insensitive)
      const existingByName = await this.findAccountByExactName(
        accountData.accountName,
        boardId
      );

      if (existingByName) {
        logger.info(
          `[Monday Accounts] 🔄 Found existing account by name: "${existingByName.name}" (${existingByName.id})`
        );

        // Check if it already has a SimPro ID
        const hasSimProId = await this.accountHasSimProId(
          existingByName.id,
          boardId
        );

        if (!hasSimProId) {
          // Update existing account with SimPro ID
          await this.addSimProIdToAccount(
            existingByName.id,
            boardId,
            accountData.simproCustomerId
          );

          logger.info(
            `[Monday Accounts] ✅ Updated existing account "${existingByName.name}" with SimPro Customer ID: ${accountData.simproCustomerId}`
          );

          return { success: true, itemId: existingByName.id };
        } else {
          logger.info(
            `[Monday Accounts] ✅ Using existing account "${existingByName.name}" (already has SimPro ID)`
          );
          return { success: true, itemId: existingByName.id };
        }
      }

      // STEP 2: Check by SimPro Customer ID (existing logic)
      const existingBySimProId = await this.findAccountBySimProId(
        accountData.simproCustomerId,
        boardId
      );

      if (existingBySimProId) {
        logger.info(
          `[Monday Accounts] ✅ Found existing account by SimPro ID: "${existingBySimProId.name}" (${existingBySimProId.id})`
        );
        return { success: true, itemId: existingBySimProId.id };
      }

      // STEP 3: Create new account if no matches found
      logger.info(
        `[Monday Accounts] Creating new account: "${accountData.accountName}"`
      );

      const columnValues: any = {};

      // Add SimPro Customer ID to dedicated column
      columnValues["text_mktzqxk"] = accountData.simproCustomerId.toString();

      // Add SimPro tracking info to notes
      const notes = `SimPro Customer ID: ${
        accountData.simproCustomerId
      }\nLast Sync: ${new Date().toISOString()}\nSource: SimPro`;
      columnValues[this.columnIds.accounts.notes] = notes;

      const item = await this.createItem(
        boardId,
        accountData.accountName,
        columnValues
      );

      logger.info(
        `[Monday Accounts] ✅ Account created successfully: ${item.id}`
      );
      return { success: true, itemId: item.id };
    } catch (error) {
      logger.error(`[Monday Accounts] Failed to create account`, {
        error,
        accountData,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Find account by exact name match (case-insensitive)
   */
  private async findAccountByExactName(
    accountName: string,
    boardId: string
  ): Promise<MondayItem | null> {
    try {
      logger.debug(
        `[Monday Accounts] Searching for exact name match: "${accountName}"`
      );

      const query = `
        query FindAccountByName($boardId: ID!) {
          boards(ids: [$boardId]) {
            items_page(limit: 100) {
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

      const cleanSearchName = accountName.trim().toLowerCase();

      for (const item of items) {
        const cleanItemName = item.name.trim().toLowerCase();

        if (cleanItemName === cleanSearchName) {
          logger.debug(
            `[Monday Accounts] Found exact name match: "${item.name}" (${item.id})`
          );
          return item;
        }
      }

      logger.debug(
        `[Monday Accounts] No exact name match found for: "${accountName}"`
      );
      return null;
    } catch (error) {
      logger.error("[Monday Accounts] Error finding account by name", {
        error,
        accountName,
      });
      return null;
    }
  }

  /**
   * Check if account already has a SimPro ID in dedicated column
   */
  private async accountHasSimProId(
    accountId: string,
    boardId: string
  ): Promise<boolean> {
    try {
      const query = `
        query CheckSimProId($itemId: ID!) {
          items(ids: [$itemId]) {
            column_values(ids: ["text_mktzqxk"]) {
              id
              text
            }
          }
        }
      `;

      const result = await this.api.query(query, { itemId: accountId });
      const simproColumn = result.items[0]?.column_values[0];

      const hasSimProId = !!(simproColumn?.text && simproColumn.text.trim());

      logger.debug(
        `[Monday Accounts] Account ${accountId} has SimPro ID: ${hasSimProId} (value: "${
          simproColumn?.text || "empty"
        }")`
      );

      return hasSimProId;
    } catch (error) {
      logger.error("[Monday Accounts] Error checking SimPro ID", {
        error,
        accountId,
      });
      return false;
    }
  }

  /**
   * Add SimPro Customer ID to existing account's dedicated column
   */
  private async addSimProIdToAccount(
    accountId: string,
    boardId: string,
    simproCustomerId: number
  ): Promise<void> {
    try {
      // Update dedicated SimPro ID column
      const mutation = `
        mutation UpdateSimProId($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
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
        itemId: accountId,
        boardId,
        columnId: "text_mktzqxk", // Dedicated SimPro ID column
        value: JSON.stringify(simproCustomerId.toString()),
      });

      // Also update notes with sync info
      const currentNotes = await this.getCurrentNotes(accountId);
      const simProInfo = `SimPro Customer ID: ${simproCustomerId}\nLast Sync: ${new Date().toISOString()}\nSource: SimPro (Added to existing account)`;

      const updatedNotes = currentNotes
        ? `${currentNotes}\n\n${simProInfo}`
        : simProInfo;

      await this.api.query(mutation, {
        itemId: accountId,
        boardId,
        columnId: this.columnIds.accounts.notes,
        value: JSON.stringify(updatedNotes),
      });

      logger.info(
        `[Monday Accounts] ✅ Added SimPro Customer ID ${simproCustomerId} to account ${accountId} in dedicated column`
      );
    } catch (error) {
      logger.error("[Monday Accounts] Error adding SimPro ID to account", {
        error,
        accountId,
        simproCustomerId,
      });
      throw error;
    }
  }

  /**
   * Get current notes from account
   */
  private async getCurrentNotes(accountId: string): Promise<string | null> {
    try {
      const query = `
        query GetAccountNotes($itemId: ID!) {
          items(ids: [$itemId]) {
            column_values(ids: ["${this.columnIds.accounts.notes}"]) {
              text
            }
          }
        }
      `;

      const result = await this.api.query(query, { itemId: accountId });
      const notesColumn = result.items[0]?.column_values[0];

      return notesColumn?.text || null;
    } catch (error) {
      logger.error("[Monday Accounts] Error getting current notes", {
        error,
        accountId,
      });
      return null;
    }
  }

  /**
   * Find account by SimPro Customer ID in dedicated column
   */
  private async findAccountBySimProId(
    simproCustomerId: number,
    boardId: string
  ): Promise<MondayItem | null> {
    try {
      const query = `
        query FindAccount($boardId: ID!) {
          boards(ids: [$boardId]) {
            items_page(limit: 100) {
              items {
                id
                name
                column_values(ids: ["text_mktzqxk"]) {
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
      const simproIdStr = simproCustomerId.toString();

      for (const item of items) {
        const simproIdColumn = item.column_values?.find(
          (cv: any) => cv.id === "text_mktzqxk"
        );

        if (simproIdColumn?.text === simproIdStr) {
          logger.debug(
            `[Monday Accounts] Found account by SimPro ID ${simproCustomerId}: ${item.name} (${item.id})`
          );
          return item;
        }
      }

      logger.debug(
        `[Monday Accounts] No account found with SimPro ID: ${simproCustomerId}`
      );
      return null;
    } catch (error) {
      logger.error("[Monday Accounts] Error finding account by SimPro ID", {
        error,
        simproCustomerId,
      });
      return null;
    }
  }

  /**
   * Create new item in Monday.com
   */
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

    if (!result.create_item) {
      throw new Error("Failed to create item - no response from Monday.com");
    }

    return result.create_item;
  }
}
