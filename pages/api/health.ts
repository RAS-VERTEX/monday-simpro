// pages/api/health.ts - Public health check endpoint using new structure
import { NextApiRequest, NextApiResponse } from "next";
import { SyncService } from "@/lib/services/sync-service";
import { createSimProConfig } from "@/lib/clients/simpro/simpro-config";
import { createMondayConfig } from "@/lib/clients/monday/monday-config";
import { logger } from "@/lib/utils/logger";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const startTime = Date.now();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    logger.info("[Health] Public health check requested");

    const healthStatus = {
      status: "healthy" as "healthy" | "degraded" | "unhealthy",
      timestamp: new Date().toISOString(),
      version: "2.0.0",
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
        timestamp: "Not available via public endpoint",
        status: "unknown" as "success" | "failed" | "unknown",
        quotesProcessed: 0,
      },
    };

    // Check environment configuration
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

    // Only test connections if we have proper configuration
    if (
      envCheck.hasSimproConfig &&
      envCheck.hasMondayConfig &&
      envCheck.hasBoardIds
    ) {
      try {
        const simproConfig = createSimProConfig();
        const mondayConfig = createMondayConfig(process.env.MONDAY_API_TOKEN!, {
          accounts: process.env.MONDAY_ACCOUNTS_BOARD_ID!,
          contacts: process.env.MONDAY_CONTACTS_BOARD_ID!,
          deals: process.env.MONDAY_DEALS_BOARD_ID!,
        });

        const syncService = new SyncService(simproConfig, mondayConfig);
        const serviceHealthCheck = await syncService.healthCheck();

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
      } catch (connectionError) {
        logger.error("[Health] Connection test failed", {
          error: connectionError,
        });
        healthStatus.status = "unhealthy";
        healthStatus.services.simpro.status = "down";
        healthStatus.services.monday.status = "down";
      }
    } else {
      logger.warn("[Health] Missing environment configuration");
      healthStatus.status = "unhealthy";
    }

    const executionTime = Date.now() - startTime;

    logger.info(
      `[Health] Public health check completed in ${executionTime}ms - Status: ${healthStatus.status}`
    );

    res.status(healthStatus.status === "unhealthy" ? 503 : 200).json({
      ...healthStatus,
      executionTime: `${executionTime}ms`,
      configurationStatus: {
        simproConfigured: envCheck.hasSimproConfig,
        mondayConfigured: envCheck.hasMondayConfig,
        boardsConfigured: envCheck.hasBoardIds,
        webhooksConfigured: envCheck.hasWebhookSecrets,
      },
      features: {
        syncDirection: "one-way (SimPro → Monday)",
        stageMapping: "simplified (Sent → Proposal Sent, others → Discovery)",
        architecture: "clean modular components",
        logging: "structured with context",
      },
      endpoints: {
        testSync: "/api/test-new-sync",
        cronSync: "/api/cron/sync-quotes",
        simproWebhook: "/api/webhooks/simpro",
        mondayWebhook: "/api/webhooks/monday (simplified)",
      },
    });
  } catch (error) {
    const executionTime = Date.now() - startTime;

    logger.error(
      `[Health] Public health check failed after ${executionTime}ms`,
      { error }
    );

    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      version: "2.0.0",
      architecture: "simplified-one-way-sync",
      error: error instanceof Error ? error.message : "Unknown error",
      executionTime: `${executionTime}ms`,
      message: "Health check failed - see server logs for details",
    });
  }
}
