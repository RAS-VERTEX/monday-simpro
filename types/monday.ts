// types/monday.ts - Complete Monday.com type definitions

// ============================================================================
// CORE MONDAY API TYPES
// ============================================================================

export interface MondayApiResponse<T> {
  data: T;
  errors?: Array<{
    message: string;
    locations?: Array<{
      line: number;
      column: number;
    }>;
    path?: string[];
  }>;
  account_id?: number;
}

export interface MondayItem {
  id: string;
  name: string;
  column_values?: Array<{
    id: string;
    text: string;
    value: string;
  }>;
  board?: {
    id: string;
  };
}

export interface MondayBoard {
  id: string;
  name: string;
  description?: string;
  items?: MondayItem[];
  columns?: Array<{
    id: string;
    title: string;
    type: string;
  }>;
}

export interface MondayColumnValues {
  [columnId: string]: any;
}

// ============================================================================
// DATA TRANSFER OBJECTS
// ============================================================================

export interface MondayAccountData {
  accountName: string;
  description?: string;
  simproCustomerId: number;
  industry?: string;
}

export interface MondayContactData {
  contactName: string;
  companyName: string;
  email?: string;
  phone?: string;
  contactType?: string;
  siteName?: string;
  department?: string; // ✅ Added missing property
  position?: string; // ✅ Added missing property
  simproContactId: number;
  simproCustomerId: number;
}

export interface MondayDealData {
  dealName: string;
  dealValue: number;
  stage: MondayDealStage;
  closeDate?: string;
  dateIssued?: string;
  dueDate?: string;
  salesperson?: string;
  accountName: string;
  siteName?: string;
  simproQuoteId: number;
}

// ============================================================================
// DEAL STAGES (Based on your actual Monday board statuses)
// ============================================================================

export type MondayDealStage =
  | "Quote: Sent"
  | "Quote: Won"
  | "Quote: On Hold"
  | "Quote: To Be Scheduled"
  | "Quote: To Write"
  | "Quote: To Be Assigned"
  | "Quote Visit Scheduled"
  | "Quote: Due Date Reached"
  | "Quote: Archived - Not Won"
  | "Quote : Archived - Not Won";

// ============================================================================
// CONFIGURATION TYPES
// ============================================================================

export interface MondayClientConfig {
  apiToken: string;
}

export interface MondayBoardConfig {
  accounts: string;
  contacts: string;
  deals: string;
}

export interface MondayColumnIds {
  accounts: {
    description: string;
    notes: string;
    contacts_relation: string;
    deals_relation: string;
  };
  contacts: {
    email: string;
    phone: string;
    notes: string;
    accounts_relation: string;
    deals_relation: string;
  };
  deals: {
    value: string;
    stage: string;
    close_date: string;
    notes: string;
    contacts_relation: string;
    accounts_relation: string;
  };
}

// ============================================================================
// API OPERATION RESULTS
// ============================================================================

export interface MondayOperationResult {
  success: boolean;
  itemId?: string;
  error?: string;
  message?: string;
}

export interface MondayHealthStatus {
  status: "up" | "down";
  lastCheck: string;
  responseTime?: number;
  error?: string;
}

// ============================================================================
// SYNC SERVICE TYPES
// ============================================================================

export interface MondaySyncMetrics {
  accountsCreated: number;
  contactsCreated: number;
  dealsCreated: number;
  relationshipsLinked: number;
  errors: number;
}

export interface MondaySyncResult {
  success: boolean;
  message: string;
  metrics: MondaySyncMetrics;
  errors?: string[];
  timestamp: string;
}
