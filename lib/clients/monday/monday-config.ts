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

export const MONDAY_COLUMN_IDS: MondayColumnIds = {
  accounts: {
    description: "dropdown_mktjs43t", // ✅ FIXED: From board discovery
    notes: "text_mktqry14", // ✅ FIXED: From board discovery
    contacts_relation: "account_contact",
    deals_relation: "account_deal",
  },
  contacts: {
    email: "contact_email",
    phone: "contact_phone",
    notes: "text_mktqzy0q", // ✅ FIXED: From board discovery
    accounts_relation: "contact_account",
    deals_relation: "contact_deal",
    type: "title5", // This might need checking if contact type isn't working
  },
  deals: {
    value: "deal_value",
    stage: "deal_stage", // ✅ FIXED: From board discovery
    close_date: "deal_expected_close_date",
    notes: "text_mktq93t9", // ✅ From board discovery
    contacts_relation: "deal_contact",
    accounts_relation: "deal_account",
    owner: "deal_owner", // ✅ From board discovery
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
