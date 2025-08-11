export interface MondayBoard {
  id: string;
  name: string;
  board_kind: string;
  columns: MondayColumn[];
}

export interface MondayColumn {
  id: string;
  title: string;
  type: string;
  settings_str?: string;
}

export interface MondayItem {
  id: string;
  name: string;
  column_values: MondayColumnValue[];
}

export interface MondayColumnValue {
  id: string;
  text?: string;
  value?: string;
}

export interface MondayApiResponse<T> {
  data: T;
  errors?: Array<{
    message: string;
    locations?: Array<{
      line: number;
      column: number;
    }>;
  }>;
}

export interface MondayDealData {
  dealName: string;
  dealValue: number;
  stage: string;
  accountName: string;
  salesperson?: string;
  dateIssued?: string;
  dueDate?: string;
  siteName?: string;
  simproQuoteId: number;
}

export interface MondayAccountData {
  accountName: string;
  industry?: string;
  description?: string;
  simproCustomerId: number;
}

export interface MondayContactData {
  contactName: string;
  companyName: string;
  contactType: 'customer' | 'site';
  siteName?: string;
  simproContactId: number;
  simproCustomerId: number;
}

export interface MondayWebhookPayload {
  challenge?: string;
  event: {
    type: 'update_column_value' | 'create_item' | 'delete_item';
    data: {
      item_id: string;
      board_id: string;
      column_id?: string;
      value?: {
        column_id: string;
        value: string;
      };
    };
  };
}

export interface MondayColumnValues {
  [columnId: string]: string | number | { 
    label?: string;
    index?: number;
  } | {
    date?: string;
  };
}

export type MondayDealStage = 
  | 'Quote: To Be Assigned'
  | 'Quote: To Be Scheduled' 
  | 'Quote: To Write'
  | 'Quote: Visit Scheduled'
  | 'Quote: In Progress'
  | 'Quote: Won'
  | 'Quote: On Hold'
  | 'Quote: Quote Due Date Reached';

export interface MondayClientConfig {
  apiToken: string;
}
