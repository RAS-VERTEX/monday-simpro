// lib/services/sync-service.ts - Simplified sync orchestration
import { SimProApi } from "@/lib/clients/simpro/simpro-api";
import { SimProQuotes } from "@/lib/clients/simpro/simpro-quotes";
import { MondayApi } from "@/lib/clients/monday/monday-api";
import { MondayAccounts } from "@/lib/clients/monday/monday-accounts";
import { MondayContacts } from "@/lib/clients/monday/monday-contacts";
import { MondayDeals } from "@/lib/clients/monday/monday-deals";
import {
  MondayBoardConfig,
  MONDAY_COLUMN_IDS,
} from "@/lib/clients/monday/monday-config";
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
    errors: number;
  };
  errors?: string[];
}

export class SyncService {
  private simproApi: SimProApi;
  private simproQuotes: SimProQuotes;
  private mondayApi: MondayApi;
  private mondayAccounts: MondayAccounts;
  private mondayContacts: MondayContacts;
  private mondayDeals: MondayDeals;
  private mappingService: MappingService;

  constructor(
    simproConfig: { baseUrl: string; accessToken: string; companyId: number },
    mondayConfig: { apiToken: string; boardIds: MondayBoardConfig }
  ) {
    // Initialize SimPro clients
    this.simproApi = new SimProApi(simproConfig);
    this.simproQuotes = new SimProQuotes(this.simproApi);

    // Initialize Monday clients
    this.mondayApi = new MondayApi(mondayConfig.apiToken);
    this.mondayAccounts = new MondayAccounts(this.mondayApi, MONDAY_COLUMN_IDS);
    this.mondayContacts = new MondayContacts(this.mondayApi, MONDAY_COLUMN_IDS);
    this.mondayDeals = new MondayDeals(this.mondayApi, MONDAY_COLUMN_IDS);

    // Initialize mapping service
    this.mappingService = new MappingService();
  }

  async syncSimProToMonday(
    config: SyncConfig,
    limit?: number
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let metrics = {
      quotesProcessed: 0,
      accountsCreated: 0,
      contactsCreated: 0,
      dealsCreated: 0,
      errors: 0,
    };

    try {
      logger.info("[Sync Service] Starting SimPro → Monday sync", {
        minimumValue: config.minimumQuoteValue,
        limit,
      });

      // Get high-value quotes from SimPro
      const quotes = await this.simproQuotes.getActiveHighValueQuotes(
        config.minimumQuoteValue
      );

      if (quotes.length === 0) {
        logger.info("[Sync Service] No high-value quotes found to sync");
        return {
          success: true,
          message: "No high-value quotes found to sync",
          timestamp: new Date().toISOString(),
          metrics,
        };
      }

      // Apply limit for testing
      const quotesToProcess = limit ? quotes.slice(0, limit) : quotes;
      logger.info(`[Sync Service] Processing ${quotesToProcess.length} quotes`);

      // Process each quote
      for (const quote of quotesToProcess) {
        try {
          metrics.quotesProcessed++;

          // Map quote data for Monday
          const mappedData = this.mappingService.mapQuoteToMonday(quote);

          // Create account
          const accountResult = await this.mondayAccounts.createAccount(
            config.boardIds.accounts,
            mappedData.account
          );

          if (!accountResult.success) {
            throw new Error(`Account creation failed: ${accountResult.error}`);
          }

          if (
            accountResult.itemId &&
            !(await this.isExistingAccount(
              mappedData.account.simproCustomerId,
              config.boardIds.accounts
            ))
          ) {
            metrics.accountsCreated++;
          }

          // Create contacts
          const contactIds: string[] = [];
          for (const contactData of mappedData.contacts) {
            const contactResult = await this.mondayContacts.createContact(
              config.boardIds.contacts,
              contactData,
              accountResult.itemId
            );

            if (contactResult.success && contactResult.itemId) {
              contactIds.push(contactResult.itemId);
              if (
                !(await this.isExistingContact(
                  contactData.simproContactId,
                  config.boardIds.contacts
                ))
              ) {
                metrics.contactsCreated++;
              }
            }
          }

          // Create deal
          const dealResult = await this.mondayDeals.createDeal(
            config.boardIds.deals,
            mappedData.deal,
            accountResult.itemId,
            contactIds
          );

          if (!dealResult.success) {
            throw new Error(`Deal creation failed: ${dealResult.error}`);
          }

          if (
            dealResult.itemId &&
            !(await this.isExistingDeal(
              mappedData.deal.simproQuoteId,
              config.boardIds.deals
            ))
          ) {
            metrics.dealsCreated++;
          }

          logger.debug(
            `[Sync Service] ✅ Processed quote ${quote.ID} successfully`
          );
        } catch (error) {
          metrics.errors++;
          const errorMsg = `Quote ${quote.ID}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`;
          errors.push(errorMsg);
          logger.error(
            `[Sync Service] ❌ Failed to process quote ${quote.ID}`,
            { error }
          );
        }
      }

      const duration = Date.now() - startTime;
      const success = errors.length === 0;

      logger.syncMetrics("SimPro → Monday Sync", {
        duration,
        itemsProcessed: metrics.quotesProcessed,
        errors: metrics.errors,
        success,
      });

      return {
        success,
        message: success
          ? `Successfully synced ${metrics.quotesProcessed} quotes`
          : `Synced with ${errors.length} errors`,
        timestamp: new Date().toISOString(),
        metrics,
        errors: errors.length > 0 ? errors : undefined,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("[Sync Service] Sync failed completely", {
        error,
        duration,
      });

      return {
        success: false,
        message: `Sync failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        timestamp: new Date().toISOString(),
        metrics,
        errors: [error instanceof Error ? error.message : "Unknown error"],
      };
    }
  }

  async healthCheck(): Promise<{
    simpro: { status: "up" | "down"; responseTime?: number };
    monday: { status: "up" | "down"; responseTime?: number };
  }> {
    const [simproResult, mondayResult] = await Promise.allSettled([
      this.testSimProConnection(),
      this.testMondayConnection(),
    ]);

    return {
      simpro: {
        status:
          simproResult.status === "fulfilled" && simproResult.value.success
            ? "up"
            : "down",
        responseTime:
          simproResult.status === "fulfilled"
            ? simproResult.value.responseTime
            : undefined,
      },
      monday: {
        status:
          mondayResult.status === "fulfilled" && mondayResult.value.success
            ? "up"
            : "down",
        responseTime:
          mondayResult.status === "fulfilled"
            ? mondayResult.value.responseTime
            : undefined,
      },
    };
  }

  private async testSimProConnection(): Promise<{
    success: boolean;
    responseTime: number;
  }> {
    const startTime = Date.now();
    try {
      const result = await this.simproApi.testConnection();
      return {
        success: result.success,
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        responseTime: Date.now() - startTime,
      };
    }
  }

  private async testMondayConnection(): Promise<{
    success: boolean;
    responseTime: number;
  }> {
    const startTime = Date.now();
    try {
      const result = await this.mondayApi.testConnection();
      return {
        success: result.success,
        responseTime: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        responseTime: Date.now() - startTime,
      };
    }
  }

  // Helper methods to check if items already exist (simplified)
  private async isExistingAccount(
    simproCustomerId: number,
    boardId: string
  ): Promise<boolean> {
    // This would need to be implemented based on your needs
    // For now, assume we're creating new items
    return false;
  }

  private async isExistingContact(
    simproContactId: number,
    boardId: string
  ): Promise<boolean> {
    return false;
  }

  private async isExistingDeal(
    simproQuoteId: number,
    boardId: string
  ): Promise<boolean> {
    return false;
  }
}
