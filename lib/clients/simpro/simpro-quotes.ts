// lib/clients/simpro/simpro-quotes.ts - FIXED to apply limit before enhancement
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

  async getActiveHighValueQuotes(
    minimumValue: number = 15000
  ): Promise<EnhancedSimProQuote[]> {
    const companyId = this.api.getCompanyId();

    logger.info(
      `[SimPro Quotes] Getting high-value quotes (>${minimumValue}) for company ${companyId}`
    );

    try {
      // Step 1: Get basic quotes with filtering
      const quotes = await this.getQuotes({
        companyId,
        activeOnly: true,
        minimumValue,
      });

      logger.info(
        `[SimPro Quotes] Found ${quotes.length} high-value quotes after filtering`
      );

      if (quotes.length === 0) {
        return [];
      }

      // APPLY FINAL FILTER FIRST to avoid enhancing quotes we'll discard
      const validQuotes = quotes.filter((quote) => {
        const hasMinimumValue =
          quote.Total?.ExTax && quote.Total.ExTax >= minimumValue;
        const isNotClosed = !quote.IsClosed;

        // Debug why quotes are being filtered out
        if (!hasMinimumValue) {
          logger.debug(
            `[SimPro Quotes] Quote ${quote.ID} filtered - value: ${quote.Total?.ExTax}, minimum: ${minimumValue}`
          );
        }
        if (!isNotClosed) {
          logger.debug(
            `[SimPro Quotes] Quote ${quote.ID} filtered - is closed: ${quote.IsClosed}`
          );
        }

        return hasMinimumValue && isNotClosed;
      });

      logger.info(
        `[SimPro Quotes] ${
          validQuotes.length
        } quotes passed final validation (${
          quotes.length - validQuotes.length
        } filtered out)`
      );

      if (validQuotes.length === 0) {
        return [];
      }

      // Step 2: Enhance quotes with full details (now only the valid ones)
      const enhancedQuotes = await this.batchEnhanceQuotes(
        validQuotes,
        companyId
      );

      logger.info(
        `[SimPro Quotes] Returning ${enhancedQuotes.length} enhanced high-value quotes`
      );
      return enhancedQuotes;
    } catch (error) {
      logger.error("[SimPro Quotes] Failed to get high-value quotes", {
        error,
        companyId,
      });
      throw error;
    }
  }

  async getQuoteDetails(
    companyId: number,
    quoteId: number
  ): Promise<SimProQuote> {
    return this.api.request<SimProQuote>(
      `/companies/${companyId}/quotes/${quoteId}`
    );
  }

  private async getQuotes(
    options: {
      companyId: number;
      minimumValue?: number;
      activeOnly?: boolean;
      dateFrom?: string;
    } = {}
  ): Promise<SimProQuote[]> {
    const { companyId, activeOnly, dateFrom } = options;

    let endpoint = `/companies/${companyId}/quotes/`;
    const params = new URLSearchParams();

    if (activeOnly !== false) {
      params.append("IsClosed", "false");
    }

    if (dateFrom) {
      params.append("DateIssued", `>=${dateFrom}`);
    }

    if (params.toString()) {
      endpoint += "?" + params.toString();
    }

    logger.debug(`[SimPro Quotes] Fetching quotes from: ${endpoint}`);

    const quotesList = await this.api.request<SimProQuote[]>(endpoint);

    if (!quotesList || quotesList.length === 0) {
      return [];
    }

    // Get full details for each quote
    const quotesWithDetails: SimProQuote[] = [];

    for (const quote of quotesList) {
      try {
        const fullQuote = await this.getQuoteDetails(companyId, quote.ID);
        quotesWithDetails.push(fullQuote);
      } catch (error) {
        logger.error(
          `[SimPro Quotes] Failed to get details for quote ${quote.ID}`,
          { error }
        );
        quotesWithDetails.push(quote); // Use basic quote if details fail
      }
    }

    return quotesWithDetails;
  }

  private async batchEnhanceQuotes(
    quotes: SimProQuote[],
    companyId: number
  ): Promise<EnhancedSimProQuote[]> {
    logger.debug(`[SimPro Quotes] Batch enhancing ${quotes.length} quotes...`);

    // Collect unique IDs to minimize API calls
    const uniqueCustomerIds = [
      ...new Set(quotes.map((q) => q.Customer?.ID).filter(Boolean)),
    ];
    const uniqueContactIds = [
      ...new Set(
        quotes
          .flatMap((q) => [q.CustomerContact?.ID, q.SiteContact?.ID])
          .filter(Boolean)
      ),
    ];

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
