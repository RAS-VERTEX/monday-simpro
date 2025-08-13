// lib/services/mapping-service.ts - Data transformation only
import { EnhancedSimProQuote } from "@/lib/clients/simpro/simpro-quotes";
import {
  MondayDealData,
  MondayAccountData,
  MondayContactData,
} from "@/types/monday";
import { mapSimProToMondayStage } from "@/lib/utils/stage-mapper";
import { logger } from "@/lib/utils/logger";

export interface QuoteToMondayMapping {
  account: MondayAccountData;
  contacts: MondayContactData[];
  deal: MondayDealData;
}

export class MappingService {
  mapQuoteToMonday(quote: EnhancedSimProQuote): QuoteToMondayMapping {
    logger.debug(
      `[Mapping Service] Mapping quote ${quote.ID} to Monday format`
    );

    // Create clean deal name
    let cleanDescription = (quote.Description || "")
      .replace(/<[^>]*>/g, "") // Remove HTML tags
      .trim();

    if (cleanDescription.length > 50) {
      cleanDescription = cleanDescription.substring(0, 50) + "...";
    }

    const quoteName = quote.Name || cleanDescription || "Service";
    const dealName = `Quote #${quote.ID} - ${quoteName}`;

    // Map stage using simplified mapping
    const simproStatusName = quote.Status?.Name?.trim() || "";
    const mondayStage = mapSimProToMondayStage(simproStatusName);

    // Account data
    const account: MondayAccountData = {
      accountName: quote.Customer.CompanyName,
      description: this.buildAccountDescription(quote),
      simproCustomerId: quote.Customer.ID,
    };

    // Contacts data
    const contacts: MondayContactData[] = this.extractContacts(quote);

    // Deal data
    const deal: MondayDealData = {
      dealName,
      dealValue: quote.Total?.ExTax || 0,
      stage: mondayStage,
      accountName: quote.Customer.CompanyName,
      salesperson: quote.Salesperson?.Name || "",
      dateIssued: quote.DateIssued || new Date().toISOString().split("T")[0],
      dueDate:
        quote.DueDate ||
        quote.DateIssued ||
        new Date().toISOString().split("T")[0],
      siteName: quote.Site?.Name || "",
      simproQuoteId: quote.ID,
    };

    logger.debug(
      `[Mapping Service] Mapped quote ${quote.ID}: Account="${account.accountName}", Deal="${deal.dealName}", Stage="${mondayStage}"`
    );

    return {
      account,
      contacts,
      deal,
    };
  }

  private buildAccountDescription(quote: EnhancedSimProQuote): string {
    const parts = [
      `Customer from SimPro (Quote ${quote.ID})`,
      "",
      `Email: ${quote.CustomerDetails?.email || "Not provided"}`,
      `Phone: ${quote.CustomerDetails?.phone || "Not provided"}`,
      `Alt Phone: ${quote.CustomerDetails?.altPhone || "Not provided"}`,
    ];

    if (quote.CustomerDetails?.address) {
      parts.push(`Address: ${JSON.stringify(quote.CustomerDetails.address)}`);
    } else {
      parts.push("Address: Not provided");
    }

    return parts.join("\n");
  }

  private extractContacts(quote: EnhancedSimProQuote): MondayContactData[] {
    const contacts: MondayContactData[] = [];

    // Customer contact
    if (quote.CustomerContact?.GivenName || quote.CustomerContact?.FamilyName) {
      contacts.push({
        contactName: `${quote.CustomerContact.GivenName || ""} ${
          quote.CustomerContact.FamilyName || ""
        }`.trim(),
        companyName: quote.Customer.CompanyName,
        contactType: "customer",
        simproContactId: quote.CustomerContact.ID,
        simproCustomerId: quote.Customer.ID,
        email: quote.CustomerContactDetails?.Email,
        phone:
          quote.CustomerContactDetails?.WorkPhone ||
          quote.CustomerContactDetails?.CellPhone,
        department: quote.CustomerContactDetails?.Department,
        position: quote.CustomerContactDetails?.Position,
      });
    }

    // Site contact (if different from customer contact)
    if (quote.SiteContact?.GivenName || quote.SiteContact?.FamilyName) {
      // Only add if it's a different contact
      const siteContactId = quote.SiteContact.ID;
      const customerContactId = quote.CustomerContact?.ID;

      if (siteContactId !== customerContactId) {
        contacts.push({
          contactName: `${quote.SiteContact.GivenName || ""} ${
            quote.SiteContact.FamilyName || ""
          }`.trim(),
          companyName: quote.Customer.CompanyName,
          contactType: "site",
          siteName: quote.Site?.Name || "",
          simproContactId: quote.SiteContact.ID,
          simproCustomerId: quote.Customer.ID,
          email: quote.SiteContactDetails?.Email,
          phone:
            quote.SiteContactDetails?.WorkPhone ||
            quote.SiteContactDetails?.CellPhone,
          department: quote.SiteContactDetails?.Department,
          position: quote.SiteContactDetails?.Position,
        });
      }
    }

    logger.debug(
      `[Mapping Service] Extracted ${contacts.length} contacts from quote ${quote.ID}`
    );
    return contacts;
  }
}
