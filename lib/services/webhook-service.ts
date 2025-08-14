// lib/services/webhook-service.ts - REAL-TIME VERSION
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
          return this.handleQuoteDeleted(quoteId);

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
        message:
          error instanceof Error
            ? error.message
            : "Unknown webhook processing error",
      };
    }
  }

  // 🚀 REAL-TIME: Sync immediately when quote is created
  private async handleQuoteCreatedRealTime(
    quoteId: number,
    companyId: number
  ): Promise<{ success: boolean; message: string }> {
    logger.info(
      `[Webhook Service] 🚀 REAL-TIME: Processing quote.created for quote ${quoteId}`
    );

    try {
      // Trigger immediate sync for this specific quote
      const syncResult = await this.syncService.syncSingleQuote(
        quoteId,
        companyId,
        {
          minimumQuoteValue: 15000,
        }
      );

      if (syncResult.success) {
        logger.info(
          `[Webhook Service] ✅ Quote ${quoteId} synced to Monday INSTANTLY!`
        );
        return {
          success: true,
          message: `Quote ${quoteId} created and synced to Monday.com instantly!`,
        };
      } else {
        logger.warn(
          `[Webhook Service] ⚠️ Quote ${quoteId} created but didn't meet sync criteria (likely <$15k)`
        );
        return {
          success: true,
          message: `Quote ${quoteId} created but not synced (below $15k threshold)`,
        };
      }
    } catch (error) {
      logger.error(
        `[Webhook Service] ❌ Failed to sync quote ${quoteId} immediately`,
        { error }
      );
      return {
        success: false,
        message: `Quote ${quoteId} creation failed to sync: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  // 🚀 REAL-TIME: Sync immediately when quote is updated
  private async handleQuoteUpdatedRealTime(
    quoteId: number,
    companyId: number
  ): Promise<{ success: boolean; message: string }> {
    logger.info(
      `[Webhook Service] 🚀 REAL-TIME: Processing quote update for quote ${quoteId}`
    );

    try {
      // Trigger immediate sync for this updated quote
      const syncResult = await this.syncService.syncSingleQuote(
        quoteId,
        companyId,
        {
          minimumQuoteValue: 15000,
        }
      );

      if (syncResult.success) {
        logger.info(
          `[Webhook Service] ✅ Quote ${quoteId} update synced to Monday INSTANTLY!`
        );
        return {
          success: true,
          message: `Quote ${quoteId} updated and synced to Monday.com instantly!`,
        };
      } else {
        logger.warn(
          `[Webhook Service] ⚠️ Quote ${quoteId} updated but doesn't meet sync criteria`
        );
        return {
          success: true,
          message: `Quote ${quoteId} updated but not synced (below $15k threshold or invalid status)`,
        };
      }
    } catch (error) {
      logger.error(
        `[Webhook Service] ❌ Failed to sync quote ${quoteId} update immediately`,
        { error }
      );
      return {
        success: false,
        message: `Quote ${quoteId} update failed to sync: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  private handleQuoteDeleted(quoteId: number): {
    success: boolean;
    message: string;
  } {
    logger.info(
      `[Webhook Service] Quote ${quoteId} deleted in SimPro - preserving in Monday for history`
    );

    // We don't delete from Monday when quotes are deleted in SimPro
    // This preserves the sales history and communication

    return {
      success: true,
      message: `Quote ${quoteId} deletion acknowledged - preserved in Monday for history`,
    };
  }
}
