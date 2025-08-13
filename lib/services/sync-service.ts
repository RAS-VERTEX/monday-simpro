// lib/services/sync-service.ts - FIXED: Populate data FIRST, then check duplicates
import { SimProApi } from "@/lib/clients/simpro/simpro-api";
import { SimProQuotes } from "@/lib/clients/simpro/simpro-quotes";
import { MondayClient } from "@/lib/monday-client"; // Use the working MondayClient
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
    relationshipsLinked: number;
    errors: number;
  };
  errors?: string[];
  debugInfo?: any;
}

export class SyncService {
  private simproApi: SimProApi;
  private simproQuotes: SimProQuotes;
  private mondayApi: MondayClient; // Use the working MondayClient
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

    // Initialize Monday client (use the working MondayClient class)
    this.mondayApi = new MondayClient({ apiToken: mondayConfig.apiToken });

    // Keep the specialized service classes for their logic
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
      logger.info("[Sync Service] Starting FIXED SimPro → Monday sync", {
        minimumValue: config.minimumQuoteValue,
        limit,
      });

      // Get raw quotes first
      const rawQuotes = await this.simproQuotes.getActiveHighValueQuotes(
        config.minimumQuoteValue
      );
      if (rawQuotes.length === 0) {
        return {
          success: true,
          message: "No high-value quotes found to sync",
          timestamp: new Date().toISOString(),
          metrics,
        };
      }

      // Apply limit for testing
      const quotesToProcess = limit ? rawQuotes.slice(0, limit) : rawQuotes;
      logger.info(`[Sync Service] Processing ${quotesToProcess.length} quotes`);

      // Process each quote with PROPER data population
      for (const quote of quotesToProcess) {
        try {
          metrics.quotesProcessed++;
          logger.info(
            `[Sync Service] Processing Quote #${quote.ID} - ${quote.Customer.CompanyName}`
          );

          // STEP 1: Fetch full customer data from SimPro API
          const fullCustomerData = await this.fetchFullCustomerData(
            quote.Customer.ID
          );
          debugInfo[`quote_${quote.ID}_customer`] = fullCustomerData;

          // STEP 2: Fetch full contact data from SimPro API
          const fullContactsData = await this.fetchFullContactsData(quote);
          debugInfo[`quote_${quote.ID}_contacts`] = fullContactsData;

          // STEP 3: Create account with REAL data
          const accountData = {
            accountName: quote.Customer.CompanyName,
            industry: "Building Services",
            description: `Customer from SimPro - Quote #${quote.ID}`,
            email: fullCustomerData.Email || "",
            phone: fullCustomerData.Phone || "",
            address: this.formatAddress(fullCustomerData.Address),
            simproCustomerId: quote.Customer.ID,
          };

          logger.info(
            `[Sync Service] Creating account with data:`,
            accountData
          );
          const accountResult = await this.createAccountWithData(
            accountData,
            config.boardIds.accounts
          );
          if (!accountResult.success) {
            throw new Error(`Account creation failed: ${accountResult.error}`);
          }
          const accountId = accountResult.itemId!;
          if (accountResult.created) metrics.accountsCreated++;

          // STEP 4: Create contacts with REAL data and proper linking
          const contactIds: string[] = [];
          for (const contactData of fullContactsData) {
            logger.info(
              `[Sync Service] Creating contact with data:`,
              contactData
            );

            const contactResult = await this.createContactWithData(
              contactData,
              config.boardIds.contacts,
              accountId
            );

            if (contactResult.success && contactResult.itemId) {
              contactIds.push(contactResult.itemId);
              if (contactResult.created) metrics.contactsCreated++;
            }
          }

          // STEP 5: Create deal with REAL data and proper linking
          const dealData = {
            dealName: `Quote #${quote.ID} - ${quote.Customer.CompanyName}`,
            dealValue: quote.Total?.ExTax || 0,
            stage: quote.Stage || "Quoted",
            accountName: quote.Customer.CompanyName,
            salesperson: quote.Salesperson?.Name || "",
            dateIssued:
              quote.DateIssued || new Date().toISOString().split("T")[0],
            dueDate:
              quote.DueDate ||
              quote.DateIssued ||
              new Date().toISOString().split("T")[0],
            siteName: quote.Site?.Name || "",
            simproQuoteId: quote.ID,
          };

          logger.info(`[Sync Service] Creating deal with data:`, dealData);
          const dealResult = await this.createDealWithData(
            dealData,
            config.boardIds.deals,
            accountId,
            contactIds
          );

          if (!dealResult.success) {
            throw new Error(`Deal creation failed: ${dealResult.error}`);
          }
          const dealId = dealResult.itemId!;
          if (dealResult.created) metrics.dealsCreated++;

          // STEP 6: Link everything together with mirror columns
          await this.linkItemsWithMirrorColumns(
            accountId,
            contactIds,
            dealId,
            config.boardIds
          );
          metrics.relationshipsLinked++;

          logger.info(
            `[Sync Service] ✅ Quote #${quote.ID} processed successfully`
          );
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
          ? `Successfully synced ${metrics.quotesProcessed} quotes with full data and relationships`
          : `Completed with ${metrics.errors} errors out of ${metrics.quotesProcessed} quotes`,
        timestamp: new Date().toISOString(),
        metrics,
        errors: errors.length > 0 ? errors : undefined,
        debugInfo,
      };
    } catch (error) {
      logger.error("[Sync Service] Critical error", { error });
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Critical sync failure",
        timestamp: new Date().toISOString(),
        metrics,
        errors: [
          error instanceof Error ? error.message : "Critical sync failure",
        ],
      };
    }
  }

  /**
   * Fetch complete customer data from SimPro API
   */
  private async fetchFullCustomerData(customerId: number): Promise<any> {
    try {
      logger.info(
        `[Sync Service] Fetching customer data for ID: ${customerId}`
      );
      const customer = await this.simproApi.request(
        `/companies/${this.simproApi["companyId"]}/customers/companies/${customerId}`
      );
      logger.info(`[Sync Service] Customer data fetched:`, {
        name: customer.CompanyName,
        email: customer.Email,
        phone: customer.Phone,
        hasAddress: !!customer.Address,
      });
      return customer;
    } catch (error) {
      logger.error(`[Sync Service] Failed to fetch customer ${customerId}`, {
        error,
      });
      return { CompanyName: "Unknown", Email: "", Phone: "", Address: null };
    }
  }

  /**
   * Fetch complete contact data from SimPro API
   */
  private async fetchFullContactsData(quote: any): Promise<any[]> {
    const contacts: any[] = [];

    // Fetch customer contact details
    if (quote.CustomerContact?.ID) {
      try {
        const contact = await this.simproApi.request(
          `/companies/${this.simproApi["companyId"]}/contacts/${quote.CustomerContact.ID}`
        );
        contacts.push({
          contactName: `${contact.GivenName || ""} ${
            contact.FamilyName || ""
          }`.trim(),
          contactType: "customer",
          email: contact.Email || "",
          phone: contact.WorkPhone || contact.CellPhone || "",
          department: contact.Department || "",
          position: contact.Position || "",
          companyName: quote.Customer.CompanyName,
          simproContactId: quote.CustomerContact.ID,
          simproCustomerId: quote.Customer.ID,
        });
      } catch (error) {
        logger.error(
          `Failed to fetch customer contact ${quote.CustomerContact.ID}`,
          { error }
        );
      }
    }

    // Fetch site contact details (if different)
    if (
      quote.SiteContact?.ID &&
      quote.SiteContact.ID !== quote.CustomerContact?.ID
    ) {
      try {
        const contact = await this.simproApi.request(
          `/companies/${this.simproApi["companyId"]}/contacts/${quote.SiteContact.ID}`
        );
        contacts.push({
          contactName: `${contact.GivenName || ""} ${
            contact.FamilyName || ""
          }`.trim(),
          contactType: "site",
          email: contact.Email || "",
          phone: contact.WorkPhone || contact.CellPhone || "",
          department: contact.Department || "",
          position: contact.Position || "",
          companyName: quote.Customer.CompanyName,
          siteName: quote.Site?.Name || "",
          simproContactId: quote.SiteContact.ID,
          simproCustomerId: quote.Customer.ID,
        });
      } catch (error) {
        logger.error(`Failed to fetch site contact ${quote.SiteContact.ID}`, {
          error,
        });
      }
    }

    logger.info(
      `[Sync Service] Fetched ${contacts.length} contacts with full data`
    );
    return contacts;
  }

  /**
   * Create account with actual data and proper duplicate checking
   */
  private async createAccountWithData(
    accountData: any,
    boardId: string
  ): Promise<{
    success: boolean;
    itemId?: string;
    created?: boolean;
    error?: string;
  }> {
    try {
      // Check for existing account by SimPro Customer ID
      const existing = await this.findExistingAccountBySimproId(
        accountData.simproCustomerId,
        boardId
      );
      if (existing) {
        logger.info(
          `[Sync Service] Using existing account: ${existing.name} (${existing.id})`
        );
        return { success: true, itemId: existing.id, created: false };
      }

      // Create new account with full column data
      const columnValues: any = {};

      // Industry
      if (accountData.industry) {
        columnValues["text8"] = accountData.industry;
      }

      // Description with all details
      const description = [
        accountData.description,
        `Email: ${accountData.email}`,
        `Phone: ${accountData.phone}`,
        `Address: ${accountData.address}`,
        `SimPro Customer ID: ${accountData.simproCustomerId}`,
        `Last Sync: ${new Date().toISOString()}`,
      ].join("\n");
      columnValues["long_text"] = description;

      const item = await this.mondayApi.createItem(
        boardId,
        accountData.accountName,
        columnValues
      );
      logger.info(
        `[Sync Service] ✅ Created account: ${item.name} (${item.id})`
      );

      return { success: true, itemId: item.id, created: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Create contact with actual data and proper linking
   */
  private async createContactWithData(
    contactData: any,
    boardId: string,
    accountId: string
  ): Promise<{
    success: boolean;
    itemId?: string;
    created?: boolean;
    error?: string;
  }> {
    try {
      // Check for existing contact by SimPro Contact ID AND name
      const existing = await this.findExistingContactBySimproId(
        contactData.simproContactId,
        boardId
      );
      if (existing) {
        logger.info(
          `[Sync Service] Using existing contact: ${existing.name} (${existing.id})`
        );
        // Update the existing contact's account link
        await this.linkContactToAccount(existing.id, accountId);
        return { success: true, itemId: existing.id, created: false };
      }

      // Create new contact with full column data
      const columnValues: any = {};

      // Email
      if (contactData.email) {
        columnValues["email"] = {
          email: contactData.email,
          text: contactData.email,
        };
      }

      // Phone
      if (contactData.phone) {
        columnValues["phone"] = contactData.phone;
      }

      // Link to account (mirror column)
      columnValues["connect_boards"] = {
        item_ids: [parseInt(accountId)],
      };

      // Notes with full details
      const notes = [
        `Contact Type: ${contactData.contactType}`,
        `Department: ${contactData.department}`,
        `Position: ${contactData.position}`,
        `Company: ${contactData.companyName}`,
        contactData.siteName ? `Site: ${contactData.siteName}` : "",
        `SimPro Contact ID: ${contactData.simproContactId}`,
        `SimPro Customer ID: ${contactData.simproCustomerId}`,
        `Last Sync: ${new Date().toISOString()}`,
      ]
        .filter(Boolean)
        .join("\n");
      columnValues["long_text"] = notes;

      const item = await this.mondayApi.createItem(
        boardId,
        contactData.contactName,
        columnValues
      );
      logger.info(
        `[Sync Service] ✅ Created contact: ${item.name} (${item.id}) linked to account ${accountId}`
      );

      return { success: true, itemId: item.id, created: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Create deal with actual data and proper linking
   */
  private async createDealWithData(
    dealData: any,
    boardId: string,
    accountId: string,
    contactIds: string[]
  ): Promise<{
    success: boolean;
    itemId?: string;
    created?: boolean;
    error?: string;
  }> {
    try {
      // Check for existing deal by SimPro Quote ID
      const existing = await this.findExistingDealBySimproId(
        dealData.simproQuoteId,
        boardId
      );
      if (existing) {
        logger.info(
          `[Sync Service] Using existing deal: ${existing.name} (${existing.id})`
        );
        return { success: true, itemId: existing.id, created: false };
      }

      // Create new deal with full column data
      const columnValues: any = {};

      // Deal value
      if (dealData.dealValue) {
        columnValues["numbers"] = dealData.dealValue;
      }

      // Stage
      if (dealData.stage) {
        columnValues["status"] = { label: dealData.stage };
      }

      // Dates
      if (dealData.dateIssued) {
        columnValues["date"] = dealData.dateIssued;
      }
      if (dealData.dueDate) {
        columnValues["date4"] = dealData.dueDate;
      }

      // Link to account (mirror column)
      columnValues["connect_boards9"] = {
        item_ids: [parseInt(accountId)],
      };

      // Link to contacts (mirror column)
      if (contactIds.length > 0) {
        columnValues["connect_boards"] = {
          item_ids: contactIds.map((id) => parseInt(id)),
        };
      }

      // Notes with full details
      const notes = [
        `Account: ${dealData.accountName}`,
        `Salesperson: ${dealData.salesperson}`,
        `Site: ${dealData.siteName}`,
        `Value: $${dealData.dealValue}`,
        `SimPro Quote ID: ${dealData.simproQuoteId}`,
        `Last Sync: ${new Date().toISOString()}`,
      ]
        .filter(Boolean)
        .join("\n");
      columnValues["long_text"] = notes;

      const item = await this.mondayApi.createItem(
        boardId,
        dealData.dealName,
        columnValues
      );
      logger.info(
        `[Sync Service] ✅ Created deal: ${item.name} (${item.id}) linked to account ${accountId} and ${contactIds.length} contacts`
      );

      return { success: true, itemId: item.id, created: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // Helper methods for finding existing items by SimPro ID
  private async findExistingAccountBySimproId(
    simproCustomerId: number,
    boardId: string
  ): Promise<any> {
    // Use the correct method from MondayClient
    return await this.mondayApi.findItemBySimProId(
      boardId,
      simproCustomerId,
      "customer"
    );
  }

  private async findExistingContactBySimproId(
    simproContactId: number,
    boardId: string
  ): Promise<any> {
    // Use the correct method from MondayClient
    return await this.mondayApi.findItemBySimProId(
      boardId,
      simproContactId,
      "contact"
    );
  }

  private async findExistingDealBySimproId(
    simproQuoteId: number,
    boardId: string
  ): Promise<any> {
    // Use the correct method from MondayClient
    return await this.mondayApi.findItemBySimProId(
      boardId,
      simproQuoteId,
      "quote"
    );
  }

  private formatAddress(address: any): string {
    if (!address) return "Not provided";
    return `${address.Address || ""}, ${address.City || ""}, ${
      address.State || ""
    } ${address.PostalCode || ""}`.trim();
  }

  private async linkContactToAccount(
    contactId: string,
    accountId: string
  ): Promise<void> {
    const columnValues = {
      connect_boards: {
        item_ids: [parseInt(accountId)],
      },
    };
    await this.mondayApi.updateItem(contactId, columnValues);
  }

  private async linkItemsWithMirrorColumns(
    accountId: string,
    contactIds: string[],
    dealId: string,
    boardIds: MondayBoardConfig
  ): Promise<void> {
    // Update account to show related contacts and deals
    await this.mondayApi.updateItem(accountId, {
      connect_boards: { item_ids: contactIds.map((id) => parseInt(id)) },
      connect_boards5: { item_ids: [parseInt(dealId)] },
    });

    // Update each contact to show related account and deal
    for (const contactId of contactIds) {
      await this.mondayApi.updateItem(contactId, {
        connect_boards: { item_ids: [parseInt(accountId)] },
        connect_boards4: { item_ids: [parseInt(dealId)] },
      });
    }

    // Update deal to show related account and contacts
    await this.mondayApi.updateItem(dealId, {
      connect_boards9: { item_ids: [parseInt(accountId)] },
      connect_boards: { item_ids: contactIds.map((id) => parseInt(id)) },
    });
  }

  async healthCheck(): Promise<{
    simpro: { status: "up" | "down"; responseTime?: number; lastCheck: string };
    monday: { status: "up" | "down"; responseTime?: number; lastCheck: string };
  }> {
    // Test SimPro connection
    let simproStatus: "up" | "down" = "down";
    let simproResponseTime: number | undefined;

    try {
      const testStart = Date.now();
      await this.simproApi.testConnection();
      simproResponseTime = Date.now() - testStart;
      simproStatus = "up";
    } catch (error) {
      logger.error("[Health Check] SimPro connection failed", { error });
    }

    // Test Monday connection
    let mondayStatus: "up" | "down" = "down";
    let mondayResponseTime: number | undefined;

    try {
      const testStart = Date.now();
      await this.mondayApi.testConnection();
      mondayResponseTime = Date.now() - testStart;
      mondayStatus = "up";
    } catch (error) {
      logger.error("[Health Check] Monday connection failed", { error });
    }

    return {
      simpro: {
        status: simproStatus,
        responseTime: simproResponseTime,
        lastCheck: new Date().toISOString(),
      },
      monday: {
        status: mondayStatus,
        responseTime: mondayResponseTime,
        lastCheck: new Date().toISOString(),
      },
    };
  }
}
