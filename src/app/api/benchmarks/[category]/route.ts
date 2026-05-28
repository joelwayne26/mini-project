/** GET /api/benchmarks/[category] — Category benchmarks */
import { NextResponse } from 'next/server';
import { healthCheck, GroundTruthRepository, PostsRepository, ModelRegistryRepository } from '@/lib/db/client';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ category: string }> }
) {
  const { category } = await params;

  try {
    const connected = await healthCheck();
    if (!connected) {
      return NextResponse.json({ category, sampleCount: 0, message: 'Database not connected' });
    }

    const gtRepo = new GroundTruthRepository();
    const gtData = await gtRepo.findMany({ category }, { sort: { engagement_rate: -1 }, limit: 100 });

    if (gtData.length === 0) {
      return NextResponse.json({ category, sampleCount: 0, message: 'No ground truth data available' });
    }

    const rates = gtData.map((d: Record<string, unknown>) => Number(d.engagement_rate || 0));
    rates.sort((a: number, b: number) => a - b);
    const avg = rates.reduce((s: number, r: number) => s + r, 0) / rates.length;
    const top10 = rates.length >= 10 ? rates[Math.floor(rates.length * 0.9)] : rates[rates.length - 1];

    const postsRepo = new PostsRepository();
    const totalPosts = await postsRepo.count({ category });

    return NextResponse.json({
      category,
      sampleCount: gtData.length,
      industryAvgEngagement: Math.round(avg * 10000) / 10000,
      industryTop10Engagement: Math.round(top10 * 10000) / 10000,
      totalPosts,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
