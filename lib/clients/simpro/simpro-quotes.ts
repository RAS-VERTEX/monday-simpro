// lib/clients/simpro/simpro-quotes.ts - Webhook-only quote processing
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

  async enhanceQuotesWithDetails(
    quotes: SimProQuote[],
    companyId: number
  ): Promise<EnhancedSimProQuote[]> {
    logger.debug(`Enhancing ${quotes.length} quotes with contact details`);

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

    const [customerDetailsMap, contactDetailsMap] = await Promise.all([
      this.fetchCustomerDetails(uniqueCustomerIds, companyId),
      this.fetchContactDetails(uniqueContactIds, companyId),
    ]);

    const enhancedQuotes: EnhancedSimProQuote[] = quotes.map((quote) => {
      const enhanced: EnhancedSimProQuote = { ...quote };

      if (quote.Customer?.ID && customerDetailsMap.has(quote.Customer.ID)) {
        enhanced.CustomerDetails = customerDetailsMap.get(quote.Customer.ID);
      }

      if (
        quote.CustomerContact?.ID &&
        contactDetailsMap.has(quote.CustomerContact.ID)
      ) {
        enhanced.CustomerContactDetails = contactDetailsMap.get(
          quote.CustomerContact.ID
        );

        logger.debug(`Enhanced quote ${quote.ID} customer contact:`, {
          contactId: quote.CustomerContact.ID,
          contactDetails: enhanced.CustomerContactDetails,
        });
      }

      if (
        quote.SiteContact?.ID &&
        contactDetailsMap.has(quote.SiteContact.ID)
      ) {
        enhanced.SiteContactDetails = contactDetailsMap.get(
          quote.SiteContact.ID
        );

        logger.debug(`Enhanced quote ${quote.ID} site contact:`, {
          contactId: quote.SiteContact.ID,
          contactDetails: enhanced.SiteContactDetails,
        });
      }

      return enhanced;
    });

    logger.debug(
      `Enhanced ${enhancedQuotes.length} quotes with contact details`
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
        logger.warn(`Failed to fetch customer ${customerId}`, { error });
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
        logger.warn(`Failed to fetch contact ${contactId}`, { error });
      }
    }

    return contactMap;
  }
}
