/** GET /api/health — System health check */
import { NextResponse } from 'next/server';
import { healthCheck } from '@/lib/db/client';

export async function GET() {
  const dbConnected = await healthCheck();
  return NextResponse.json({
    status: dbConnected ? 'healthy' : 'degraded',
    version: '6.0.0',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected',
    features: {
      rag: true,
      shap: true,
      captionGeneration: true,
      driftDetection: true,
    },
  });
}
