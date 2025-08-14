// lib/services/sync-service.ts - EFFICIENT webhook sync (no bulk scanning)
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

    // Initialize Monday client
    this.mondayApi = new MondayClient({ apiToken: mondayConfig.apiToken });

    // Initialize mapping service
    this.mappingService = new MappingService();
  }

  // ✅ BATCH SYNC: For manual/cron syncing (scans all quotes)
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
        "[Sync Service] Starting BATCH sync with direct Monday client",
        {
          minimumValue: config.minimumQuoteValue,
          limit,
        }
      );

      // Get ALL valid quotes first (only for batch sync)
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

  // ✅ WEBHOOK SYNC: Efficient single quote processing (no bulk scanning)
  async syncSingleQuote(
    quoteId: number,
    companyId: number,
    config: { minimumQuoteValue: number }
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(
        `[Sync Service] 🚀 WEBHOOK: Processing single quote ${quoteId}`
      );

      // Get ONLY this specific quote (not all quotes!)
      const quote = await this.simproQuotes.getQuoteDetails(companyId, quoteId);

      // Quick validation checks
      if (!quote.Total?.ExTax || quote.Total.ExTax < config.minimumQuoteValue) {
        return {
          success: false,
          message: `Quote ${quoteId} value $${
            quote.Total?.ExTax || 0
          } doesn't meet minimum $${config.minimumQuoteValue}`,
        };
      }

      // Check if quote is in valid stage
      const validStages = ["Complete", "Approved"];
      if (!validStages.includes(quote.Stage)) {
        return {
          success: false,
          message: `Quote ${quoteId} stage "${quote.Stage}" is not valid (need Complete/Approved)`,
        };
      }

      // Check valid status
      const validStatuses = [
        "Quote: To Be Assigned",
        "Quote: To Be Scheduled",
        "Quote : To Be Scheduled",
        "Quote: To Write",
        "Quote: Visit Scheduled",
        "Quote : Visit Scheduled",
        "Quote: In Progress",
        "Quote : In Progress",
        "Quote: Won",
        "Quote : Won",
        "Quote: On Hold",
        "Quote : On Hold",
        "Quote: Sent",
        "Quote : Sent",
        "Quote : Sent ",
        "Quote: Quote Due Date Reached",
        "Quote : Quote Due Date Reached",
      ];
      const statusName = quote.Status?.Name?.trim();
      if (!statusName || !validStatuses.includes(statusName)) {
        return {
          success: false,
          message: `Quote ${quoteId} status "${statusName}" is not valid for sync`,
        };
      }

      // Check if not closed
      if (quote.IsClosed === true) {
        return {
          success: false,
          message: `Quote ${quoteId} is closed and won't be synced`,
        };
      }

      logger.info(
        `[Sync Service] ✅ Quote ${quoteId} passes validation - syncing to Monday`
      );

      // Map to Monday format
      const mappedData = this.mappingService.mapQuoteToMonday(quote as any);

      // STEP 1: Check for existing account first
      logger.info(
        `[Sync Service] 🏢 Processing account: ${mappedData.account.accountName}`
      );

      const existingAccount = await this.findBySimproId(
        process.env.MONDAY_ACCOUNTS_BOARD_ID!,
        quote.Customer.ID,
        "customer"
      );

      let accountId: string;
      if (existingAccount) {
        accountId = existingAccount.id;
        logger.info(
          `[Sync Service] ✅ Using existing account: ${existingAccount.name}`
        );
      } else {
        const accountResult = await this.mondayApi.createAccount(
          process.env.MONDAY_ACCOUNTS_BOARD_ID!,
          mappedData.account
        );

        if (!accountResult.success || !accountResult.itemId) {
          throw new Error(`Failed to create account: ${accountResult.error}`);
        }
        accountId = accountResult.itemId;
        logger.info(
          `[Sync Service] ✅ Created new account: ${mappedData.account.accountName}`
        );
      }

      // STEP 2: Process contacts with account linking
      const contactIds: string[] = [];
      for (const contactData of mappedData.contacts) {
        logger.info(
          `[Sync Service] 👤 Processing contact: ${contactData.contactName}`
        );

        const contactResult = await this.mondayApi.createContact(
          process.env.MONDAY_CONTACTS_BOARD_ID!,
          contactData
        );

        if (contactResult.success && contactResult.itemId) {
          contactIds.push(contactResult.itemId);

          // ✅ LINK CONTACT TO ACCOUNT
          try {
            await this.linkContactToAccount(contactResult.itemId, accountId);
            logger.info(
              `[Sync Service] 🔗 Linked contact ${contactResult.itemId} to account ${accountId}`
            );
          } catch (linkError) {
            logger.warn(
              `[Sync Service] ⚠️ Failed to link contact to account: ${linkError}`
            );
          }
        } else {
          logger.warn(
            `[Sync Service] ⚠️ Failed to create contact: ${contactResult.error}`
          );
          continue;
        }
      }

      // STEP 3: Create deal with contact linking
      logger.info(
        `[Sync Service] 💼 Processing deal: ${mappedData.deal.dealName}`
      );

      const dealResult = await this.mondayApi.createDeal(
        process.env.MONDAY_DEALS_BOARD_ID!,
        mappedData.deal
      );

      if (!dealResult.success || !dealResult.itemId) {
        throw new Error(`Failed to create deal: ${dealResult.error}`);
      }

      const dealId = dealResult.itemId;
      logger.info(
        `[Sync Service] ✅ Created new deal: ${mappedData.deal.dealName}`
      );

      // ✅ LINK DEAL TO CONTACTS
      if (contactIds.length > 0) {
        try {
          await this.linkDealToContacts(dealId, contactIds);
          logger.info(
            `[Sync Service] 🔗 Linked deal ${dealId} to ${contactIds.length} contacts`
          );
        } catch (linkError) {
          logger.warn(
            `[Sync Service] ⚠️ Failed to link deal to contacts: ${linkError}`
          );
        }
      }

      logger.info(`[Sync Service] 🎉 Quote ${quoteId} webhook sync complete!`);
      logger.info(
        `[Sync Service] 📊 Summary: Account(${accountId}), Contacts(${contactIds.length}), Deal(${dealId})`
      );

      return {
        success: true,
        message: `Quote ${quoteId} successfully synced via webhook: "${mappedData.deal.dealName}"`,
      };
    } catch (error) {
      logger.error(`[Sync Service] ❌ Failed to sync single quote ${quoteId}`, {
        error,
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ✅ HELPER: Find existing items by SimPro ID to avoid duplicates
  private async findBySimproId(
    boardId: string,
    simproId: number,
    type: "customer" | "contact" | "quote"
  ): Promise<any> {
    try {
      // Use the Monday client's search method
      const result = await this.mondayApi.findItemBySimProId(
        boardId,
        simproId,
        type
      );
      return result;
    } catch (error) {
      logger.error(`Error finding existing ${type}`, { error });
      return null;
    }
  }

  // ✅ LINKING: Connect contact to account
  private async linkContactToAccount(
    contactId: string,
    accountId: string
  ): Promise<void> {
    const mutation = `
      mutation ($itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(item_id: $itemId, column_id: $columnId, value: $value) {
          id
        }
      }
    `;

    const variables = {
      itemId: contactId,
      columnId: "contact_account", // Your contact-to-account relation column
      value: JSON.stringify({ item_ids: [parseInt(accountId)] }),
    };

    await this.mondayApi.query(mutation, variables);
  }

  // ✅ LINKING: Connect deal to contacts
  private async linkDealToContacts(
    dealId: string,
    contactIds: string[]
  ): Promise<void> {
    const mutation = `
      mutation ($itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(item_id: $itemId, column_id: $columnId, value: $value) {
          id
        }
      }
    `;

    const variables = {
      itemId: dealId,
      columnId: "deal_contact", // Your deal-to-contact relation column
      value: JSON.stringify({ item_ids: contactIds.map((id) => parseInt(id)) }),
    };

    await this.mondayApi.query(mutation, variables);
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
        responseTime: simproResponseTime,
      },
      monday: {
        status: mondayStatus,
        lastCheck: new Date().toISOString(),
        responseTime: mondayResponseTime,
      },
    };
  }
}
