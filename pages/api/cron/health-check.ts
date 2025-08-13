// pages/api/cron/health-check.ts - Updated to use new structure
import { NextApiRequest, NextApiResponse } from "next";
import { SyncService } from "@/lib/services/sync-service";
import { createSimProConfig } from "@/lib/clients/simpro/simpro-config";
import { createMondayConfig } from "@/lib/clients/monday/monday-config";
import { logger } from "@/lib/utils/logger";

function verifyCronRequest(req: NextApiRequest): boolean {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

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

  logger.info(`[Health Check] Starting health check`);

  if (!verifyCronRequest(req)) {
    logger.error("[Health Check] Unauthorized cron request");
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    // Build health status object
    const healthStatus = {
      status: "healthy" as "healthy" | "degraded" | "unhealthy",
      timestamp: new Date().toISOString(),
      version: "2.0.0", // Updated version for new architecture
      architecture: "simplified-one-way-sync",
      services: {
        simpro: {
          status: "down" as "up" | "down",
          lastCheck: new Date().toISOString(),
          responseTime: undefined as number | undefined,
        },
        monday: {
          status: "down" as "up" | "down",
          lastCheck: new Date().toISOString(),
          responseTime: undefined as number | undefined,
        },
      },
      lastSync: {
        timestamp: "Not available via this endpoint",
        status: "unknown" as "success" | "failed" | "unknown",
        quotesProcessed: 0,
      },
    };

    // Check if we have the required environment variables
    const envCheck = {
      hasSimproConfig: !!(
        process.env.SIMPRO_BASE_URL && process.env.SIMPRO_ACCESS_TOKEN
      ),
      hasMondayConfig: !!process.env.MONDAY_API_TOKEN,
      hasBoardIds: !!(
        process.env.MONDAY_ACCOUNTS_BOARD_ID &&
        process.env.MONDAY_CONTACTS_BOARD_ID &&
        process.env.MONDAY_DEALS_BOARD_ID
      ),
      hasWebhookSecrets: !!process.env.SIMPRO_WEBHOOK_SECRET,
    };

    if (
      !envCheck.hasSimproConfig ||
      !envCheck.hasMondayConfig ||
      !envCheck.hasBoardIds
    ) {
      throw new Error("Missing required environment variables");
    }

    // Create configurations and test connections
    const simproConfig = createSimProConfig();
    const mondayConfig = createMondayConfig(process.env.MONDAY_API_TOKEN!, {
      accounts: process.env.MONDAY_ACCOUNTS_BOARD_ID!,
      contacts: process.env.MONDAY_CONTACTS_BOARD_ID!,
      deals: process.env.MONDAY_DEALS_BOARD_ID!,
    });

    const syncService = new SyncService(simproConfig, mondayConfig);
    const serviceHealthCheck = await syncService.healthCheck();

    // Update health status based on service checks
    healthStatus.services.simpro = serviceHealthCheck.simpro;
    healthStatus.services.monday = serviceHealthCheck.monday;

    // Determine overall health
    if (
      serviceHealthCheck.simpro.status === "up" &&
      serviceHealthCheck.monday.status === "up"
    ) {
      healthStatus.status = "healthy";
    } else if (
      serviceHealthCheck.simpro.status === "up" ||
      serviceHealthCheck.monday.status === "up"
    ) {
      healthStatus.status = "degraded";
    } else {
      healthStatus.status = "unhealthy";
    }

    const executionTime = Date.now() - startTime;

    logger.info(
      `[Health Check] Completed in ${executionTime}ms - Status: ${healthStatus.status}`
    );

    res.status(healthStatus.status === "unhealthy" ? 503 : 200).json({
      ...healthStatus,
      executionTime: `${executionTime}ms`,
      environmentCheck: envCheck,
      improvements: [
        "Simplified one-way sync architecture",
        "Clean separation of concerns",
        "Better error handling and logging",
        "Focused components for easier maintenance",
      ],
    });
  } catch (error) {
    const executionTime = Date.now() - startTime;

    logger.error(`[Health Check] Failed after ${executionTime}ms`, { error });

    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      version: "2.0.0",
      architecture: "simplified-one-way-sync",
      error: error instanceof Error ? error.message : "Unknown error",
      executionTime: `${executionTime}ms`,
      services: {
        simpro: { status: "unknown", lastCheck: new Date().toISOString() },
        monday: { status: "unknown", lastCheck: new Date().toISOString() },
      },
    });
  }
}
