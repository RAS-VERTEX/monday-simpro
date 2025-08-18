// lib/clients/monday/monday-api.ts - Fixed return type issues

import { MondayApiResponse } from "@/types/monday";
import { logger } from "@/lib/utils/logger";

interface RateLimitError {
  error_code: string;
  error_data?: {
    retry_in_seconds?: number;
  };
}

export class MondayApi {
  private apiToken: string;
  private baseUrl = "https://api.monday.com/v2";

  // Rate limiting properties
  private isRateLimited = false;
  private rateLimitResetTime = 0;

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  // ✅ FIXED: Proper return type handling
  async query<T = any>(query: string, variables?: any): Promise<T> {
    // Check if we're still rate limited
    if (this.isRateLimited && Date.now() < this.rateLimitResetTime) {
      const waitTime = Math.ceil((this.rateLimitResetTime - Date.now()) / 1000);
      logger.warn(
        `[Monday API] ⏰ Still rate limited, waiting ${waitTime}s before retry`
      );
      await this.sleep(waitTime * 1000);
    }

    try {
      const result = await this.makeRequest<T>(query, variables);

      // Reset rate limit flag on success
      this.isRateLimited = false;
      this.rateLimitResetTime = 0;

      return result;
    } catch (error: any) {
      // Handle rate limit errors specifically
      if (this.isRateLimitError(error)) {
        return await this.handleRateLimit(error, query, variables);
      }

      throw error; // Re-throw non-rate-limit errors
    }
  }

  // ✅ FIXED: Explicit return type and proper null handling
  private async makeRequest<T>(query: string, variables?: any): Promise<T> {
    logger.debug("[Monday API] Executing query", {
      query: query.substring(0, 100) + "...",
      variables,
    });

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(
        `Monday.com API error ${response.status}: ${response.statusText}`
      );
    }

    const data: MondayApiResponse<T> = await response.json();

    if (data.errors && data.errors.length > 0) {
      const errorMessage = data.errors[0].message;

      // Check for rate limit in GraphQL errors
      if (
        errorMessage.includes("429") ||
        errorMessage.includes("Too Many Requests") ||
        errorMessage.includes("Complexity budget exhausted")
      ) {
        const error = new Error(`Monday.com GraphQL errors: ${errorMessage}`);
        (error as any).isRateLimit = true;
        throw error;
      }

      throw new Error(`Monday.com GraphQL errors: ${errorMessage}`);
    }

    logger.debug("[Monday API] Query completed successfully");

    // ✅ FIXED: Proper null checking and type assertion
    if (data.data === undefined || data.data === null) {
      throw new Error("Monday API returned no data");
    }

    return data.data;
  }

  private isRateLimitError(error: any): boolean {
    return (
      error?.message?.includes("429") ||
      error?.message?.includes("Too Many Requests") ||
      error?.message?.includes("Complexity budget exhausted") ||
      error?.isRateLimit === true
    );
  }

  private async handleRateLimit(
    error: any,
    query: string,
    variables: any
  ): Promise<any> {
    logger.warn(
      `[Monday API] 🚦 Rate limit hit, implementing backoff strategy`
    );

    // Extract retry time from error message
    let retryInSeconds = 30; // Default fallback

    try {
      // Parse Monday's error format: "reset in 28 seconds"
      const resetMatch = error.message.match(/reset in (\d+) seconds/);
      if (resetMatch) {
        retryInSeconds = parseInt(resetMatch[1], 10);
      } else {
        // Try to parse JSON error data
        const jsonMatch = error.message.match(/\{.*\}/);
        if (jsonMatch) {
          const errorData = JSON.parse(jsonMatch[0]);
          retryInSeconds = errorData.error_data?.retry_in_seconds || 30;
        }
      }
    } catch (parseError) {
      logger.warn(`[Monday API] Could not parse retry time, using default 30s`);
    }

    // Set rate limit flags
    this.isRateLimited = true;
    this.rateLimitResetTime = Date.now() + retryInSeconds * 1000;

    logger.info(`[Monday API] ⏳ Waiting ${retryInSeconds}s before retry...`);
    await this.sleep(retryInSeconds * 1000);

    // Retry the request
    try {
      const result = await this.makeRequest(query, variables);
      this.isRateLimited = false;
      this.rateLimitResetTime = 0;
      logger.info(`[Monday API] ✅ Retry successful after rate limit`);
      return result;
    } catch (retryError) {
      logger.error(`[Monday API] ❌ Retry failed after rate limit wait`, {
        retryError,
      });
      throw retryError;
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
