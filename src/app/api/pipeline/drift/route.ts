/** GET /api/pipeline/drift — Drift measurements */
import { NextResponse } from 'next/server';
import { healthCheck, DriftStateRepository } from '@/lib/db/client';

export async function GET() {
  try {
    const connected = await healthCheck();
    if (!connected) return NextResponse.json({ measurements: [], count: 0 });

    const repo = new DriftStateRepository();
    const history = await repo.getHistory(50);
    return NextResponse.json({ measurements: history, count: history.length });
  } catch {
    return NextResponse.json({ measurements: [], count: 0 });
  }
}
