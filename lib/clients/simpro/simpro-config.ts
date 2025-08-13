// lib/clients/simpro/simpro-config.ts - Configuration and utilities
export interface SimProConfig {
  baseUrl: string;
  accessToken: string;
  companyId: number;
}

export function createSimProConfig(): SimProConfig {
  const baseUrl = process.env.SIMPRO_BASE_URL;
  const accessToken = process.env.SIMPRO_ACCESS_TOKEN;
  const companyId = process.env.SIMPRO_COMPANY_ID;

  if (!baseUrl) {
    throw new Error("SIMPRO_BASE_URL environment variable is required");
  }

  if (!accessToken) {
    throw new Error("SIMPRO_ACCESS_TOKEN environment variable is required");
  }

  if (!companyId) {
    throw new Error("SIMPRO_COMPANY_ID environment variable is required");
  }

  return {
    baseUrl,
    accessToken,
    companyId: parseInt(companyId),
  };
}

export function validateSimProConfig(config: SimProConfig): void {
  if (!config.baseUrl) {
    throw new Error("SimPro baseUrl is required");
  }

  if (!config.accessToken) {
    throw new Error("SimPro accessToken is required");
  }

  if (!config.companyId || config.companyId <= 0) {
    throw new Error("SimPro companyId must be a positive number");
  }
}
