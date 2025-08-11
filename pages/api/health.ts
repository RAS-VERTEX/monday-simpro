// pages/api/health.ts - Public Health Check Endpoint

import { NextApiRequest, NextApiResponse } from 'next';
import { SimProClient } from '@/lib/simpro-client';
import { MondayClient } from '@/lib/monday-client';
import { HealthStatus } from '@/types/sync';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const startTime = Date.now();
  
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
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
        timestamp: 'Not available via this endpoint',
        status: 'failed',
        quotesProcessed: 0
      }
    };

    const envCheck = {
      hasSimproConfig: !!(process.env.SIMPRO_BASE_URL && process.env.SIMPRO_ACCESS_TOKEN),
      hasMondayConfig: !!process.env.MONDAY_API_TOKEN,
      hasBoardIds: !!(process.env.MONDAY_ACCOUNTS_BOARD_ID && 
                     process.env.MONDAY_CONTACTS_BOARD_ID && 
                     process.env.MONDAY_DEALS_BOARD_ID),
      hasWebhookSecrets: !!(process.env.SIMPRO_WEBHOOK_SECRET)
    };

    if (envCheck.hasSimproConfig) {
      try {
        const simproClient = new SimProClient({
          baseUrl: process.env.SIMPRO_BASE_URL!,
          accessToken: process.env.SIMPRO_ACCESS_TOKEN!,
          companyId: parseInt(process.env.SIMPRO_COMPANY_ID || '0')
        });

        const simproStartTime = Date.now();
        const simproTest = await simproClient.testConnection();
        const simproResponseTime = Date.now() - simproStartTime;

        healthStatus.services.simpro = {
          status: simproTest.success ? 'up' : 'down',
          lastCheck: new Date().toISOString(),
          responseTime: simproResponseTime
        };
      } catch (error) {
        console.error('[Health] SimPro test failed:', error);
        healthStatus.services.simpro.status = 'down';
      }
    }

    if (envCheck.hasMondayConfig) {
      try {
        const mondayClient = new MondayClient({
          apiToken: process.env.MONDAY_API_TOKEN!
        });

        const mondayStartTime = Date.now();
        const mondayTest = await mondayClient.testConnection();
        const mondayResponseTime = Date.now() - mondayStartTime;

        healthStatus.services.monday = {
          status: mondayTest.success ? 'up' : 'down',
          lastCheck: new Date().toISOString(),
          responseTime: mondayResponseTime
        };
      } catch (error) {
        console.error('[Health] Monday test failed:', error);
        healthStatus.services.monday.status = 'down';
      }
    }

    if (!envCheck.hasSimproConfig || !envCheck.hasMondayConfig || !envCheck.hasBoardIds) {
      healthStatus.status = 'unhealthy';
    } else if (healthStatus.services.simpro.status === 'down' || healthStatus.services.monday.status === 'down') {
      healthStatus.status = 'degraded';
    }

    const executionTime = Date.now() - startTime;

    const httpStatus = healthStatus.status === 'healthy' ? 200 : 
                      healthStatus.status === 'degraded' ? 207 : 503;

    res.status(httpStatus).json({
      success: healthStatus.status !== 'unhealthy',
      executionTime: `${executionTime}ms`,
      health: healthStatus,
      configuration: {
        environment: envCheck,
        endpoints: {
          simproWebhook: '/api/webhooks/simpro',
          mondayWebhook: '/api/webhooks/monday',
          cronSync: '/api/cron/sync-quotes',
          cronHealth: '/api/cron/health-check'
        },
        sync: {
          minimumQuoteValue: 15000,
          cronSchedule: 'Every 10 minutes',
          healthCheckSchedule: 'Every 6 hours'
        }
      },
      buildInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    const executionTime = Date.now() - startTime;
    
    console.error(`[Health] Error after ${executionTime}ms:`, error);
    
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      executionTime: `${executionTime}ms`,
      timestamp: new Date().toISOString()
    });
  }
}
