export interface MondayAccountData {
  accountName: string;
  simproCustomerId: number;
  industry?: string;
}

export interface MondayContactData {
  contactName: string;
  companyName: string;
  email?: string;
  phone?: string;
  contactType?: "customer" | "site";
  siteName?: string;
  department?: string;
  position?: string;
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
  dealOwnerId?: number;
}

export interface MondayItem {
  id: string;
  name: string;
  column_values?: Array<{
    id: string;
    text: string;
    value?: string;
  }>;
}

export type MondayDealStage =
  | "Quote: Sent"
  | "Quote: On Hold"
  | "Quote: To Be Scheduled"
  | "Quote: To Write"
  | "Quote: To Be Assigned"
  | "Quote Visit Scheduled"
  | "Quote: Due Date Reached"
  | "Quote: In Progress"
  | "Quote: Won"
  | "Quote : Won"
  | "Quote: Archived - Not Won"
  | "Quote : Archived - Not Won";

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
    type: string;
  };
  deals: {
    value: string;
    stage: string;
    close_date: string;
    notes: string;
    contacts_relation: string;
    accounts_relation: string;
    owner: string;
  };
}

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

export interface MondayApiResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    locations?: Array<{
      line: number;
      column: number;
    }>;
  }>;
}

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
