// lib/clients/monday/monday-accounts.ts - Account operations only
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
      // Check if account already exists
      const existing = await this.findAccountBySimProId(
        accountData.simproCustomerId,
        boardId
      );
      if (existing) {
        logger.info(
          `[Monday Accounts] ✅ Using existing account: "${existing.name}" (${existing.id})`
        );
        return { success: true, itemId: existing.id };
      }

      logger.info(
        `[Monday Accounts] Creating new account: "${accountData.accountName}"`
      );

      // Prepare column values
      const columnValues: any = {};

      // if (accountData.description) {
      //   columnValues[this.columnIds.accounts.description] =
      //     accountData.description;
      // }

      // Add SimPro tracking info
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

  private async findAccountBySimProId(
    simproCustomerId: number,
    boardId: string
  ): Promise<MondayItem | null> {
    try {
      const query = `
        query FindAccount($boardId: ID!) {
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

      // Search for account by SimPro Customer ID in notes
      for (const item of items) {
        const notesColumn = item.column_values.find(
          (cv: any) => cv.id === this.columnIds.accounts.notes
        );
        if (
          notesColumn?.text?.includes(`SimPro Customer ID: ${simproCustomerId}`)
        ) {
          return item;
        }
      }

      return null;
    } catch (error) {
      logger.error("[Monday Accounts] Error finding account by SimPro ID", {
        error,
        simproCustomerId,
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
