/** GET /api/metrics — Prometheus-compatible metrics */
import { NextResponse } from 'next/server';

// Simple in-memory metrics
const metrics: Record<string, number> = {
  trendlens_evaluations_total: 0,
  trendlens_avg_score: 0,
  trendlens_db_connected: 0,
};

export function incrementMetric(name: string, value = 1) {
  metrics[name] = (metrics[name] || 0) + value;
}

export function setMetric(name: string, value: number) {
  metrics[name] = value;
}

export async function GET() {
  const lines = Object.entries(metrics).map(([name, value]) => `${name} ${value}`);
  return new NextResponse(lines.join('\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; version=0.0.4' },
  });
}
