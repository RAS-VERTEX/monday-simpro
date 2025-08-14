// lib/clients/simpro/simpro-quotes.ts - EFFICIENT: Filter first, then get details
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
   * EFFICIENT: Get high-value quotes by filtering basic data first
   */
  async getActiveHighValueQuotes(
    minimumValue: number = 15000
  ): Promise<EnhancedSimProQuote[]> {
    const companyId = this.api.getCompanyId();

    logger.info(
      `[SimPro Quotes] EFFICIENT: Getting quotes over $${minimumValue} with stage Complete/Approved`
    );

    try {
      // Step 1: Get ALL basic quotes (just ID, Description, Total)
      const basicQuotes = await this.getAllBasicQuotes(companyId);

      if (basicQuotes.length === 0) {
        logger.info(`[SimPro Quotes] No active quotes found in SimPro`);
        return [];
      }

      logger.info(
        `[SimPro Quotes] Retrieved ${basicQuotes.length} basic active quotes`
      );

      // Step 2: Filter basic quotes by value (we can do this without full details)
      const highValueBasicQuotes = basicQuotes.filter((quote) => {
        const hasHighValue =
          quote.Total?.ExTax && quote.Total.ExTax >= minimumValue;
        if (hasHighValue) {
          logger.debug(
            `[SimPro Quotes] Basic quote ${quote.ID}: $${quote.Total.ExTax} - qualifies for detailed check`
          );
        }
        return hasHighValue;
      });

      logger.info(
        `[SimPro Quotes] Found ${highValueBasicQuotes.length} high-value quotes (>= $${minimumValue}) out of ${basicQuotes.length} total`
      );

      if (highValueBasicQuotes.length === 0) {
        logger.warn(
          `[SimPro Quotes] No quotes found over $${minimumValue} - check if minimumValue is correct`
        );
        return [];
      }

      // Step 3: Get full details ONLY for high-value quotes
      const detailedQuotes = await this.getDetailedQuotes(
        highValueBasicQuotes,
        companyId
      );

      // Step 4: Apply stage and status filters to detailed quotes
      const validQuotes = this.filterByStageAndStatus(
        detailedQuotes,
        minimumValue
      );

      if (validQuotes.length === 0) {
        logger.warn(
          `[SimPro Quotes] No quotes passed stage/status filtering - found ${detailedQuotes.length} high-value but none with Complete/Approved stage`
        );
        return [];
      }

      // Step 5: Enhance the final valid quotes
      const enhancedQuotes = await this.batchEnhanceQuotes(
        validQuotes,
        companyId
      );

      logger.info(
        `[SimPro Quotes] SUCCESS: Found ${enhancedQuotes.length} final qualifying quotes (Complete/Approved stage, valid status, $${minimumValue}+)`
      );
      return enhancedQuotes;
    } catch (error) {
      logger.error("[SimPro Quotes] Failed to get high-value quotes", {
        error,
      });
      throw error;
    }
  }

  /**
   * Get ALL basic quotes (just ID, Description, Total) efficiently
   */
  private async getAllBasicQuotes(companyId: number): Promise<SimProQuote[]> {
    const allQuotes: SimProQuote[] = [];
    let page = 1;
    const pageSize = 250;
    let hasMorePages = true;

    logger.info(`[SimPro Quotes] Getting ALL basic quotes with pagination`);

    while (hasMorePages) {
      try {
        const params = new URLSearchParams({
          IsClosed: "false",
          pageSize: pageSize.toString(),
          page: page.toString(),
          // Only get essential fields to speed up the request
          columns: "ID,Description,Total,Stage",
        });

        const endpoint = `/companies/${companyId}/quotes/?${params.toString()}`;
        logger.debug(`[SimPro Quotes] Page ${page}: ${endpoint}`);

        const pageQuotes = await this.api.request<SimProQuote[]>(endpoint);

        if (!pageQuotes || pageQuotes.length === 0) {
          logger.info(
            `[SimPro Quotes] Page ${page}: No quotes found - pagination complete`
          );
          hasMorePages = false;
          break;
        }

        logger.info(
          `[SimPro Quotes] Page ${page}: Got ${pageQuotes.length} basic quotes`
        );
        allQuotes.push(...pageQuotes);

        // Check if we got a full page
        if (pageQuotes.length < pageSize) {
          logger.info(
            `[SimPro Quotes] Page ${page}: Last page (${pageQuotes.length} < ${pageSize})`
          );
          hasMorePages = false;
        } else {
          page++;
        }

        // Safety limit
        if (page > 100) {
          logger.warn(`[SimPro Quotes] Safety limit: Stopping at page 100`);
          hasMorePages = false;
        }
      } catch (error) {
        logger.error(`[SimPro Quotes] Failed to fetch page ${page}`, { error });
        hasMorePages = false;
      }
    }

    logger.info(
      `[SimPro Quotes] Retrieved ${allQuotes.length} total basic quotes from ${
        page - 1
      } pages`
    );
    return allQuotes;
  }

  /**
   * Get full details ONLY for high-value quotes (much more efficient)
   */
  private async getDetailedQuotes(
    basicQuotes: SimProQuote[],
    companyId: number
  ): Promise<SimProQuote[]> {
    logger.info(
      `[SimPro Quotes] Getting full details for ${basicQuotes.length} high-value quotes`
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
            `[SimPro Quotes] Progress: ${processed}/${basicQuotes.length} detailed quotes retrieved`
          );
        }
      } catch (error) {
        logger.warn(
          `[SimPro Quotes] Failed to get details for quote ${basicQuote.ID}`,
          { error }
        );
        // Use basic quote if we can't get details
        detailedQuotes.push(basicQuote);
      }
    }

    logger.info(
      `[SimPro Quotes] Retrieved full details for ${detailedQuotes.length} quotes`
    );
    return detailedQuotes;
  }

  /**
   * Filter detailed quotes by stage and status
   */
  private filterByStageAndStatus(
    quotes: SimProQuote[],
    minimumValue: number
  ): SimProQuote[] {
    logger.info(
      `[SimPro Quotes] Filtering ${quotes.length} detailed quotes by stage/status`
    );

    const validQuotes = quotes.filter((quote) => {
      // 1. Check Stage (Complete or Approved) - THIS IS THE KEY FILTER
      const validStages = ["Complete", "Approved"];
      const hasValidStage = validStages.includes(quote.Stage);

      // 2. Check Status (handle SimPro's extra spaces around colons)
      const validStatuses = [
        "Quote: To Be Assigned",
        "Quote: To Be Scheduled",
        "Quote : To Be Scheduled", // SimPro format with extra spaces
        "Quote: To Write",
        "Quote: Visit Scheduled",
        "Quote : Visit Scheduled", // SimPro format with extra spaces
        "Quote: In Progress",
        "Quote : In Progress", // SimPro format with extra spaces
        "Quote: Won",
        "Quote : Won", // SimPro format with extra spaces
        "Quote: On Hold",
        "Quote : On Hold", // SimPro format with extra spaces
        "Quote: Quote Due Date Reached",
        "Quote : Quote Due Date Reached", // SimPro format with extra spaces
      ];
      const statusName = quote.Status?.Name;
      const hasValidStatus = statusName && validStatuses.includes(statusName);

      // 3. Double-check value (should already be filtered, but just in case)
      const hasMinimumValue =
        quote.Total?.ExTax && quote.Total.ExTax >= minimumValue;

      // 4. Check not closed (should already be filtered, but double-check)
      const isNotClosed = !quote.IsClosed;

      // Debug logging for each filter
      if (!hasValidStage) {
        logger.debug(
          `[SimPro Quotes] Quote ${quote.ID} filtered - stage: "${quote.Stage}" (need Complete/Approved)`
        );
      }
      if (!hasValidStatus) {
        logger.debug(
          `[SimPro Quotes] Quote ${quote.ID} filtered - status: "${statusName}" (not in valid list)`
        );
      }
      if (!hasMinimumValue) {
        logger.debug(
          `[SimPro Quotes] Quote ${quote.ID} filtered - value: $${
            quote.Total?.ExTax || 0
          } (need >= $${minimumValue})`
        );
      }
      if (!isNotClosed) {
        logger.debug(
          `[SimPro Quotes] Quote ${quote.ID} filtered - is closed: ${quote.IsClosed}`
        );
      }

      const isValid =
        hasValidStage && hasValidStatus && hasMinimumValue && isNotClosed;

      if (isValid) {
        logger.debug(
          `[SimPro Quotes] ✅ Quote ${quote.ID} QUALIFIES: Stage="${quote.Stage}", Status="${statusName}", Value=$${quote.Total?.ExTax}`
        );
      }

      return isValid;
    });

    // Summary of filtering results
    const stageCompleteApproved = quotes.filter((q) =>
      ["Complete", "Approved"].includes(q.Stage)
    ).length;
    const valueAboveMinimum = quotes.filter(
      (q) => q.Total?.ExTax >= minimumValue
    ).length;
    const notClosed = quotes.filter((q) => !q.IsClosed).length;

    logger.info(`[SimPro Quotes] Filtering summary:`, {
      inputQuotes: quotes.length,
      stageCompleteApproved,
      valueAboveMinimum,
      notClosed,
      finalValid: validQuotes.length,
    });

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
    logger.debug(
      `[SimPro Quotes] Batch enhancing ${quotes.length} qualifying quotes...`
    );

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
      `[SimPro Quotes] Need to fetch ${uniqueCustomerIds.length} customers and ${uniqueContactIds.length} contacts`
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
      `[SimPro Quotes] Enhanced ${enhancedQuotes.length} quotes with contact details`
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
        logger.warn(`[SimPro Quotes] Failed to fetch customer ${customerId}`, {
          error,
        });
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
        logger.warn(`[SimPro Quotes] Failed to fetch contact ${contactId}`, {
          error,
        });
      }
    }

    return contactMap;
  }
}
