// lib/services/webhook-service.ts - Simplified webhook processing
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
          return await this.handleQuoteCreated(quoteId, companyId);

        case "quote.status":
        case "quote.updated":
          return await this.handleQuoteUpdated(quoteId, companyId);

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

  private async handleQuoteCreated(
    quoteId: number,
    companyId: number
  ): Promise<{ success: boolean; message: string }> {
    logger.info(
      `[Webhook Service] Processing quote.created for quote ${quoteId}`
    );

    try {
      // For new quotes, we can trigger a limited sync to process just this quote
      // This is a simplified approach - in reality, you'd want to check if the quote
      // meets criteria (>$15k, not closed) before syncing

      // For now, just log that we received the event
      logger.info(
        `[Webhook Service] ✅ Quote ${quoteId} created - will be picked up in next sync`
      );

      return {
        success: true,
        message: `Quote ${quoteId} creation acknowledged - will sync in next batch`,
      };
    } catch (error) {
      logger.error(
        `[Webhook Service] Failed to process quote.created for ${quoteId}`,
        { error }
      );
      throw error;
    }
  }

  private async handleQuoteUpdated(
    quoteId: number,
    companyId: number
  ): Promise<{ success: boolean; message: string }> {
    logger.info(
      `[Webhook Service] Processing quote update for quote ${quoteId}`
    );

    try {
      // For quote updates, we mainly care about status changes
      // In the simplified model, we'll let the scheduled sync handle this

      logger.info(
        `[Webhook Service] ✅ Quote ${quoteId} updated - will be picked up in next sync`
      );

      return {
        success: true,
        message: `Quote ${quoteId} update acknowledged - will sync in next batch`,
      };
    } catch (error) {
      logger.error(
        `[Webhook Service] Failed to process quote update for ${quoteId}`,
        { error }
      );
      throw error;
    }
  }

  private handleQuoteDeleted(quoteId: number): {
    success: boolean;
    message: string;
  } {
    logger.info(
      `[Webhook Service] Quote ${quoteId} deleted in SimPro - not deleting from Monday`
    );

    // We don't delete from Monday when quotes are deleted in SimPro
    // This preserves the sales history and communication

    return {
      success: true,
      message: `Quote ${quoteId} deletion acknowledged - preserved in Monday for history`,
    };
  }
}
