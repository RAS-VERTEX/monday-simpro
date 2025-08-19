// lib/services/sync-service.ts - Complete file with all mirror relationships
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
    this.simproApi = new SimProApi(simproConfig);
    this.simproQuotes = new SimProQuotes(this.simproApi);
    this.mondayApi = new MondayClient({ apiToken: mondayConfig.apiToken });
    this.mappingService = new MappingService();
  }

  public get mondayClient(): MondayClient {
    return this.mondayApi;
  }

  public async getSimProQuoteDetails(companyId: number, quoteId: number) {
    return await this.simproQuotes.getQuoteDetails(companyId, quoteId);
  }

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

      const result = await this.mondayApi.query(query, { boardId });
      const items = result.boards[0]?.items_page?.items || [];

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

  async healthCheck(): Promise<{
    simpro: { status: "up" | "down"; lastCheck: string; responseTime?: number };
    monday: { status: "up" | "down"; lastCheck: string; responseTime?: number };
  }> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    try {
      const simproTest = await this.simproApi.testConnection();
      const mondayTest = await this.mondayApi.testConnection();
      const responseTime = Date.now() - startTime;

      return {
        simpro: {
          status: simproTest.success ? "up" : "down",
          lastCheck: timestamp,
          responseTime: simproTest.success ? responseTime : undefined,
        },
        monday: {
          status: mondayTest.success ? "up" : "down",
          lastCheck: timestamp,
          responseTime: mondayTest.success ? responseTime : undefined,
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error("[Sync Service] Health check failed", { error });

      return {
        simpro: { status: "down", lastCheck: timestamp },
        monday: { status: "down", lastCheck: timestamp },
      };
    }
  }

  public async syncSingleQuote(
    quoteId: number,
    companyId: number,
    config: { minimumQuoteValue: number }
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(
        `[Sync Service] 🚀 WEBHOOK: Processing single quote ${quoteId}`
      );

      const basicQuote = await this.simproQuotes.getQuoteDetails(
        companyId,
        quoteId
      );

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

      const validStages = ["Complete", "Approved"];
      if (!validStages.includes(basicQuote.Stage)) {
        return {
          success: false,
          message: `Quote ${quoteId} stage "${basicQuote.Stage}" is not valid (need Complete/Approved)`,
        };
      }

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
        "Quote: Due Date Reached",
        "Quote : Due Date Reached",
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

      console.log(
        `🔧 [CONTACT FIX] Enhancing quote ${quoteId} with contact details...`
      );

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

      const mappedData = this.mappingService.mapQuoteToMonday(enhancedQuote);

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

  async syncSimProToMonday(
    config: SyncConfig,
    limit?: number
  ): Promise<SyncResult> {
    const errors: string[] = [];
    let metrics = {
      quotesProcessed: 0,
      accountsCreated: 0,
      contactsCreated: 0,
      dealsCreated: 0,
      relationshipsLinked: 0,
      errors: 0,
    };

    try {
      logger.info("[Sync Service] Starting BATCH sync", {
        minimumValue: config.minimumQuoteValue,
        limit,
      });

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

      const quotesToProcess = limit
        ? allValidQuotes.slice(0, limit)
        : allValidQuotes;

      for (const quote of quotesToProcess) {
        try {
          const mappedData = this.mappingService.mapQuoteToMonday(quote);
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
        ? `Successfully synced ${metrics.quotesProcessed} quotes`
        : `Completed with ${metrics.errors} errors out of ${metrics.quotesProcessed} quotes`;

      return {
        success,
        message,
        timestamp: new Date().toISOString(),
        metrics,
        errors: errors.length > 0 ? errors : undefined,
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

  // ✅ COMPLETE: All mirror relationships implemented
  private async processMappedQuote(
    quoteId: number,
    mappedData: any,
    metrics: any
  ): Promise<void> {
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
    if (
      accountResult.itemId &&
      !mappedData.account.accountName.includes("existing")
    ) {
      metrics.accountsCreated++;
    }
    logger.info(
      `[Sync Service] ✅ Using existing account: ${mappedData.account.accountName}`
    );

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

        // ✅ LINK: Contact → Account
        try {
          await this.linkContactToAccount(contactResult.itemId, accountId);
          logger.info(
            `[Sync Service] 🔗 Linked contact ${contactResult.itemId} to account ${accountId}`
          );
          metrics.relationshipsLinked++;
        } catch (linkError) {
          logger.warn(
            `[Sync Service] ⚠️ Failed to link contact to account: ${linkError}`
          );
        }
      } else {
        logger.warn(
          `[Sync Service] ⚠️ Failed to create contact: ${contactResult.error}`
        );
      }
    }

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
    metrics.dealsCreated++;
    logger.info(
      `[Sync Service] ✅ Deal processed: ${mappedData.deal.dealName} (${dealId})`
    );

    // ✅ LINK: Deal → Account (THIS WAS MISSING!)
    try {
      await this.linkDealToAccount(dealId, accountId);
      logger.info(
        `[Sync Service] 🔗 Linked deal ${dealId} to account ${accountId}`
      );
      metrics.relationshipsLinked++;
    } catch (linkError) {
      logger.warn(
        `[Sync Service] ⚠️ Failed to link deal to account: ${linkError}`
      );
    }

    // ✅ LINK: Deal → Contacts
    if (contactIds.length > 0) {
      try {
        await this.linkDealToContacts(dealId, contactIds);
        logger.info(
          `[Sync Service] 🔗 Linked deal ${dealId} to ${contactIds.length} contacts`
        );
        metrics.relationshipsLinked++;
      } catch (linkError) {
        logger.warn(
          `[Sync Service] ⚠️ Failed to link deal to contacts: ${linkError}`
        );
      }
    }

    // ✅ LINK: Contact → Deal (bidirectional)
    for (const contactId of contactIds) {
      try {
        await this.linkContactToDeal(contactId, dealId);
        logger.info(
          `[Sync Service] 🔗 Linked contact ${contactId} to deal ${dealId}`
        );
        metrics.relationshipsLinked++;
      } catch (linkError) {
        logger.warn(
          `[Sync Service] ⚠️ Failed to link contact to deal: ${linkError}`
        );
      }
    }
  }

  // ✅ LINK: Contact → Account
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

  // ✅ LINK: Deal → Account (THIS WAS MISSING!)
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
      columnId: "deal_account",
      value: JSON.stringify({ item_ids: [parseInt(accountId)] }),
    });
  }

  // ✅ LINK: Deal → Contacts
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

    await this.mondayApi.query(mutation, {
      itemId: dealId,
      boardId: process.env.MONDAY_DEALS_BOARD_ID!,
      columnId: "deal_contact",
      value: JSON.stringify({
        item_ids: contactIds.map((id) => parseInt(id)),
      }),
    });
  }

  // ✅ LINK: Contact → Deal (bidirectional)
  private async linkContactToDeal(
    contactId: string,
    dealId: string
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
      columnId: "contact_deal",
      value: JSON.stringify({ item_ids: [parseInt(dealId)] }),
    });
  }

  private async enhanceSingleQuoteWithDetails(
    quote: any,
    companyId: number
  ): Promise<any[]> {
    console.log(
      `🔧 [CONTACT FIX] Starting contact detail enhancement for quote ${quote.ID}...`
    );

    const contactIds = [
      quote.CustomerContact?.ID,
      quote.SiteContact?.ID,
    ].filter(Boolean);
    const customerIds = [quote.Customer?.ID].filter(Boolean);

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
      return [quote];
    }

    try {
      const [customerDetailsMap, contactDetailsMap] = await Promise.all([
        this.fetchCustomerDetails(customerIds, companyId),
        this.fetchContactDetails(contactIds, companyId),
      ]);

      console.log(`🔧 [CONTACT FIX] Fetched details:`, {
        customerDetails: Object.fromEntries(customerDetailsMap),
        contactDetails: Object.fromEntries(contactDetailsMap),
      });

      const enhancedQuote = { ...quote };

      if (quote.Customer?.ID && customerDetailsMap.has(quote.Customer.ID)) {
        enhancedQuote.CustomerDetails = customerDetailsMap.get(
          quote.Customer.ID
        );
      }

      if (
        quote.CustomerContact?.ID &&
        contactDetailsMap.has(quote.CustomerContact.ID)
      ) {
        enhancedQuote.CustomerContactDetails = contactDetailsMap.get(
          quote.CustomerContact.ID
        );
      }

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
      return [quote];
    }
  }

  private async fetchCustomerDetails(
    customerIds: number[],
    companyId: number
  ): Promise<Map<number, any>> {
    const customerDetails = new Map<number, any>();

    for (const customerId of customerIds) {
      try {
        const customer = await this.simproApi.request(
          `/companies/${companyId}/customers/${customerId}/`
        );
        customerDetails.set(customerId, customer);
      } catch (error) {
        console.warn(
          `⚠️ [CONTACT FIX] Failed to fetch customer ${customerId}:`,
          error
        );
      }
    }

    return customerDetails;
  }

  private async fetchContactDetails(
    contactIds: number[],
    companyId: number
  ): Promise<Map<number, any>> {
    const contactDetails = new Map<number, any>();

    for (const contactId of contactIds) {
      try {
        const contact = await this.simproApi.request(
          `/companies/${companyId}/contacts/${contactId}/`
        );
        contactDetails.set(contactId, contact);
      } catch (error) {
        console.warn(
          `⚠️ [CONTACT FIX] Failed to fetch contact ${contactId}:`,
          error
        );
      }
    }

    return contactDetails;
  }
}
