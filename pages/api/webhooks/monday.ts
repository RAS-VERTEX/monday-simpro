// pages/api/webhooks/monday.ts - Simplified for one-way sync only
import { NextApiRequest, NextApiResponse } from "next";
import { logger } from "@/lib/utils/logger";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  logger.info(`[Monday Webhook] ${req.method} request received`);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const payload = req.body;

    // Handle Monday's challenge verification
    if (payload.challenge) {
      logger.info("[Monday Webhook] Responding to challenge");
      return res.status(200).json({ challenge: payload.challenge });
    }

    logger.info(`[Monday Webhook] Event received:`, {
      type: payload.event?.type,
      itemId: payload.event?.data?.item_id,
      boardId: payload.event?.data?.board_id,
    });

    // Since we've simplified to one-way sync (SimPro → Monday only),
    // we don't need to process Monday webhook events back to SimPro

    logger.info(
      "[Monday Webhook] ✅ Event acknowledged but not processed (one-way sync only)"
    );

    res.status(200).json({
      success: true,
      message: "Event acknowledged - one-way sync only (SimPro → Monday)",
      timestamp: new Date().toISOString(),
      eventType: payload.event?.type,
      syncDirection: "one-way (SimPro → Monday only)",
      note: "Monday events are not synced back to SimPro in simplified architecture",
    });
  } catch (error) {
    logger.error("[Monday Webhook] Error processing webhook", { error });

    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};
