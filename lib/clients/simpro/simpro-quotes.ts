// lib/clients/simpro/simpro-quotes.ts - COMPLETE FINAL VERSION
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
   * FINAL VERSION: Get all high-value quotes with Complete/Approved stage
   * This should find all 73 qualifying quotes
   */
  async getActiveHighValueQuotes(
    minimumValue: number = 15000
  ): Promise<EnhancedSimProQuote[]> {
    const companyId = this.api.getCompanyId();

    // FORCE VISIBLE LOGS TO CONFIRM NEW CODE IS RUNNING
    logger.error(
      `🚨 FINAL VERSION RUNNING! Looking for $${minimumValue}+ quotes in Complete/Approved stage`
    );
    console.log(
      `🚨 FINAL VERSION RUNNING! Looking for $${minimumValue}+ quotes in Complete/Approved stage`
    );
    console.error(
      `🚨 FINAL VERSION RUNNING! Looking for $${minimumValue}+ quotes in Complete/Approved stage`
    );

    try {
      // Step 1: Get ALL basic quotes efficiently
      const basicQuotes = await this.getAllBasicQuotes(companyId);

      if (basicQuotes.length === 0) {
        logger.error(`❌ No active quotes found in SimPro at all!`);
        return [];
      }

      logger.error(`📊 TOTAL BASIC QUOTES RETRIEVED: ${basicQuotes.length}`);
      console.log(`📊 TOTAL BASIC QUOTES RETRIEVED: ${basicQuotes.length}`);

      // Step 2: Filter by value first (efficient)
      const highValueBasicQuotes = basicQuotes.filter((quote) => {
        const hasHighValue =
          quote.Total?.ExTax && quote.Total.ExTax >= minimumValue;
        if (hasHighValue) {
          console.log(
            `💰 High-value quote found: ID=${quote.ID}, Value=$${quote.Total.ExTax}`
          );
        }
        return hasHighValue;
      });

      logger.error(
        `💰 HIGH-VALUE QUOTES (>=$${minimumValue}): ${highValueBasicQuotes.length} out of ${basicQuotes.length}`
      );
      console.log(
        `💰 HIGH-VALUE QUOTES (>=$${minimumValue}): ${highValueBasicQuotes.length} out of ${basicQuotes.length}`
      );

      if (highValueBasicQuotes.length === 0) {
        logger.error(
          `❌ No quotes found over $${minimumValue} - this is the problem!`
        );
        return [];
      }

      // Step 3: Get full details for high-value quotes only
      const detailedQuotes = await this.getDetailedQuotes(
        highValueBasicQuotes,
        companyId
      );

      logger.error(`📋 DETAILED QUOTES RETRIEVED: ${detailedQuotes.length}`);
      console.log(`📋 DETAILED QUOTES RETRIEVED: ${detailedQuotes.length}`);

      // Step 4: Filter by stage and status
      const validQuotes = this.filterByStageAndStatus(
        detailedQuotes,
        minimumValue
      );

      logger.error(
        `✅ FINAL VALID QUOTES: ${validQuotes.length} (Complete/Approved stage + valid status)`
      );
      console.log(
        `✅ FINAL VALID QUOTES: ${validQuotes.length} (Complete/Approved stage + valid status)`
      );

      if (validQuotes.length === 0) {
        logger.error(`❌ No quotes passed stage/status filtering!`);
        return [];
      }

      // Step 5: Enhance with customer/contact details
      const enhancedQuotes = await this.batchEnhanceQuotes(
        validQuotes,
        companyId
      );

      logger.error(
        `🎉 FINAL RESULT: ${enhancedQuotes.length} enhanced quotes ready for sync`
      );
      console.log(
        `🎉 FINAL RESULT: ${enhancedQuotes.length} enhanced quotes ready for sync`
      );

      return enhancedQuotes;
    } catch (error) {
      logger.error("❌ SimPro quotes retrieval failed", { error });
      console.error("❌ SimPro quotes retrieval failed", error);
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

    logger.error(`🔄 Starting pagination to get ALL basic quotes...`);
    console.log(`🔄 Starting pagination to get ALL basic quotes...`);

    while (hasMorePages) {
      try {
        const params = new URLSearchParams({
          IsClosed: "false",
          pageSize: pageSize.toString(),
          page: page.toString(),
          columns: "ID,Description,Total,Stage",
        });

        const endpoint = `/companies/${companyId}/quotes/?${params.toString()}`;
        logger.debug(`📄 Page ${page}: ${endpoint}`);

        const pageQuotes = await this.api.request<SimProQuote[]>(endpoint);

        if (!pageQuotes || pageQuotes.length === 0) {
          logger.error(
            `📄 Page ${page}: No quotes found - pagination complete`
          );
          console.log(`📄 Page ${page}: No quotes found - pagination complete`);
          hasMorePages = false;
          break;
        }

        logger.error(
          `📄 Page ${page}: Found ${pageQuotes.length} basic quotes`
        );
        console.log(`📄 Page ${page}: Found ${pageQuotes.length} basic quotes`);

        allQuotes.push(...pageQuotes);

        // Check if we got a full page
        if (pageQuotes.length < pageSize) {
          logger.error(
            `📄 Page ${page}: Last page (${pageQuotes.length} < ${pageSize})`
          );
          console.log(
            `📄 Page ${page}: Last page (${pageQuotes.length} < ${pageSize})`
          );
          hasMorePages = false;
        } else {
          page++;
        }

        // Safety limit
        if (page > 100) {
          logger.error(`⚠️ Safety limit: Stopping at page 100`);
          console.log(`⚠️ Safety limit: Stopping at page 100`);
          hasMorePages = false;
        }
      } catch (error) {
        logger.error(`❌ Failed to fetch page ${page}`, { error });
        console.error(`❌ Failed to fetch page ${page}`, error);
        hasMorePages = false;
      }
    }

    logger.error(
      `📊 PAGINATION COMPLETE: ${allQuotes.length} total basic quotes from ${
        page - 1
      } pages`
    );
    console.log(
      `📊 PAGINATION COMPLETE: ${allQuotes.length} total basic quotes from ${
        page - 1
      } pages`
    );

    return allQuotes;
  }

  /**
   * Get full details for high-value quotes only
   */
  private async getDetailedQuotes(
    basicQuotes: SimProQuote[],
    companyId: number
  ): Promise<SimProQuote[]> {
    logger.error(
      `🔍 Getting full details for ${basicQuotes.length} high-value quotes...`
    );
    console.log(
      `🔍 Getting full details for ${basicQuotes.length} high-value quotes...`
    );

    const detailedQuotes: SimProQuote[] = [];
    let processed = 0;

    for (const basicQuote of basicQuotes) {
      try {
        processed++;
        const fullQuote = await this.getQuoteDetails(companyId, basicQuote.ID);
        detailedQuotes.push(fullQuote);

        if (processed % 10 === 0) {
          logger.error(
            `📈 Progress: ${processed}/${basicQuotes.length} detailed quotes retrieved`
          );
          console.log(
            `📈 Progress: ${processed}/${basicQuotes.length} detailed quotes retrieved`
          );
        }
      } catch (error) {
        logger.warn(`⚠️ Failed to get details for quote ${basicQuote.ID}`, {
          error,
        });
        detailedQuotes.push(basicQuote);
      }
    }

    logger.error(
      `✅ Retrieved full details for ${detailedQuotes.length} quotes`
    );
    console.log(
      `✅ Retrieved full details for ${detailedQuotes.length} quotes`
    );

    return detailedQuotes;
  }

  /**
   * Filter by stage and status - this is where we apply Complete/Approved filter
   */
  private filterByStageAndStatus(
    quotes: SimProQuote[],
    minimumValue: number
  ): SimProQuote[] {
    logger.error(
      `🔍 Filtering ${quotes.length} detailed quotes by stage/status...`
    );
    console.log(
      `🔍 Filtering ${quotes.length} detailed quotes by stage/status...`
    );

    const validQuotes = quotes.filter((quote) => {
      // 1. Check Stage (Complete or Approved) - CRITICAL FILTER
      const validStages = ["Complete", "Approved"];
      const hasValidStage = validStages.includes(quote.Stage);

      // 2. Check Status (handle SimPro's extra spaces)
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
        "Quote: Quote Due Date Reached",
        "Quote : Quote Due Date Reached",
        "Quote: Sent",
        "Quote : Sent ",
        "Quote : Sent",
      ];
      const statusName = quote.Status?.Name;
      const hasValidStatus = statusName && validStatuses.includes(statusName);

      // 3. Double-check value
      const hasMinimumValue =
        quote.Total?.ExTax && quote.Total.ExTax >= minimumValue;

      // 4. Check not closed
      const isNotClosed = !quote.IsClosed;

      // Debug each filter
      if (!hasValidStage) {
        console.log(
          `❌ Quote ${quote.ID} filtered - stage: "${quote.Stage}" (need Complete/Approved)`
        );
      }
      if (!hasValidStatus) {
        console.log(
          `❌ Quote ${quote.ID} filtered - status: "${statusName}" (not in valid list)`
        );
      }
      if (!hasMinimumValue) {
        console.log(
          `❌ Quote ${quote.ID} filtered - value: $${
            quote.Total?.ExTax || 0
          } (need >= $${minimumValue})`
        );
      }
      if (!isNotClosed) {
        console.log(
          `❌ Quote ${quote.ID} filtered - is closed: ${quote.IsClosed}`
        );
      }

      const isValid =
        hasValidStage && hasValidStatus && hasMinimumValue && isNotClosed;

      if (isValid) {
        console.log(
          `✅ Quote ${quote.ID} QUALIFIES: Stage="${quote.Stage}", Status="${statusName}", Value=$${quote.Total?.ExTax}`
        );
      }

      return isValid;
    });

    // Summary statistics
    const stageCompleteApproved = quotes.filter((q) =>
      ["Complete", "Approved"].includes(q.Stage)
    ).length;
    const valueAboveMinimum = quotes.filter(
      (q) => q.Total?.ExTax >= minimumValue
    ).length;
    const notClosed = quotes.filter((q) => !q.IsClosed).length;

    const filterSummary = {
      inputQuotes: quotes.length,
      stageCompleteApproved,
      valueAboveMinimum,
      notClosed,
      finalValid: validQuotes.length,
    };

    logger.error(`📊 FILTERING SUMMARY:`, filterSummary);
    console.log(
      `📊 FILTERING SUMMARY:`,
      JSON.stringify(filterSummary, null, 2)
    );

    return validQuotes;
  }

  /**
   * Get detailed quote information
   */
  async getQuoteDetails(
    companyId: number,
    quoteId: number
  ): Promise<SimProQuote> {
    return this.api.request<SimProQuote>(
      `/companies/${companyId}/quotes/${quoteId}`
    );
  }

  /**
   * Enhance quotes with customer and contact details
   */
  private async batchEnhanceQuotes(
    quotes: SimProQuote[],
    companyId: number
  ): Promise<EnhancedSimProQuote[]> {
    logger.debug(`🔧 Batch enhancing ${quotes.length} qualifying quotes...`);

    // Collect unique IDs to minimize API calls
    const customerIds = quotes
      .map((q) => q.Customer?.ID)
      .filter((id): id is number => Boolean(id));
    const uniqueCustomerIds = Array.from(new Set(customerIds));

    const contactIds = quotes
      .flatMap((q) => [q.CustomerContact?.ID, q.SiteContact?.ID])
      .filter((id): id is number => Boolean(id));
    const uniqueContactIds = Array.from(new Set(contactIds));

    logger.debug(
      `🔧 Need to fetch ${uniqueCustomerIds.length} customers and ${uniqueContactIds.length} contacts`
    );

    // Fetch customer and contact details in parallel
    const [customerDetailsMap, contactDetailsMap] = await Promise.all([
      this.fetchCustomerDetails(uniqueCustomerIds, companyId),
      this.fetchContactDetails(uniqueContactIds, companyId),
    ]);

    // Enhance quotes with fetched details
    const enhancedQuotes: EnhancedSimProQuote[] = quotes.map((quote) => {
      const enhanced: EnhancedSimProQuote = { ...quote };

      // Add customer details
      if (quote.Customer?.ID && customerDetailsMap.has(quote.Customer.ID)) {
        enhanced.CustomerDetails = customerDetailsMap.get(quote.Customer.ID);
      }

      // Add customer contact details
      if (
        quote.CustomerContact?.ID &&
        contactDetailsMap.has(quote.CustomerContact.ID)
      ) {
        enhanced.CustomerContactDetails = contactDetailsMap.get(
          quote.CustomerContact.ID
        );
      }

      // Add site contact details
      if (
        quote.SiteContact?.ID &&
        contactDetailsMap.has(quote.SiteContact.ID)
      ) {
        enhanced.SiteContactDetails = contactDetailsMap.get(
          quote.SiteContact.ID
        );
      }

      return enhanced;
    });

    logger.debug(
      `✅ Enhanced ${enhancedQuotes.length} quotes with contact details`
    );
    return enhancedQuotes;
  }

  /**
   * Fetch customer details in batch
   */
  private async fetchCustomerDetails(
    customerIds: number[],
    companyId: number
  ): Promise<Map<number, any>> {
    const customerMap = new Map();

    for (const customerId of customerIds) {
      try {
        const customer = await this.api.request(
          `/companies/${companyId}/customers/companies/${customerId}`
        );
        customerMap.set(customerId, {
          email: customer.Email,
          phone: customer.Phone,
          altPhone: customer.AltPhone,
          address: customer.Address,
        });
      } catch (error) {
        logger.warn(`⚠️ Failed to fetch customer ${customerId}`, { error });
      }
    }

    return customerMap;
  }

  /**
   * Fetch contact details in batch
   */
  private async fetchContactDetails(
    contactIds: number[],
    companyId: number
  ): Promise<Map<number, any>> {
    const contactMap = new Map();

    for (const contactId of contactIds) {
      try {
        const contact = await this.api.request(
          `/companies/${companyId}/contacts/${contactId}`
        );
        contactMap.set(contactId, {
          Email: contact.Email,
          WorkPhone: contact.WorkPhone,
          CellPhone: contact.CellPhone,
          Department: contact.Department,
          Position: contact.Position,
        });
      } catch (error) {
        logger.warn(`⚠️ Failed to fetch contact ${contactId}`, { error });
      }
    }

    return contactMap;
  }
}
