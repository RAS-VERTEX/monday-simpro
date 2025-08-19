import { EnhancedSimProQuote } from "@/lib/clients/simpro/simpro-quotes";
import {
  MondayDealData,
  MondayAccountData,
  MondayContactData,
  MondayDealStage,
} from "@/types/monday";
import { logger } from "@/lib/utils/logger";
import { SalespersonMappingService } from "./salesperson-mapping";

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

    let cleanDescription = (quote.Description || "")
      .replace(/<[^>]*>/g, "")
      .trim();

    if (cleanDescription.length > 50) {
      cleanDescription = cleanDescription.substring(0, 50) + "...";
    }

    const quoteName = quote.Name || cleanDescription || "Service";
    const dealName = `Quote #${quote.ID} - ${quoteName}`;

    const simproStatusName = quote.Status?.Name?.trim() || "";
    const mondayStage = this.mapSimProToMondayStage(simproStatusName);

    const account: MondayAccountData = {
      accountName: quote.Customer.CompanyName,
      // REMOVED: description field - not useful
      simproCustomerId: quote.Customer.ID,
    };

    const contacts: MondayContactData[] = this.extractContacts(quote);

    const simproSalesperson = quote.Salesperson?.Name || "";

    let mondayUserId: number | null = null;
    try {
      const mappingResult =
        SalespersonMappingService.getMondayUserMapping(simproSalesperson);
      SalespersonMappingService.logMappingResult(mappingResult);
      mondayUserId = mappingResult.mondayUserId;
    } catch (error) {
      logger.warn(
        `[Mapping Service] Salesperson mapping failed safely: ${error}`
      );
      mondayUserId = null;
    }

    const deal: MondayDealData = {
      dealName,
      dealValue: quote.Total?.ExTax || 0,
      stage: mondayStage,
      accountName: quote.Customer.CompanyName,
      salesperson: simproSalesperson || "Not specified",
      // COMMENTED OUT: dealOwnerId: mondayUserId || undefined,
      dateIssued: quote.DateIssued || new Date().toISOString().split("T")[0],
      dueDate:
        quote.DueDate ||
        quote.DateIssued ||
        new Date().toISOString().split("T")[0],
      siteName: quote.Site?.Name || "",
      simproQuoteId: quote.ID,
    };

    try {
      if (mondayUserId && simproSalesperson) {
        logger.info(
          `[Mapping Service] 👤 Will assign "${simproSalesperson}" as deal owner (User ${mondayUserId})`
        );
      } else if (simproSalesperson) {
        logger.info(
          `[Mapping Service] 👤 Salesperson "${simproSalesperson}" noted but no Monday user assignment available`
        );
      } else {
        logger.debug(
          `[Mapping Service] No salesperson specified for quote ${quote.ID}`
        );
      }
    } catch (logError) {
      logger.warn(`[Mapping Service] Logging error: ${logError}`);
    }

    return { account, contacts, deal };
  }

  private mapSimProToMondayStage(simproStatusName: string): MondayDealStage {
    const cleanStatus = simproStatusName.trim();

    const statusMapping: Record<string, MondayDealStage> = {
      Sent: "Quote: Sent",
      "Quote: Sent": "Quote: Sent",
      "In Progress": "Quote: In Progress",
      "Quote: In Progress": "Quote: In Progress",
      "To Be Scheduled": "Quote: To Be Scheduled",
      "Quote: To Be Scheduled": "Quote: To Be Scheduled",
      "To Write": "Quote: To Write",
      "Quote: To Write": "Quote: To Write",
      "To Be Assigned": "Quote: To Be Assigned",
      "Quote: To Be Assigned": "Quote: To Be Assigned",
      "On Hold": "Quote: On Hold",
      "Quote: On Hold": "Quote: On Hold",
      "Visit Scheduled": "Quote Visit Scheduled",
      "Quote Visit Scheduled": "Quote Visit Scheduled",
      "Due Date Reached": "Quote: Due Date Reached",
      "Quote: Due Date Reached": "Quote: Due Date Reached",
      Won: "Quote: Won",
      "Quote: Won": "Quote: Won",
      "Quote : Won": "Quote: Won",
      "Archived - Won": "Quote: Won",
      "Quote: Archived - Won": "Quote: Won",
      "Quote : Archived - Won": "Quote: Won",
      Lost: "Quote: Archived - Not Won",
      "Quote: Lost": "Quote: Archived - Not Won",
      "Archived - Not Won": "Quote: Archived - Not Won",
      "Quote: Archived - Not Won": "Quote: Archived - Not Won",
      "Quote : Archived - Not Won": "Quote: Archived - Not Won",
    };

    return statusMapping[cleanStatus] || "Quote: Sent";
  }

  // REMOVED: buildAccountDescription method - not needed anymore

  private extractContacts(quote: EnhancedSimProQuote): MondayContactData[] {
    const contacts: MondayContactData[] = [];

    console.log(`🔍 [CONTACT DEBUG] Quote ${quote.ID} - Full contact data:`, {
      CustomerContact: quote.CustomerContact,
      CustomerContactDetails: quote.CustomerContactDetails,
      SiteContact: quote.SiteContact,
      SiteContactDetails: quote.SiteContactDetails,
    });

    // Customer contact
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

      console.log(
        `✅ [CONTACT DEBUG] Final contact data for "${contactName}":`,
        contactData
      );
      contacts.push(contactData);
    }

    // Site contact - only if different from customer contact
    if (
      quote.SiteContact?.GivenName ||
      quote.SiteContact?.FamilyName ||
      quote.SiteContact?.Name
    ) {
      const siteContactId = quote.SiteContact.ID;
      const customerContactId = quote.CustomerContact?.ID;

      // Skip if same SimPro contact ID
      if (siteContactId === customerContactId) {
        console.log(
          `🔄 [CONTACT DEBUG] Site contact ${siteContactId} is same as customer contact - skipping duplicate`
        );
        logger.debug(
          `[Mapping Service] Skipped duplicate site contact ${siteContactId}`
        );
        return contacts;
      }

      const siteContactName =
        quote.SiteContact.GivenName && quote.SiteContact.FamilyName
          ? `${quote.SiteContact.GivenName} ${quote.SiteContact.FamilyName}`.trim()
          : quote.SiteContact.Name || "Unknown Site Contact";

      const siteContactEmail = quote.SiteContactDetails?.Email;
      const customerContactEmail = quote.CustomerContactDetails?.Email;

      // SIMPLE DUPLICATE DETECTION: Same name + same email = same person
      const customerContactName = contacts[0]?.contactName;
      const isSamePerson =
        siteContactName.toLowerCase().replace(/\s+/g, "") ===
          customerContactName?.toLowerCase().replace(/\s+/g, "") &&
        siteContactEmail?.toLowerCase() ===
          customerContactEmail?.toLowerCase() &&
        siteContactEmail &&
        customerContactEmail; // Both must have emails

      if (isSamePerson) {
        console.log(
          `🔄 [CONTACT DEBUG] Site contact "${siteContactName}" appears to be same person as customer contact - skipping duplicate`
        );
        logger.debug(
          `[Mapping Service] Skipped duplicate contact: ${siteContactName} (same name + email as customer contact)`
        );
        return contacts;
      }

      // Different person - create separate site contact
      const contactWorkPhone = quote.SiteContactDetails?.WorkPhone;
      const contactCellPhone = quote.SiteContactDetails?.CellPhone;
      const contactPhone = contactWorkPhone || contactCellPhone;

      console.log(`📧 [CONTACT DEBUG] Site Contact "${siteContactName}":`, {
        email: siteContactEmail,
        workPhone: contactWorkPhone,
        cellPhone: contactCellPhone,
        finalPhone: contactPhone,
        department: quote.SiteContactDetails?.Department,
        position: quote.SiteContactDetails?.Position,
        contactId: quote.SiteContact.ID,
        customerId: quote.Customer.ID,
      });

      const contactData: MondayContactData = {
        contactName: siteContactName,
        companyName: quote.Customer.CompanyName,
        contactType: "site",
        siteName: quote.Site?.Name || "",
        simproContactId: quote.SiteContact.ID,
        simproCustomerId: quote.Customer.ID,
        email: siteContactEmail,
        phone: contactPhone,
        department: quote.SiteContactDetails?.Department,
        position: quote.SiteContactDetails?.Position,
      };

      console.log(
        `✅ [CONTACT DEBUG] Final site contact data for "${siteContactName}":`,
        contactData
      );
      contacts.push(contactData);
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
