// types/simpro.ts - SimPro API type definitions

// ============================================================================
// WEBHOOK PAYLOAD TYPES
// ============================================================================

export interface SimProWebhookPayload {
  ID: string; // e.g., "quote.created", "quote.updated", "quote.status"
  action: string;
  reference?: {
    quoteID: number;
    companyID: number;
  };
  timestamp?: string;
}

// ============================================================================
// QUOTE TYPES
// ============================================================================

export interface SimProQuote {
  ID: number;
  Name?: string;
  Description?: string;
  Stage: string;
  Status?: {
    ID: number;
    Name: string;
  };
  Total?: {
    ExTax: number;
    InTax: number;
  };
  DueDate?: string;
  DateIssued?: string;
  IsClosed?: boolean; // ✅ Added missing property
  Customer: {
    ID: number;
    CompanyName: string;
  };
  CustomerContact?: {
    // ✅ Added missing property
    ID: number;
    Name: string;
    GivenName?: string; // ✅ Added missing properties
    FamilyName?: string;
  };
  Site?: {
    ID: number;
    Name: string;
  };
  SiteContact?: {
    // ✅ Added missing property
    ID: number;
    Name: string;
    GivenName?: string; // ✅ Added missing properties
    FamilyName?: string;
  };
  Salesperson?: {
    ID: number;
    Name: string;
  };
}

// ============================================================================
// CUSTOMER/COMPANY TYPES
// ============================================================================

export interface SimProCustomer {
  ID: number;
  CompanyName: string;
  Industry?: string;
  Description?: string;
  Address?: SimProAddress;
  Phone?: string;
  Email?: string;
}

export interface SimProAddress {
  AddressLine1?: string;
  AddressLine2?: string;
  City?: string;
  State?: string;
  PostCode?: string;
  Country?: string;
}

// ============================================================================
// CONTACT TYPES
// ============================================================================

export interface SimProContact {
  ID: number;
  FirstName: string;
  LastName: string;
  Email?: string;
  Phone?: string;
  Position?: string;
  IsPrimary?: boolean;
  Customer: {
    ID: number;
    CompanyName: string;
  };
}

// ============================================================================
// API CONFIGURATION
// ============================================================================

export interface SimProConfig {
  baseUrl: string;
  accessToken: string;
  companyId: number;
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface SimProApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface SimProHealthStatus {
  status: "up" | "down";
  lastCheck: string;
  responseTime?: number;
  error?: string;
}

// ============================================================================
// ENHANCED QUOTE TYPE (with full customer/contact data)
// ============================================================================

export interface EnhancedSimProQuote extends SimProQuote {
  CustomerData?: SimProCustomer;
  ContactsData?: SimProContact[];
  SiteData?: {
    ID: number;
    Name: string;
    Address?: SimProAddress;
  };
}
