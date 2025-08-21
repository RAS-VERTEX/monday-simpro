// lib/services/webhook-service.ts
import { SyncService } from "./sync-service";
import { SimProWebhookPayload } from "@/types/simpro";
import { logger } from "@/lib/utils/logger";

interface CachedItem {
  id: string;
  name: string;
  lastUpdated: number;
}

export class WebhookService {
  private processedWebhooks = new Map<string, number>();
  private itemCache = new Map<number, CachedItem>();
  private readonly CACHE_TTL = 300000; // 5 minutes
  private readonly DEBOUNCE_WINDOW = 30000; // 30 seconds
  private readonly MINIMUM_QUOTE_VALUE = 10000; // $10k minimum
  private readonly MONDAY_SEARCH_DELAY = 2000; // 2 second delay for eventual consistency
  private readonly MAX_SEARCH_RETRIES = 3; // Retry search if not found

  constructor(private syncService: SyncService) {}

  async processSimProWebhook(
    payload: SimProWebhookPayload
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`Processing SimPro webhook: ${payload.ID}`, {
        quoteId: payload.reference?.quoteID,
        companyId: payload.reference?.companyID,
      });

      if (!payload.ID.startsWith("quote.")) {
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

      // ✅ ENHANCED: More robust duplicate webhook detection
      if (this.isDuplicateWebhook(payload.ID, quoteId)) {
        return {
          success: true,
          message: `Duplicate webhook blocked - quote ${quoteId} ${payload.ID} already processed recently`,
        };
      }

      this.markWebhookProcessed(payload.ID, quoteId);

      switch (payload.ID) {
        case "quote.created":
          return await this.handleQuoteCreated(quoteId, companyId);

        case "quote.status":
        case "quote.updated":
          return await this.handleQuoteUpdated(quoteId, companyId);

        case "quote.deleted":
          return await this.handleQuoteDeleted(quoteId);

        default:
          logger.warn(`Unhandled quote event: ${payload.ID}`);
          return {
            success: true,
            message: `Event acknowledged but not processed: ${payload.ID}`,
          };
      }
    } catch (error) {
      logger.error("Failed to process SimPro webhook", { error, payload });
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async handleQuoteCreated(
    quoteId: number,
    companyId: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`Processing quote creation for quote ${quoteId}`);

      // STEP 1: Check price FIRST - no Monday API calls until we know it's valuable
      const priceCheckResult = await this.checkQuoteValueFirst(
        quoteId,
        companyId
      );
      if (!priceCheckResult.meetsMinimum) {
        logger.info(
          `Quote ${quoteId} value $${priceCheckResult.value} doesn't meet minimum $${this.MINIMUM_QUOTE_VALUE} - skipping all Monday API calls`
        );
        return {
          success: true,
          message: `Quote ${quoteId} value $${priceCheckResult.value} doesn't meet minimum $${this.MINIMUM_QUOTE_VALUE}`,
        };
      }

      logger.info(
        `Quote ${quoteId} value $${priceCheckResult.value} meets minimum - proceeding with Monday sync`
      );

      // ✅ ENHANCED: Multi-layer duplicate detection with retries
      const existingDeal = await this.findExistingDealWithRetries(quoteId);
      if (existingDeal) {
        this.updateCache(quoteId, existingDeal);
        logger.warn(
          `Quote ${quoteId} already exists as "${existingDeal.name}" (${existingDeal.id}) - duplicate creation prevented`
        );
        return {
          success: true,
          message: `Quote ${quoteId} already exists - duplicate creation prevented`,
        };
      }

      // STEP 4: Create new quote (now we know it's valuable and doesn't exist)
      logger.info(
        `Creating quote ${quoteId} - confirmed it doesn't exist in Monday`
      );

      const result = await this.syncService.syncSingleQuote(
        quoteId,
        companyId,
        {
          minimumQuoteValue: this.MINIMUM_QUOTE_VALUE,
        }
      );

      if (result.success) {
        // ✅ ENHANCED: Verify creation actually worked
        await this.delay(1000); // Give Monday time to index
        const verifyCreated = await this.findDealOptimized(quoteId);
        if (verifyCreated) {
          this.updateCache(quoteId, verifyCreated);
          logger.info(
            `Quote ${quoteId} created and verified in Monday (${verifyCreated.id})`
          );
        } else {
          logger.warn(
            `Quote ${quoteId} creation succeeded but could not verify in Monday`
          );
          this.updateCache(quoteId, { id: "new", name: `Quote #${quoteId}` });
        }

        return {
          success: true,
          message: `Quote ${quoteId} created and synced to Monday.com`,
        };
      } else {
        throw new Error(`Failed to sync quote ${quoteId}: ${result.message}`);
      }
    } catch (error) {
      logger.error(`Failed to create quote ${quoteId}`, { error });
      return {
        success: false,
        message: `Failed to create quote ${quoteId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  private async handleQuoteUpdated(
    quoteId: number,
    companyId: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`Processing quote update for quote ${quoteId}`);

      // STEP 1: Check price FIRST - no Monday API calls until we know it's valuable
      const priceCheckResult = await this.checkQuoteValueFirst(
        quoteId,
        companyId
      );
      if (!priceCheckResult.meetsMinimum) {
        logger.info(
          `Quote ${quoteId} value $${priceCheckResult.value} doesn't meet minimum $${this.MINIMUM_QUOTE_VALUE} - skipping all Monday API calls`
        );
        return {
          success: true,
          message: `Quote ${quoteId} value $${priceCheckResult.value} doesn't meet minimum $${this.MINIMUM_QUOTE_VALUE}`,
        };
      }

      logger.info(
        `Quote ${quoteId} value $${priceCheckResult.value} meets minimum - checking if exists in Monday`
      );

      // ✅ ENHANCED: Use the same robust search for updates
      const existingDeal = await this.findExistingDealWithRetries(quoteId);

      // STEP 4: If doesn't exist, treat as creation
      if (!existingDeal) {
        logger.info(
          `Quote ${quoteId} doesn't exist in Monday - treating update as creation`
        );
        return await this.handleQuoteCreated(quoteId, companyId);
      }

      // STEP 5: Update existing quote (status only)
      logger.info(
        `Updating existing quote ${quoteId} ("${existingDeal.name}") - ${existingDeal.id}`
      );

      const newStatus = priceCheckResult.basicQuote.Status?.Name?.trim();
      if (newStatus && this.isStatusUpdateNeeded(newStatus)) {
        await this.updateDealStatusOnly(existingDeal.id, newStatus);
        logger.info(`Quote ${quoteId} status updated to "${newStatus}"`);
        return {
          success: true,
          message: `Quote ${quoteId} status updated to "${newStatus}"`,
        };
      } else {
        logger.info(`Quote ${quoteId} status unchanged, no update needed`);
        return {
          success: true,
          message: `Quote ${quoteId} status unchanged, no update needed`,
        };
      }
    } catch (error: any) {
      if (this.isRateLimitError(error)) {
        logger.warn(`Rate limited updating quote ${quoteId}, will retry later`);
        return {
          success: true,
          message: `Quote ${quoteId} update rate limited, will retry automatically`,
        };
      }

      logger.error(`Failed to update quote ${quoteId}`, { error });
      return {
        success: false,
        message: `Failed to update quote ${quoteId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  // ✅ NEW: Multi-layer duplicate detection with retries and delays
  private async findExistingDealWithRetries(
    quoteId: number
  ): Promise<any | null> {
    // Layer 1: Check cache first
    if (this.isInCache(quoteId)) {
      const cached = this.getCachedItem(quoteId);
      logger.info(`Quote ${quoteId} found in cache: "${cached?.name}"`);
      return cached;
    }

    // Layer 2: Search Monday with retries and delays
    for (let attempt = 1; attempt <= this.MAX_SEARCH_RETRIES; attempt++) {
      logger.info(
        `Quote ${quoteId} search attempt ${attempt}/${this.MAX_SEARCH_RETRIES}`
      );

      // Add delay for eventual consistency (except first attempt)
      if (attempt > 1) {
        const delay = this.MONDAY_SEARCH_DELAY * attempt; // Increasing delay
        logger.info(`Waiting ${delay}ms for Monday indexing before retry...`);
        await this.delay(delay);
      }

      const existingDeal = await this.findDealComprehensive(quoteId);
      if (existingDeal) {
        logger.info(
          `Quote ${quoteId} found on attempt ${attempt}: "${existingDeal.name}" (${existingDeal.id})`
        );
        this.updateCache(quoteId, existingDeal);
        return existingDeal;
      }

      logger.info(`Quote ${quoteId} not found on attempt ${attempt}`);
    }

    logger.info(
      `Quote ${quoteId} confirmed not found after ${this.MAX_SEARCH_RETRIES} attempts`
    );
    return null;
  }

  // ✅ NEW: More comprehensive search strategy
  private async findDealComprehensive(quoteId: number): Promise<any | null> {
    try {
      const boardId = process.env.MONDAY_DEALS_BOARD_ID!;
      const simproIdStr = quoteId.toString();
      const quotePattern = `Quote #${quoteId}`;

      // Strategy 1: Search by SimPro ID column (most reliable)
      const bySimProId = await this.searchBySimProId(boardId, simproIdStr);
      if (bySimProId) {
        logger.debug(`Found quote ${quoteId} by SimPro ID`);
        return bySimProId;
      }

      // Strategy 2: Search by exact name pattern
      const byName = await this.searchByNamePattern(boardId, quotePattern);
      if (byName) {
        logger.debug(`Found quote ${quoteId} by name pattern`);
        return byName;
      }

      return null;
    } catch (error) {
      logger.error(`Error in comprehensive deal search for quote ${quoteId}`, {
        error,
      });
      return null;
    }
  }

  // ✅ NEW: Search by SimPro ID with pagination
  private async searchBySimProId(
    boardId: string,
    simproIdStr: string
  ): Promise<any | null> {
    const query = `
      query FindDealBySimProId($boardId: ID!, $cursor: String) {
        boards(ids: [$boardId]) {
          items_page(limit: 50, cursor: $cursor) {
            cursor
            items {
              id
              name
              column_values(ids: ["text_mktzc7e6"]) {
                id
                text
              }
            }
          }
        }
      }
    `;

    let cursor: string | null = null;
    let totalSearched = 0;

    do {
      const result: any = await this.syncService.mondayClient.query(query, {
        boardId,
        cursor,
      });

      const itemsPage: any = result.boards?.[0]?.items_page;
      if (!itemsPage) break;

      totalSearched += itemsPage.items.length;

      for (const item of itemsPage.items) {
        const simproIdColumn = item.column_values?.find(
          (col: any) => col.id === "text_mktzc7e6"
        );
        if (simproIdColumn?.text === simproIdStr) {
          logger.debug(
            `Found by SimPro ID after searching ${totalSearched} items`
          );
          return item;
        }
      }

      cursor = itemsPage.cursor;
    } while (cursor);

    return null;
  }

  // ✅ NEW: Search by name pattern
  private async searchByNamePattern(
    boardId: string,
    quotePattern: string
  ): Promise<any | null> {
    const query = `
      query FindDealByName($boardId: ID!) {
        boards(ids: [$boardId]) {
          items_page(limit: 100) {
            items {
              id
              name
            }
          }
        }
      }
    `;

    const result: any = await this.syncService.mondayClient.query(query, {
      boardId,
    });
    const items: any[] = result.boards?.[0]?.items_page?.items || [];

    for (const item of items) {
      if (item.name?.includes(quotePattern)) {
        return item;
      }
    }

    return null;
  }

  // ✅ ENHANCED: Better duplicate webhook detection
  private isDuplicateWebhook(eventType: string, quoteId: number): boolean {
    const webhookKey = `${eventType}-${quoteId}`;
    const now = Date.now();
    const lastProcessed = this.processedWebhooks.get(webhookKey);

    if (lastProcessed && now - lastProcessed < this.DEBOUNCE_WINDOW) {
      const secondsAgo = Math.round((now - lastProcessed) / 1000);
      logger.warn(
        `🚫 DUPLICATE WEBHOOK BLOCKED: ${webhookKey} (processed ${secondsAgo}s ago)`
      );
      return true;
    }

    return false;
  }

  // ✅ NEW: Simple delay helper
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Keep all existing private methods unchanged...
  private async findDealOptimized(quoteId: number): Promise<any | null> {
    try {
      const boardId = process.env.MONDAY_DEALS_BOARD_ID!;

      const query = `
        query FindDealOptimized($boardId: ID!) {
          boards(ids: [$boardId]) {
            items_page(limit: 100) {
              items {
                id
                name
                column_values(ids: ["text_mktzc7e6"]) {
                  id
                  text
                }
              }
            }
          }
        }
      `;

      const result = await this.syncService.mondayClient.query(query, {
        boardId,
      });
      const items = result.boards?.[0]?.items_page?.items || [];

      const simproIdStr = quoteId.toString();
      const quotePattern = `Quote #${quoteId}`;

      for (const item of items) {
        const simproIdColumn = item.column_values?.find(
          (col: any) => col.id === "text_mktzc7e6"
        );
        if (simproIdColumn?.text === simproIdStr) {
          logger.debug(`Found quote ${quoteId} by SimPro ID`);
          return item;
        }

        if (item.name?.includes(quotePattern)) {
          logger.debug(`Found quote ${quoteId} by name pattern`);
          return item;
        }
      }

      return null;
    } catch (error) {
      logger.error(`Error in optimized deal search for quote ${quoteId}`, {
        error,
      });
      return null;
    }
  }

  private async handleQuoteDeleted(
    quoteId: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`Processing quote deletion for quote ${quoteId}`);

      const existingDeal = await this.findExistingDealWithRetries(quoteId);

      if (!existingDeal) {
        logger.info(`Quote ${quoteId} not found in Monday - nothing to delete`);
        return {
          success: true,
          message: `Quote ${quoteId} not found in Monday - no deletion needed`,
        };
      }

      await this.deleteDealFromMonday(existingDeal.id);
      this.removeFromCache(quoteId);

      logger.info(`Quote ${quoteId} deleted from Monday`);
      return {
        success: true,
        message: `Quote ${quoteId} deleted from Monday.com successfully`,
      };
    } catch (error) {
      logger.error(`Failed to delete quote ${quoteId}`, { error });
      return {
        success: false,
        message: `Failed to delete quote ${quoteId}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  private async checkQuoteValueFirst(
    quoteId: number,
    companyId: number
  ): Promise<{
    meetsMinimum: boolean;
    value: number;
    basicQuote: any;
  }> {
    try {
      const basicQuote = await this.syncService.getSimProQuoteDetails(
        companyId,
        quoteId
      );
      const value = basicQuote.Total?.ExTax || 0;
      const meetsMinimum = value >= this.MINIMUM_QUOTE_VALUE;

      logger.debug(
        `Quote ${quoteId} price check: $${value} (minimum: $${
          this.MINIMUM_QUOTE_VALUE
        }) - ${meetsMinimum ? "PASS" : "FAIL"}`
      );

      return {
        meetsMinimum,
        value,
        basicQuote,
      };
    } catch (error) {
      logger.error(`Failed to check quote ${quoteId} value`, { error });
      return {
        meetsMinimum: false,
        value: 0,
        basicQuote: null,
      };
    }
  }

  private markWebhookProcessed(eventType: string, quoteId: number): void {
    const webhookKey = `${eventType}-${quoteId}`;
    const now = Date.now();

    this.processedWebhooks.set(webhookKey, now);
    this.cleanupOldWebhooks(now);
  }

  private cleanupOldWebhooks(now: number): void {
    const keysToDelete: string[] = [];
    this.processedWebhooks.forEach((timestamp, key) => {
      if (now - timestamp > this.CACHE_TTL) {
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach((key) => this.processedWebhooks.delete(key));
  }

  private isInCache(quoteId: number): boolean {
    const cached = this.itemCache.get(quoteId);
    if (!cached) return false;

    const now = Date.now();
    if (now - cached.lastUpdated > this.CACHE_TTL) {
      this.itemCache.delete(quoteId);
      return false;
    }

    return true;
  }

  private getCachedItem(quoteId: number): any | null {
    if (!this.isInCache(quoteId)) return null;

    const cached = this.itemCache.get(quoteId)!;
    return {
      id: cached.id,
      name: cached.name,
    };
  }

  private updateCache(quoteId: number, item: any): void {
    this.itemCache.set(quoteId, {
      id: item.id,
      name: item.name,
      lastUpdated: Date.now(),
    });
  }

  private removeFromCache(quoteId: number): void {
    this.itemCache.delete(quoteId);
  }

  private isStatusUpdateNeeded(status: string): boolean {
    const criticalStatuses = [
      "Quote: Won",
      "Quote : Won",
      "Quote: Archived - Not Won",
      "Quote : Archived - Not Won",
      "Quote: Sent",
      "Quote : Sent",
    ];

    return criticalStatuses.some((s) =>
      status.replace(/\s/g, "").includes(s.replace(/\s/g, ""))
    );
  }

  private isRateLimitError(error: any): boolean {
    return (
      error?.message?.includes("429") ||
      error?.message?.includes("Too Many Requests") ||
      error?.message?.includes("Complexity budget exhausted")
    );
  }

  private async updateDealStatusOnly(
    dealId: string,
    newStatus: string
  ): Promise<void> {
    const statusMapping: { [key: string]: string } = {
      "Quote: Archived - Not Won": "Quote : Archived - Not Won",
      "Quote : Archived - Not Won": "Quote : Archived - Not Won",
      "Quote: Won": "Quote: Won",
      "Quote : Won": "Quote: Won",
      "Quote: Sent": "Quote: Sent",
      "Quote : Sent": "Quote: Sent",
    };

    const mondayStatus = statusMapping[newStatus] || newStatus;

    logger.info(
      `Updating deal ${dealId} status: "${newStatus}" → "${mondayStatus}"`
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

    await this.syncService.mondayClient.query(mutation, {
      itemId: dealId,
      boardId: process.env.MONDAY_DEALS_BOARD_ID!,
      columnId: "deal_stage",
      value: JSON.stringify({ label: mondayStatus }),
    });
  }

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

      logger.info(`Successfully deleted deal ${dealId} from Monday`);
    } catch (error) {
      logger.error(`Failed to delete deal ${dealId}`, { error });
      throw error;
    }
  }
}
