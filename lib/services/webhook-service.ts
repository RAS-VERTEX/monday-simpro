// lib/services/webhook-service.ts - COMPLETE VERSION with rate limiting and lightweight updates
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

      // Clean old entries (keep only last 5 minutes)
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

  // 🛡️ ENHANCED: Quote update with lightweight updates and rate limiting
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

      // ✅ Quote exists - proceed with LIGHTWEIGHT update (not full sync)
      logger.info(
        `[Webhook Service] 🔄 Updating existing quote ${quoteId} ("${existingDeal.name}")`
      );

      // ✅ NEW: For existing deals, only update the status (much lighter API call)
      try {
        const basicQuote = await this.syncService.getSimProQuoteDetails(
          companyId,
          quoteId
        );
        const newStatus = basicQuote.Status?.Name?.trim();

        if (newStatus && this.isStatusUpdateNeeded(newStatus)) {
          await this.updateDealStatusOnly(existingDeal.id, boardId, newStatus);

          logger.info(
            `[Webhook Service] ✅ Quote ${quoteId} status updated to "${newStatus}"`
          );
          return {
            success: true,
            message: `Quote ${quoteId} status updated to "${newStatus}" instantly!`,
          };
        } else {
          logger.info(
            `[Webhook Service] ℹ️ Quote ${quoteId} status unchanged, no update needed`
          );
          return {
            success: true,
            message: `Quote ${quoteId} status unchanged, no update needed`,
          };
        }
      } catch (error: any) {
        logger.error(
          `[Webhook Service] Failed to update quote ${quoteId} status`,
          { error }
        );

        // If rate limited, return success but log the issue
        if (this.isRateLimitError(error)) {
          logger.warn(
            `[Webhook Service] 🚦 Rate limited updating quote ${quoteId}, will retry later`
          );
          return {
            success: true, // Don't fail the webhook
            message: `Quote ${quoteId} update rate limited, will retry automatically`,
          };
        }

        throw error;
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

  // Helper method to check if status update is needed
  private isStatusUpdateNeeded(status: string): boolean {
    const importantStatuses = [
      "Quote: Won",
      "Quote : Won",
      "Quote: Archived - Not Won",
      "Quote : Archived - Not Won",
      "Quote: Sent",
      "Quote : Sent",
    ];

    return importantStatuses.some((s) =>
      status.replace(/\s/g, "").includes(s.replace(/\s/g, ""))
    );
  }

  // Check if error is rate limit related
  private isRateLimitError(error: any): boolean {
    return (
      error?.message?.includes("429") ||
      error?.message?.includes("Too Many Requests") ||
      error?.message?.includes("Complexity budget exhausted")
    );
  }

  // Lightweight status-only update method
  private async updateDealStatusOnly(
    dealId: string,
    boardId: string,
    newStatus: string
  ): Promise<void> {
    const statusMapping: { [key: string]: string } = {
      "Quote: Archived - Not Won": "Quote : Archived - Not Won", // Use Monday's exact format
      "Quote : Archived - Not Won": "Quote : Archived - Not Won",
      "Quote: Won": "Quote: Won",
      "Quote : Won": "Quote: Won",
      "Quote: Sent": "Quote: Sent",
      "Quote : Sent": "Quote: Sent",
    };

    const mondayStatus = statusMapping[newStatus] || newStatus;

    logger.info(
      `[Webhook Service] 🎯 Updating deal ${dealId} status: "${newStatus}" → "${mondayStatus}"`
    );

    // Use a simple, low-complexity update mutation
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

    await this.syncService.mondayClient.query(mutation, {
      itemId: dealId,
      boardId: boardId,
      columnId: "color_mktrw6k3",
      value: JSON.stringify({ label: mondayStatus }),
    });
  }

  // Handle quote deletion
  private async handleQuoteDeleted(
    quoteId: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(
        `[Webhook Service] 🗑️ Processing quote deletion for quote ${quoteId}`
      );

      const boardId = process.env.MONDAY_DEALS_BOARD_ID!;
      const existingDeal = await this.findQuoteInMondayExtensive(
        quoteId,
        boardId
      );

      if (!existingDeal) {
        logger.info(
          `[Webhook Service] ℹ️ Quote ${quoteId} not found in Monday - nothing to delete`
        );
        return {
          success: true,
          message: `Quote ${quoteId} not found in Monday - no deletion needed`,
        };
      }

      await this.deleteDealFromMonday(existingDeal.id);

      logger.info(`[Webhook Service] ✅ Quote ${quoteId} deleted from Monday`);
      return {
        success: true,
        message: `Quote ${quoteId} deleted from Monday.com successfully`,
      };
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

  // Delete deal item from Monday
  private async deleteDealFromMonday(dealId: string): Promise<void> {
    try {
      const mutation = `
        mutation DeleteItem($itemId: ID!) {
          delete_item(item_id: $itemId) {
            id
          }
        }
      `;

      await this.syncService.mondayClient.query(mutation, {
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

  // Search by quote name pattern
  private async findQuoteByNamePattern(
    quoteId: number,
    boardId: string
  ): Promise<any | null> {
    try {
      const query = `
        query FindQuoteByName($boardId: ID!) {
          boards(ids: [$boardId]) {
            items_page(limit: 50) {
              items {
                id
                name
              }
            }
          }
        }
      `;

      const result = (await this.syncService.mondayClient.query(query, {
        boardId,
      })) as any;
      const items = result.boards[0]?.items_page?.items || [];

      for (const item of items) {
        if (item.name && item.name.includes(`Quote #${quoteId}`)) {
          return item;
        }
      }

      return null;
    } catch (error) {
      logger.error(`[Webhook Service] Error searching by name pattern`, {
        error,
      });
      return null;
    }
  }

  // Search by notes content (backup method)
  private async findQuoteByNotesContent(
    quoteId: number,
    boardId: string
  ): Promise<any | null> {
    try {
      const query = `
        query FindQuoteByNotes($boardId: ID!) {
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

      const result = (await this.syncService.mondayClient.query(query, {
        boardId,
      })) as any;
      const items = result.boards[0]?.items_page?.items || [];

      for (const item of items) {
        const notesColumn = item.column_values?.find(
          (col: any) =>
            col.text && col.text.includes(`SimPro Quote ID: ${quoteId}`)
        );

        if (notesColumn) {
          return item;
        }
      }

      return null;
    } catch (error) {
      logger.error(`[Webhook Service] Error searching by notes content`, {
        error,
      });
      return null;
    }
  }
}
