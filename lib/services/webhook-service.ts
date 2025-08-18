// lib/services/webhook-service.ts - COMPLETE VERSION with bulletproof duplicate prevention
import { SyncService } from "./sync-service";
import { SimProWebhookPayload } from "@/types/simpro";
import { logger } from "@/lib/utils/logger";

export class WebhookService {
  private processedWebhooks = new Map<string, number>(); // In-memory dedup cache

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

      // 🛡️ CRITICAL: In-memory duplicate prevention for rapid webhooks
      const webhookKey = `${payload.ID}-${quoteId}`;
      const now = Date.now();

      if (this.processedWebhooks.has(webhookKey)) {
        const lastProcessed = this.processedWebhooks.get(webhookKey)!;
        if (now - lastProcessed < 30000) {
          // 30 second window
          logger.warn(
            `[Webhook Service] 🚫 DUPLICATE WEBHOOK BLOCKED: ${
              payload.ID
            } for quote ${quoteId} (processed ${Math.round(
              (now - lastProcessed) / 1000
            )}s ago)`
          );
          return {
            success: true,
            message: `Duplicate webhook blocked - quote ${quoteId} ${payload.ID} already processed recently`,
          };
        }
      }

      // Mark as processing
      this.processedWebhooks.set(webhookKey, now);

      // Clean old entries (keep only last 5 minutes) - Fix for ES5 compatibility
      const keysToDelete: string[] = [];
      this.processedWebhooks.forEach((timestamp, key) => {
        if (now - timestamp > 300000) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach((key) => this.processedWebhooks.delete(key));

      switch (payload.ID) {
        case "quote.created":
          return await this.handleQuoteCreatedWithDuplicateCheck(
            quoteId,
            companyId
          );

        case "quote.status":
        case "quote.updated":
          return await this.handleQuoteUpdatedWithDuplicateCheck(
            quoteId,
            companyId
          );

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

  // 🛡️ BULLETPROOF: Quote creation with multiple duplicate checks
  private async handleQuoteCreatedWithDuplicateCheck(
    quoteId: number,
    companyId: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(
        `[Webhook Service] 🚀 REAL-TIME: Processing quote creation for quote ${quoteId}`
      );

      // 🛡️ STEP 1: Check if quote already exists in Monday BEFORE creating
      const boardId = process.env.MONDAY_DEALS_BOARD_ID!;
      const existingDeal = await this.findQuoteInMondayExtensive(
        quoteId,
        boardId
      );

      if (existingDeal) {
        logger.warn(
          `[Webhook Service] 🚫 DUPLICATE CREATION BLOCKED: Quote ${quoteId} already exists as "${existingDeal.name}" (${existingDeal.id})`
        );
        return {
          success: true,
          message: `Quote ${quoteId} already exists in Monday as "${existingDeal.name}" - duplicate creation prevented`,
        };
      }

      // 🛡️ STEP 2: Double-check with SimPro ID column search
      const simproIdExists = await this.syncService.findDealBySimProId(
        quoteId,
        boardId
      );
      if (simproIdExists) {
        logger.warn(
          `[Webhook Service] 🚫 DUPLICATE CREATION BLOCKED (SimPro ID check): Quote ${quoteId} found as "${simproIdExists.name}" (${simproIdExists.id})`
        );
        return {
          success: true,
          message: `Quote ${quoteId} already exists in Monday (SimPro ID match) - duplicate creation prevented`,
        };
      }

      // ✅ STEP 3: Quote doesn't exist - safe to create
      logger.info(
        `[Webhook Service] ✅ Quote ${quoteId} confirmed new - proceeding with creation`
      );

      // Fix: Provide the required config parameter
      const result = await this.syncService.syncSingleQuote(
        quoteId,
        companyId,
        {
          minimumQuoteValue: 10000, // Using default minimum value for webhooks
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
        throw new Error(
          `Failed to sync quote ${quoteId} to Monday: ${result.message}`
        );
      }
    } catch (error) {
      logger.error(`[Webhook Service] Failed to create quote ${quoteId}`, {
        error,
      });
      return {
        success: false,
        message: `Failed to create quote ${quoteId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  // 🛡️ ENHANCED: Quote update with existence check
  private async handleQuoteUpdatedWithDuplicateCheck(
    quoteId: number,
    companyId: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(
        `[Webhook Service] 🔄 REAL-TIME: Processing quote update for quote ${quoteId}`
      );

      // 🛡️ Check if quote exists first
      const boardId = process.env.MONDAY_DEALS_BOARD_ID!;
      const existingDeal = await this.findQuoteInMondayExtensive(
        quoteId,
        boardId
      );

      if (!existingDeal) {
        logger.info(
          `[Webhook Service] ➕ Quote ${quoteId} doesn't exist in Monday - treating update as creation`
        );
        return await this.handleQuoteCreatedWithDuplicateCheck(
          quoteId,
          companyId
        );
      }

      // ✅ Quote exists - proceed with update
      logger.info(
        `[Webhook Service] 🔄 Updating existing quote ${quoteId} ("${existingDeal.name}")`
      );

      // Fix: Provide the required config parameter
      const result = await this.syncService.syncSingleQuote(
        quoteId,
        companyId,
        {
          minimumQuoteValue: 10000, // Using default minimum value for webhooks
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
      logger.error(`[Webhook Service] Failed to update quote ${quoteId}`, {
        error,
      });
      return {
        success: false,
        message: `Failed to update quote ${quoteId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  // 🛡️ COMPREHENSIVE: Multiple search strategies to find existing quotes
  private async findQuoteInMondayExtensive(
    quoteId: number,
    boardId: string
  ): Promise<any | null> {
    try {
      logger.debug(
        `[Webhook Service] 🔍 Comprehensive search for quote ${quoteId}`
      );

      // Strategy 1: Search by SimPro ID column (most reliable)
      const bySimproId = await this.syncService.findDealBySimProId(
        quoteId,
        boardId
      );
      if (bySimproId) {
        logger.debug(
          `[Webhook Service] ✅ Found quote ${quoteId} by SimPro ID column`
        );
        return bySimproId;
      }

      // Strategy 2: Search by quote name pattern
      const byName = await this.findQuoteByNamePattern(quoteId, boardId);
      if (byName) {
        logger.debug(
          `[Webhook Service] ✅ Found quote ${quoteId} by name pattern`
        );
        return byName;
      }

      // Strategy 3: Search by notes content (backup)
      const byNotes = await this.findQuoteByNotesContent(quoteId, boardId);
      if (byNotes) {
        logger.debug(
          `[Webhook Service] ✅ Found quote ${quoteId} by notes content`
        );
        return byNotes;
      }

      logger.debug(`[Webhook Service] ❌ Quote ${quoteId} not found in Monday`);
      return null;
    } catch (error) {
      logger.error(
        `[Webhook Service] Error in comprehensive search for quote ${quoteId}`,
        {
          error,
        }
      );
      return null;
    }
  }

  private async findQuoteByNamePattern(
    quoteId: number,
    boardId: string
  ): Promise<any | null> {
    try {
      const query = `
        query FindQuoteByName($boardId: ID!) {
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

      const result: any = await this.syncService.mondayApi.query(query, {
        boardId,
      });
      const items = result.boards[0]?.items_page?.items || [];

      // Look for quotes with "Quote #8923" pattern
      const namePattern = `Quote #${quoteId}`;
      const match = items.find((item: any) => item.name.includes(namePattern));

      return match || null;
    } catch (error) {
      logger.error("Error searching by name pattern", { error, quoteId });
      return null;
    }
  }

  private async findQuoteByNotesContent(
    quoteId: number,
    boardId: string
  ): Promise<any | null> {
    try {
      const query = `
        query FindQuoteByNotes($boardId: ID!) {
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

      const result: any = await this.syncService.mondayApi.query(query, {
        boardId,
      });
      const items = result.boards[0]?.items_page?.items || [];

      // Look in notes/text columns for "SimPro Quote ID: 8923"
      const notesPattern = `SimPro Quote ID: ${quoteId}`;
      const match = items.find((item: any) =>
        item.column_values.some(
          (cv: any) => cv.text && cv.text.includes(notesPattern)
        )
      );

      return match || null;
    } catch (error) {
      logger.error("Error searching by notes content", { error, quoteId });
      return null;
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
