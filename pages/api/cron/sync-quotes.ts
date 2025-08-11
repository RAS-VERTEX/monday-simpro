// pages/api/cron/sync-quotes.ts - With Local Testing Support

import { NextApiRequest, NextApiResponse } from 'next';
import { SimProClient } from '@/lib/simpro-client';
import { MondayClient } from '@/lib/monday-client';
import { SyncEngine } from '@/lib/sync-engine';
import { SyncConfig } from '@/types/sync';

function verifyCronRequest(req: NextApiRequest): boolean {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  
  // Allow local testing without auth
  if (process.env.NODE_ENV === 'development' || req.headers.host?.includes('localhost')) {
    console.log('[Cron Sync] Local development - bypassing auth');
    return true;
  }
  
  if (cronSecret) {
    return authHeader === `Bearer ${cronSecret}`;
  }
  
  const userAgent = req.headers['user-agent'];
  return userAgent === 'vercel-cron/1.0' || (userAgent?.includes('vercel') ?? false);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const startTime = Date.now();
  
  const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
  
  console.log(`[Cron Sync] Starting sync${limit ? ` (limited to ${limit} quotes)` : ''} at ${new Date().toISOString()}`);

  if (!verifyCronRequest(req)) {
    console.error('[Cron Sync] Unauthorized cron request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const requiredEnvVars = [
      'SIMPRO_BASE_URL',
      'SIMPRO_ACCESS_TOKEN', 
      'SIMPRO_COMPANY_ID',
      'MONDAY_API_TOKEN',
      'MONDAY_ACCOUNTS_BOARD_ID',
      'MONDAY_CONTACTS_BOARD_ID',
      'MONDAY_DEALS_BOARD_ID'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing environment variable: ${envVar}`);
      }
    }

    const simproClient = new SimProClient({
      baseUrl: process.env.SIMPRO_BASE_URL!,
      accessToken: process.env.SIMPRO_ACCESS_TOKEN!,
      companyId: parseInt(process.env.SIMPRO_COMPANY_ID!)
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

    console.log('[Cron Sync] Running health check...');
    const healthCheck = await syncEngine.healthCheck();
    
    if (healthCheck.simpro.status === 'down') {
      throw new Error('SimPro API is not responding');
    }
    
    if (healthCheck.monday.status === 'down') {
      throw new Error('Monday.com API is not responding');
    }

    console.log('[Cron Sync] Health check passed, starting sync...');

    const syncResult = await syncEngine.syncSimProToMonday(limit);
    
    const executionTime = Date.now() - startTime;
    
    console.log(`[Cron Sync] Completed in ${executionTime}ms:`, {
      success: syncResult.success,
      quotesProcessed: syncResult.metrics.quotesProcessed,
      accountsCreated: syncResult.metrics.accountsCreated,
      contactsCreated: syncResult.metrics.contactsCreated,
      dealsCreated: syncResult.metrics.dealsCreated,
      errors: syncResult.metrics.errors
    });

    res.status(200).json({
      success: true,
      message: `${limit ? 'Test sync' : 'Backup sync'} completed successfully`,
      executionTime: `${executionTime}ms`,
      syncResult: {
        success: syncResult.success,
        message: syncResult.message,
        metrics: syncResult.metrics,
        timestamp: syncResult.timestamp,
        errorCount: syncResult.errors?.length || 0,
        limitApplied: limit || 'No limit'
      },
      healthCheck: {
        simpro: healthCheck.simpro,
        monday: healthCheck.monday
      },
      nextRun: 'In 10 minutes'
    });

  } catch (error) {
    const executionTime = Date.now() - startTime;
    
    console.error(`[Cron Sync] Failed after ${executionTime}ms:`, error);
    
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTime: `${executionTime}ms`,
      timestamp: new Date().toISOString(),
      nextRun: 'In 10 minutes (will retry)'
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
    externalResolver: true,
  },
  maxDuration: 30,
}
EOFcat > pages/api/cron/sync-quotes.ts << 'EOF'
// pages/api/cron/sync-quotes.ts - With Local Testing Support

import { NextApiRequest, NextApiResponse } from 'next';
import { SimProClient } from '@/lib/simpro-client';
import { MondayClient } from '@/lib/monday-client';
import { SyncEngine } from '@/lib/sync-engine';
import { SyncConfig } from '@/types/sync';

function verifyCronRequest(req: NextApiRequest): boolean {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  
  // Allow local testing without auth
  if (process.env.NODE_ENV === 'development' || req.headers.host?.includes('localhost')) {
    console.log('[Cron Sync] Local development - bypassing auth');
    return true;
  }
  
  if (cronSecret) {
    return authHeader === `Bearer ${cronSecret}`;
  }
  
  const userAgent = req.headers['user-agent'];
  return userAgent === 'vercel-cron/1.0' || (userAgent?.includes('vercel') ?? false);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const startTime = Date.now();
  
  const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
  
  console.log(`[Cron Sync] Starting sync${limit ? ` (limited to ${limit} quotes)` : ''} at ${new Date().toISOString()}`);

  if (!verifyCronRequest(req)) {
    console.error('[Cron Sync] Unauthorized cron request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const requiredEnvVars = [
      'SIMPRO_BASE_URL',
      'SIMPRO_ACCESS_TOKEN', 
      'SIMPRO_COMPANY_ID',
      'MONDAY_API_TOKEN',
      'MONDAY_ACCOUNTS_BOARD_ID',
      'MONDAY_CONTACTS_BOARD_ID',
      'MONDAY_DEALS_BOARD_ID'
    ];

    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        throw new Error(`Missing environment variable: ${envVar}`);
      }
    }

    const simproClient = new SimProClient({
      baseUrl: process.env.SIMPRO_BASE_URL!,
      accessToken: process.env.SIMPRO_ACCESS_TOKEN!,
      companyId: parseInt(process.env.SIMPRO_COMPANY_ID!)
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

    console.log('[Cron Sync] Running health check...');
    const healthCheck = await syncEngine.healthCheck();
    
    if (healthCheck.simpro.status === 'down') {
      throw new Error('SimPro API is not responding');
    }
    
    if (healthCheck.monday.status === 'down') {
      throw new Error('Monday.com API is not responding');
    }

    console.log('[Cron Sync] Health check passed, starting sync...');

    const syncResult = await syncEngine.syncSimProToMonday(limit);
    
    const executionTime = Date.now() - startTime;
    
    console.log(`[Cron Sync] Completed in ${executionTime}ms:`, {
      success: syncResult.success,
      quotesProcessed: syncResult.metrics.quotesProcessed,
      accountsCreated: syncResult.metrics.accountsCreated,
      contactsCreated: syncResult.metrics.contactsCreated,
      dealsCreated: syncResult.metrics.dealsCreated,
      errors: syncResult.metrics.errors
    });

    res.status(200).json({
      success: true,
      message: `${limit ? 'Test sync' : 'Backup sync'} completed successfully`,
      executionTime: `${executionTime}ms`,
      syncResult: {
        success: syncResult.success,
        message: syncResult.message,
        metrics: syncResult.metrics,
        timestamp: syncResult.timestamp,
        errorCount: syncResult.errors?.length || 0,
        limitApplied: limit || 'No limit'
      },
      healthCheck: {
        simpro: healthCheck.simpro,
        monday: healthCheck.monday
      },
      nextRun: 'In 10 minutes'
    });

  } catch (error) {
    const executionTime = Date.now() - startTime;
    
    console.error(`[Cron Sync] Failed after ${executionTime}ms:`, error);
    
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTime: `${executionTime}ms`,
      timestamp: new Date().toISOString(),
      nextRun: 'In 10 minutes (will retry)'
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
    externalResolver: true,
  },
  maxDuration: 30,
}
