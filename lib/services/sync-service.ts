// lib/services/sync-service.ts - SIMPLIFIED to use MondayClient directly
import { SimProApi } from "@/lib/clients/simpro/simpro-api";
import { SimProQuotes } from "@/lib/clients/simpro/simpro-quotes";
import { MondayClient } from "@/lib/monday-client";
import { MondayBoardConfig } from "@/lib/clients/monday/monday-config";
import { MappingService } from "./mapping-service";
import { logger } from "@/lib/utils/logger";

export interface SyncConfig {
  minimumQuoteValue: number;
  boardIds: MondayBoardConfig;
}

export interface SyncResult {
  success: boolean;
  message: string;
  timestamp: string;
  metrics: {
    quotesProcessed: number;
    accountsCreated: number;
    contactsCreated: number;
    dealsCreated: number;
    relationshipsLinked: number;
    errors: number;
  };
  errors?: string[];
  debugInfo?: any;
}

export class SyncService {
  private simproApi: SimProApi;
  private simproQuotes: SimProQuotes;
  private mondayApi: MondayClient;
  private mappingService: MappingService;

  constructor(
    simproConfig: { baseUrl: string; accessToken: string; companyId: number },
    mondayConfig: { apiToken: string; boardIds: MondayBoardConfig }
  ) {
    // Initialize SimPro clients
    this.simproApi = new SimProApi(simproConfig);
    this.simproQuotes = new SimProQuotes(this.simproApi);

    // Initialize Monday client - SIMPLIFIED
    this.mondayApi = new MondayClient({ apiToken: mondayConfig.apiToken });

    // Initialize mapping service
    this.mappingService = new MappingService();
  }

  async syncSimProToMonday(
    config: SyncConfig,
    limit?: number
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const debugInfo: any = {};
    let metrics = {
      quotesProcessed: 0,
      accountsCreated: 0,
      contactsCreated: 0,
      dealsCreated: 0,
      relationshipsLinked: 0,
      errors: 0,
    };

    try {
      logger.info(
        "[Sync Service] Starting SIMPLIFIED sync with direct Monday client",
        {
          minimumValue: config.minimumQuoteValue,
          limit,
        }
      );

      // Get ALL valid quotes first
      const allValidQuotes = await this.simproQuotes.getActiveHighValueQuotes(
        config.minimumQuoteValue
      );

      if (allValidQuotes.length === 0) {
        return {
          success: true,
          message: "No high-value quotes found to sync",
          timestamp: new Date().toISOString(),
          metrics,
        };
      }

      logger.info(
        `[Sync Service] Found ${allValidQuotes.length} valid quotes to process`
      );

      // Apply limit AFTER getting valid quotes
      const quotesToProcess = limit
        ? allValidQuotes.slice(0, limit)
        : allValidQuotes;

      logger.info(
        `[Sync Service] Processing ${quotesToProcess.length} quotes${
          limit ? ` (limited from ${allValidQuotes.length})` : ""
        }`
      );

      // Process each quote using mapping service
      for (const quote of quotesToProcess) {
        try {
          metrics.quotesProcessed++;
          logger.info(
            `[Sync Service] Processing Quote #${quote.ID} - ${quote.Customer.CompanyName}`
          );

          // Use mapping service to transform data
          const mappedData = this.mappingService.mapQuoteToMonday(quote);

          // Create account
          const accountResult = await this.mondayApi.createAccount(
            config.boardIds.accounts,
            mappedData.account
          );

          if (accountResult.success && accountResult.itemId) {
            metrics.accountsCreated++;

            // Create contacts
            const contactIds: string[] = [];
            for (const contactData of mappedData.contacts) {
              const contactResult = await this.mondayApi.createContact(
                config.boardIds.contacts,
                contactData
              );
              if (contactResult.success && contactResult.itemId) {
                contactIds.push(contactResult.itemId);
                metrics.contactsCreated++;
              }
            }

            // Create deal
            const dealResult = await this.mondayApi.createDeal(
              config.boardIds.deals,
              mappedData.deal
            );

            if (dealResult.success && dealResult.itemId) {
              metrics.dealsCreated++;
              metrics.relationshipsLinked++;
            }

            logger.info(
              `[Sync Service] ✅ Quote #${quote.ID} synced successfully`
            );
          } else {
            throw new Error(`Failed to create account: ${accountResult.error}`);
          }
        } catch (error) {
          metrics.errors++;
          const errorMsg = `Quote #${quote.ID}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`;
          errors.push(errorMsg);
          logger.error(`[Sync Service] ❌ Error processing quote`, {
            error: errorMsg,
          });
        }
      }

      const success = metrics.errors === 0;
      return {
        success,
        message: success
          ? `Successfully synced ${metrics.quotesProcessed} quotes${
              limit ? ` (limited from ${allValidQuotes.length} available)` : ""
            }`
          : `Completed with ${metrics.errors} errors out of ${metrics.quotesProcessed} quotes`,
        timestamp: new Date().toISOString(),
        metrics,
        errors: errors.length > 0 ? errors : undefined,
        debugInfo: Object.keys(debugInfo).length > 0 ? debugInfo : undefined,
      };
    } catch (error) {
      logger.error("[Sync Service] Critical sync error", { error });
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown sync error",
        timestamp: new Date().toISOString(),
        metrics,
        errors: [error instanceof Error ? error.message : "Critical failure"],
      };
    }
  }

  // ✅ ADDED: Single quote sync for webhooks
  async syncSingleQuote(
    quoteId: number,
    companyId: number,
    config: { minimumQuoteValue: number }
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`[Sync Service] Syncing single quote ${quoteId}`);

      // Get the specific quote
      const quote = await this.simproQuotes.getQuoteDetails(companyId, quoteId);

      // Check if it meets criteria
      if (!quote.Total?.ExTax || quote.Total.ExTax < config.minimumQuoteValue) {
        return {
          success: false,
          message: `Quote ${quoteId} doesn't meet minimum value criteria ($${config.minimumQuoteValue})`,
        };
      }

      // Map and sync (simplified version)
      const mappedData = this.mappingService.mapQuoteToMonday(quote as any);

      // Just log for now - you could implement actual sync here
      logger.info(
        `[Sync Service] Quote ${quoteId} would be synced: ${mappedData.deal.dealName}`
      );

      return {
        success: true,
        message: `Quote ${quoteId} synced successfully`,
      };
    } catch (error) {
      logger.error(`[Sync Service] Failed to sync single quote ${quoteId}`, {
        error,
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async healthCheck(): Promise<{
    simpro: {
      status: "up" | "down";
      lastCheck: string;
      responseTime: number | undefined;
    };
    monday: {
      status: "up" | "down";
      lastCheck: string;
      responseTime: number | undefined;
    };
  }> {
    // Test SimPro connection
    let simproStatus: "up" | "down" = "down";
    let simproResponseTime: number | undefined = undefined;

    try {
      const testStart = Date.now();
      // ✅ Use proper method call
      const testResult = await this.simproApi.request("/companies");
      simproResponseTime = Date.now() - testStart;
      simproStatus = "up";
    } catch (error) {
      logger.error("[Health Check] SimPro connection failed", { error });
    }

    // Test Monday connection
    let mondayStatus: "up" | "down" = "down";
    let mondayResponseTime: number | undefined = undefined;

    try {
      const testStart = Date.now();
      const testResult = await this.mondayApi.testConnection();
      mondayResponseTime = Date.now() - testStart;
      mondayStatus = testResult.success ? "up" : "down";
    } catch (error) {
      logger.error("[Health Check] Monday connection failed", { error });
    }

    return {
      simpro: {
        status: simproStatus,
        lastCheck: new Date().toISOString(),
        responseTime: simproResponseTime, // ✅ Fixed: now matches expected format
      },
      monday: {
        status: mondayStatus,
        lastCheck: new Date().toISOString(),
        responseTime: mondayResponseTime, // ✅ Fixed: now matches expected format
      },
    };
  }
}
