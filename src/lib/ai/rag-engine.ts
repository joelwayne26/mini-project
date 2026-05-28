/**
 * TrendLens AI v6.0 — RAG Engine
 * Retrieval-Augmented Generation using MongoDB Atlas Vector Search.
 * Finds similar high-performing posts and generates grounded recommendations.
 */

import { EmbeddingsRepository } from '../db/client';
import { RagInsight, VectorSearchResult, CaptionFeatures } from './types';
import { getCategoryRule } from './category-rules';

// ─── Embedding Generation ──────────────────────────────────────────────────
// Simple TF-based embedding for demo (replace with SBERT in production)

const FOOD_VOCABULARY = [
  'cake', 'bread', 'pastry', 'bakery', 'restaurant', 'food', 'meal', 'dish',
  'ugx', 'delivery', 'order', 'fresh', 'homemade', 'delicious', 'special',
  'kampala', 'uganda', 'birthday', 'wedding', 'custom', 'organic', 'local',
  'breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink', 'coffee',
  'chocolate', 'vanilla', 'chicken', 'beef', 'fish', 'rice', 'matooke',
  'whatsapp', 'dm', 'link', 'price', 'starting', 'limited', 'offer',
  'morning', 'evening', 'today', 'new', 'best', 'top', 'premium',
];

export function generateSimpleEmbedding(text: string, dimensions: number = 384): number[] {
  if (!text) return new Array(dimensions).fill(0);

  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  const embedding = new Array(dimensions).fill(0);

  // Bag of words approach
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    // Hash the word to multiple positions in the embedding
    for (let j = 0; j < 3; j++) {
      const hash = simpleHash(`${word}_${j}`) % dimensions;
      embedding[hash] += 1;
    }
  }

  // Add vocabulary-based features
  for (let i = 0; i < FOOD_VOCABULARY.length && i < dimensions / 4; i++) {
    if (lower.includes(FOOD_VOCABULARY[i])) {
      embedding[i] += 2;
    }
  }

  // Add structural features
  const hashCount = (text.match(/#\w+/g) || []).length;
  if (dimensions > FOOD_VOCABULARY.length + 10) {
    embedding[FOOD_VOCABULARY.length] = Math.min(1, hashCount / 10);
  }

  const hasPrice = /ugx|ush|\$|price|starting/i.test(text);
  if (dimensions > FOOD_VOCABULARY.length + 11) {
    embedding[FOOD_VOCABULARY.length + 1] = hasPrice ? 1 : 0;
  }

  const hasCta = /dm|whatsapp|order|link in bio|call/i.test(text);
  if (dimensions > FOOD_VOCABULARY.length + 12) {
    embedding[FOOD_VOCABULARY.length + 2] = hasCta ? 1 : 0;
  }

  // Normalize
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= norm;
    }
  }

  return embedding;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

// ─── RAG Search ────────────────────────────────────────────────────────────

export async function searchSimilarPosts(
  caption: string,
  category: string,
  limit: number = 5,
): Promise<VectorSearchResult[]> {
  try {
    const embedding = generateSimpleEmbedding(caption);
    const repo = new EmbeddingsRepository();

    try {
      const results = await repo.vectorSearch(embedding, limit, { category });
      return results as VectorSearchResult[];
    } catch {
      // Vector search might not be available (no index created yet)
      // Fallback to text-based search
      return await textBasedSearch(caption, category, limit);
    }
  } catch {
    return [];
  }
}

async function textBasedSearch(
  caption: string,
  category: string,
  limit: number,
): Promise<VectorSearchResult[]> {
  try {
    const repo = new EmbeddingsRepository();
    const keywords = caption.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5);
    if (keywords.length === 0) return [];

    const results = await repo.findMany({
      category,
      $or: keywords.map(kw => ({ caption: { $regex: kw, $options: 'i' } })),
    }, { sort: { engagement_rate: -1 }, limit });

    return results.map(r => ({
      _id: r._id?.toString() || '',
      caption: (r.caption as string) || '',
      engagementRate: (r.engagement_rate as number) || 0,
      category: (r.category as string) || category,
      score: 0.5,
      hashtags: (r.hashtags as string[]) || [],
      hasCta: (r.has_cta as boolean) || false,
      hasPrice: (r.has_price as boolean) || false,
    }));
  } catch {
    return [];
  }
}

// ─── RAG Insight Generation ────────────────────────────────────────────────

export function generateRagInsights(
  similarPosts: VectorSearchResult[],
  captionFeatures: CaptionFeatures,
  category: string,
): RagInsight[] {
  if (similarPosts.length === 0) return [];

  return similarPosts.slice(0, 5).map(post => {
    const patterns: string[] = [];
    const rules = getCategoryRule(category);

    // Identify key patterns in successful posts
    if (post.hasCta && !captionFeatures.hasCta) {
      patterns.push('Uses a call-to-action');
    }
    if (post.hasPrice && !captionFeatures.hasPrice) {
      patterns.push('Includes pricing info');
    }
    if (post.hashtags.length >= rules.idealHashtags && captionFeatures.hashtagCount < rules.idealHashtags) {
      patterns.push(`Uses ${post.hashtags.length}+ hashtags`);
    }
    if (post.engagementRate > 0.7) {
      patterns.push('High engagement rate');
    }

    // Generate takeaway
    let takeaway = '';
    if (patterns.length > 0) {
      takeaway = `This similar post ${patterns.slice(0, 2).join(' and ')}, achieving ${Math.round(post.engagementRate * 100)}% engagement.`;
    } else {
      takeaway = `This ${category} post achieved ${Math.round(post.engagementRate * 100)}% engagement.`;
    }

    return {
      postId: post._id,
      caption: post.caption.slice(0, 200) + (post.caption.length > 200 ? '...' : ''),
      engagementRate: post.engagementRate,
      category: post.category,
      similarity: post.score,
      keyPatterns: patterns,
      takeaway,
    };
  });
}

// ─── Store Embedding ───────────────────────────────────────────────────────

export async function storePostEmbedding(
  postId: string,
  caption: string,
  category: string,
  engagementRate: number,
  hashtags: string[] = [],
  hasCta: boolean = false,
  hasPrice: boolean = false,
): Promise<void> {
  try {
    const embedding = generateSimpleEmbedding(caption);
    const repo = new EmbeddingsRepository();
    await repo.storeEmbedding({
      post_id: postId,
      caption,
      category,
      engagement_rate: engagementRate,
      embedding,
      hashtags,
      has_cta: hasCta,
      has_price: hasPrice,
    });
  } catch {
    // Non-critical — don't fail the evaluation
  }
}
