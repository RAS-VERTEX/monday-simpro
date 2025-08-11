import { SimProQuote } from './simpro';
import { MondayDealData, MondayAccountData, MondayContactData } from './monday';

export interface SyncConfig {
  minimumQuoteValue: number;
  boardIds: {
    accounts: string;
    contacts: string;
    deals: string;
  };
  enabledEvents: {
    simproToMonday: boolean;
    mondayToSimpro: boolean;
  };
}

export interface SyncResult {
  success: boolean;
  message: string;
  timestamp: string;
  metrics: {
    quotesProcessed: number;
    accountsCreated: number;
    contactsCreated: number;
    dealsCreated: number;
    dealsUpdated: number;
    errors: number;
  };
  errors?: SyncError[];
}

export interface SyncError {
  type: 'SIMPRO_API' | 'MONDAY_API' | 'VALIDATION' | 'MAPPING';
  message: string;
  details?: any;
  timestamp: string;
  quoteId?: number;
  itemId?: string;
}

export interface QuoteToMondayMapping {
  quote: SimProQuote;
  account: MondayAccountData;
  contacts: MondayContactData[];
  deal: MondayDealData;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  services: {
    simpro: {
      status: 'up' | 'down';
      lastCheck: string;
      responseTime?: number;
    };
    monday: {
      status: 'up' | 'down';
      lastCheck: string;
      responseTime?: number;
    };
  };
  lastSync: {
    timestamp: string;
    status: 'success' | 'failed';
    quotesProcessed: number;
  };
}
