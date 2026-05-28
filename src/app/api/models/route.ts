/** GET /api/models — Model history */
import { NextResponse } from 'next/server';
import { healthCheck, ModelRegistryRepository } from '@/lib/db/client';

export async function GET() {
  try {
    const connected = await healthCheck();
    if (!connected) return NextResponse.json({ count: 0, versions: [] });

    const repo = new ModelRegistryRepository();
    const versions = await repo.getAllVersions('xgboost');
    return NextResponse.json({ count: versions.length, versions: versions.slice(0, 20) });
  } catch {
    return NextResponse.json({ count: 0, versions: [] });
  }
}
