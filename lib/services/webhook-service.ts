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

  // ✅ UPDATED: handleQuoteUpdated with efficient price + status updates
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

      // STEP 2: Check cache first
      let existingDeal = this.getCachedItem(quoteId);

      // STEP 3: If not in cache, do single optimized lookup
      if (!existingDeal) {
        existingDeal = await this.findDealOptimized(quoteId);
        if (existingDeal) {
          this.updateCache(quoteId, existingDeal);
        }
      }

      // STEP 4: If doesn't exist, treat as creation
      if (!existingDeal) {
        logger.info(
          `Quote ${quoteId} doesn't exist in Monday - treating update as creation`
        );
        return await this.handleQuoteCreated(quoteId, companyId);
      }

      // STEP 5: Check if quote stage is Closed/Archived and should be deleted
      const currentStage = priceCheckResult.basicQuote.Stage?.trim();
      const currentStatus = priceCheckResult.basicQuote.Status?.Name?.trim();

      if (this.shouldDeleteDealForClosedStage(currentStage, currentStatus)) {
        logger.info(
          `Quote ${quoteId} stage "${currentStage}" with status "${currentStatus}" - deleting deal from Monday`
        );

        await this.deleteDealFromMonday(existingDeal.id);
        this.removeFromCache(quoteId);

        return {
          success: true,
          message: `Quote ${quoteId} deal deleted from Monday due to stage "${currentStage}" with status "${currentStatus}"`,
        };
      }

      // STEP 6: Efficient update - only update if there are changes
      logger.info(
        `Checking if quote ${quoteId} ("${existingDeal.name}") needs updates`
      );

      // Get current Monday deal data
      const currentDealData = await this.getCurrentDealData(existingDeal.id);
      if (!currentDealData) {
        logger.error(
          `Could not retrieve current deal data for ${existingDeal.id}`
        );
        return {
          success: false,
          message: `Could not retrieve current deal data for quote ${quoteId}`,
        };
      }

      // Compare with SimPro data
      const newValue = priceCheckResult.value;
      const newStatus = currentStatus;

      const updateCheck = this.needsUpdate(
        currentDealData.currentValue,
        currentDealData.currentStatus,
        newValue,
        newStatus
      );

      if (!updateCheck.hasChanges) {
        logger.info(`Quote ${quoteId} has no changes - skipping update`);
        return {
          success: true,
          message: `Quote ${quoteId} is already up to date`,
        };
      }

      // Prepare updates
      const updates: { value?: number; status?: string } = {};

      if (updateCheck.updateValue) {
        updates.value = newValue;
      }

      if (updateCheck.updateStatus && this.isStatusUpdateNeeded(newStatus)) {
        updates.status = newStatus;
      }

      // Apply updates efficiently
      if (Object.keys(updates).length > 0) {
        await this.updateDealEfficiently(existingDeal.id, updates);

        const updateTypes = [];
        if (updates.value !== undefined) updateTypes.push("value");
        if (updates.status !== undefined) updateTypes.push("status");

        logger.info(`Quote ${quoteId} updated: ${updateTypes.join(" and ")}`);
        return {
          success: true,
          message: `Quote ${quoteId} ${updateTypes.join(
            " and "
          )} updated successfully`,
        };
      } else {
        logger.info(`Quote ${quoteId} - no critical updates needed`);
        return {
          success: true,
          message: `Quote ${quoteId} - no critical updates needed`,
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

  private async handleQuoteDeleted(
    quoteId: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`Processing quote deletion for quote ${quoteId}`);

      // Check cache first
      let existingDeal = this.getCachedItem(quoteId);

      // If not in cache, do single optimized lookup
      if (!existingDeal) {
        existingDeal = await this.findDealOptimized(quoteId);
      }

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

      // STEP 2: Check cache first
      if (this.isInCache(quoteId)) {
        const cached = this.itemCache.get(quoteId)!;
        logger.warn(
          `Quote ${quoteId} already exists in cache as "${cached.name}" - duplicate creation prevented`
        );
        return {
          success: true,
          message: `Quote ${quoteId} already exists - duplicate creation prevented`,
        };
      }

      // STEP 3: Single optimized lookup instead of 3 separate calls
      const existingDeal = await this.findDealOptimized(quoteId);
      if (existingDeal) {
        this.updateCache(quoteId, existingDeal);
        logger.warn(
          `Quote ${quoteId} already exists as "${existingDeal.name}" - duplicate creation prevented`
        );
        return {
          success: true,
          message: `Quote ${quoteId} already exists - duplicate creation prevented`,
        };
      }

      // STEP 4: Create new quote (now we know it's valuable and doesn't exist)
      const result = await this.syncService.syncSingleQuote(
        quoteId,
        companyId,
        {
          minimumQuoteValue: this.MINIMUM_QUOTE_VALUE,
        }
      );

      if (result.success) {
        this.updateCache(quoteId, { id: "new", name: `Quote #${quoteId}` });
        logger.info(`Quote ${quoteId} created and synced to Monday`);
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

  // ✅ NEW: Get current deal data from Monday
  private async getCurrentDealData(dealId: string): Promise<{
    currentValue: number;
    currentStatus: string;
  } | null> {
    try {
      const query = `
        query GetDealData($itemId: ID!) {
          items(ids: [$itemId]) {
            id
            column_values(ids: ["deal_value", "deal_stage"]) {
              id
              text
              value
            }
          }
        }
      `;

      const result = await this.syncService.mondayClient.query(query, {
        itemId: dealId,
      });

      const item = result.items?.[0];
      if (!item) return null;

      let currentValue = 0;
      let currentStatus = "";

      for (const column of item.column_values) {
        if (column.id === "deal_value") {
          currentValue = parseFloat(column.text || "0");
        } else if (column.id === "deal_stage") {
          try {
            const statusValue = JSON.parse(column.value || "{}");
            currentStatus = statusValue.label || "";
          } catch {
            currentStatus = column.text || "";
          }
        }
      }

      return { currentValue, currentStatus };
    } catch (error) {
      logger.error(`Failed to get current deal data for ${dealId}`, { error });
      return null;
    }
  }

  // ✅ NEW: Check what needs updating
  private needsUpdate(
    currentValue: number,
    currentStatus: string,
    newValue: number,
    newStatus: string
  ): { updateValue: boolean; updateStatus: boolean; hasChanges: boolean } {
    const updateValue = Math.abs(currentValue - newValue) > 0.01; // Account for floating point precision
    const updateStatus = currentStatus !== newStatus;
    const hasChanges = updateValue || updateStatus;

    logger.debug(`Update check for deal:`, {
      currentValue,
      newValue,
      updateValue,
      currentStatus,
      newStatus,
      updateStatus,
      hasChanges,
    });

    return { updateValue, updateStatus, hasChanges };
  }

  // ✅ NEW: Update deal efficiently
  private async updateDealEfficiently(
    dealId: string,
    updates: {
      value?: number;
      status?: string;
    }
  ): Promise<void> {
    const mutations: string[] = [];
    const variables: any = {};

    if (updates.value !== undefined) {
      mutations.push(`
        change_column_value(
          item_id: $itemId
          board_id: $boardId
          column_id: "deal_value"
          value: $valueUpdate
        ) {
          id
        }
      `);
      variables.valueUpdate = JSON.stringify(updates.value);
    }

    if (updates.status !== undefined) {
      const statusMapping: { [key: string]: string } = {
        "Quote: Archived - Not Won": "Quote: Archived - Not Won",
        "Quote : Archived - Not Won": "Quote: Archived - Not Won",
        "Quote: Won": "Quote: Won",
        "Quote : Won": "Quote: Won",
        "Quote: Sent": "Quote: Sent",
        "Quote : Sent": "Quote: Sent",
      };

      const mondayStatus = statusMapping[updates.status] || updates.status;

      mutations.push(`
        change_column_value(
          item_id: $itemId
          board_id: $boardId
          column_id: "deal_stage"
          value: $statusUpdate
        ) {
          id
        }
      `);
      variables.statusUpdate = JSON.stringify({ label: mondayStatus });
    }

    if (mutations.length === 0) return;

    const mutation = `
      mutation UpdateDeal($itemId: ID!, $boardId: ID!${
        updates.value !== undefined ? ", $valueUpdate: JSON!" : ""
      }${updates.status !== undefined ? ", $statusUpdate: JSON!" : ""}) {
        ${mutations.join("\n")}
      }
    `;

    await this.syncService.mondayClient.query(mutation, {
      itemId: dealId,
      boardId: process.env.MONDAY_DEALS_BOARD_ID!,
      ...variables,
    });

    const updateTypes = [];
    if (updates.value !== undefined)
      updateTypes.push(`value: $${updates.value}`);
    if (updates.status !== undefined)
      updateTypes.push(`status: "${updates.status}"`);

    logger.info(`Deal ${dealId} updated: ${updateTypes.join(", ")}`);
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
      // Single SimPro API call to get quote details
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
      // On error, assume it doesn't meet minimum to avoid unnecessary Monday API calls
      return {
        meetsMinimum: false,
        value: 0,
        basicQuote: null,
      };
    }
  }

  private async findDealOptimized(quoteId: number): Promise<any | null> {
    try {
      const boardId = process.env.MONDAY_DEALS_BOARD_ID!;

      // ✅ FIXED: Use CORRECT column ID for deals
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
        // ✅ FIXED: Use CORRECT column ID for deals
        const simproIdColumn = item.column_values?.find(
          (col: any) => col.id === "text_mktzc7e6"
        );
        if (simproIdColumn?.text === simproIdStr) {
          logger.debug(`Found quote ${quoteId} by SimPro ID`);
          return item;
        }

        // Fallback check: name pattern
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

  private isDuplicateWebhook(eventType: string, quoteId: number): boolean {
    const webhookKey = `${eventType}-${quoteId}`;
    const now = Date.now();
    const lastProcessed = this.processedWebhooks.get(webhookKey);

    if (lastProcessed && now - lastProcessed < this.DEBOUNCE_WINDOW) {
      logger.warn(
        `Duplicate webhook blocked: ${webhookKey} (processed ${Math.round(
          (now - lastProcessed) / 1000
        )}s ago)`
      );
      return true;
    }

    return false;
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
      // Map all variants TO Monday's correct format (no spaces around colon)
      "Quote: Archived - Not Won": "Quote: Archived - Not Won", // ✅ CORRECT
      "Quote : Archived - Not Won": "Quote: Archived - Not Won", // ✅ FIXED: Remove spaces around colon
      "Quote: Won": "Quote: Won", // ✅ CORRECT
      "Quote : Won": "Quote: Won", // ✅ CORRECT
      "Quote: Sent": "Quote: Sent", // ✅ CORRECT
      "Quote : Sent": "Quote: Sent", // ✅ CORRECT
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
      columnId: "deal_stage", // ✅ FIXED: Changed from "color_mktrw6k3" to "deal_stage"
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

  // ✅ NEW METHOD: Check if deal should be deleted based on stage and status
  private shouldDeleteDealForClosedStage(
    stage: string,
    status: string
  ): boolean {
    if (!stage || !status) {
      return false;
    }

    // Check if stage is Closed or Archived
    const stageToCheck = stage.toLowerCase().trim();
    const isClosedOrArchived =
      stageToCheck === "closed" || stageToCheck === "archived";

    if (!isClosedOrArchived) {
      return false;
    }

    // Keep deals if status is "Quote: Won" or "Quote: Archived - Not Won"
    const statusesToKeep = [
      "Quote: Won",
      "Quote : Won",
      "Quote: Archived - Not Won",
      "Quote : Archived - Not Won",
    ];

    const shouldKeep = statusesToKeep.some((keepStatus) =>
      status
        .replace(/\s/g, "")
        .toLowerCase()
        .includes(keepStatus.replace(/\s/g, "").toLowerCase())
    );

    if (shouldKeep) {
      logger.info(
        `Quote stage "${stage}" but keeping deal due to status "${status}"`
      );
      return false;
    }

    // Delete the deal - stage is Closed/Archived and status is not a "keep" status
    logger.info(
      `Quote stage "${stage}" with status "${status}" - will delete deal`
    );
    return true;
  }
}
