// pages/api/test-new-sync.ts - Test the new clean structure
import { NextApiRequest, NextApiResponse } from "next";
import { SyncService } from "@/lib/services/sync-service";
import { createSimProConfig } from "@/lib/clients/simpro/simpro-config";
import { createMondayConfig } from "@/lib/clients/monday/monday-config";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const startTime = Date.now();
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 5; // Default to 5 for testing

  try {
    console.log(
      `🧪 [Test New Sync] Starting test with new structure (limit: ${limit})`
    );

    // Create configurations using new structure
    const simproConfig = createSimProConfig();
    const mondayConfig = createMondayConfig(process.env.MONDAY_API_TOKEN!, {
      accounts: process.env.MONDAY_ACCOUNTS_BOARD_ID!,
      contacts: process.env.MONDAY_CONTACTS_BOARD_ID!,
      deals: process.env.MONDAY_DEALS_BOARD_ID!,
    });

    // Initialize the new sync service
    const syncService = new SyncService(simproConfig, mondayConfig);

    // Test health check first
    console.log("🔍 [Test New Sync] Running health check...");
    const healthCheck = await syncService.healthCheck();

    if (healthCheck.simpro.status === "down") {
      throw new Error("SimPro API is not responding");
    }

    if (healthCheck.monday.status === "down") {
      throw new Error("Monday.com API is not responding");
    }

    console.log("✅ [Test New Sync] Health check passed, starting sync...");

    // Run the sync with the new service
    const syncResult = await syncService.syncSimProToMonday(
      {
        minimumQuoteValue: 15000,
        boardIds: mondayConfig.boardIds,
      },
      limit
    );

    const executionTime = Date.now() - startTime;

    console.log(`✅ [Test New Sync] Completed in ${executionTime}ms:`, {
      success: syncResult.success,
      quotesProcessed: syncResult.metrics.quotesProcessed,
      accountsCreated: syncResult.metrics.accountsCreated,
      contactsCreated: syncResult.metrics.contactsCreated,
      dealsCreated: syncResult.metrics.dealsCreated,
      errors: syncResult.metrics.errors,
    });

    res.status(200).json({
      success: true,
      message: `✨ NEW STRUCTURE TEST: ${
        syncResult.success ? "SUCCESS" : "COMPLETED WITH ERRORS"
      }`,
      executionTime: `${executionTime}ms`,
      syncResult: {
        success: syncResult.success,
        message: syncResult.message,
        metrics: syncResult.metrics,
        timestamp: syncResult.timestamp,
        errorCount: syncResult.errors?.length || 0,
        limitApplied: limit,
      },
      healthCheck: {
        simpro: healthCheck.simpro,
        monday: healthCheck.monday,
      },
      newStructure: {
        message: "This endpoint uses the new clean architecture!",
        benefits: [
          "Simplified business logic",
          "One-way sync only",
          "Clean separation of concerns",
          "Better error handling",
          "Easier to maintain",
        ],
      },
    });
  } catch (error) {
    const executionTime = Date.now() - startTime;

    console.error(`❌ [Test New Sync] Failed after ${executionTime}ms:`, error);

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      executionTime: `${executionTime}ms`,
      timestamp: new Date().toISOString(),
      message: "Test failed - check server logs for details",
    });
  }
}
