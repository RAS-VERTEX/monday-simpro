// pages/api/webhooks/simpro.ts - Updated to use new WebhookService
import { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { SyncService } from "@/lib/services/sync-service";
import { WebhookService } from "@/lib/services/webhook-service";
import { createSimProConfig } from "@/lib/clients/simpro/simpro-config";
import { createMondayConfig } from "@/lib/clients/monday/monday-config";
import { SimProWebhookPayload } from "@/types/simpro";

function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac("sha1", secret)
    .update(body)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  console.log(`[SimPro Webhook] ${req.method} request received`);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers["x-response-signature"] as string;
    const webhookSecret = process.env.SIMPRO_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("[SimPro Webhook] SIMPRO_WEBHOOK_SECRET not configured");
      return res.status(500).json({ error: "Webhook secret not configured" });
    }

    if (!signature) {
      console.error("[SimPro Webhook] Missing signature header");
      return res.status(401).json({ error: "Missing signature" });
    }

    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      console.error("[SimPro Webhook] Invalid signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    const payload: SimProWebhookPayload = req.body;
    console.log(`[SimPro Webhook] Verified payload:`, {
      id: payload.ID,
      action: payload.action,
      quoteId: payload.reference?.quoteID,
      companyId: payload.reference?.companyID,
    });

    // Initialize services using new structure
    const simproConfig = createSimProConfig();
    const mondayConfig = createMondayConfig(process.env.MONDAY_API_TOKEN!, {
      accounts: process.env.MONDAY_ACCOUNTS_BOARD_ID!,
      contacts: process.env.MONDAY_CONTACTS_BOARD_ID!,
      deals: process.env.MONDAY_DEALS_BOARD_ID!,
    });

    const syncService = new SyncService(simproConfig, mondayConfig);
    const webhookService = new WebhookService(syncService);

    // Process webhook using new service
    const result = await webhookService.processSimProWebhook(payload);

    console.log(`[SimPro Webhook] ✅ Webhook processed:`, result);

    res.status(200).json({
      success: result.success,
      message: result.message,
      timestamp: new Date().toISOString(),
      eventType: payload.ID,
      quoteId: payload.reference?.quoteID,
      newStructure: true, // Flag to indicate this uses the new architecture
    });
  } catch (error) {
    console.error("[SimPro Webhook] Error processing webhook:", error);

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
