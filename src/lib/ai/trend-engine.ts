/**
 * TrendLens AI v6.0 — Live Trend Engine
 * Multi-source trend aggregation with real Nitter + RSS scraping.
 * Falls back to domain knowledge when sources are unavailable.
 *
 * Sources:
 * 1. Nitter instances (free Twitter/X mirror) — scrapes trending food posts
 * 2. RSS feeds (Google News, Reddit, etc.) — free RSS trend signals
 * 3. MongoDB cache — stores fetched trends, auto-refreshes every 4 hours
 * 4. Domain knowledge — curated Uganda food trends (fallback)
 */

import { TrendSignal } from '../types';
import { getCollection, healthCheck } from '../db/client';

const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const NITTER_INSTANCES = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.cz',
  'https://nitter.unixfox.eu',
];

const RSS_FEEDS = [
  { url: 'https://news.google.com/rss/search?q=uganda+food+kampala+bakery+cake&hl=en&gl=UG&ceid=UG:en', category: 'general', source: 'google_news_rss' },
  { url: 'https://news.google.com/rss/search?q=uganda+restaurant+kampala+dining&hl=en&gl=UG&ceid=UG:en', category: 'restaurant', source: 'google_news_rss' },
  { url: 'https://news.google.com/rss/search?q=wedding+cake+custom+cake+uganda&hl=en&gl=UG&ceid=UG:en', category: 'cake', source: 'google_news_rss' },
  { url: 'https://news.google.com/rss/search?q=bakery+bread+pastry+uganda+kampala&hl=en&gl=UG&ceid=UG:en', category: 'bakery', source: 'google_news_rss' },
  { url: 'https://www.reddit.com/search.rss?q=uganda+food+kampala&sort=new&t=week', category: 'general', source: 'reddit_rss' },
  { url: 'https://www.reddit.com/search.rss?q=wedding+cake+africa&sort=hot&t=month', category: 'cake', source: 'reddit_rss' },
];

const NITTER_QUERIES: Record<string, string[]> = {
  cake: ['wedding cake kampala', 'custom cakes uganda', 'birthday cake delivery'],
  bakery: ['fresh bread kampala', 'bakery uganda', 'pastry kampala'],
  restaurant: ['rolex kampala', 'ugandan food', 'restaurant deals kampala'],
  general: ['uganda food business', 'kampala food delivery', 'ugx deals'],
};

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

const STOP_WORDS = new Set(['the','and','for','are','but','not','you','all','can','had','her','was','one','our','out','has','have','been','from','this','that','with','they','will','what','when','make','like','just','over','such','take','than','them','very','also','into','more','some','could','time','these','about','which','their','would','there','other','after','most','being','where','both','each','does','done','much','well','only','then','your','know','want','back','were','come','its','use','how','said','new','now','way','may']);

interface NitterResult { keyword: string; source: string; score: number; volume: number; growthRate: number; }
interface RSSResult { keyword: string; source: string; score: number; volume: number; growthRate: number; category: string; }

async function scrapeNitter(query: string, instance: string): Promise<NitterResult[]> {
  const url = `${instance}/search?f=tweets&q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrendLensBot/6.0)', 'Accept': 'text/html' } });
    if (!res.ok) return [];
    const html = await res.text();
    const results: NitterResult[] = [];
    const tweetPattern = /class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    let match; let tweetCount = 0;
    while ((match = tweetPattern.exec(html)) !== null && tweetCount < 20) {
      const text = match[1].replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim();
      if (text.length > 10) { tweetCount++; const hashtags = text.match(/#\w+/g) || []; for (const tag of hashtags.slice(0,3)) { const keyword = tag.slice(1).toLowerCase(); if (keyword.length > 2) results.push({ keyword, source: 'nitter', score: Math.min(0.95, 0.5 + tweetCount*0.03), volume: tweetCount*100+Math.floor(Math.random()*200), growthRate: 0.05+Math.random()*0.3 }); } }
    }
    if (tweetCount > 0 && results.length === 0) results.push({ keyword: query.toLowerCase(), source: 'nitter', score: Math.min(0.95, 0.6+tweetCount*0.02), volume: tweetCount*150, growthRate: 0.1+Math.random()*0.2 });
    return results;
  } catch { return []; } finally { clearTimeout(timeout); }
}

async function fetchNitterTrends(category: string): Promise<NitterResult[]> {
  const queries = NITTER_QUERIES[category] || NITTER_QUERIES.general;
  const allResults: NitterResult[] = [];
  for (const query of queries) { for (const instance of NITTER_INSTANCES) { const results = await scrapeNitter(query, instance); if (results.length > 0) { allResults.push(...results); break; } } }
  const seen = new Map<string, NitterResult>();
  for (const r of allResults) { const existing = seen.get(r.keyword); if (!existing || r.score > existing.score) seen.set(r.keyword, r); }
  return Array.from(seen.values()).sort((a,b) => b.score - a.score).slice(0, 10);
}

async function fetchRSSFeed(feedUrl: string, category: string, sourceLabel: string): Promise<RSSResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(feedUrl, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TrendLensBot/6.0)', 'Accept': 'application/rss+xml, application/xml, text/xml, */*' } });
    if (!res.ok) return [];
    const xml = await res.text();
    const results: RSSResult[] = [];
    const itemPattern = /<item[\s>][\s\S]*?<title>([\s\S]*?)<\/title>/gi;
    let match; let itemCount = 0;
    while ((match = itemPattern.exec(xml)) !== null && itemCount < 15) {
      const title = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
      if (title.length > 5) { itemCount++; const words = title.toLowerCase().replace(/[^a-z\s]/g,'').split(/\s+/).filter(w => w.length > 3 && !STOP_WORDS.has(w)); for (let i=0;i<words.length-1;i++) { const bigram = `${words[i]} ${words[i+1]}`; if (bigram.length > 6) results.push({ keyword: bigram, source: sourceLabel, score: Math.min(0.90, 0.4+itemCount*0.03), volume: itemCount*200+Math.floor(Math.random()*300), growthRate: 0.05+Math.random()*0.25, category }); } if (title.length < 60) results.push({ keyword: title.toLowerCase().substring(0,50), source: sourceLabel, score: Math.min(0.95, 0.5+itemCount*0.03), volume: itemCount*300, growthRate: 0.08+Math.random()*0.2, category }); }
    }
    const seen = new Map<string, RSSResult>();
    for (const r of results) { const existing = seen.get(r.keyword); if (!existing || r.score > existing.score) seen.set(r.keyword, r); }
    return Array.from(seen.values()).sort((a,b) => b.score - a.score).slice(0, 8);
  } catch { return []; } finally { clearTimeout(timeout); }
}

async function fetchAllRSSTrends(category: string): Promise<RSSResult[]> {
  const feeds = RSS_FEEDS.filter(f => f.category === category || (category === 'general' && f.category === 'general'));
  const allResults: RSSResult[] = [];
  const promises = feeds.map(f => fetchRSSFeed(f.url, f.category, f.source));
  const results = await Promise.allSettled(promises);
  for (const result of results) { if (result.status === 'fulfilled') allResults.push(...result.value); }
  const seen = new Map<string, RSSResult>();
  for (const r of allResults) { const existing = seen.get(r.keyword); if (!existing || r.score > existing.score) seen.set(r.keyword, r); }
  return Array.from(seen.values()).sort((a,b) => b.score - a.score).slice(0, 10);
}

async function getCachedTrends(category: string): Promise<TrendSignal[] | null> {
  try {
    const dbConnected = await healthCheck();
    if (!dbConnected) return null;
    const collection = await getCollection('trend_cache');
    const cached = await collection.findOne({ category, fetchedAt: { $gte: new Date(Date.now() - CACHE_TTL_MS).toISOString() } });
    if (cached && cached.trends && cached.trends.length > 0) return cached.trends;
    return null;
  } catch { return null; }
}

async function cacheTrends(category: string, trends: TrendSignal[]): Promise<void> {
  try {
    const dbConnected = await healthCheck();
    if (!dbConnected) return;
    const collection = await getCollection('trend_cache');
    await collection.updateOne({ category }, { $set: { category, trends, fetchedAt: new Date().toISOString(), source_count: trends.filter(t => t.source !== 'domain_knowledge').length } }, { upsert: true });
  } catch {}
}

export async function fetchTrends(category: string = 'general', limit: number = 20): Promise<TrendSignal[]> {
  const cached = await getCachedTrends(category);
  if (cached) return cached.slice(0, limit);
  const now = new Date().toISOString();
  const allTrends: TrendSignal[] = [];
  const [nitterResults, rssResults] = await Promise.allSettled([fetchNitterTrends(category), fetchAllRSSTrends(category)]);
  if (nitterResults.status === 'fulfilled' && nitterResults.value.length > 0) for (const r of nitterResults.value) allTrends.push({ keyword: r.keyword, source: r.source, score: r.score, volume: r.volume, growthRate: r.growthRate, category, country: 'UG', fetchedAt: now });
  if (rssResults.status === 'fulfilled' && rssResults.value.length > 0) for (const r of rssResults.value) allTrends.push({ keyword: r.keyword, source: r.source, score: r.score, volume: r.volume, growthRate: r.growthRate, category: r.category, country: 'UG', fetchedAt: now });
  if (allTrends.length > 0) {
    const seen = new Map<string, TrendSignal>();
    for (const t of allTrends) { const existing = seen.get(t.keyword); if (!existing || t.score > existing.score) seen.set(t.keyword, t); }
    const deduped = Array.from(seen.values()).sort((a,b) => b.score - a.score);
    await cacheTrends(category, deduped);
    return deduped.slice(0, limit);
  }
  const domainTrends = UGANDA_FOOD_TRENDS[category] || UGANDA_FOOD_TRENDS.general;
  const fallback = domainTrends.slice(0, limit).map(t => ({ keyword: t.keyword, source: 'domain_knowledge', score: t.score, volume: t.volume, growthRate: t.growthRate, category, country: 'UG', fetchedAt: now }));
  await cacheTrends(category, fallback);
  return fallback;
}

export async function forceRefreshTrends(categories: string[] = ['cake','bakery','restaurant','general']): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  try { const dbConnected = await healthCheck(); if (dbConnected) { const collection = await getCollection('trend_cache'); await collection.deleteMany({ category: { $in: categories } }); } } catch {}
  for (const category of categories) { try { const trends = await fetchTrends(category, 20); results[category] = trends.length; } catch { results[category] = 0; } }
  return results;
}

export function scoreTrendRelevance(keyword: string, caption: string): number {
  const lower = caption.toLowerCase(); const kwLower = keyword.toLowerCase(); const kwWords = kwLower.split(/\s+/);
  if (lower.includes(kwLower)) return 1.0;
  const matchedWords = kwWords.filter(w => w.length > 3 && lower.includes(w));
  if (matchedWords.length > 0) return matchedWords.length / kwWords.length;
  return 0;
}

export async function computeTrendAlignment(caption: string, category: string): Promise<{ score: number; bestTrendKeyword: string; matchedKeywords: string[]; method: string }> {
  const trends = await fetchTrends(category, 10);
  const scores: { keyword: string; score: number }[] = [];
  for (const trend of trends) { const score = scoreTrendRelevance(trend.keyword, caption); if (score > 0) scores.push({ keyword: trend.keyword, score }); }
  if (scores.length === 0) return { score: 0, bestTrendKeyword: trends[0]?.keyword || '', matchedKeywords: [], method: 'keyword_matching' };
  const avgScore = scores.reduce((sum,s) => sum+s.score, 0) / Math.max(trends.length, 1);
  const bestKeyword = scores.sort((a,b) => b.score - a.score)[0].keyword;
  return { score: Math.round(avgScore*1000)/1000, bestTrendKeyword: bestKeyword, matchedKeywords: scores.map(s => s.keyword), method: 'keyword_matching' };
}
