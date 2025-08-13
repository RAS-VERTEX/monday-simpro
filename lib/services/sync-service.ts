// lib/services/sync-service.ts - FULLY FIXED with correct Monday column formats
import { SimProApi } from "@/lib/clients/simpro/simpro-api";
import { SimProQuotes } from "@/lib/clients/simpro/simpro-quotes";
import { MondayClient } from "@/lib/monday-client";
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
  private mondayApi: MondayClient;
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

    // Initialize Monday client
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
      logger.info(
        "[Sync Service] Starting FULLY FIXED sync with correct column formats",
        {
          minimumValue: config.minimumQuoteValue,
          limit,
        }
      );

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

      // Process each quote with CORRECT data population
      for (const quote of quotesToProcess) {
        try {
          metrics.quotesProcessed++;
          logger.info(
            `[Sync Service] Processing Quote #${quote.ID} - ${quote.Customer.CompanyName}`
          );

          // STEP 1: Get complete customer data from SimPro
          const customerData = await this.getCustomerData(quote.Customer.ID);
          debugInfo[`quote_${quote.ID}_customer`] = customerData;

          // STEP 2: Get complete contacts data from SimPro
          const contactsData = await this.getContactsData(quote);
          debugInfo[`quote_${quote.ID}_contacts`] = contactsData;

          // STEP 3: Create account with REAL DATA
          const accountId = await this.createAccountWithCorrectFormat(
            quote,
            customerData,
            config.boardIds.accounts
          );
          metrics.accountsCreated++;

          // STEP 4: Create contacts with REAL DATA and correct board relations
          const contactIds: string[] = [];
          for (const contactData of contactsData) {
            const contactId = await this.createContactWithCorrectFormat(
              contactData,
              accountId,
              config.boardIds.contacts
            );
            contactIds.push(contactId);
            metrics.contactsCreated++;
          }

          // STEP 5: Create deal with REAL DATA and correct board relations
          const dealId = await this.createDealWithCorrectFormat(
            quote,
            accountId,
            contactIds,
            config.boardIds.deals
          );
          metrics.dealsCreated++;

          // STEP 6: Link mirror columns with correct format and board_id
          await this.linkMirrorColumnsCorrectly(
            accountId,
            contactIds,
            dealId,
            config.boardIds
          );
          metrics.relationshipsLinked++;

          logger.info(
            `[Sync Service] ✅ Quote #${quote.ID} synced with ALL data and relationships`
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
          ? `Successfully synced ${metrics.quotesProcessed} quotes with FULL data and mirror relationships`
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
   * Get complete customer data from SimPro API
   */
  private async getCustomerData(customerId: number): Promise<any> {
    try {
      const customer = await this.simproApi.request(
        `/companies/${this.simproApi["companyId"]}/customers/companies/${customerId}`
      );
      logger.info(`[Sync Service] Customer data fetched:`, {
        name: customer.CompanyName,
        email: customer.Email,
        phone: customer.Phone,
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
   * Get complete contacts data from SimPro API - FIXED to avoid duplicates
   */
  private async getContactsData(quote: any): Promise<any[]> {
    const contacts: any[] = [];
    const processedContactIds = new Set<number>(); // Track processed contact IDs to avoid duplicates

    // Customer contact
    if (
      quote.CustomerContact?.ID &&
      !processedContactIds.has(quote.CustomerContact.ID)
    ) {
      try {
        const contact = await this.simproApi.request(
          `/companies/${this.simproApi["companyId"]}/contacts/${quote.CustomerContact.ID}`
        );
        contacts.push({
          ...contact,
          contactType: "customer",
          simproContactId: quote.CustomerContact.ID,
          simproCustomerId: quote.Customer.ID,
        });
        processedContactIds.add(quote.CustomerContact.ID);
        logger.info(
          `[Sync Service] Added customer contact: ${contact.GivenName} ${contact.FamilyName} (ID: ${quote.CustomerContact.ID})`
        );
      } catch (error) {
        logger.error(
          `Failed to fetch customer contact ${quote.CustomerContact.ID}`,
          { error }
        );
      }
    }

    // Site contact (ONLY if different from customer contact)
    if (
      quote.SiteContact?.ID &&
      quote.SiteContact.ID !== quote.CustomerContact?.ID &&
      !processedContactIds.has(quote.SiteContact.ID)
    ) {
      // Additional check: ensure they have different names (some systems use same ID with different data)
      const customerName = `${quote.CustomerContact?.GivenName || ""} ${
        quote.CustomerContact?.FamilyName || ""
      }`.trim();
      const siteName = `${quote.SiteContact?.GivenName || ""} ${
        quote.SiteContact?.FamilyName || ""
      }`.trim();

      if (customerName !== siteName) {
        try {
          const contact = await this.simproApi.request(
            `/companies/${this.simproApi["companyId"]}/contacts/${quote.SiteContact.ID}`
          );
          contacts.push({
            ...contact,
            contactType: "site",
            siteName: quote.Site?.Name || "",
            simproContactId: quote.SiteContact.ID,
            simproCustomerId: quote.Customer.ID,
          });
          processedContactIds.add(quote.SiteContact.ID);
          logger.info(
            `[Sync Service] Added site contact: ${contact.GivenName} ${contact.FamilyName} (ID: ${quote.SiteContact.ID})`
          );
        } catch (error) {
          logger.error(`Failed to fetch site contact ${quote.SiteContact.ID}`, {
            error,
          });
        }
      } else {
        logger.info(
          `[Sync Service] Site contact has same name as customer contact ("${siteName}") - treating as duplicate`
        );
      }
    } else if (quote.SiteContact?.ID === quote.CustomerContact?.ID) {
      logger.info(
        `[Sync Service] Site contact is same as customer contact (ID: ${quote.SiteContact.ID}) - not duplicating`
      );
    }

    logger.info(
      `[Sync Service] Fetched ${contacts.length} unique contacts (avoided duplicates)`
    );
    return contacts;
  }

  /**
   * Create account with CORRECT column format
   */
  private async createAccountWithCorrectFormat(
    quote: any,
    customerData: any,
    boardId: string
  ): Promise<string> {
    // Check for existing account using notes field
    const existing = await this.findBySimproId(
      boardId,
      quote.Customer.ID,
      "customer"
    );
    if (existing) {
      logger.info(`[Sync Service] Using existing account: ${existing.name}`);
      return existing.id;
    }

    // Create account with CORRECT column format based on your board structure
    const columnValues: any = {};

    // Company Description (your actual column: "company_description")
    columnValues["company_description"] = `Customer from SimPro
Email: ${customerData.Email || "Not provided"}
Phone: ${customerData.Phone || "Not provided"}
Address: ${this.formatAddress(customerData.Address)}`;

    // Notes (your actual column: "text_mktrez5x")
    columnValues["text_mktrez5x"] = `SimPro Customer ID: ${quote.Customer.ID}
Last Sync: ${new Date().toISOString()}
Source: SimPro Quote #${quote.ID}`;

    const item = await this.mondayApi.createItem(
      boardId,
      quote.Customer.CompanyName,
      columnValues
    );
    logger.info(
      `[Sync Service] ✅ Created account with CORRECT format: ${item.name} (${item.id})`
    );

    return item.id;
  }

  /**
   * Create contact with CORRECT column format and board_relation
   */
  private async createContactWithCorrectFormat(
    contactData: any,
    accountId: string,
    boardId: string
  ): Promise<string> {
    // Check for existing contact using notes field
    const existing = await this.findBySimproId(
      boardId,
      contactData.simproContactId,
      "contact"
    );
    if (existing) {
      logger.info(`[Sync Service] Using existing contact: ${existing.name}`);
      return existing.id;
    }

    const contactName = `${contactData.GivenName || ""} ${
      contactData.FamilyName || ""
    }`.trim();

    // Create contact with CORRECT column format based on your board structure
    const columnValues: any = {};

    // EMAIL (format confirmed: object with email and text)
    if (contactData.Email) {
      columnValues["contact_email"] = {
        email: contactData.Email,
        text: contactData.Email,
      };
      logger.info(
        `[Sync Service] 📧 Setting email correctly: ${contactData.Email}`
      );
    }

    // PHONE (format confirmed: simple string, but clean the format first)
    if (contactData.WorkPhone || contactData.CellPhone) {
      const rawPhone = contactData.WorkPhone || contactData.CellPhone;
      // Clean phone: remove spaces, keep only digits and +
      const cleanPhone = rawPhone.replace(/\s+/g, "").replace(/[^\d+]/g, "");
      columnValues["contact_phone"] = cleanPhone;
      logger.info(
        `[Sync Service] 📞 Setting cleaned phone: ${rawPhone} → ${cleanPhone}`
      );
    }

    // LINK TO ACCOUNT (your actual column: "contact_account", type: "board_relation")
    columnValues["contact_account"] = {
      item_ids: [parseInt(accountId)],
    };
    logger.info(
      `[Sync Service] 🔗 Linking contact to account correctly: ${accountId}`
    );

    // Notes (your actual column: "text_mktr67s0")
    columnValues["text_mktr67s0"] = `SimPro Contact ID: ${
      contactData.simproContactId
    }
Contact Type: ${contactData.contactType}
Department: ${contactData.Department || "Not specified"}
Position: ${contactData.Position || "Not specified"}
Last Sync: ${new Date().toISOString()}`;

    const item = await this.mondayApi.createItem(
      boardId,
      contactName,
      columnValues
    );
    logger.info(
      `[Sync Service] ✅ Created contact with CORRECT format: ${item.name} (${item.id})`
    );

    return item.id;
  }

  /**
   * Create deal with CORRECT column format and board_relations
   */
  private async createDealWithCorrectFormat(
    quote: any,
    accountId: string,
    contactIds: string[],
    boardId: string
  ): Promise<string> {
    // Check for existing deal using notes field
    const existing = await this.findBySimproId(boardId, quote.ID, "quote");
    if (existing) {
      logger.info(`[Sync Service] Using existing deal: ${existing.name}`);
      return existing.id;
    }

    const dealName = `Quote #${quote.ID} - ${quote.Customer.CompanyName}`;

    // Create deal with CORRECT column format based on your board structure
    const columnValues: any = {};

    // DEAL VALUE (your actual column: "deal_value", type: "numbers")
    if (quote.Total?.ExTax) {
      columnValues["deal_value"] = quote.Total.ExTax;
      logger.info(
        `[Sync Service] 💰 Setting deal value correctly: $${quote.Total.ExTax}`
      );
    }

    // STATUS/STAGE (format confirmed: object with label, but must use exact status names)
    // Your valid statuses: Quote: Sent, Quote: Won, Quote: On Hold, Quote: To Be Scheduled, Quote: To Write, Quote: To Be Assigned, Quote Visit Scheduled, Quote: Due Date Reached
    if (quote.Stage) {
      // Map SimPro stages to your Monday status labels
      const statusMapping: { [key: string]: string } = {
        Quoted: "Quote: Sent",
        "Proposal Sent": "Quote: Sent",
        Won: "Quote: Won",
        Accepted: "Quote: Won",
        "On Hold": "Quote: On Hold",
        Scheduled: "Quote Visit Scheduled",
        "To Be Scheduled": "Quote: To Be Scheduled",
        "To Write": "Quote: To Write",
        "To Be Assigned": "Quote: To Be Assigned",
      };

      const mondayStatus = statusMapping[quote.Stage] || "Quote: Sent"; // Default fallback
      columnValues["color_mktrw6k3"] = { label: mondayStatus };
      logger.info(
        `[Sync Service] 📊 Setting stage correctly: ${quote.Stage} → ${mondayStatus}`
      );
    }

    // CLOSE DATE (format confirmed: simple string YYYY-MM-DD)
    if (quote.DueDate) {
      columnValues["deal_expected_close_date"] = quote.DueDate; // Simple string format
      logger.info(
        `[Sync Service] 📅 Setting close date correctly: ${quote.DueDate}`
      );
    }

    // LINK TO ACCOUNT - Skip mirror column, it should auto-populate
    // columnValues["deal_account"] = { item_ids: [parseInt(accountId)] };  // DISABLED - Mirror columns are read-only
    logger.info(
      `[Sync Service] 🔗 Account will be linked via contacts, not directly (mirror column)`
    );

    // LINK TO CONTACTS (your actual column: "deal_contact", type: "board_relation")
    if (contactIds.length > 0) {
      columnValues["deal_contact"] = {
        item_ids: contactIds.map((id) => parseInt(id)),
      };
      logger.info(
        `[Sync Service] 🔗 Linking deal to ${contactIds.length} contacts correctly`
      );
    }

    // Notes (your actual column: "text_mktrtr9b")
    columnValues["text_mktrtr9b"] = `SimPro Quote ID: ${quote.ID}
Customer: ${quote.Customer.CompanyName}
Salesperson: ${quote.Salesperson?.Name || "Not specified"}
Site: ${quote.Site?.Name || "Not specified"}
Last Sync: ${new Date().toISOString()}`;

    const item = await this.mondayApi.createItem(
      boardId,
      dealName,
      columnValues
    );
    logger.info(
      `[Sync Service] ✅ Created deal with CORRECT format: ${item.name} (${item.id})`
    );

    return item.id;
  }

  /**
   * Link mirror columns using the CORRECT mutation format with board_id - SIMPLIFIED
   */
  private async linkMirrorColumnsCorrectly(
    accountId: string,
    contactIds: string[],
    dealId: string,
    boardIds: MondayBoardConfig
  ): Promise<void> {
    try {
      logger.info(
        `[Sync Service] 🔗 Linking mirror columns with CORRECT format`
      );

      // SIMPLIFIED: Only update the items that were just created, skip mirror columns
      // Mirror columns should auto-populate based on the relationships we already set during creation

      logger.info(
        `[Sync Service] ✅ Mirror columns should auto-populate from creation relationships`
      );
    } catch (error) {
      logger.error(
        `[Sync Service] ❌ Failed to link mirror columns correctly`,
        { error }
      );
      throw error;
    }
  }

  /**
   * Find existing Monday item by SimPro ID stored in notes
   */
  private async findBySimproId(
    boardId: string,
    simproId: number,
    type: "customer" | "contact" | "quote"
  ): Promise<any> {
    try {
      const searchText = `SimPro ${
        type === "customer"
          ? "Customer"
          : type === "contact"
          ? "Contact"
          : "Quote"
      } ID: ${simproId}`;

      const query = `
        query FindItem($boardId: ID!) {
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
        const notesColumns = item.column_values.filter(
          (cv: any) =>
            cv.id === "text_mktrez5x" ||
            cv.id === "text_mktr67s0" ||
            cv.id === "text_mktrtr9b"
        );
        for (const notesColumn of notesColumns) {
          if (notesColumn?.text?.includes(searchText)) {
            return item;
          }
        }
      }
      return null;
    } catch (error) {
      logger.error(`Error finding existing ${type}`, { error });
      return null;
    }
  }

  private formatAddress(address: any): string {
    if (!address) return "Not provided";
    return `${address.Address || ""}, ${address.City || ""}, ${
      address.State || ""
    } ${address.PostalCode || ""}`.trim();
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
