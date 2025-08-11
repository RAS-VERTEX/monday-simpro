// lib/simpro-client.ts - Production SimPro API Client

import { 
  SimProQuote, 
  SimProCompany, 
  SimProClientConfig, 
  SimProQuoteUpdateRequest 
} from '@/types/simpro';

export class SimProClient {
  private baseUrl: string;
  private accessToken: string;
  private companyId: number;

  constructor(config: SimProClientConfig) {
    this.baseUrl = this.normalizeUrl(config.baseUrl);
    this.accessToken = config.accessToken;
    this.companyId = config.companyId || 0;
  }

  private normalizeUrl(url: string): string {
    url = url.replace(/\/+$/, '');
    if (url.includes('.simprosuite.com')) {
      return url;
    }
    return url;
  }

  private async apiRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v1.0${endpoint}`;
    
    console.log(`[SimPro API] ${options.method || 'GET'} ${url}`);
    
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401) {
          throw new Error('SimPro authentication failed - access token may be expired');
        }
        throw new Error(`SimPro API error ${response.status}: ${response.statusText}. ${errorText}`);
      }

      const data = await response.json();
      console.log(`[SimPro API] Response received for ${endpoint}`);
      return data;
    } catch (error) {
      console.error(`[SimPro API] Error on ${endpoint}:`, error);
      throw error;
    }
  }

  async testConnection(): Promise<{ success: boolean; message: string; companies?: SimProCompany[] }> {
    try {
      const companies = await this.getCompanies();
      if (companies && companies.length > 0) {
        return {
          success: true,
          message: `Connected successfully. Found ${companies.length} companies.`,
          companies
        };
      } else {
        return { success: false, message: 'Connected but no companies found' };
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown connection error'
      };
    }
  }

  async getCompanies(): Promise<SimProCompany[]> {
    return this.apiRequest<SimProCompany[]>('/companies/');
  }

  async getActiveHighValueQuotes(companyId?: number): Promise<SimProQuote[]> {
    const quotes = await this.getQuotes({
      companyId: companyId || this.companyId,
      activeOnly: true,
      minimumValue: 15000
    });
    
    const validStages: SimProQuote['Stage'][] = [
      'Quote: To Be Assigned',
      'Quote: To Be Scheduled', 
      'Quote: To Write',
      'Quote: Visit Scheduled',
      'Quote: In Progress',
      'Quote: Won',
      'Quote: On Hold',
      'Quote: Quote Due Date Reached'
    ];
    
    const activeQuotes = quotes.filter(quote => {
      const hasValidStage = validStages.includes(quote.Stage);
      const hasMinimumValue = quote.Total?.ExTax && quote.Total.ExTax >= 15000;
      const isNotClosed = !quote.IsClosed;
      return hasValidStage && hasMinimumValue && isNotClosed;
    });
    
    console.log(`[SimPro] Filtered to ${activeQuotes.length} active high-value quotes`);
    return activeQuotes;
  }

  async getQuotes(options: {
    companyId?: number;
    minimumValue?: number;
    activeOnly?: boolean;
    dateFrom?: string;
  } = {}): Promise<SimProQuote[]> {
    const companyId = options.companyId || this.companyId;
    
    let endpoint = `/companies/${companyId}/quotes/`;
    const params = new URLSearchParams();
    
    if (options.activeOnly !== false) {
      params.append('IsClosed', 'false');
    }
    
    if (options.dateFrom) {
      params.append('DateIssued', `>=${options.dateFrom}`);
    }
    
    if (params.toString()) {
      endpoint += '?' + params.toString();
    }
    
    console.log(`[SimPro] Fetching quotes from: ${endpoint}`);
    
    const quotesList = await this.apiRequest<SimProQuote[]>(endpoint);
    
    if (!quotesList || quotesList.length === 0) {
      return [];
    }
    
    console.log(`[SimPro] Found ${quotesList.length} quotes, getting full details...`);
    
    const quotesWithDetails: SimProQuote[] = [];
    
    for (const quote of quotesList) {
      try {
        const fullQuote = await this.getQuoteDetails(companyId, quote.ID);
        
        if (options.minimumValue && fullQuote.Total?.ExTax) {
          if (fullQuote.Total.ExTax < options.minimumValue) {
            console.log(`[SimPro] Skipping quote ${quote.ID} - value $${fullQuote.Total.ExTax} below minimum $${options.minimumValue}`);
            continue;
          }
        }
        
        quotesWithDetails.push(fullQuote);
        
      } catch (error) {
        console.error(`[SimPro] Failed to get details for quote ${quote.ID}:`, error);
        quotesWithDetails.push(quote);
      }
    }
    
    console.log(`[SimPro] Returning ${quotesWithDetails.length} quotes after filtering`);
    return quotesWithDetails;
  }

  async getQuoteDetails(companyId: number, quoteId: number): Promise<SimProQuote> {
    return this.apiRequest<SimProQuote>(`/companies/${companyId}/quotes/${quoteId}`);
  }

  async updateQuote(
    quoteId: number, 
    updates: SimProQuoteUpdateRequest,
    companyId?: number
  ): Promise<SimProQuote> {
    const targetCompanyId = companyId || this.companyId;
    
    console.log(`[SimPro] Updating quote ${quoteId}:`, updates);
    
    const allowedUpdates: SimProQuoteUpdateRequest = {};
    
    if (updates.Stage) {
      allowedUpdates.Stage = updates.Stage;
    }
    
    if (updates.Status !== undefined) {
      allowedUpdates.Status = updates.Status;
    }
    
    if (updates.Notes) {
      allowedUpdates.Notes = updates.Notes;
    }
    
    if (Object.keys(allowedUpdates).length === 0) {
      throw new Error('No valid updates provided for quote');
    }
    
    return this.apiRequest<SimProQuote>(
      `/companies/${targetCompanyId}/quotes/${quoteId}`,
      {
        method: 'PATCH',
        body: JSON.stringify(allowedUpdates),
      }
    );
  }
}
