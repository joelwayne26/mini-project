/** GET /api/trends — Current trending terms */
import { NextRequest, NextResponse } from 'next/server';
import { fetchTrends } from '@/lib/ai/trend-engine';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') || 'general';
  const limit = parseInt(searchParams.get('limit') || '20');

  const signals = fetchTrends(category, limit);
  return NextResponse.json({
    category,
    count: signals.length,
    trends: signals,
    fetchedAt: new Date().toISOString(),
  });
}
