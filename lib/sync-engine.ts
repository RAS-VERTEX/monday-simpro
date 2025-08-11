// lib/sync-engine.ts - Core Sync Engine with Test Limit Support

import { SimProClient } from './simpro-client';
import { MondayClient } from './monday-client';
import { 
  SyncResult, 
  SyncError, 
  QuoteToMondayMapping, 
  SyncConfig
} from '@/types/sync';
import { SimProQuote } from '@/types/simpro';
import { 
  MondayDealData, 
  MondayAccountData, 
  MondayContactData,
  MondayDealStage 
} from '@/types/monday';

export class SyncEngine {
  private simproClient: SimProClient;
  private mondayClient: MondayClient;
  private config: SyncConfig;

  constructor(
    simproClient: SimProClient,
    mondayClient: MondayClient,
    config: SyncConfig
  ) {
    this.simproClient = simproClient;
    this.mondayClient = mondayClient;
    this.config = config;
  }

  async syncSimProToMonday(limit?: number): Promise<SyncResult> {
    const startTime = new Date().toISOString();
    const errors: SyncError[] = [];
    let metrics = {
      quotesProcessed: 0,
      accountsCreated: 0,
      contactsCreated: 0,
      dealsCreated: 0,
      dealsUpdated: 0,
      errors: 0
    };

    try {
      console.log('[Sync Engine] Starting SimPro → Monday sync...');
      
      const allQuotes = await this.simproClient.getActiveHighValueQuotes();
      console.log(`[Sync Engine] Found ${allQuotes.length} high-value quotes`);

      if (allQuotes.length === 0) {
        return {
          success: true,
          message: 'No high-value quotes found to sync',
          timestamp: startTime,
          metrics
        };
      }

      // Apply limit for testing
      const quotes = limit ? allQuotes.slice(0, limit) : allQuotes;
      
      if (limit) {
        console.log(`[Sync Engine] Limited to ${quotes.length} quotes for testing`);
      }

      for (const quote of quotes) {
        try {
          metrics.quotesProcessed++;
          
          const mapping = this.mapQuoteToMonday(quote);
          const syncResult = await this.syncQuoteToMonday(mapping);
          
          metrics.accountsCreated += syncResult.accountCreated ? 1 : 0;
          metrics.contactsCreated += syncResult.contactsCreated;
          metrics.dealsCreated += syncResult.dealCreated ? 1 : 0;
          
          console.log(`[Sync Engine] ✅ Synced quote ${quote.ID} successfully`);
          
        } catch (error) {
          metrics.errors++;
          const syncError: SyncError = {
            type: 'VALIDATION',
            message: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString(),
            quoteId: quote.ID,
            details: error
          };
          errors.push(syncError);
          
          console.error(`[Sync Engine] ❌ Failed to sync quote ${quote.ID}:`, error);
        }
      }

      const successRate = ((metrics.quotesProcessed - metrics.errors) / metrics.quotesProcessed) * 100;
      
      return {
        success: true,
        message: `Synced ${metrics.quotesProcessed} quotes with ${successRate.toFixed(1)}% success rate${limit ? ' (test mode)' : ''}`,
        timestamp: startTime,
        metrics,
        errors: errors.length > 0 ? errors : undefined
      };
      
    } catch (error) {
      console.error('[Sync Engine] Critical sync error:', error);
      
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown sync error',
        timestamp: startTime,
        metrics,
        errors: [{
          type: 'SIMPRO_API',
          message: error instanceof Error ? error.message : 'Critical sync failure',
          timestamp: new Date().toISOString(),
          details: error
        }]
      };
    }
  }

  private mapQuoteToMonday(quote: SimProQuote): QuoteToMondayMapping {
    let cleanDescription = (quote.Description || '')
      .replace(/<[^>]*>/g, '')
      .trim();
    
    if (cleanDescription.length > 50) {
      cleanDescription = cleanDescription.substring(0, 50) + '...';
    }

    const quoteName = quote.Name || cleanDescription || 'Service';
    const dealName = `Quote #${quote.ID} - ${quoteName}`;

    const account: MondayAccountData = {
      accountName: quote.Customer.CompanyName,
      industry: 'Building Services',
      description: `Customer from SimPro`,
      simproCustomerId: quote.Customer.ID
    };

    const contacts: MondayContactData[] = [];
    
    if (quote.CustomerContact?.GivenName || quote.CustomerContact?.FamilyName) {
      contacts.push({
        contactName: `${quote.CustomerContact.GivenName || ''} ${quote.CustomerContact.FamilyName || ''}`.trim(),
        companyName: quote.Customer.CompanyName,
        contactType: 'customer',
        simproContactId: quote.CustomerContact.ID,
        simproCustomerId: quote.Customer.ID
      });
    }

    if (quote.SiteContact?.GivenName || quote.SiteContact?.FamilyName) {
      contacts.push({
        contactName: `${quote.SiteContact.GivenName || ''} ${quote.SiteContact.FamilyName || ''}`.trim(),
        companyName: quote.Customer.CompanyName,
        contactType: 'site',
        siteName: quote.Site?.Name || '',
        simproContactId: quote.SiteContact.ID,
        simproCustomerId: quote.Customer.ID
      });
    }

    const deal: MondayDealData = {
      dealName,
      dealValue: quote.Total?.ExTax || 0,
      stage: quote.Stage,
      accountName: quote.Customer.CompanyName,
      salesperson: quote.Salesperson?.Name || '',
      dateIssued: quote.DateIssued || new Date().toISOString().split('T')[0],
      dueDate: quote.DueDate || quote.DateIssued || new Date().toISOString().split('T')[0],
      siteName: quote.Site?.Name || '',
      simproQuoteId: quote.ID
    };

    return {
      quote,
      account,
      contacts,
      deal
    };
  }

  private async syncQuoteToMonday(mapping: QuoteToMondayMapping): Promise<{
    accountCreated: boolean;
    contactsCreated: number;
    dealCreated: boolean;
  }> {
    let accountCreated = false;
    let contactsCreated = 0;
    let dealCreated = false;

    let accountId: string | undefined;
    
    const existingAccount = await this.mondayClient.findItemBySimProId(
      this.config.boardIds.accounts,
      mapping.account.simproCustomerId,
      'customer'
    );

    if (existingAccount) {
      accountId = existingAccount.id;
      console.log(`[Sync Engine] Using existing account ${accountId}`);
    } else {
      const accountResult = await this.mondayClient.createAccount(
        this.config.boardIds.accounts,
        mapping.account
      );

      if (accountResult.success) {
        accountId = accountResult.itemId;
        accountCreated = true;
        console.log(`[Sync Engine] Created new account ${accountId}: ${mapping.account.accountName}`);
      } else {
        throw new Error(`Failed to create account: ${accountResult.error}`);
      }
    }

    for (const contact of mapping.contacts) {
      const existingContact = await this.mondayClient.findItemBySimProId(
        this.config.boardIds.contacts,
        contact.simproContactId,
        'contact'
      );

      if (!existingContact) {
        const contactResult = await this.mondayClient.createContact(
          this.config.boardIds.contacts,
          contact
        );

        if (contactResult.success) {
          contactsCreated++;
          console.log(`[Sync Engine] Created contact: ${contact.contactName}`);
        }
      }
    }

    const existingDeal = await this.mondayClient.findItemBySimProId(
      this.config.boardIds.deals,
      mapping.deal.simproQuoteId,
      'quote'
    );

    if (!existingDeal) {
      const dealResult = await this.mondayClient.createDeal(
        this.config.boardIds.deals,
        mapping.deal
      );

      if (dealResult.success) {
        dealCreated = true;
        console.log(`[Sync Engine] Created deal: ${mapping.deal.dealName} - $${mapping.deal.dealValue}`);
      } else {
        throw new Error(`Failed to create deal: ${dealResult.error}`);
      }
    }

    return {
      accountCreated,
      contactsCreated,
      dealCreated
    };
  }

  async updateSimProQuoteStage(
    quoteId: number,
    newStage: MondayDealStage
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[Sync Engine] Updating SimPro quote ${quoteId} to stage: ${newStage}`);
      
      await this.simproClient.updateQuote(quoteId, {
        Stage: newStage,
        Notes: `Stage updated from Monday.com on ${new Date().toISOString()}`
      });

      console.log(`[Sync Engine] ✅ Updated SimPro quote ${quoteId} successfully`);
      return { success: true };
      
    } catch (error) {
      console.error(`[Sync Engine] ❌ Failed to update SimPro quote ${quoteId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async updateMondayDealStage(
    quoteId: number,
    newStage: MondayDealStage
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[Sync Engine] Updating Monday deal for quote ${quoteId} to stage: ${newStage}`);
      
      const existingDeal = await this.mondayClient.findItemBySimProId(
        this.config.boardIds.deals,
        quoteId,
        'quote'
      );

      if (!existingDeal) {
        return {
          success: false,
          error: `Deal not found in Monday.com for quote ${quoteId}`
        };
      }

      const result = await this.mondayClient.updateDealStage(existingDeal.id, newStage);
      
      if (result.success) {
        console.log(`[Sync Engine] ✅ Updated Monday deal ${existingDeal.id} successfully`);
      }
      
      return result;
      
    } catch (error) {
      console.error(`[Sync Engine] ❌ Failed to update Monday deal:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async healthCheck(): Promise<{
    simpro: { status: 'up' | 'down'; responseTime?: number };
    monday: { status: 'up' | 'down'; responseTime?: number };
  }> {
    const results = {
      simpro: { status: 'down' as 'up' | 'down', responseTime: undefined as number | undefined },
      monday: { status: 'down' as 'up' | 'down', responseTime: undefined as number | undefined }
    };

    try {
      const startTime = Date.now();
      const simproTest = await this.simproClient.testConnection();
      results.simpro = {
        status: simproTest.success ? 'up' : 'down',
        responseTime: Date.now() - startTime
      };
    } catch (error) {
      console.error('[Health Check] SimPro connection failed:', error);
    }

    try {
      const startTime = Date.now();
      const mondayTest = await this.mondayClient.testConnection();
      results.monday = {
        status: mondayTest.success ? 'up' : 'down',
        responseTime: Date.now() - startTime
      };
    } catch (error) {
      console.error('[Health Check] Monday connection failed:', error);
    }

    return results;
  }
}
