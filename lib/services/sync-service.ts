// lib/services/sync-service.ts - COMPLETE VERSION with getSimProQuoteDetails method

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

  // ✅ NEW: Public getter for mondayApi (fixes private access error)
  public get mondayClient(): MondayClient {
    return this.mondayApi;
  }

  /**
   * ✅ NEW: Get quote details from SimPro (public method for webhook service)
   */
  public async getSimProQuoteDetails(companyId: number, quoteId: number) {
    return await this.simproQuotes.getQuoteDetails(companyId, quoteId);
  }

  // ✅ NEW: Missing findDealBySimProId method
  public async findDealBySimProId(
    simproQuoteId: number,
    boardId: string
  ): Promise<any | null> {
    try {
      const query = `
        query FindDeal($boardId: ID!) {
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

      const result = (await this.mondayApi.query(query, { boardId })) as any; // ✅ Type assertion to fix TypeScript error
      const items = result.boards[0]?.items_page?.items || [];

      // Search for deal by SimPro Quote ID in notes
      for (const item of items) {
        const notesColumn = item.column_values.find(
          (cv: any) =>
            cv.text && cv.text.includes(`SimPro Quote ID: ${simproQuoteId}`)
        );

        if (notesColumn) {
          logger.info(
            `[Sync Service] Found deal by SimPro ID: ${item.name} (${item.id})`
          );
          return item;
        }

        // Also check deal name for quote ID pattern
        if (item.name.includes(`Quote #${simproQuoteId}`)) {
          logger.info(
            `[Sync Service] Found deal by name pattern: ${item.name} (${item.id})`
          );
          return item;
        }
      }

      return null;
    } catch (error) {
      logger.error("[Sync Service] Error finding deal by SimPro ID", {
        error,
        simproQuoteId,
        boardId,
      });
      return null;
    }
  }

  // ✅ NEW: Missing syncSingleQuote method
  public async syncSingleQuote(
    quoteId: number,
    companyId: number,
    config: { minimumQuoteValue: number }
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(
        `[Sync Service] 🚀 WEBHOOK: Processing single quote ${quoteId}`
      );

      // ✅ STEP 1: Get basic quote details using existing method
      const basicQuote = await this.simproQuotes.getQuoteDetails(
        companyId,
        quoteId
      );

      // Quick validation checks
      if (
        !basicQuote.Total?.ExTax ||
        basicQuote.Total.ExTax < config.minimumQuoteValue
      ) {
        return {
          success: false,
          message: `Quote ${quoteId} value $${
            basicQuote.Total?.ExTax || 0
          } doesn't meet minimum $${config.minimumQuoteValue}`,
        };
      }

      // Check if quote is in valid stage
      const validStages = ["Complete", "Approved"];
      if (!validStages.includes(basicQuote.Stage)) {
        return {
          success: false,
          message: `Quote ${quoteId} stage "${basicQuote.Stage}" is not valid (need Complete/Approved)`,
        };
      }

      // Check valid status - ✅ UPDATED: Include archived statuses
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
        // ✅ ADD ARCHIVED STATUSES:
        "Quote: Archived - Not Won",
        "Quote : Archived - Not Won",
        "Quote: Archived - Won",
        "Quote : Archived - Won",
      ];
      const statusName = basicQuote.Status?.Name?.trim();
      if (!statusName || !validStatuses.includes(statusName)) {
        return {
          success: false,
          message: `Quote ${quoteId} status "${statusName}" is not valid for sync`,
        };
      }

      // Check if not closed (skip for archived quotes)
      const isArchivedQuote = statusName?.includes("Archived");
      if (!isArchivedQuote && basicQuote.IsClosed === true) {
        return {
          success: false,
          message: `Quote ${quoteId} is closed and won't be synced`,
        };
      }

      logger.info(
        `[Sync Service] ✅ Quote ${quoteId} passes validation - syncing to Monday`
      );

      // ✅ STEP 2: CRITICAL FIX - Enhance the quote with contact details!
      console.log(
        `🔧 [CONTACT FIX] Enhancing quote ${quoteId} with contact details...`
      );

      // Use the same enhancement logic as batch processing
      const enhancedQuotes = await this.enhanceSingleQuoteWithDetails(
        basicQuote,
        companyId
      );

      if (enhancedQuotes.length === 0) {
        throw new Error(
          `Failed to enhance quote ${quoteId} with contact details`
        );
      }

      const enhancedQuote = enhancedQuotes[0];

      console.log(
        `✅ [CONTACT FIX] Enhanced quote ${quoteId} - Contact details:`,
        {
          CustomerContactDetails: enhancedQuote.CustomerContactDetails,
          SiteContactDetails: enhancedQuote.SiteContactDetails,
        }
      );

      // ✅ STEP 3: Map the ENHANCED quote to Monday format
      const mappedData = this.mappingService.mapQuoteToMonday(enhancedQuote);

      // ✅ STEP 4: Process the mapped data
      const metrics = {
        quotesProcessed: 0,
        accountsCreated: 0,
        contactsCreated: 0,
        dealsCreated: 0,
        relationshipsLinked: 0,
        errors: 0,
      };

      await this.processMappedQuote(quoteId, mappedData, metrics);

      logger.info(`[Sync Service] 🎉 Quote ${quoteId} webhook sync complete!`);
      logger.info(
        `[Sync Service] 📊 Summary: Accounts(${metrics.accountsCreated}), Contacts(${metrics.contactsCreated}), Deals(${metrics.dealsCreated})`
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
          limit ? ` (limited from ${allValidQuotes.length} available)` : ""
        }`
      );

      // Process quotes with enhanced contact details
      for (const quote of quotesToProcess) {
        try {
          const mappedData = this.mappingService.mapQuoteToMonday(quote);

          // Process each mapped quote (account, contacts, deal)
          await this.processMappedQuote(quote.ID, mappedData, metrics);

          metrics.quotesProcessed++;
        } catch (error) {
          const errorMsg = `Failed to sync quote ${quote.ID}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`;
          logger.error(errorMsg, { error });
          errors.push(errorMsg);
          metrics.errors++;
        }
      }

      const success = errors.length === 0;
      const message = success
        ? `Successfully synced ${metrics.quotesProcessed} quotes${
            limit ? ` (limited from ${allValidQuotes.length} available)` : ""
          }`
        : `Completed with ${metrics.errors} errors out of ${metrics.quotesProcessed} quotes`;

      return {
        success,
        message,
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

  // ✅ NEW: Method to enhance a single quote with contact details (like batch processing does)
  private async enhanceSingleQuoteWithDetails(
    quote: any,
    companyId: number
  ): Promise<any[]> {
    console.log(
      `🔧 [CONTACT FIX] Starting contact detail enhancement for quote ${quote.ID}...`
    );

    // Collect contact IDs that need details
    const contactIds = [
      quote.CustomerContact?.ID,
      quote.SiteContact?.ID,
    ].filter((id) => Boolean(id));
    const customerIds = [quote.Customer?.ID].filter((id) => Boolean(id));

    console.log(`🔧 [CONTACT FIX] Need to fetch details for:`, {
      customerIds,
      contactIds,
      customerContact: quote.CustomerContact,
      siteContact: quote.SiteContact,
    });

    if (contactIds.length === 0) {
      console.log(
        `⚠️ [CONTACT FIX] No contacts found to enhance for quote ${quote.ID}`
      );
      return [quote]; // Return as-is if no contacts
    }

    try {
      // Fetch contact and customer details (reuse the existing methods)
      const [customerDetailsMap, contactDetailsMap] = await Promise.all([
        this.fetchCustomerDetails(customerIds, companyId),
        this.fetchContactDetails(contactIds, companyId),
      ]);

      console.log(`🔧 [CONTACT FIX] Fetched details:`, {
        customerDetails: Object.fromEntries(customerDetailsMap),
        contactDetails: Object.fromEntries(contactDetailsMap),
      });

      // Create enhanced quote
      const enhancedQuote = { ...quote };

      // Add customer details
      if (quote.Customer?.ID && customerDetailsMap.has(quote.Customer.ID)) {
        enhancedQuote.CustomerDetails = customerDetailsMap.get(
          quote.Customer.ID
        );
      }

      // Add customer contact details
      if (
        quote.CustomerContact?.ID &&
        contactDetailsMap.has(quote.CustomerContact.ID)
      ) {
        enhancedQuote.CustomerContactDetails = contactDetailsMap.get(
          quote.CustomerContact.ID
        );
      }

      // Add site contact details
      if (
        quote.SiteContact?.ID &&
        contactDetailsMap.has(quote.SiteContact.ID)
      ) {
        enhancedQuote.SiteContactDetails = contactDetailsMap.get(
          quote.SiteContact.ID
        );
      }

      console.log(`✅ [CONTACT FIX] Enhanced quote ${quote.ID} successfully`);
      return [enhancedQuote];
    } catch (error) {
      console.error(
        `❌ [CONTACT FIX] Failed to enhance quote ${quote.ID}:`,
        error
      );
      // Return original quote if enhancement fails
      return [quote];
    }
  }

  // Fetch customer details (company information)
  private async fetchCustomerDetails(
    customerIds: number[],
    companyId: number
  ): Promise<Map<number, any>> {
    const customerMap = new Map();

    for (const customerId of customerIds) {
      try {
        const customer = (await this.simproApi.request(
          `/companies/${companyId}/customers/companies/${customerId}`
        )) as any; // ✅ Type assertion to fix TypeScript error

        customerMap.set(customerId, {
          email: customer?.Email,
          phone: customer?.Phone,
          altPhone: customer?.AltPhone,
          address: customer?.Address,
        });
      } catch (error) {
        console.warn(`⚠️ Failed to fetch customer ${customerId}:`, error);
      }
    }

    return customerMap;
  }

  // Fetch individual contact details
  private async fetchContactDetails(
    contactIds: number[],
    companyId: number
  ): Promise<Map<number, any>> {
    const contactMap = new Map();

    for (const contactId of contactIds) {
      try {
        const contact = (await this.simproApi.request(
          `/companies/${companyId}/contacts/${contactId}`
        )) as any; // ✅ Type assertion to fix TypeScript error

        contactMap.set(contactId, {
          Email: contact?.Email,
          WorkPhone: contact?.WorkPhone,
          CellPhone: contact?.CellPhone,
          Department: contact?.Department,
          Position: contact?.Position,
        });
      } catch (error) {
        console.warn(`⚠️ Failed to fetch contact ${contactId}:`, error);
      }
    }

    return contactMap;
  }

  // Process mapped quote data to Monday
  private async processMappedQuote(
    quoteId: number,
    mappedData: any,
    metrics: any
  ): Promise<void> {
    // STEP 1: Create account
    logger.info(
      `[Sync Service] 🏢 Processing account: ${mappedData.account.accountName}`
    );

    const accountResult = await this.mondayApi.createAccount(
      process.env.MONDAY_ACCOUNTS_BOARD_ID!,
      mappedData.account
    );

    if (!accountResult.success || !accountResult.itemId) {
      throw new Error(`Failed to create account: ${accountResult.error}`);
    }

    const accountId = accountResult.itemId;
    logger.info(
      `[Sync Service] ✅ Using existing account: ${mappedData.account.accountName}`
    );

    // STEP 2: Create contacts and link to account
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
        metrics.contactsCreated++;

        // Link contact to account
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
      `[Sync Service] ✅ Deal processed: ${mappedData.deal.dealName} (${dealId})`
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

    // ✅ NEW: LINK DEAL TO ACCOUNT (fixes mirror relationship)
    try {
      await this.linkDealToAccount(dealId, accountId);
      logger.info(
        `[Sync Service] 🔗 Linked deal ${dealId} to account ${accountId}`
      );
    } catch (linkError) {
      logger.warn(
        `[Sync Service] ⚠️ Failed to link deal to account: ${linkError}`
      );
    }
  }

  // Health check method
  async healthCheck(): Promise<{
    simpro: { status: "up" | "down"; lastCheck: string; responseTime?: number };
    monday: { status: "up" | "down"; lastCheck: string; responseTime?: number };
  }> {
    const startTime = Date.now();

    // Test SimPro connection
    const simproTest = await this.simproApi.testConnection();
    const simproTime = Date.now() - startTime;

    // Test Monday connection
    const mondayStartTime = Date.now();
    const mondayTest = await this.mondayApi.testConnection();
    const mondayTime = Date.now() - mondayStartTime;

    return {
      simpro: {
        status: simproTest.success ? "up" : "down",
        lastCheck: new Date().toISOString(),
        responseTime: simproTime,
      },
      monday: {
        status: mondayTest.success ? "up" : "down",
        lastCheck: new Date().toISOString(),
        responseTime: mondayTime,
      },
    };
  }

  // Helper methods for linking
  private async linkContactToAccount(
    contactId: string,
    accountId: string
  ): Promise<void> {
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

    await this.mondayApi.query(mutation, {
      itemId: contactId,
      boardId: process.env.MONDAY_CONTACTS_BOARD_ID!,
      columnId: "contact_account",
      value: JSON.stringify({ item_ids: [parseInt(accountId)] }),
    });
  }

  private async linkDealToContacts(
    dealId: string,
    contactIds: string[]
  ): Promise<void> {
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

    const contactIdNumbers = contactIds.map((id) => parseInt(id));
    await this.mondayApi.query(mutation, {
      itemId: dealId,
      boardId: process.env.MONDAY_DEALS_BOARD_ID!,
      columnId: "deal_contact",
      value: JSON.stringify({ item_ids: contactIdNumbers }),
    });
  }

  // ✅ NEW: Link deal to account (fixes mirror relationship)
  private async linkDealToAccount(
    dealId: string,
    accountId: string
  ): Promise<void> {
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

    await this.mondayApi.query(mutation, {
      itemId: dealId,
      boardId: process.env.MONDAY_DEALS_BOARD_ID!,
      columnId: "deal_account", // This should match your Monday column ID for deal-to-account relationship
      value: JSON.stringify({ item_ids: [parseInt(accountId)] }),
    });
  }
}
