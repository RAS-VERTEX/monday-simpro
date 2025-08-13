// lib/clients/monday/monday-deals.ts - Deal operations only
import { MondayApi } from "./monday-api";
import { MondayColumnIds } from "./monday-config";
import { MondayDealData, MondayItem } from "@/types/monday";
import { MondayStage, getMondayStageIndex } from "@/lib/utils/stage-mapper";
import { logger } from "@/lib/utils/logger";

export class MondayDeals {
  constructor(private api: MondayApi, private columnIds: MondayColumnIds) {}

  async createDeal(
    boardId: string,
    dealData: MondayDealData,
    accountId?: string,
    contactIds?: string[]
  ): Promise<{ success: boolean; itemId?: string; error?: string }> {
    try {
      // Check if deal already exists
      const existing = await this.findDealBySimProId(
        dealData.simproQuoteId,
        boardId
      );
      if (existing) {
        logger.info(
          `[Monday Deals] ✅ Using existing deal: "${existing.name}" (${existing.id})`
        );
        return { success: true, itemId: existing.id };
      }

      logger.info(`[Monday Deals] Creating new deal: "${dealData.dealName}"`);

      // Prepare column values
      const columnValues: any = {};

      // Deal value
      if (dealData.dealValue) {
        columnValues[this.columnIds.deals.value] = dealData.dealValue;
      }

      // Close date
      if (dealData.dueDate) {
        columnValues[this.columnIds.deals.close_date] = {
          date: dealData.dueDate,
        };
      }

      // Link to account and contacts
      if (accountId) {
        columnValues[this.columnIds.deals.accounts_relation] = {
          item_ids: [parseInt(accountId)],
        };
      }

      if (contactIds && contactIds.length > 0) {
        columnValues[this.columnIds.deals.contacts_relation] = {
          item_ids: contactIds.map((id) => parseInt(id)),
        };
      }

      // Add SimPro tracking info
      const notes = `SimPro Quote ID: ${
        dealData.simproQuoteId
      }\nLast Sync: ${new Date().toISOString()}\nSource: SimPro`;
      columnValues[this.columnIds.deals.notes] = notes;

      // Create the deal without stage first
      const item = await this.createItem(
        boardId,
        dealData.dealName,
        columnValues
      );

      // Set stage separately to avoid conflicts
      if (dealData.stage) {
        await this.updateDealStage(
          item.id,
          boardId,
          dealData.stage as MondayStage
        );
      }

      logger.info(`[Monday Deals] ✅ Deal created successfully: ${item.id}`);
      return { success: true, itemId: item.id };
    } catch (error) {
      logger.error(`[Monday Deals] Failed to create deal`, { error, dealData });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async updateDealStage(
    dealId: string,
    boardId: string,
    newStage: MondayStage
  ): Promise<{ success: boolean; error?: string }> {
    try {
      logger.info(
        `[Monday Deals] Updating deal ${dealId} stage to: ${newStage}`
      );

      const stageIndex = getMondayStageIndex(newStage);

      const mutation = `
        mutation UpdateDealStage($itemId: ID!, $boardId: ID!, $columnId: String!, $value: String!) {
          change_column_value(
            item_id: $itemId
            board_id: $boardId
            column_id: $columnId
            value: $value
          ) {
            id
            name
          }
        }
      `;

      await this.api.query(mutation, {
        itemId: dealId,
        boardId,
        columnId: this.columnIds.deals.stage,
        value: JSON.stringify({ index: stageIndex }),
      });

      logger.info(
        `[Monday Deals] ✅ Updated deal ${dealId} stage to ${newStage}`
      );
      return { success: true };
    } catch (error) {
      logger.error(`[Monday Deals] Failed to update deal stage`, {
        error,
        dealId,
        newStage,
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async findDealBySimProId(
    simproQuoteId: number,
    boardId: string
  ): Promise<MondayItem | null> {
    try {
      const query = `
        query FindDeal($boardId: ID!) {
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

      // Search for deal by SimPro Quote ID in notes or name
      for (const item of items) {
        const notesColumn = item.column_values.find(
          (cv: any) => cv.id === this.columnIds.deals.notes
        );
        if (notesColumn?.text?.includes(`SimPro Quote ID: ${simproQuoteId}`)) {
          return item;
        }

        // Also check deal name for quote ID
        if (item.name.includes(`Quote #${simproQuoteId}`)) {
          return item;
        }
      }

      return null;
    } catch (error) {
      logger.error("[Monday Deals] Error finding deal by SimPro ID", {
        error,
        simproQuoteId,
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
