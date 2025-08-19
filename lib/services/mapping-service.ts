// lib/services/mapping-service.ts - Complete updated file with salesperson assignment enabled
import { EnhancedSimProQuote } from "@/lib/clients/simpro/simpro-quotes";
import {
  MondayDealData,
  MondayAccountData,
  MondayContactData,
  MondayDealStage,
} from "@/types/monday";
import { logger } from "@/lib/utils/logger";
// ✅ ENABLE: Salesperson mapping import
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
      simproCustomerId: quote.Customer.ID,
    };

    // ✅ SIMPLIFIED: Extract only main customer contact
    const contacts: MondayContactData[] = this.extractContacts(quote);

    const simproSalesperson = quote.Salesperson?.Name || "";

    // ✅ ENABLE: Get Monday user ID for salesperson
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
      dealOwnerId: mondayUserId || undefined, // ✅ ENABLE
      dateIssued: quote.DateIssued || new Date().toISOString().split("T")[0],
      dueDate:
        quote.DueDate ||
        quote.DateIssued ||
        new Date().toISOString().split("T")[0],
      siteName: quote.Site?.Name || "",
      simproQuoteId: quote.ID,
    };

    // ✅ ENABLE: Salesperson logging
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

  // ✅ SIMPLIFIED: Extract only main customer contact
  private extractContacts(quote: EnhancedSimProQuote): MondayContactData[] {
    const contacts: MondayContactData[] = [];

    console.log(
      `🔍 [CONTACT DEBUG] Quote ${quote.ID} - Processing main contact only`
    );

    // Only process main customer contact - simplified approach
    if (quote.CustomerContact && quote.CustomerContact.ID) {
      const contactName =
        quote.CustomerContact.GivenName && quote.CustomerContact.FamilyName
          ? `${quote.CustomerContact.GivenName} ${quote.CustomerContact.FamilyName}`.trim()
          : quote.CustomerContact.Name || "Unknown Customer Contact";

      const contactEmail = quote.CustomerContactDetails?.Email;
      const contactWorkPhone = quote.CustomerContactDetails?.WorkPhone;
      const contactCellPhone = quote.CustomerContactDetails?.CellPhone;
      const contactPhone = contactWorkPhone || contactCellPhone;

      console.log(`📧 [CONTACT DEBUG] Main Contact "${contactName}":`, {
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
        `✅ [CONTACT DEBUG] Final main contact data for "${contactName}":`,
        contactData
      );
      contacts.push(contactData);

      logger.info(
        `[Mapping Service] 📧 Using main contact only: ${contactName}`
      );
    } else {
      logger.warn(
        `[Mapping Service] No main customer contact found for quote ${quote.ID}`
      );
    }

    console.log(
      `📊 [CONTACT DEBUG] Total contacts extracted for quote ${quote.ID}: ${contacts.length} (simplified approach)`
    );

    return contacts;
  }

  // ✅ REMOVED: The complex extractContacts method with site contact logic
  // This simplified version only creates the main customer contact to avoid:
  // - Duplicate contact issues
  // - Complex contact matching logic
  // - Cleaner data in Monday.com
}
