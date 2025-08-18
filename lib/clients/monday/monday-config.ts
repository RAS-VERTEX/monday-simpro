// lib/clients/monday/monday-config.ts - Updated with correct column IDs from discovery

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
    owner: string; // ✅ NEW: Deal owner (salesperson)
  };
}

// ✅ UPDATED: Using actual column IDs from your Monday boards
export const MONDAY_COLUMN_IDS: MondayColumnIds = {
  accounts: {
    description: "company_description",
    notes: "text_mktrez5x",
    contacts_relation: "account_contact",
    deals_relation: "account_deal",
  },
  contacts: {
    email: "contact_email",
    phone: "contact_phone",
    notes: "text_mktr67s0",
    accounts_relation: "contact_account",
    deals_relation: "contact_deal",
    type: "title5",
  },
  deals: {
    value: "deal_value",
    stage: "color_mktrw6k3",
    close_date: "deal_expected_close_date",
    notes: "text_mktrtr9b",
    contacts_relation: "deal_contact",
    accounts_relation: "deal_account",
    owner: "deal_owner",
  },
};

export function createMondayConfig(
  apiToken: string,
  boardIds: MondayBoardConfig
): {
  apiToken: string;
  boardIds: MondayBoardConfig;
  columnIds: MondayColumnIds;
} {
  return {
    apiToken,
    boardIds,
    columnIds: MONDAY_COLUMN_IDS,
  };
}
