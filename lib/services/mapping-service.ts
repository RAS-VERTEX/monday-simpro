// lib/services/mapping-service.ts - FIXED with email/phone debugging
import { EnhancedSimProQuote } from "@/lib/clients/simpro/simpro-quotes";
import {
  MondayDealData,
  MondayAccountData,
  MondayContactData,
  MondayDealStage,
} from "@/types/monday";
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

    // ✅ FIXED: Map stage using correct type
    const simproStatusName = quote.Status?.Name?.trim() || "";
    const mondayStage = this.mapSimProToMondayStage(simproStatusName);

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

  private mapSimProToMondayStage(simproStatus: string): MondayDealStage {
    const cleanStatus = simproStatus.trim();

    const statusMapping: { [key: string]: MondayDealStage } = {
      "Quote: Sent": "Quote: Sent",
      "Quote : Sent": "Quote: Sent",
      "Quote : Sent ": "Quote: Sent",
      "Quote: Won": "Quote: Won",
      "Quote : Won": "Quote: Won",
      "Quote: On Hold": "Quote: On Hold",
      "Quote : On Hold": "Quote: On Hold",
      "Quote: To Be Scheduled": "Quote: To Be Scheduled",
      "Quote : To Be Scheduled": "Quote: To Be Scheduled",
      "Quote: To Write": "Quote: To Write",
      "Quote: To Be Assigned": "Quote: To Be Assigned",
      "Quote: Visit Scheduled": "Quote Visit Scheduled",
      "Quote : Visit Scheduled": "Quote Visit Scheduled",
      "Quote: In Progress": "Quote: To Write",
      "Quote : In Progress": "Quote: To Write",
      "Quote: Quote Due Date Reached": "Quote: Due Date Reached",
      "Quote : Quote Due Date Reached": "Quote: Due Date Reached",
    };

    return statusMapping[cleanStatus] || "Quote: Sent";
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

  // ✅ FIXED: Enhanced debugging for contact extraction
  private extractContacts(quote: EnhancedSimProQuote): MondayContactData[] {
    const contacts: MondayContactData[] = [];

    // 🔍 COMPREHENSIVE DEBUG LOGGING
    console.log(`🔍 [CONTACT DEBUG] Quote ${quote.ID} - Full contact data:`, {
      CustomerContact: quote.CustomerContact,
      CustomerContactDetails: quote.CustomerContactDetails,
      SiteContact: quote.SiteContact,
      SiteContactDetails: quote.SiteContactDetails,
    });

    // Customer contact - SAFE NULL CHECKS
    if (
      quote.CustomerContact?.GivenName ||
      quote.CustomerContact?.FamilyName ||
      quote.CustomerContact?.Name
    ) {
      const contactName =
        quote.CustomerContact.GivenName && quote.CustomerContact.FamilyName
          ? `${quote.CustomerContact.GivenName} ${quote.CustomerContact.FamilyName}`.trim()
          : quote.CustomerContact.Name || "Unknown Contact";

      const contactEmail = quote.CustomerContactDetails?.Email;
      const contactWorkPhone = quote.CustomerContactDetails?.WorkPhone;
      const contactCellPhone = quote.CustomerContactDetails?.CellPhone;
      const contactPhone = contactWorkPhone || contactCellPhone;

      // 🔍 DETAILED EMAIL/PHONE DEBUG
      console.log(`📧 [CONTACT DEBUG] Customer Contact "${contactName}":`, {
        email: contactEmail,
        workPhone: contactWorkPhone,
        cellPhone: contactCellPhone,
        finalPhone: contactPhone,
        department: quote.CustomerContactDetails?.Department,
        position: quote.CustomerContactDetails?.Position,
        contactId: quote.CustomerContact.ID,
        customerId: quote.Customer.ID,
      });

      const contactData: MondayContactData = {
        contactName,
        companyName: quote.Customer.CompanyName,
        contactType: "customer",
        simproContactId: quote.CustomerContact.ID,
        simproCustomerId: quote.Customer.ID,
        email: contactEmail,
        phone: contactPhone,
        department: quote.CustomerContactDetails?.Department,
        position: quote.CustomerContactDetails?.Position,
      };

      // 🔍 FINAL CONTACT DATA DEBUG
      console.log(
        `✅ [CONTACT DEBUG] Final contact data for "${contactName}":`,
        contactData
      );

      contacts.push(contactData);
    }

    // Site contact (if different from customer contact) - SAFE NULL CHECKS
    if (
      quote.SiteContact?.GivenName ||
      quote.SiteContact?.FamilyName ||
      quote.SiteContact?.Name
    ) {
      const siteContactId = quote.SiteContact.ID;
      const customerContactId = quote.CustomerContact?.ID;

      if (siteContactId !== customerContactId) {
        const contactName =
          quote.SiteContact.GivenName && quote.SiteContact.FamilyName
            ? `${quote.SiteContact.GivenName} ${quote.SiteContact.FamilyName}`.trim()
            : quote.SiteContact.Name || "Unknown Site Contact";

        const contactEmail = quote.SiteContactDetails?.Email;
        const contactWorkPhone = quote.SiteContactDetails?.WorkPhone;
        const contactCellPhone = quote.SiteContactDetails?.CellPhone;
        const contactPhone = contactWorkPhone || contactCellPhone;

        // 🔍 SITE CONTACT DEBUG
        console.log(`📧 [CONTACT DEBUG] Site Contact "${contactName}":`, {
          email: contactEmail,
          workPhone: contactWorkPhone,
          cellPhone: contactCellPhone,
          finalPhone: contactPhone,
          department: quote.SiteContactDetails?.Department,
          position: quote.SiteContactDetails?.Position,
          contactId: quote.SiteContact.ID,
          customerId: quote.Customer.ID,
        });

        const contactData: MondayContactData = {
          contactName,
          companyName: quote.Customer.CompanyName,
          contactType: "site",
          siteName: quote.Site?.Name || "",
          simproContactId: quote.SiteContact.ID,
          simproCustomerId: quote.Customer.ID,
          email: contactEmail,
          phone: contactPhone,
          department: quote.SiteContactDetails?.Department,
          position: quote.SiteContactDetails?.Position,
        };

        console.log(
          `✅ [CONTACT DEBUG] Final site contact data for "${contactName}":`,
          contactData
        );

        contacts.push(contactData);
      }
    }

    console.log(
      `📊 [CONTACT DEBUG] Total contacts extracted for quote ${quote.ID}: ${contacts.length}`
    );

    logger.debug(
      `[Mapping Service] Extracted ${contacts.length} contacts from quote ${quote.ID}`
    );

    return contacts;
  }
}
