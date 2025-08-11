// pages/api/webhooks/monday.ts - Monday.com Webhook Handler

import { NextApiRequest, NextApiResponse } from 'next';
import { SimProClient } from '@/lib/simpro-client';
import { MondayClient } from '@/lib/monday-client';
import { SyncEngine } from '@/lib/sync-engine';
import { MondayWebhookPayload, MondayDealStage } from '@/types/monday';
import { SyncConfig } from '@/types/sync';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  console.log(`[Monday Webhook] ${req.method} request received`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload: MondayWebhookPayload = req.body;
    
    if (payload.challenge) {
      console.log('[Monday Webhook] Responding to challenge');
      return res.status(200).json({ challenge: payload.challenge });
    }

    console.log(`[Monday Webhook] Event received:`, {
      type: payload.event?.type,
      itemId: payload.event?.data?.item_id,
      boardId: payload.event?.data?.board_id,
      columnId: payload.event?.data?.column_id
    });

    if (payload.event?.type !== 'update_column_value') {
      console.log(`[Monday Webhook] Ignoring event type: ${payload.event?.type}`);
      return res.status(200).json({ 
        message: 'Event ignored - not a column update',
        eventType: payload.event?.type 
      });
    }

    const { item_id, board_id, column_id, value } = payload.event.data;

    if (board_id !== process.env.MONDAY_DEALS_BOARD_ID) {
      console.log(`[Monday Webhook] Event not from deals board - ignoring`);
      return res.status(200).json({ 
        message: 'Event ignored - not from deals board' 
      });
    }

    if (!column_id || !isStageColumn(column_id)) {
      console.log(`[Monday Webhook] Not a stage column update - ignoring`);
      return res.status(200).json({ 
        message: 'Event ignored - not a stage update' 
      });
    }

    if (!value?.value) {
      console.log(`[Monday Webhook] No value in update - ignoring`);
      return res.status(200).json({ 
        message: 'Event ignored - no value' 
      });
    }

    const simproClient = new SimProClient({
      baseUrl: process.env.SIMPRO_BASE_URL!,
      accessToken: process.env.SIMPRO_ACCESS_TOKEN!,
      companyId: parseInt(process.env.SIMPRO_COMPANY_ID || '0')
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

    await handleStageChange(syncEngine, mondayClient, item_id, value.value, board_id);

    res.status(200).json({
      success: true,
      message: `Processed stage change for item ${item_id}`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Monday Webhook] Error processing webhook:', error);
    
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}

function isStageColumn(columnId: string): boolean {
  const stageColumnIds = [
    'status', 'status0', 'status1', 'status2', 'status3', 'status4', 'status5',
    'color', 'color0', 'color1', 'color2', 'color3', 'color4', 'color5'
  ];
  
  return stageColumnIds.includes(columnId) || columnId.startsWith('status') || columnId.startsWith('color');
}

function extractStageLabel(value: any): string | null {
  try {
    if (typeof value === 'string') {
      const parsed = JSON.parse(value);
      return parsed.label || parsed.text || null;
    }
    
    if (typeof value === 'object' && value.label) {
      return value.label;
    }
    
    return null;
  } catch (error) {
    console.error('[Monday Webhook] Error parsing stage value:', error);
    return null;
  }
}

async function handleStageChange(
  syncEngine: SyncEngine,
  mondayClient: MondayClient,
  itemId: string,
  newValue: any,
  boardId: string
): Promise<void> {
  console.log(`[Monday Webhook] Processing stage change for item ${itemId}`);
  
  try {
    const newStage = extractStageLabel(newValue);
    
    if (!newStage) {
      console.log(`[Monday Webhook] Could not extract stage from value:`, newValue);
      return;
    }

    console.log(`[Monday Webhook] New stage: ${newStage}`);

    const validStages: MondayDealStage[] = [
      'Quote: To Be Assigned',
      'Quote: To Be Scheduled',
      'Quote: To Write',
      'Quote: Visit Scheduled',
      'Quote: In Progress',
      'Quote: Won',
      'Quote: On Hold',
      'Quote: Quote Due Date Reached'
    ];

    if (!validStages.includes(newStage as MondayDealStage)) {
      console.log(`[Monday Webhook] Invalid stage: ${newStage} - not syncing to SimPro`);
      return;
    }

    const quoteId = await extractSimProQuoteId(mondayClient, boardId, itemId);
    
    if (!quoteId) {
      console.log(`[Monday Webhook] Could not find SimPro quote ID for item ${itemId}`);
      return;
    }

    console.log(`[Monday Webhook] Found SimPro quote ID: ${quoteId}`);

    const result = await syncEngine.updateSimProQuoteStage(quoteId, newStage as MondayDealStage);

    if (result.success) {
      console.log(`[Monday Webhook] ✅ Updated SimPro quote ${quoteId} to stage: ${newStage}`);
    } else {
      console.error(`[Monday Webhook] ❌ Failed to update SimPro quote ${quoteId}:`, result.error);
    }
    
  } catch (error) {
    console.error(`[Monday Webhook] Failed to process stage change for item ${itemId}:`, error);
    throw error;
  }
}

async function extractSimProQuoteId(
  mondayClient: MondayClient,
  boardId: string,
  itemId: string
): Promise<number | null> {
  try {
    const query = `
      query ($itemId: ID!) {
        items(ids: [$itemId]) {
          id
          name
          column_values {
            id
            text
            value
          }
        }
      }
    `;

    const result = await (mondayClient as any).query(query, { itemId });
    
    if (!result.items || result.items.length === 0) {
      return null;
    }

    const item = result.items[0];
    
    for (const columnValue of item.column_values) {
      if (columnValue.text && columnValue.text.includes('SimPro Quote ID:')) {
        const match = columnValue.text.match(/SimPro Quote ID:\s*(\d+)/);
        if (match && match[1]) {
          return parseInt(match[1]);
        }
      }
    }

    if (item.name && item.name.includes('Quote #')) {
      const match = item.name.match(/Quote #(\d+)/);
      if (match && match[1]) {
        return parseInt(match[1]);
      }
    }

    return null;
    
  } catch (error) {
    console.error('[Monday Webhook] Error extracting SimPro quote ID:', error);
    return null;
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
}
