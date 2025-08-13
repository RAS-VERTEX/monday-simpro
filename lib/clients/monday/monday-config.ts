// lib/clients/monday/monday-config.ts - FIXED with your actual column IDs
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

// CORRECTED: Using your actual column IDs from the Monday boards
export const MONDAY_COLUMN_IDS: MondayColumnIds = {
  accounts: {
    description: "company_description", // ✅ Correct: company description
    notes: "text_mktrez5x", // ✅ Correct: Notes field
    contacts_relation: "account_contact", // ✅ Correct: Contacts relation
    deals_relation: "account_deal", // ✅ Correct: Deals relation (mirror)
  },
  contacts: {
    email: "contact_email", // ✅ Correct: Email field
    phone: "contact_phone", // ✅ Correct: Phone field
    notes: "text_mktr67s0", // ✅ Correct: Notes field
    accounts_relation: "contact_account", // ✅ Correct: Accounts relation
    deals_relation: "contact_deal", // ✅ Correct: Deals relation
  },
  deals: {
    value: "deal_value", // ✅ Correct: Deal Value field
    stage: "color_mktrw6k3", // ✅ Correct: Status field
    close_date: "deal_expected_close_date", // ✅ Correct: Expected Close Date
    notes: "text_mktrtr9b", // ✅ Correct: Notes field
    contacts_relation: "deal_contact", // ✅ Correct: Contacts relation
    accounts_relation: "deal_account", // ✅ Correct: Accounts relation (mirror)
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
