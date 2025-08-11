// pages/api/webhooks/simpro.ts - SimPro Webhook Handler

import { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import { SimProClient } from '@/lib/simpro-client';
import { MondayClient } from '@/lib/monday-client';
import { SyncEngine } from '@/lib/sync-engine';
import { SimProWebhookPayload } from '@/types/simpro';
import { SyncConfig } from '@/types/sync';

function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
  const expectedSignature = crypto
    .createHmac('sha1', secret)
    .update(body)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log(`[SimPro Webhook] ${req.method} request received`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody = JSON.stringify(req.body);
    const signature = req.headers['x-response-signature'] as string;
    const webhookSecret = process.env.SIMPRO_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[SimPro Webhook] SIMPRO_WEBHOOK_SECRET not configured');
      return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    if (!signature) {
      console.error('[SimPro Webhook] Missing signature header');
      return res.status(401).json({ error: 'Missing signature' });
    }

    if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
      console.error('[SimPro Webhook] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const payload: SimProWebhookPayload = req.body;
    console.log(`[SimPro Webhook] Verified payload:`, {
      id: payload.ID,
      action: payload.action,
      quoteId: payload.reference?.quoteID,
      companyId: payload.reference?.companyID
    });

    if (!payload.ID.startsWith('quote.')) {
      console.log(`[SimPro Webhook] Ignoring non-quote event: ${payload.ID}`);
      return res.status(200).json({ 
        message: 'Event ignored - not a quote event',
        eventType: payload.ID 
      });
    }

    const quoteId = payload.reference?.quoteID;
    const companyId = payload.reference?.companyID;

    if (!quoteId || companyId === undefined) {
      console.error('[SimPro Webhook] Missing quote ID or company ID in payload');
      return res.status(400).json({ error: 'Missing quote or company ID' });
    }

    const simproClient = new SimProClient({
      baseUrl: process.env.SIMPRO_BASE_URL!,
      accessToken: process.env.SIMPRO_ACCESS_TOKEN!,
      companyId: companyId
    });

    const mondayClient = new MondayClient({
      apiToken: process.env.MONDAY_API_TOKEN!
    });

    const syncConfig: SyncConfig = {
      minimumQuoteValue: 15000,
      boardIds: {
        accounts: process.env.MONDAY_ACCOUNTS_BOARD_ID!,
        contacts: process.env.MONDAY_CONTACTS_BOARD_ID!,
        deals: process.env.MONDAY_DEALS_BOARD_ID!
      },
      enabledEvents: {
        simproToMonday: true,
        mondayToSimpro: true
      }
    };

    const syncEngine = new SyncEngine(simproClient, mondayClient, syncConfig);

    switch (payload.ID) {
      case 'quote.created':
        await handleQuoteCreated(syncEngine, quoteId, companyId);
        break;
        
      case 'quote.status':
      case 'quote.updated':
        await handleQuoteUpdated(syncEngine, quoteId, companyId);
        break;
        
      case 'quote.deleted':
        console.log(`[SimPro Webhook] Quote ${quoteId} deleted in SimPro - not deleting from Monday`);
        break;
        
      default:
        console.log(`[SimPro Webhook] Unhandled quote event: ${payload.ID}`);
    }

    res.status(200).json({
      success: true,
      message: `Processed ${payload.ID} for quote ${quoteId}`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[SimPro Webhook] Error processing webhook:', error);
    
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}

async function handleQuoteCreated(
  syncEngine: SyncEngine,
  quoteId: number,
  companyId: number
): Promise<void> {
  console.log(`[SimPro Webhook] Processing quote.created for quote ${quoteId}`);
  
  try {
    const simproClient = new SimProClient({
      baseUrl: process.env.SIMPRO_BASE_URL!,
      accessToken: process.env.SIMPRO_ACCESS_TOKEN!,
      companyId: companyId
    });
    
    const quote = await simproClient.getQuoteDetails(companyId, quoteId);
    
    if (!quote.Total?.ExTax || quote.Total.ExTax < 15000) {
      console.log(`[SimPro Webhook] Quote ${quoteId} value $${quote.Total?.ExTax || 0} below minimum - skipping`);
      return;
    }
    
    if (quote.IsClosed) {
      console.log(`[SimPro Webhook] Quote ${quoteId} is closed - skipping`);
      return;
    }
    
    console.log(`[SimPro Webhook] Quote ${quoteId} meets criteria - creating in Monday`);
    
    const mondayClient = new MondayClient({
      apiToken: process.env.MONDAY_API_TOKEN!
    });
    
    const mapping = (syncEngine as any).mapQuoteToMonday(quote);
    const result = await (syncEngine as any).syncQuoteToMonday(mapping);
    
    console.log(`[SimPro Webhook] ✅ Quote ${quoteId} synced to Monday:`, result);
    
  } catch (error) {
    console.error(`[SimPro Webhook] Failed to process quote.created for ${quoteId}:`, error);
    throw error;
  }
}

async function handleQuoteUpdated(
  syncEngine: SyncEngine,
  quoteId: number,
  companyId: number
): Promise<void> {
  console.log(`[SimPro Webhook] Processing quote update for quote ${quoteId}`);
  
  try {
    const simproClient = new SimProClient({
      baseUrl: process.env.SIMPRO_BASE_URL!,
      accessToken: process.env.SIMPRO_ACCESS_TOKEN!,
      companyId: companyId
    });
    
    const quote = await simproClient.getQuoteDetails(companyId, quoteId);
    
    const result = await syncEngine.updateMondayDealStage(quoteId, quote.Stage);
    
    if (result.success) {
      console.log(`[SimPro Webhook] ✅ Updated Monday deal stage for quote ${quoteId} to: ${quote.Stage}`);
    } else {
      console.log(`[SimPro Webhook] ⚠️  Monday deal update result:`, result);
    }
    
  } catch (error) {
    console.error(`[SimPro Webhook] Failed to process quote update for ${quoteId}:`, error);
    throw error;
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
}
