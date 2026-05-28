/**
 * TrendLens AI v6.0 — Trend Engine
 * Multi-source trend aggregation for Ugandan food businesses.
 * Free sources only: RSS, simulated trends with domain knowledge.
 */

import { TrendSignal } from './types';

// ─── Simulated Trend Data ──────────────────────────────────────────────────
// Since we can't call external APIs from Vercel edge functions for free,
// we provide a curated set of trending topics based on domain knowledge.

const UGANDA_FOOD_TRENDS: Record<string, { keyword: string; score: number; volume: number; growthRate: number }[]> = {
  cake: [
    { keyword: 'custom cakes kampala', score: 0.92, volume: 2400, growthRate: 0.15 },
    { keyword: 'wedding cakes uganda', score: 0.88, volume: 1800, growthRate: 0.08 },
    { keyword: 'birthday cake delivery', score: 0.85, volume: 1500, growthRate: 0.22 },
    { keyword: 'fondant cakes', score: 0.78, volume: 900, growthRate: 0.12 },
    { keyword: 'cupcakes kampala', score: 0.75, volume: 750, growthRate: 0.18 },
    { keyword: 'eggless cake', score: 0.68, volume: 450, growthRate: 0.35 },
    { keyword: 'red velvet cake', score: 0.65, volume: 600, growthRate: 0.05 },
    { keyword: 'cake baking class', score: 0.60, volume: 350, growthRate: 0.40 },
  ],
  bakery: [
    { keyword: 'fresh bread delivery', score: 0.90, volume: 2000, growthRate: 0.12 },
    { keyword: 'sourdough kampala', score: 0.82, volume: 650, growthRate: 0.45 },
    { keyword: 'artisan bakery', score: 0.78, volume: 500, growthRate: 0.28 },
    { keyword: 'pastries uganda', score: 0.75, volume: 800, growthRate: 0.10 },
    { keyword: 'healthy bread', score: 0.72, volume: 400, growthRate: 0.32 },
    { keyword: 'gluten free bakery', score: 0.68, volume: 300, growthRate: 0.50 },
  ],
  restaurant: [
    { keyword: 'local food delivery', score: 0.92, volume: 3200, growthRate: 0.18 },
    { keyword: 'rolex kampala', score: 0.88, volume: 2800, growthRate: 0.05 },
    { keyword: 'matooke recipe', score: 0.85, volume: 2200, growthRate: 0.08 },
    { keyword: 'ugandan food', score: 0.82, volume: 4500, growthRate: 0.15 },
    { keyword: 'restaurant deals', score: 0.78, volume: 1500, growthRate: 0.22 },
    { keyword: 'luwombo', score: 0.72, volume: 600, growthRate: 0.10 },
    { keyword: 'outdoor dining kampala', score: 0.70, volume: 450, growthRate: 0.35 },
  ],
  general: [
    { keyword: 'ugx deals', score: 0.88, volume: 3500, growthRate: 0.20 },
    { keyword: 'kampala food', score: 0.85, volume: 5000, growthRate: 0.12 },
    { keyword: 'uganda business', score: 0.82, volume: 2800, growthRate: 0.08 },
    { keyword: 'food delivery uganda', score: 0.80, volume: 2200, growthRate: 0.30 },
    { keyword: 'small business uganda', score: 0.78, volume: 1800, growthRate: 0.15 },
    { keyword: 'whatsapp business', score: 0.75, volume: 4000, growthRate: 0.10 },
    { keyword: 'social media marketing', score: 0.72, volume: 2500, growthRate: 0.25 },
    { keyword: 'online ordering', score: 0.70, volume: 1500, growthRate: 0.35 },
  ],
};

// ─── Trend Fetching ────────────────────────────────────────────────────────

export function fetchTrends(category: string = 'general', limit: number = 20): TrendSignal[] {
  const trends = UGANDA_FOOD_TRENDS[category] || UGANDA_FOOD_TRENDS.general;
  const now = new Date().toISOString();

  return trends.slice(0, limit).map(t => ({
    keyword: t.keyword,
    source: 'domain_knowledge',
    score: t.score,
    volume: t.volume,
    growthRate: t.growthRate,
    category,
    country: 'UG',
    fetchedAt: now,
  }));
}

// ─── Trend Scoring ─────────────────────────────────────────────────────────

export function scoreTrendRelevance(
  keyword: string,
  caption: string,
): number {
  const lower = caption.toLowerCase();
  const kwLower = keyword.toLowerCase();
  const kwWords = kwLower.split(/\s+/);

  // Exact match
  if (lower.includes(kwLower)) return 1.0;

  // Partial match (any word from keyword)
  const matchedWords = kwWords.filter(w => w.length > 3 && lower.includes(w));
  if (matchedWords.length > 0) {
    return matchedWords.length / kwWords.length;
  }

  return 0;
}

// ─── Trend Alignment for Caption ───────────────────────────────────────────

export function computeTrendAlignment(
  caption: string,
  category: string,
): { score: number; bestTrendKeyword: string; matchedKeywords: string[]; method: string } {
  const trends = fetchTrends(category, 10);
  const scores: { keyword: string; score: number }[] = [];

  for (const trend of trends) {
    const score = scoreTrendRelevance(trend.keyword, caption);
    if (score > 0) {
      scores.push({ keyword: trend.keyword, score });
    }
  }

  if (scores.length === 0) {
    return {
      score: 0,
      bestTrendKeyword: trends[0]?.keyword || '',
      matchedKeywords: [],
      method: 'keyword_matching',
    };
  }

  const avgScore = scores.reduce((sum, s) => sum + s.score, 0) / Math.max(trends.length, 1);
  const bestKeyword = scores.sort((a, b) => b.score - a.score)[0].keyword;

  return {
    score: Math.round(avgScore * 1000) / 1000,
    bestTrendKeyword: bestKeyword,
    matchedKeywords: scores.map(s => s.keyword),
    method: 'keyword_matching',
  };
}
