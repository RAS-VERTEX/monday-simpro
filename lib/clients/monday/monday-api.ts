// lib/clients/monday/monday-api.ts - Core GraphQL API wrapper
import { MondayApiResponse } from "@/types/monday";
import { logger } from "@/lib/utils/logger";

export class MondayApi {
  private apiToken: string;
  private baseUrl = "https://api.monday.com/v2";

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  async query<T = any>(query: string, variables?: any): Promise<T> {
    logger.debug("[Monday API] Executing query", {
      query: query.substring(0, 100) + "...",
      variables,
    });

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: MondayApiResponse<T> = await response.json();

      if (data.errors && data.errors.length > 0) {
        throw new Error(`Monday GraphQL error: ${data.errors[0].message}`);
      }

      logger.debug("[Monday API] Query successful");
      return data.data;
    } catch (error) {
      logger.error("[Monday API] Query failed", { error, query, variables });
      throw error;
    }
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const query = `
        query {
          me {
            id
            name
          }
        }
      `;

      const result = await this.query(query);
      logger.info(
        `[Monday API] ✅ Connection test successful. User: ${result.me.name}`
      );
      return { success: true };
    } catch (error) {
      logger.error(`[Monday API] ❌ Connection test failed`, { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
