import { SimProApi } from "@/lib/clients/simpro/simpro-api";
import { SimProQuotes } from "@/lib/clients/simpro/simpro-quotes";
import { MondayClient } from "@/lib/monday-client";
import { MondayBoardConfig } from "@/lib/clients/monday/monday-config";
import { MappingService } from "./mapping-service";
import { logger } from "@/lib/utils/logger";

export interface SyncConfig {
  minimumQuoteValue: number;
  boardIds: MondayBoardConfig;
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
    relationshipsLinked: number;
    errors: number;
  };
  errors?: string[];
}

export class SyncService {
  private simproApi: SimProApi;
  private simproQuotes: SimProQuotes;
  private mondayApi: MondayClient;
  private mappingService: MappingService;

  constructor(
    simproConfig: { baseUrl: string; accessToken: string; companyId: number },
    mondayConfig: { apiToken: string; boardIds: MondayBoardConfig }
  ) {
    this.simproApi = new SimProApi(simproConfig);
    this.simproQuotes = new SimProQuotes(this.simproApi);
    this.mondayApi = new MondayClient({ apiToken: mondayConfig.apiToken });
    this.mappingService = new MappingService();
  }

  public get mondayClient(): MondayClient {
    return this.mondayApi;
  }

  public async getSimProQuoteDetails(companyId: number, quoteId: number) {
    return await this.simproQuotes.getQuoteDetails(companyId, quoteId);
  }

  public async findDealBySimProId(
    simproQuoteId: number,
    boardId: string
  ): Promise<any | null> {
    try {
      const query = `
        query FindDeal($boardId: ID!) {
          boards(ids: [$boardId]) {
            items_page(limit: 50) {
              items {
                id
                name
                column_values {
                  id
                  text
                }
              }
            }
          }
        }
      `;

      const result = await this.mondayApi.query(query, { boardId });
      const items = result.boards[0]?.items_page?.items || [];

      for (const item of items) {
        const notesColumn = item.column_values.find(
          (cv: any) =>
            cv.text && cv.text.includes(`SimPro Quote ID: ${simproQuoteId}`)
        );

        if (notesColumn) {
          logger.info(`Found deal by SimPro ID: ${item.name} (${item.id})`);
          return item;
        }

        if (item.name.includes(`Quote #${simproQuoteId}`)) {
          logger.info(`Found deal by name pattern: ${item.name} (${item.id})`);
          return item;
        }
      }

      return null;
    } catch (error) {
      logger.error("Error finding deal by SimPro ID", {
        error,
        simproQuoteId,
        boardId,
      });
      return null;
    }
  }

  async healthCheck(): Promise<{
    simpro: { status: "up" | "down"; lastCheck: string; responseTime?: number };
    monday: { status: "up" | "down"; lastCheck: string; responseTime?: number };
  }> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    try {
      const simproTest = await this.simproApi.testConnection();
      const mondayTest = await this.mondayApi.testConnection();
      const responseTime = Date.now() - startTime;

      return {
        simpro: {
          status: simproTest.success ? "up" : "down",
          lastCheck: timestamp,
          responseTime: simproTest.success ? responseTime : undefined,
        },
        monday: {
          status: mondayTest.success ? "up" : "down",
          lastCheck: timestamp,
          responseTime: mondayTest.success ? responseTime : undefined,
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error("Health check failed", { error });

      return {
        simpro: { status: "down", lastCheck: timestamp },
        monday: { status: "down", lastCheck: timestamp },
      };
    }
  }

  public async syncSingleQuote(
    quoteId: number,
    companyId: number,
    config: { minimumQuoteValue: number }
  ): Promise<{ success: boolean; message: string }> {
    try {
      logger.info(`Processing single quote ${quoteId}`);

      const basicQuote = await this.simproQuotes.getQuoteDetails(
        companyId,
        quoteId
      );

      if (
        !basicQuote.Total?.ExTax ||
        basicQuote.Total.ExTax < config.minimumQuoteValue
      ) {
        return {
          success: false,
          message: `Quote ${quoteId} value $${
            basicQuote.Total?.ExTax || 0
          } doesn't meet minimum $${config.minimumQuoteValue}`,
        };
      }

      const validStages = ["Complete", "Approved"];
      if (!validStages.includes(basicQuote.Stage)) {
        return {
          success: false,
          message: `Quote ${quoteId} stage "${basicQuote.Stage}" is not valid (need Complete/Approved)`,
        };
      }

      const validStatuses = [
        "Quote: To Be Assigned",
        "Quote: To Be Scheduled",
        "Quote : To Be Scheduled",
        "Quote: To Write",
        "Quote: Visit Scheduled",
        "Quote : Visit Scheduled",
        "Quote: In Progress",
        "Quote : In Progress",
        "Quote: Won",
        "Quote : Won",
        "Quote: On Hold",
        "Quote : On Hold",
        "Quote: Sent",
        "Quote : Sent",
        "Quote : Sent ",
        "Quote: Due Date Reached",
        "Quote : Due Date Reached",
        "Quote: Archived - Not Won",
        "Quote : Archived - Not Won",
        "Quote: Archived - Won",
        "Quote : Archived - Won",
      ];

      const statusName = basicQuote.Status?.Name?.trim();
      if (!statusName || !validStatuses.includes(statusName)) {
        return {
          success: false,
          message: `Quote ${quoteId} status "${statusName}" is not valid for sync`,
        };
      }

      const isArchivedQuote = statusName?.includes("Archived");
      if (!isArchivedQuote && basicQuote.IsClosed === true) {
        return {
          success: false,
          message: `Quote ${quoteId} is closed and won't be synced`,
        };
      }

      logger.info(`Quote ${quoteId} passes validation, syncing to Monday`);

      const enhancedQuotes = await this.simproQuotes.enhanceQuotesWithDetails(
        [basicQuote],
        companyId
      );

      if (enhancedQuotes.length === 0) {
        throw new Error(
          `Failed to enhance quote ${quoteId} with contact details`
        );
      }

      const enhancedQuote = enhancedQuotes[0];
      const mappedData = this.mappingService.mapQuoteToMonday(enhancedQuote);

      const metrics = {
        quotesProcessed: 0,
        accountsCreated: 0,
        contactsCreated: 0,
        dealsCreated: 0,
        relationshipsLinked: 0,
        errors: 0,
      };

      await this.processMappedQuote(quoteId, mappedData, metrics);

      logger.info(`Quote ${quoteId} sync complete`);
      logger.info(
        `Summary: Accounts(${metrics.accountsCreated}), Contacts(${metrics.contactsCreated}), Deals(${metrics.dealsCreated})`
      );

      return {
        success: true,
        message: `Quote ${quoteId} successfully synced: "${mappedData.deal.dealName}"`,
      };
    } catch (error) {
      logger.error(`Failed to sync single quote ${quoteId}`, { error });
      return {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async processMappedQuote(
    quoteId: number,
    mappedData: any,
    metrics: any
  ): Promise<void> {
    logger.info(`Processing account: ${mappedData.account.accountName}`);

    const accountResult = await this.mondayApi.createAccount(
      process.env.MONDAY_ACCOUNTS_BOARD_ID!,
      mappedData.account
    );

    if (!accountResult.success || !accountResult.itemId) {
      throw new Error(`Failed to create account: ${accountResult.error}`);
    }

    const accountId = accountResult.itemId;
    if (accountResult.itemId && !accountResult.itemId.includes("existing")) {
      metrics.accountsCreated++;
    }

    const contactIds: string[] = [];
    for (const contactData of mappedData.contacts) {
      logger.info(`Processing contact: ${contactData.contactName}`);

      const contactResult = await this.mondayApi.createContact(
        process.env.MONDAY_CONTACTS_BOARD_ID!,
        contactData
      );

      if (contactResult.success && contactResult.itemId) {
        contactIds.push(contactResult.itemId);
        metrics.contactsCreated++;

        try {
          await this.linkContactToAccount(contactResult.itemId, accountId);
          metrics.relationshipsLinked++;
        } catch (linkError) {
          logger.warn(`Failed to link contact to account: ${linkError}`);
        }
      } else {
        logger.warn(`Failed to create contact: ${contactResult.error}`);
      }
    }

    logger.info(`Processing deal: ${mappedData.deal.dealName}`);

    const dealResult = await this.mondayApi.createDeal(
      process.env.MONDAY_DEALS_BOARD_ID!,
      mappedData.deal
    );

    if (!dealResult.success || !dealResult.itemId) {
      throw new Error(`Failed to create deal: ${dealResult.error}`);
    }

    const dealId = dealResult.itemId;
    metrics.dealsCreated++;

    try {
      await this.linkDealToAccount(dealId, accountId);
      metrics.relationshipsLinked++;
    } catch (linkError) {
      logger.warn(`Failed to link deal to account: ${linkError}`);
    }

    if (contactIds.length > 0) {
      try {
        await this.linkDealToContacts(dealId, contactIds);
        metrics.relationshipsLinked++;
      } catch (linkError) {
        logger.warn(`Failed to link deal to contacts: ${linkError}`);
      }
    }

    for (const contactId of contactIds) {
      try {
        await this.linkContactToDeal(contactId, dealId);
        metrics.relationshipsLinked++;
      } catch (linkError) {
        logger.warn(`Failed to link contact to deal: ${linkError}`);
      }
    }
  }

  private async linkContactToAccount(
    contactId: string,
    accountId: string
  ): Promise<void> {
    const mutation = `
      mutation ($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(
          item_id: $itemId
          board_id: $boardId
          column_id: $columnId
          value: $value
        ) {
          id
        }
      }
    `;

    await this.mondayApi.query(mutation, {
      itemId: contactId,
      boardId: process.env.MONDAY_CONTACTS_BOARD_ID!,
      columnId: "contact_account",
      value: JSON.stringify({ item_ids: [parseInt(accountId)] }),
    });
  }

  private async linkDealToAccount(
    dealId: string,
    accountId: string
  ): Promise<void> {
    const mutation = `
      mutation ($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(
          item_id: $itemId
          board_id: $boardId
          column_id: $columnId
          value: $value
        ) {
          id
        }
      }
    `;

    await this.mondayApi.query(mutation, {
      itemId: dealId,
      boardId: process.env.MONDAY_DEALS_BOARD_ID!,
      columnId: "deal_account",
      value: JSON.stringify({ item_ids: [parseInt(accountId)] }),
    });
  }

  private async linkDealToContacts(
    dealId: string,
    contactIds: string[]
  ): Promise<void> {
    const mutation = `
      mutation ($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(
          item_id: $itemId
          board_id: $boardId
          column_id: $columnId
          value: $value
        ) {
          id
        }
      }
    `;

    await this.mondayApi.query(mutation, {
      itemId: dealId,
      boardId: process.env.MONDAY_DEALS_BOARD_ID!,
      columnId: "deal_contact",
      value: JSON.stringify({
        item_ids: contactIds.map((id) => parseInt(id)),
      }),
    });
  }

  private async linkContactToDeal(
    contactId: string,
    dealId: string
  ): Promise<void> {
    const mutation = `
      mutation ($itemId: ID!, $boardId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(
          item_id: $itemId
          board_id: $boardId
          column_id: $columnId
          value: $value
        ) {
          id
        }
      }
    `;

    await this.mondayApi.query(mutation, {
      itemId: contactId,
      boardId: process.env.MONDAY_CONTACTS_BOARD_ID!,
      columnId: "contact_deal",
      value: JSON.stringify({ item_ids: [parseInt(dealId)] }),
    });
  }
}
