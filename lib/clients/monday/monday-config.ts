// lib/clients/monday/monday-config.ts - Column IDs and configuration
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

// These will be discovered from your actual Monday setup
export const MONDAY_COLUMN_IDS: MondayColumnIds = {
  accounts: {
    description: "long_text",
    notes: "long_text__1",
    contacts_relation: "connect_boards",
    deals_relation: "connect_boards5",
  },
  contacts: {
    email: "email",
    phone: "phone",
    notes: "long_text",
    accounts_relation: "connect_boards",
    deals_relation: "connect_boards4",
  },
  deals: {
    value: "numbers",
    stage: "status",
    close_date: "date4",
    notes: "long_text",
    contacts_relation: "connect_boards",
    accounts_relation: "connect_boards9",
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
