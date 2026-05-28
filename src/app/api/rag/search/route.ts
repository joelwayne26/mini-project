/** GET /api/rag/search — Vector similarity search for RAG */
import { NextRequest, NextResponse } from 'next/server';
import { searchSimilarPosts, generateRagInsights } from '@/lib/ai/rag-engine';
import { extractCaptionFeatures } from '@/lib/ai/feature-extractor';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const caption = searchParams.get('caption') || searchParams.get('query') || '';
  const category = searchParams.get('category') || 'general';
  const limit = parseInt(searchParams.get('limit') || searchParams.get('topK') || '5');

  if (!caption) {
    return NextResponse.json({ error: 'Caption/query parameter required' }, { status: 400 });
  }

  try {
    const similarPosts = await searchSimilarPosts(caption, category, limit);
    const captionFeatures = extractCaptionFeatures(caption, category);
    const insights = generateRagInsights(similarPosts, captionFeatures, category);

    return NextResponse.json({
      query: caption,
      category,
      results: similarPosts,
      insights,
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
