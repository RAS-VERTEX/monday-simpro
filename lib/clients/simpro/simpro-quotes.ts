// lib/clients/simpro/simpro-quotes.ts - COMPLETE VERSION with unified contact enhancement fix
import { SimProApi } from "./simpro-api";
import { SimProQuote } from "@/types/simpro";
import { logger } from "@/lib/utils/logger";

export interface EnhancedSimProQuote extends SimProQuote {
  CustomerDetails?: {
    email?: string;
    phone?: string;
    altPhone?: string;
    address?: any;
  };
  CustomerContactDetails?: {
    Email?: string;
    WorkPhone?: string;
    CellPhone?: string;
    Department?: string;
    Position?: string;
  };
  SiteContactDetails?: {
    Email?: string;
    WorkPhone?: string;
    CellPhone?: string;
    Department?: string;
    Position?: string;
  };
  SiteAddress?: any;
}

export class SimProQuotes {
  constructor(private api: SimProApi) {}

  /**
   * Get all high-value quotes with Complete/Approved stage
   */
  async getActiveHighValueQuotes(
    minimumValue: number = 15000
  ): Promise<EnhancedSimProQuote[]> {
    const companyId = this.api.getCompanyId();

    logger.info(
      `[SimPro Quotes] Looking for $${minimumValue}+ quotes in Complete/Approved stage`
    );
    console.log(
      `[SimPro Quotes] Looking for $${minimumValue}+ quotes in Complete/Approved stage`
    );

    try {
      // Step 1: Get ALL basic quotes efficiently
      const basicQuotes = await this.getAllBasicQuotes(companyId);

      if (basicQuotes.length === 0) {
        logger.warn(`No active quotes found in SimPro at all!`);
        return [];
      }

      logger.info(`Total basic quotes retrieved: ${basicQuotes.length}`);
      console.log(`Total basic quotes retrieved: ${basicQuotes.length}`);

      // Step 2: Filter by value first (efficient) - WITH SAFE NULL CHECKS
      const highValueBasicQuotes = basicQuotes.filter((quote) => {
        const hasHighValue =
          quote.Total?.ExTax !== undefined && quote.Total.ExTax >= minimumValue;
        if (hasHighValue) {
          console.log(
            `High-value quote found: ID=${quote.ID}, Value=$${
              quote.Total?.ExTax || 0
            }`
          );
        }
        return hasHighValue;
      });

      logger.info(
        `High-value quotes (>=$${minimumValue}): ${highValueBasicQuotes.length} out of ${basicQuotes.length}`
      );
      console.log(
        `High-value quotes (>=$${minimumValue}): ${highValueBasicQuotes.length} out of ${basicQuotes.length}`
      );

      if (highValueBasicQuotes.length === 0) {
        logger.warn(`No quotes found over $${minimumValue}`);
        return [];
      }

      // Step 3: Get full details for high-value quotes only
      const detailedQuotes = await this.getDetailedQuotes(
        highValueBasicQuotes,
        companyId
      );

      logger.info(`Detailed quotes retrieved: ${detailedQuotes.length}`);
      console.log(`Detailed quotes retrieved: ${detailedQuotes.length}`);

      // Step 4: Filter by stage (Complete/Approved) and status
      const validQuotes = this.filterByStageAndStatus(
        detailedQuotes,
        minimumValue
      );

      logger.info(`Valid quotes after filtering: ${validQuotes.length}`);
      console.log(`Valid quotes after filtering: ${validQuotes.length}`);

      if (validQuotes.length === 0) {
        logger.warn(`No quotes passed stage/status filtering!`);
        return [];
      }

      // Step 5: Enhance with customer/contact details
      const enhancedQuotes = await this.enhanceQuotesWithDetails(
        validQuotes,
        companyId
      );

      logger.info(`Enhanced quotes ready for sync: ${enhancedQuotes.length}`);
      console.log(`Enhanced quotes ready for sync: ${enhancedQuotes.length}`);

      return enhancedQuotes;
    } catch (error) {
      logger.error("Failed to get active high-value quotes", { error });
      console.error("Failed to get active high-value quotes", error);
      throw error;
    }
  }

  /**
   * Get ALL basic quotes with proper pagination
   */
  private async getAllBasicQuotes(companyId: number): Promise<SimProQuote[]> {
    const allQuotes: SimProQuote[] = [];
    let page = 1;
    const pageSize = 250;
    let hasMorePages = true;

    logger.info(`Starting pagination to get ALL basic quotes...`);
    console.log(`Starting pagination to get ALL basic quotes...`);

    while (hasMorePages) {
      try {
        const params = new URLSearchParams({
          IsClosed: "false",
          pageSize: pageSize.toString(),
          page: page.toString(),
          columns: "ID,Description,Total,Stage",
        });

        const endpoint = `/companies/${companyId}/quotes?${params.toString()}`;
        logger.debug(`Fetching page ${page}: ${endpoint}`);

        const pageQuotes = (await this.api.request(endpoint)) as SimProQuote[];

        if (!pageQuotes || pageQuotes.length === 0) {
          logger.info(`No more quotes on page ${page}, stopping pagination`);
          hasMorePages = false;
          break;
        }

        allQuotes.push(...pageQuotes);
        logger.info(
          `Page ${page}: Retrieved ${pageQuotes.length} quotes (total so far: ${allQuotes.length})`
        );

        if (pageQuotes.length < pageSize) {
          logger.info(`Last page reached (${pageQuotes.length} < ${pageSize})`);
          hasMorePages = false;
        } else {
          page++;
        }
      } catch (error) {
        logger.error(`Error fetching quotes page ${page}`, { error });
        throw error;
      }
    }

    logger.info(`Pagination complete: ${allQuotes.length} total basic quotes`);
    console.log(`Pagination complete: ${allQuotes.length} total basic quotes`);

    return allQuotes;
  }

  /**
   * Get full details for high-value quotes only
   */
  private async getDetailedQuotes(
    basicQuotes: SimProQuote[],
    companyId: number
  ): Promise<SimProQuote[]> {
    logger.info(
      `Getting full details for ${basicQuotes.length} high-value quotes...`
    );
    console.log(
      `Getting full details for ${basicQuotes.length} high-value quotes...`
    );

    const detailedQuotes: SimProQuote[] = [];
    let processed = 0;

    for (const basicQuote of basicQuotes) {
      try {
        processed++;
        const fullQuote = await this.getQuoteDetails(companyId, basicQuote.ID);
        detailedQuotes.push(fullQuote);

        if (processed % 10 === 0) {
          logger.info(
            `Progress: ${processed}/${basicQuotes.length} detailed quotes retrieved`
          );
          console.log(
            `Progress: ${processed}/${basicQuotes.length} detailed quotes retrieved`
          );
        }
      } catch (error) {
        logger.warn(`Failed to get details for quote ${basicQuote.ID}`, {
          error,
        });
        // Continue with basic quote data if detailed fetch fails
        detailedQuotes.push(basicQuote);
      }
    }

    logger.info(`Retrieved full details for ${detailedQuotes.length} quotes`);
    console.log(`Retrieved full details for ${detailedQuotes.length} quotes`);

    return detailedQuotes;
  }

  /**
   * Filter by stage and status - SAFE VERSION with null checks
   */
  private filterByStageAndStatus(
    quotes: SimProQuote[],
    minimumValue: number
  ): SimProQuote[] {
    logger.info(
      `Filtering ${quotes.length} detailed quotes by stage/status...`
    );
    console.log(
      `Filtering ${quotes.length} detailed quotes by stage/status...`
    );

    const validQuotes = quotes.filter((quote) => {
      // 1. Check Stage (Complete or Approved) - CRITICAL FILTER
      const validStages = ["Complete", "Approved"];
      const hasValidStage = validStages.includes(quote.Stage);

      // 2. Check Status (handle SimPro's extra spaces) - SAFE NULL CHECK
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
        "Quote: Due Date Reached",
        "Quote : Due Date Reached",
        "Quote: Sent",
        "Quote : Sent",
        "Quote : Sent ",
        "Quote: Archived - Not Won",
        "Quote : Archived - Not Won",
        "Quote: Archived - Won",
        "Quote : Archived - Won",
      ];
      const statusName = quote.Status?.Name?.trim();
      const hasValidStatus = statusName
        ? validStatuses.includes(statusName)
        : false;

      // 3. Double-check value - SAFE NULL CHECK
      const hasMinimumValue =
        quote.Total?.ExTax !== undefined && quote.Total.ExTax >= minimumValue;

      // 4. Check if not closed (unless archived) - SAFE NULL CHECK
      const isArchivedQuote = statusName?.includes("Archived");
      const isNotClosed = quote.IsClosed !== true || isArchivedQuote;

      const isValid =
        hasValidStage && hasValidStatus && hasMinimumValue && isNotClosed;

      if (!isValid) {
        logger.debug(`Quote ${quote.ID} filtered out:`, {
          stage: quote.Stage,
          hasValidStage,
          status: statusName,
          hasValidStatus,
          value: quote.Total?.ExTax,
          hasMinimumValue,
          isClosed: quote.IsClosed,
          isNotClosed,
        });
      }

      return isValid;
    });

    // Summary statistics
    const stageCompleteApproved = quotes.filter((q) =>
      ["Complete", "Approved"].includes(q.Stage)
    ).length;
    const valueAboveMinimum = quotes.filter(
      (q) => q.Total?.ExTax !== undefined && q.Total.ExTax >= minimumValue
    ).length;
    const notClosed = quotes.filter((q) => q.IsClosed !== true).length;

    const filterSummary = {
      inputQuotes: quotes.length,
      stageCompleteApproved,
      valueAboveMinimum,
      notClosed,
      finalValid: validQuotes.length,
    };

    logger.info(`Filtering summary:`, filterSummary);
    console.log(`Filtering summary:`, JSON.stringify(filterSummary, null, 2));

    return validQuotes;
  }

  /**
   * Get a single quote's details
   */
  async getQuoteDetails(
    companyId: number,
    quoteId: number
  ): Promise<SimProQuote> {
    try {
      const quote = await this.api.request(
        `/companies/${companyId}/quotes/${quoteId}`
      );
      return quote as SimProQuote;
    } catch (error) {
      logger.error(`Failed to get quote ${quoteId} details`, { error });
      throw error;
    }
  }

  /**
   * ✅ WORKING VERSION: Enhance quotes with contact and customer details
   * This is the method that WORKS in batch sync - now used for both batch AND webhook
   * PUBLIC method so SyncService can call it
   */
  async enhanceQuotesWithDetails(
    quotes: SimProQuote[],
    companyId: number
  ): Promise<EnhancedSimProQuote[]> {
    logger.debug(`Enhancing ${quotes.length} quotes with contact details`);

    // Collect unique customer and contact IDs
    const uniqueCustomerIds = Array.from(
      new Set(quotes.map((q) => q.Customer?.ID).filter(Boolean))
    ) as number[];
    const uniqueContactIds = Array.from(
      new Set(
        quotes
          .flatMap((q) => [q.CustomerContact?.ID, q.SiteContact?.ID])
          .filter(Boolean)
      )
    ) as number[];

    logger.debug(
      `Need to fetch details for ${uniqueCustomerIds.length} customers and ${uniqueContactIds.length} contacts`
    );

    // Fetch customer and contact details in parallel
    const [customerDetailsMap, contactDetailsMap] = await Promise.all([
      this.fetchCustomerDetails(uniqueCustomerIds, companyId),
      this.fetchContactDetails(uniqueContactIds, companyId),
    ]);

    // Enhance quotes with fetched details - SAFE NULL CHECKS
    const enhancedQuotes: EnhancedSimProQuote[] = quotes.map((quote) => {
      const enhanced: EnhancedSimProQuote = { ...quote };

      // Add customer details - SAFE NULL CHECK
      if (quote.Customer?.ID && customerDetailsMap.has(quote.Customer.ID)) {
        enhanced.CustomerDetails = customerDetailsMap.get(quote.Customer.ID);
      }

      // Add customer contact details - SAFE NULL CHECK
      if (
        quote.CustomerContact?.ID &&
        contactDetailsMap.has(quote.CustomerContact.ID)
      ) {
        enhanced.CustomerContactDetails = contactDetailsMap.get(
          quote.CustomerContact.ID
        );

        // Debug log for contact details
        logger.debug(`Enhanced quote ${quote.ID} customer contact:`, {
          contactId: quote.CustomerContact.ID,
          contactDetails: enhanced.CustomerContactDetails,
        });
      }

      // Add site contact details - SAFE NULL CHECK
      if (
        quote.SiteContact?.ID &&
        contactDetailsMap.has(quote.SiteContact.ID)
      ) {
        enhanced.SiteContactDetails = contactDetailsMap.get(
          quote.SiteContact.ID
        );

        // Debug log for site contact details
        logger.debug(`Enhanced quote ${quote.ID} site contact:`, {
          contactId: quote.SiteContact.ID,
          contactDetails: enhanced.SiteContactDetails,
        });
      }

      return enhanced;
    });

    logger.debug(
      `✅ Enhanced ${enhancedQuotes.length} quotes with contact details`
    );
    return enhancedQuotes;
  }

  /**
   * ✅ WORKING VERSION: Fetch customer details in batch - CORRECT API ENDPOINT
   */
  private async fetchCustomerDetails(
    customerIds: number[],
    companyId: number
  ): Promise<Map<number, any>> {
    const customerMap = new Map();

    for (const customerId of customerIds) {
      try {
        // ✅ CORRECT ENDPOINT: /companies/{companyId}/customers/companies/{customerId}
        const customer = (await this.api.request(
          `/companies/${companyId}/customers/companies/${customerId}`
        )) as any;

        customerMap.set(customerId, {
          email: customer?.Email,
          phone: customer?.Phone,
          altPhone: customer?.AltPhone,
          address: customer?.Address,
        });

        logger.debug(`Fetched customer ${customerId} details:`, {
          email: customer?.Email,
          phone: customer?.Phone,
          altPhone: customer?.AltPhone,
        });
      } catch (error) {
        logger.warn(`⚠️ Failed to fetch customer ${customerId}`, { error });
      }
    }

    return customerMap;
  }

  /**
   * ✅ WORKING VERSION: Fetch contact details in batch - CORRECT API ENDPOINT
   */
  private async fetchContactDetails(
    contactIds: number[],
    companyId: number
  ): Promise<Map<number, any>> {
    const contactMap = new Map();

    for (const contactId of contactIds) {
      try {
        // ✅ CORRECT ENDPOINT: /companies/{companyId}/contacts/{contactId} (NO trailing slash)
        const contact = (await this.api.request(
          `/companies/${companyId}/contacts/${contactId}`
        )) as any;

        contactMap.set(contactId, {
          Email: contact?.Email,
          WorkPhone: contact?.WorkPhone,
          CellPhone: contact?.CellPhone,
          Department: contact?.Department,
          Position: contact?.Position,
        });

        logger.debug(`Fetched contact ${contactId} details:`, {
          Email: contact?.Email,
          WorkPhone: contact?.WorkPhone,
          CellPhone: contact?.CellPhone,
          Department: contact?.Department,
          Position: contact?.Position,
        });
      } catch (error) {
        logger.warn(`⚠️ Failed to fetch contact ${contactId}`, { error });
      }
    }

    return contactMap;
  }

  /**
   * Enhance quotes with customer and contact details - BATCH VERSION
   * LEGACY METHOD - kept for compatibility but now delegates to main method
   */
  private async batchEnhanceQuotes(
    quotes: SimProQuote[],
    companyId: number
  ): Promise<EnhancedSimProQuote[]> {
    // Delegate to the main enhancement method to avoid duplication
    return this.enhanceQuotesWithDetails(quotes, companyId);
  }
}
