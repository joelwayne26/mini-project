/** GET /api/stats — Dashboard statistics */
import { NextResponse } from 'next/server';
import { healthCheck, PostsRepository, GroundTruthRepository, ModelRegistryRepository, EvaluationRepository } from '@/lib/db/client';

export async function GET() {
  try {
    const connected = await healthCheck();

    if (!connected) {
      return NextResponse.json({
        totalEvaluations: 0,
        groundTruthCount: 0,
        modelAuc: 0,
        modelVersion: 'none',
        avgScore: 0,
        topCategory: 'general',
        dbConnected: false,
      });
    }

    const evalRepo = new EvaluationRepository();
    const gtRepo = new GroundTruthRepository();
    const modelRepo = new ModelRegistryRepository();

    const [evalStats, gtCount, latestModel] = await Promise.all([
      evalRepo.getAverageScore(),
      gtRepo.count(),
      modelRepo.getLatest('xgboost'),
    ]);

    return NextResponse.json({
      totalEvaluations: evalStats.count || 0,
      groundTruthCount: gtCount,
      modelAuc: (latestModel?.auc as number) || 0,
      modelVersion: (latestModel?.version as string) || 'none',
      avgScore: Math.round((evalStats.avgScore || 0) * 10) / 10,
      topCategory: 'general',
      dbConnected: true,
    });
  } catch (error) {
    return NextResponse.json({
      totalEvaluations: 0,
      groundTruthCount: 0,
      modelAuc: 0,
      modelVersion: 'none',
      avgScore: 0,
      topCategory: 'general',
      dbConnected: false,
    });
  }
}
