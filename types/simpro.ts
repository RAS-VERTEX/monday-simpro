export interface SimProCompany {
  ID: number;
  Name: string;
}

export interface SimProCustomer {
  ID: number;
  CompanyName: string;
  GivenName?: string;
  FamilyName?: string;
}

export interface SimProContact {
  ID: number;
  GivenName?: string;
  FamilyName?: string;
  Email?: string;
  WorkPhone?: string;
  CellPhone?: string;
}

export interface SimProSite {
  ID: number;
  Name: string;
}

export interface SimProSalesperson {
  ID: number;
  Name: string;
  Type: 'employee' | 'contractor';
  TypeId: number;
}

export interface SimProStatus {
  ID: number;
  Name: string;
  Color?: string;
}

export interface SimProTotal {
  ExTax: number;
  Tax: number;
  IncTax: number;
}

export interface SimProQuote {
  ID: number;
  Customer: SimProCustomer;
  CustomerContact?: SimProContact;
  Site?: SimProSite;
  SiteContact?: SimProContact;
  Description?: string;
  Notes?: string;
  Name?: string;
  Salesperson?: SimProSalesperson;
  DateIssued?: string;
  DueDate?: string;
  Stage: 'Quote: To Be Assigned' | 'Quote: To Be Scheduled' | 'Quote: To Write' | 'Quote: Visit Scheduled' | 'Quote: In Progress' | 'Quote: Won' | 'Quote: On Hold' | 'Quote: Quote Due Date Reached';
  Status?: SimProStatus;
  Total?: SimProTotal;
  IsClosed?: boolean;
  DateModified?: string;
}

export interface SimProWebhookPayload {
  ID: string;
  build: string;
  description: string;
  name: string;
  action: 'created' | 'updated' | 'deleted' | 'status';
  reference: {
    companyID: number;
    quoteID: number;
    [key: string]: any;
  };
  date_triggered: string;
}

export interface SimProQuoteUpdateRequest {
  Stage?: SimProQuote['Stage'];
  Status?: number;
  Notes?: string;
}

export interface SimProClientConfig {
  baseUrl: string;
  accessToken: string;
  companyId?: number;
}
