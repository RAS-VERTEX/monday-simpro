// lib/clients/simpro/simpro-api.ts - FIXED with proper Bearer token
import { logger } from "@/lib/utils/logger";

export class SimProApi {
  private baseUrl: string;
  private accessToken: string;
  private companyId: number;

  constructor(config: {
    baseUrl: string;
    accessToken: string;
    companyId: number;
  }) {
    this.baseUrl = this.normalizeUrl(config.baseUrl);
    this.accessToken = config.accessToken;
    this.companyId = config.companyId;
  }

  private normalizeUrl(url: string): string {
    url = url.replace(/\/+$/, "");
    if (url.includes(".simprosuite.com")) {
      return url;
    }
    return url;
  }

  async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v1.0${endpoint}`;
    const startTime = Date.now();

    logger.debug(`[SimPro API] ${options.method || "GET"} ${endpoint}`);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          // ✅ FIXED: Ensure Bearer prefix is always included
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...options.headers,
        },
      });

      const duration = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        logger.apiCall("SimPro", endpoint, duration, false);

        if (response.status === 401) {
          throw new Error(
            "SimPro authentication failed - Bearer token may be invalid or expired"
          );
        }
        throw new Error(
          `SimPro API error ${response.status}: ${response.statusText}. ${errorText}`
        );
      }

      const data = await response.json();
      logger.apiCall("SimPro", endpoint, duration, true);
      return data;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.apiCall("SimPro", endpoint, duration, false);
      logger.error(`[SimPro API] Error on ${endpoint}`, { error });
      throw error;
    }
  }

  async testConnection(): Promise<{
    success: boolean;
    message: string;
    companies?: any[];
  }> {
    try {
      const companies = await this.request<any[]>("/companies/");

      if (companies && companies.length > 0) {
        logger.info(
          `[SimPro API] ✅ Connection successful. Found ${companies.length} companies`
        );
        return {
          success: true,
          message: `Connected to SimPro. Found ${companies.length} companies.`,
          companies,
        };
      } else {
        logger.warn("[SimPro API] ⚠️ Connected but no companies found");
        return {
          success: false,
          message: "Connected to SimPro but no companies found",
        };
      }
    } catch (error) {
      logger.error("[SimPro API] ❌ Connection test failed", { error });
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Unknown connection error",
      };
    }
  }

  getCompanyId(): number {
    return this.companyId;
  }
}
