/** POST /api/feedback — User feedback on suggestions */
import { NextRequest, NextResponse } from 'next/server';
import { FeedbackRepository } from '@/lib/db/client';

export async function POST(request: NextRequest) {
  try {
    const { evaluationId, type, rating, comment } = await request.json();
    if (!evaluationId || !type || !rating) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const repo = new FeedbackRepository();
    await repo.insertOne({ evaluation_id: evaluationId, type, rating, comment: comment || '' });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
