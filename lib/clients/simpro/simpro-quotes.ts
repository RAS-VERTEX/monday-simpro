// lib/clients/simpro/simpro-quotes.ts - INITIAL SYNC: GET EVERYTHING
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
   * INITIAL SYNC: Get ALL high-value quotes - be comprehensive, not clever
   */
  async getActiveHighValueQuotes(
    minimumValue: number = 15000
  ): Promise<EnhancedSimProQuote[]> {
    const companyId = this.api.getCompanyId();

    logger.info(
      `[SimPro Quotes] INITIAL SYNC: Getting ALL active quotes over $${minimumValue} (comprehensive approach)`
    );

    try {
      // Step 1: Get ALL active quotes - no shortcuts, no optimizations
      const allActiveQuotes = await this.getAllActiveQuotes(companyId);

      if (allActiveQuotes.length === 0) {
        logger.info(`[SimPro Quotes] No active quotes found in SimPro`);
        return [];
      }

      // Step 2: Filter for high-value quotes that meet ALL criteria
      const validQuotes = this.filterForValidHighValueQuotes(
        allActiveQuotes,
        minimumValue
      );

      if (validQuotes.length === 0) {
        logger.info(
          `[SimPro Quotes] No quotes meet all criteria (stage, status, value)`
        );
        return [];
      }

      // Step 3: Enhance the valid quotes
      const enhancedQuotes = await this.batchEnhanceQuotes(
        validQuotes,
        companyId
      );

      logger.info(
        `[SimPro Quotes] INITIAL SYNC COMPLETE: Found ${enhancedQuotes.length} qualifying quotes out of ${allActiveQuotes.length} total active quotes`
      );
      return enhancedQuotes;
    } catch (error) {
      logger.error("[SimPro Quotes] Initial sync failed", { error });
      throw error;
    }
  }

  /**
   * Get ALL active quotes from SimPro - comprehensive pagination
   */
  private async getAllActiveQuotes(companyId: number): Promise<SimProQuote[]> {
    const allQuotes: SimProQuote[] = [];
    let page = 1;
    const pageSize = 250; // Max allowed by SimPro
    let hasMorePages = true;

    logger.info(
      `[SimPro Quotes] Starting comprehensive pagination to get ALL active quotes`
    );

    while (hasMorePages) {
      logger.info(
        `[SimPro Quotes] Fetching page ${page} (up to ${pageSize} quotes)...`
      );

      try {
        const params = new URLSearchParams({
          IsClosed: "false",
          pageSize: pageSize.toString(),
          page: page.toString(),
        });

        const endpoint = `/companies/${companyId}/quotes/?${params.toString()}`;
        const basicQuotes = await this.api.request<SimProQuote[]>(endpoint);

        if (!basicQuotes || basicQuotes.length === 0) {
          logger.info(
            `[SimPro Quotes] Page ${page}: No quotes found - pagination complete`
          );
          hasMorePages = false;
          break;
        }

        logger.info(
          `[SimPro Quotes] Page ${page}: Found ${basicQuotes.length} basic quotes, getting full details...`
        );

        // Get full details for ALL quotes on this page
        for (const basicQuote of basicQuotes) {
          try {
            const fullQuote = await this.getQuoteDetails(
              companyId,
              basicQuote.ID
            );
            allQuotes.push(fullQuote);
          } catch (error) {
            logger.warn(
              `[SimPro Quotes] Failed to get details for quote ${basicQuote.ID}`,
              { error }
            );
            // Use basic quote if we can't get full details
            allQuotes.push(basicQuote);
          }
        }

        logger.info(
          `[SimPro Quotes] Page ${page}: Processed ${basicQuotes.length} quotes (${allQuotes.length} total so far)`
        );

        // Check if we got a full page
        if (basicQuotes.length < pageSize) {
          logger.info(
            `[SimPro Quotes] Page ${page}: Got ${basicQuotes.length} < ${pageSize} quotes - this is the last page`
          );
          hasMorePages = false;
        } else {
          page++;
        }

        // Safety limit to prevent runaway pagination
        if (page > 100) {
          logger.warn(
            `[SimPro Quotes] Safety limit: Stopping at page 100 (${allQuotes.length} quotes total)`
          );
          hasMorePages = false;
        }
      } catch (error) {
        logger.error(`[SimPro Quotes] Failed to fetch page ${page}`, { error });
        hasMorePages = false;
      }
    }

    logger.info(
      `[SimPro Quotes] Pagination complete: Retrieved ${
        allQuotes.length
      } total active quotes from ${page - 1} pages`
    );
    return allQuotes;
  }

  /**
   * Filter quotes for ALL our criteria
   */
  private filterForValidHighValueQuotes(
    quotes: SimProQuote[],
    minimumValue: number
  ): SimProQuote[] {
    logger.info(
      `[SimPro Quotes] Filtering ${quotes.length} active quotes for high-value criteria`
    );

    const validQuotes = quotes.filter((quote) => {
      // 1. Check Stage (Complete or Approved)
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

      // 3. Check value
      const hasMinimumValue =
        quote.Total?.ExTax && quote.Total.ExTax >= minimumValue;

      // 4. Check not closed (should already be filtered, but double-check)
      const isNotClosed = !quote.IsClosed;

      // Log why quotes are being filtered out
      if (!hasValidStage) {
        logger.debug(
          `[SimPro Quotes] Quote ${quote.ID} filtered - stage: ${quote.Stage} (need Complete/Approved)`
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
          `[SimPro Quotes] ✅ Quote ${quote.ID} QUALIFIES: Stage=${quote.Stage}, Status="${statusName}", Value=$${quote.Total?.ExTax}`
        );
      }

      return isValid;
    });

    // Summary of filtering results
    const stageCompleteApproved = quotes.filter((q) =>
      ["Complete", "Approved"].includes(q.Stage)
    ).length;
    const validStatusCount = quotes.filter((q) => {
      const statusName = q.Status?.Name;
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
      ];
      return statusName && validStatuses.includes(statusName);
    }).length;
    const valueAboveMinimum = quotes.filter(
      (q) => q.Total?.ExTax >= minimumValue
    ).length;
    const notClosed = quotes.filter((q) => !q.IsClosed).length;

    logger.info(`[SimPro Quotes] Filter results:`, {
      totalQuotes: quotes.length,
      stageCompleteApproved,
      validStatus: validStatusCount,
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
