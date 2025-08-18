// pages/api/cron/sync-quotes.ts - Updated to use new SyncService
import { NextApiRequest, NextApiResponse } from "next";
import { SyncService } from "@/lib/services/sync-service";
import { createSimProConfig } from "@/lib/clients/simpro/simpro-config";
import { createMondayConfig } from "@/lib/clients/monday/monday-config";
import { logger } from "@/lib/utils/logger";

function verifyCronRequest(req: NextApiRequest): boolean {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (
    process.env.NODE_ENV === "development" ||
    req.headers.host?.includes("localhost")
  ) {
    logger.info("[Cron Sync] Local development - bypassing auth");
    return true;
  }

  if (cronSecret) {
    return authHeader === `Bearer ${cronSecret}`;
  }

  const userAgent = req.headers["user-agent"];
  return (
    userAgent === "vercel-cron/1.0" || (userAgent?.includes("vercel") ?? false)
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const startTime = Date.now();
  const limit = req.query.limit
    ? parseInt(req.query.limit as string)
    : undefined;

  logger.info(
    `[Cron Sync] Starting sync${limit ? ` (limited to ${limit} quotes)` : ""}`
  );

  if (!verifyCronRequest(req)) {
    logger.error("[Cron Sync] Unauthorized cron request");
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Validate environment variables
    const requiredEnvVars = [
      "SIMPRO_BASE_URL",
      "SIMPRO_ACCESS_TOKEN",
      "SIMPRO_COMPANY_ID",
      "MONDAY_API_TOKEN",
      "MONDAY_ACCOUNTS_BOARD_ID",
      "MONDAY_CONTACTS_BOARD_ID",
      "MONDAY_DEALS_BOARD_ID",
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing environment variable: ${envVar}`);
      }
    }

    // Create configurations using new structure
    const simproConfig = createSimProConfig();
    const mondayConfig = createMondayConfig(process.env.MONDAY_API_TOKEN!, {
      accounts: process.env.MONDAY_ACCOUNTS_BOARD_ID!,
      contacts: process.env.MONDAY_CONTACTS_BOARD_ID!,
      deals: process.env.MONDAY_DEALS_BOARD_ID!,
    });

    // Initialize new sync service
    const syncService = new SyncService(simproConfig, mondayConfig);

    logger.info("[Cron Sync] Running health check...");
    const healthCheck = await syncService.healthCheck();

    if (healthCheck.simpro.status === "down") {
      throw new Error("SimPro API is not responding");
    }

    if (healthCheck.monday.status === "down") {
      throw new Error("Monday.com API is not responding");
    }

    logger.info("[Cron Sync] Health check passed, starting sync...");

    // Run sync using new service
    const syncResult = await (syncService as any).syncSimProToMonday(
      {
        minimumQuoteValue: 15000,
        boardIds: mondayConfig.boardIds,
      },
      limit
    );

    const executionTime = Date.now() - startTime;

    logger.syncMetrics("Cron Sync", {
      duration: executionTime,
      itemsProcessed: syncResult.metrics.quotesProcessed,
      errors: syncResult.metrics.errors,
      success: syncResult.success,
    });

    res.status(200).json({
      success: true,
      message: `${
        limit ? "Test sync" : "Scheduled sync"
      } completed successfully`,
      executionTime: `${executionTime}ms`,
      syncResult: {
        success: syncResult.success,
        message: syncResult.message,
        metrics: syncResult.metrics,
        timestamp: syncResult.timestamp,
        errorCount: syncResult.errors?.length || 0,
        limitApplied: limit || "No limit",
      },
      healthCheck: {
        simpro: healthCheck.simpro,
        monday: healthCheck.monday,
      },
      nextRun: "Based on cron schedule",
      architecture: "new-simplified-structure",
    });
  } catch (error) {
    const executionTime = Date.now() - startTime;

    logger.error(`[Cron Sync] Failed after ${executionTime}ms`, { error });

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      executionTime: `${executionTime}ms`,
      timestamp: new Date().toISOString(),
      nextRun: "Will retry on next scheduled run",
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
    externalResolver: true,
  },
  maxDuration: 30,
};
