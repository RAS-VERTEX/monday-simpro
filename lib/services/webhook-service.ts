// lib/services/webhook-service.ts - COMPLETE UPDATED VERSION with deletion handling
import { SyncService } from "./sync-service";
import { SimProWebhookPayload } from "@/types/simpro";
import { logger } from "@/lib/utils/logger";

export class WebhookService {
  constructor(private syncService: SyncService) {}

  async processSimProWebhook(
    payload: SimProWebhookPayload
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(
        `[Webhook Service] Processing SimPro webhook: ${payload.ID}`,
        {
          quoteId: payload.reference?.quoteID,
          companyId: payload.reference?.companyID,
        }
      );

      // Only process quote events
      if (!payload.ID.startsWith("quote.")) {
        logger.debug(
          `[Webhook Service] Ignoring non-quote event: ${payload.ID}`
        );
        return {
          success: true,
          message: `Event ignored - not a quote event: ${payload.ID}`,
        };
      }

      const quoteId = payload.reference?.quoteID;
      const companyId = payload.reference?.companyID;

      if (!quoteId || companyId === undefined) {
        throw new Error("Missing quote ID or company ID in webhook payload");
      }

      switch (payload.ID) {
        case "quote.created":
          return await this.handleQuoteCreatedRealTime(quoteId, companyId);

        case "quote.status":
        case "quote.updated":
          return await this.handleQuoteUpdatedRealTime(quoteId, companyId);

        case "quote.deleted":
          return await this.handleQuoteDeleted(quoteId);

        default:
          logger.warn(`[Webhook Service] Unhandled quote event: ${payload.ID}`);
          return {
            success: true,
            message: `Event acknowledged but not processed: ${payload.ID}`,
          };
      }
    } catch (error) {
      logger.error("[Webhook Service] Failed to process SimPro webhook", {
        error,
        payload,
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async handleQuoteCreatedRealTime(
    quoteId: number,
    companyId: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(
        `[Webhook Service] 🚀 REAL-TIME: Processing quote creation for quote ${quoteId}`
      );

      const result = await this.syncService.syncSingleQuote(
        quoteId,
        companyId,
        {
          minimumQuoteValue: 10000, // Using default minimum value
        }
      );

      if (result.success) {
        logger.info(
          `[Webhook Service] ✅ Quote ${quoteId} creation synced to Monday INSTANTLY!`
        );
        return {
          success: true,
          message: `Quote ${quoteId} created and synced to Monday.com instantly!`,
        };
      } else {
        logger.warn(
          `[Webhook Service] ⚠️ Quote ${quoteId} creation not synced: ${result.message}`
        );
        return {
          success: true,
          message: `Quote ${quoteId} creation acknowledged but not synced: ${result.message}`,
        };
      }
    } catch (error) {
      logger.error(`[Webhook Service] Failed to process quote creation`, {
        error,
        quoteId,
        companyId,
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async handleQuoteUpdatedRealTime(
    quoteId: number,
    companyId: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(
        `[Webhook Service] 🚀 REAL-TIME: Processing quote update for quote ${quoteId}`
      );

      const result = await this.syncService.syncSingleQuote(
        quoteId,
        companyId,
        {
          minimumQuoteValue: 10000, // Using default minimum value
        }
      );

      if (result.success) {
        logger.info(
          `[Webhook Service] ✅ Quote ${quoteId} update synced to Monday INSTANTLY!`
        );
        return {
          success: true,
          message: `Quote ${quoteId} updated and synced to Monday.com instantly!`,
        };
      } else {
        logger.warn(
          `[Webhook Service] ⚠️ Quote ${quoteId} update not synced: ${result.message}`
        );
        return {
          success: true,
          message: `Quote ${quoteId} update acknowledged but not synced: ${result.message}`,
        };
      }
    } catch (error) {
      logger.error(`[Webhook Service] Failed to process quote update`, {
        error,
        quoteId,
        companyId,
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ✅ UPDATED: Actually delete quotes from Monday when deleted in SimPro
  private async handleQuoteDeleted(quoteId: number): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      logger.info(
        `[Webhook Service] 🗑️ Quote ${quoteId} deleted in SimPro - removing from Monday`
      );

      // Find the deal in Monday across all boards (Active, Won, Lost)
      const boardIds = [
        process.env.MONDAY_DEALS_BOARD_ID!, // Active deals
        // Add other board IDs if Won/Lost are separate boards
        // process.env.MONDAY_DEALS_WON_BOARD_ID,
        // process.env.MONDAY_DEALS_LOST_BOARD_ID,
      ];

      let deletedFrom: string | null = null;

      for (const boardId of boardIds) {
        try {
          const deal = await this.syncService.findDealBySimProId(
            quoteId,
            boardId
          );

          if (deal) {
            await this.deleteDealFromMonday(deal.id);
            deletedFrom = boardId;
            logger.info(
              `[Webhook Service] ✅ Deleted deal ${deal.id} for quote ${quoteId} from board ${boardId}`
            );
            break;
          }
        } catch (error) {
          logger.warn(
            `[Webhook Service] Failed to check/delete from board ${boardId}`,
            { error }
          );
        }
      }

      if (deletedFrom) {
        return {
          success: true,
          message: `Quote ${quoteId} deleted from Monday board ${deletedFrom}`,
        };
      } else {
        logger.warn(
          `[Webhook Service] Quote ${quoteId} not found in any Monday board - may have been already deleted`
        );
        return {
          success: true,
          message: `Quote ${quoteId} not found in Monday - may have been already deleted`,
        };
      }
    } catch (error) {
      logger.error(`[Webhook Service] Failed to delete quote ${quoteId}`, {
        error,
      });
      return {
        success: false,
        message: `Failed to delete quote ${quoteId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  // ✅ NEW: Delete deal item from Monday
  private async deleteDealFromMonday(dealId: string): Promise<void> {
    try {
      const mutation = `
        mutation DeleteItem($itemId: ID!) {
          delete_item(item_id: $itemId) {
            id
          }
        }
      `;

      await this.syncService.mondayApi.query(mutation, {
        itemId: dealId,
      });

      logger.info(
        `[Webhook Service] ✅ Successfully deleted deal ${dealId} from Monday`
      );
    } catch (error) {
      logger.error(`[Webhook Service] Failed to delete deal ${dealId}`, {
        error,
      });
      throw error;
    }
  }
}
