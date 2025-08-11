// pages/api/cron/health-check.ts - Health Check Cron Job (Fixed TypeScript errors)

import { NextApiRequest, NextApiResponse } from 'next';
import { SimProClient } from '@/lib/simpro-client';
import { MondayClient } from '@/lib/monday-client';
import { SyncEngine } from '@/lib/sync-engine';
import { HealthStatus } from '@/types/sync';

function verifyCronRequest(req: NextApiRequest): boolean {
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  
  if (cronSecret) {
    return authHeader === `Bearer ${cronSecret}`;
  }
  
  const userAgent = req.headers['user-agent'];
  return userAgent === 'vercel-cron/1.0' || (userAgent?.includes('vercel') ?? false);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const startTime = Date.now();
  
  console.log(`[Health Check] Starting health check at ${new Date().toISOString()}`);

  if (!verifyCronRequest(req)) {
    console.error('[Health Check] Unauthorized cron request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let simproClient: SimProClient | null = null;
    let mondayClient: MondayClient | null = null;

    const healthStatus: HealthStatus = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: {
        simpro: {
          status: 'down',
          lastCheck: new Date().toISOString(),
          responseTime: undefined
        },
        monday: {
          status: 'down',
          lastCheck: new Date().toISOString(),
          responseTime: undefined
        }
      },
      lastSync: {
        timestamp: 'unknown',
        status: 'failed',
        quotesProcessed: 0
      }
    };

    try {
      if (process.env.SIMPRO_BASE_URL && process.env.SIMPRO_ACCESS_TOKEN && process.env.SIMPRO_COMPANY_ID) {
        simproClient = new SimProClient({
          baseUrl: process.env.SIMPRO_BASE_URL,
          accessToken: process.env.SIMPRO_ACCESS_TOKEN,
          companyId: parseInt(process.env.SIMPRO_COMPANY_ID)
        });

        const simproStartTime = Date.now();
        const simproTest = await simproClient.testConnection();
        const simproResponseTime = Date.now() - simproStartTime;

        healthStatus.services.simpro = {
          status: simproTest.success ? 'up' : 'down',
          lastCheck: new Date().toISOString(),
          responseTime: simproResponseTime
        };

        console.log(`[Health Check] SimPro: ${simproTest.success ? 'UP' : 'DOWN'} (${simproResponseTime}ms)`);
      } else {
        console.warn('[Health Check] SimPro environment variables not configured');
        healthStatus.services.simpro.status = 'down';
      }
    } catch (error) {
      console.error('[Health Check] SimPro connection failed:', error);
      healthStatus.services.simpro.status = 'down';
    }

    try {
      if (process.env.MONDAY_API_TOKEN) {
        mondayClient = new MondayClient({
          apiToken: process.env.MONDAY_API_TOKEN
        });

        const mondayStartTime = Date.now();
        const mondayTest = await mondayClient.testConnection();
        const mondayResponseTime = Date.now() - mondayStartTime;

        healthStatus.services.monday = {
          status: mondayTest.success ? 'up' : 'down',
          lastCheck: new Date().toISOString(),
          responseTime: mondayResponseTime
        };

        console.log(`[Health Check] Monday: ${mondayTest.success ? 'UP' : 'DOWN'} (${mondayResponseTime}ms)`);
      } else {
        console.warn('[Health Check] Monday.com environment variables not configured');
        healthStatus.services.monday.status = 'down';
      }
    } catch (error) {
      console.error('[Health Check] Monday connection failed:', error);
      healthStatus.services.monday.status = 'down';
    }

    if (simproClient && mondayClient && 
        healthStatus.services.simpro.status === 'up' && 
        healthStatus.services.monday.status === 'up') {
      
      try {
        const syncConfig = {
          minimumQuoteValue: 15000,
          boardIds: {
            accounts: process.env.MONDAY_ACCOUNTS_BOARD_ID || '',
            contacts: process.env.MONDAY_CONTACTS_BOARD_ID || '',
            deals: process.env.MONDAY_DEALS_BOARD_ID || ''
          },
          enabledEvents: {
            simproToMonday: true,
            mondayToSimpro: true
          }
        };

        const syncEngine = new SyncEngine(simproClient, mondayClient, syncConfig);
        
        const quotes = await simproClient.getQuotes({
          minimumValue: 15000,
          activeOnly: true
        });
        
        healthStatus.lastSync = {
          timestamp: new Date().toISOString(),
          status: 'success',
          quotesProcessed: quotes.length
        };
        
        console.log(`[Health Check] Sync engine test: Found ${quotes.length} quotes`);
        
      } catch (error) {
        console.error('[Health Check] Sync engine test failed:', error);
        healthStatus.lastSync = {
          timestamp: new Date().toISOString(),
          status: 'failed',
          quotesProcessed: 0
        };
      }
    }

    if (healthStatus.services.simpro.status === 'down' || healthStatus.services.monday.status === 'down') {
      healthStatus.status = 'degraded';
    }

    if (healthStatus.services.simpro.status === 'down' && healthStatus.services.monday.status === 'down') {
      healthStatus.status = 'unhealthy';
    }

    const executionTime = Date.now() - startTime;
    
    console.log(`[Health Check] Completed in ${executionTime}ms - Status: ${healthStatus.status.toUpperCase()}`);

    const httpStatus = healthStatus.status === 'healthy' ? 200 : 
                      healthStatus.status === 'degraded' ? 207 : 503;

    res.status(httpStatus).json({
      success: healthStatus.status !== 'unhealthy',
      executionTime: `${executionTime}ms`,
      health: healthStatus,
      environment: {
        hasSimproConfig: !!(process.env.SIMPRO_BASE_URL && process.env.SIMPRO_ACCESS_TOKEN),
        hasMondayConfig: !!process.env.MONDAY_API_TOKEN,
        hasBoardIds: !!(process.env.MONDAY_ACCOUNTS_BOARD_ID && 
                       process.env.MONDAY_CONTACTS_BOARD_ID && 
                       process.env.MONDAY_DEALS_BOARD_ID)
      },
      nextHealthCheck: 'In 6 hours'
    });

  } catch (error) {
    const executionTime = Date.now() - startTime;
    
    console.error(`[Health Check] Critical error after ${executionTime}ms:`, error);
    
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTime: `${executionTime}ms`,
      timestamp: new Date().toISOString(),
      health: {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Critical health check failure'
      }
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '512kb',
    },
  },
  maxDuration: 20,
}
