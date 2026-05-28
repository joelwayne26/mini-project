import { NextRequest, NextResponse } from 'next/server';
import { forceRefreshTrends } from '@/lib/ai/trend-engine';

export async function GET(request: NextRequest) {
  try {
    const results = await forceRefreshTrends(['cake', 'bakery', 'restaurant', 'general']);
    const totalTrends = Object.values(results).reduce((sum, n) => sum + n, 0);
    return NextResponse.json({ success: true, refreshedAt: new Date().toISOString(), categories: results, totalTrends, message: `Refreshed ${totalTrends} trends across ${Object.keys(results).length} categories` });
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error), refreshedAt: new Date().toISOString() }, { status: 500 });
  }
}
