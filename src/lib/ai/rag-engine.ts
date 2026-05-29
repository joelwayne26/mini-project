/**
 * TrendLens AI v6.0 — RAG Engine (Semantic Vector Edition)
 * Retrieval-Augmented Generation using MongoDB Atlas Vector Search.
 * 
 * Key improvements over v1:
 * - In-memory cosine similarity search as automatic fallback when Atlas Vector Search
 *   index is not configured (solves Weakness 4: no manual Atlas index setup required)
 * - Silent LLM embedding enhancement for richer semantic representation (solves Weakness 2)
 * - Three-tier search: Atlas Vector → In-memory cosine → Text-based regex
 * - Category-aware similarity weighting
 * - Embedding cache to avoid recomputation
 */

import { EmbeddingsRepository, healthCheck, getCollection } from '../db/client';
import { RagInsight, VectorSearchResult, CaptionFeatures } from './types';
import { getCategoryRule } from './category-rules';

// ─── Semantic Vocabulary with Category Weighting ─────────────────────────────

const FOOD_VOCABULARY = [
  'cake', 'bread', 'pastry', 'bakery', 'restaurant', 'food', 'meal', 'dish',
  'ugx', 'delivery', 'order', 'fresh', 'homemade', 'delicious', 'special',
  'kampala', 'uganda', 'birthday', 'wedding', 'custom', 'organic', 'local',
  'breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'drink', 'coffee',
  'chocolate', 'vanilla', 'chicken', 'beef', 'fish', 'rice', 'matooke',
  'whatsapp', 'dm', 'link', 'price', 'starting', 'limited', 'offer',
  'morning', 'evening', 'today', 'new', 'best', 'top', 'premium',
  'rolex', 'luwombo', 'chapati', 'mandazi', 'tilapia', 'fondant',
  'sourdough', 'croissant', 'cupcake', 'icing', 'ganache', 'bbq',
  'grilled', 'steamed', 'fried', 'baked', 'traditional', 'street food',
  'catering', 'event', 'party', 'celebration', 'introduction', 'ceremony',
];

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  cake: ['cake', 'wedding', 'birthday', 'cupcake', 'fondant', 'icing', 'ganache', 'red velvet', 'buttercream', 'tier', 'custom design'],
  bakery: ['bread', 'pastry', 'bakery', 'sourdough', 'croissant', 'dough', 'flour', 'roll', 'mandazi', 'chapati', 'fresh baked'],
  restaurant: ['restaurant', 'menu', 'dish', 'meal', 'lunch', 'dinner', 'dining', 'chef', 'local food', 'traditional', 'rolex', 'luwombo', 'matooke', 'tilapia'],
  general: ['uganda', 'kampala', 'local', 'business', 'market', 'deal', 'offer', 'quality', 'support'],
};

// ─── Embedding Cache ────────────────────────────────────────────────────────

const embeddingCache = new Map<string, number[]>();
const EMBEDDING_CACHE_MAX = 500;

function getCachedEmbedding(text: string): number[] | null {
  const key = text.trim().toLowerCase().slice(0, 200);
  return embeddingCache.get(key) || null;
}

function setCachedEmbedding(text: string, embedding: number[]): void {
  const key = text.trim().toLowerCase().slice(0, 200);
  if (embeddingCache.size >= EMBEDDING_CACHE_MAX) {
    // Evict oldest entry
    const firstKey = embeddingCache.keys().next().value;
    if (firstKey) embeddingCache.delete(firstKey);
  }
  embeddingCache.set(key, embedding);
}

// ─── Enhanced Embedding Generation ──────────────────────────────────────────

export function generateEnhancedEmbedding(text: string, dimensions: number = 384): number[] {
  if (!text) return new Array(dimensions).fill(0);

  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(w => w.length > 1);
  const embedding = new Array(dimensions).fill(0);

  // 1. Unigram features with position diversity (3 hashes per word for better coverage)
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    for (let j = 0; j < 3; j++) {
      const hash = multiHash(`${word}_${j}`) % (dimensions - 20);
      embedding[hash] += 1;
    }
  }

  // 2. Bigram features for richer semantic capture
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]}_${words[i + 1]}`;
    const hash = multiHash(bigram) % (dimensions - 20);
    embedding[hash] += 0.7;
  }

  // 3. Trigram features for phrase-level semantics
  for (let i = 0; i < words.length - 2; i++) {
    const trigram = `${words[i]}_${words[i + 1]}_${words[i + 2]}`;
    const hash = multiHash(trigram) % (dimensions - 20);
    embedding[hash] += 0.4;
  }

  // 4. Semantic vocabulary mapping with weighted features
  for (let i = 0; i < FOOD_VOCABULARY.length && i < (dimensions - 20) / 3; i++) {
    if (lower.includes(FOOD_VOCABULARY[i])) {
      embedding[i] += 2.0;
    }
  }

  // 5. Category-specific keyword weighting
  let bestCategory = 'general';
  let bestScore = 0;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.filter(kw => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }
  // One-hot encode category in dedicated slots
  const categoryOffset = Math.floor((dimensions - 20) * 0.7);
  const catIndex = ['cake', 'bakery', 'restaurant', 'general'].indexOf(bestCategory);
  if (catIndex >= 0) embedding[categoryOffset + catIndex] = 1;

  // 6. Structural features in reserved last slots
  const hashCount = (text.match(/#\w+/g) || []).length;
  embedding[dimensions - 1] = Math.min(1, words.length / 60);       // Caption length
  embedding[dimensions - 2] = Math.min(1, hashCount / 15);          // Hashtag count
  embedding[dimensions - 3] = /ugx|ush|\$|price|starting/i.test(text) ? 1 : 0;  // Price
  embedding[dimensions - 4] = /dm|whatsapp|order|link in bio|call/i.test(text) ? 1 : 0;  // CTA
  embedding[dimensions - 5] = (text.match(/[\u{1F600}-\u{1F64F}]/gu) || []).length / 5;  // Emoji
  embedding[dimensions - 6] = /call|reserve|book|visit/i.test(text) ? 1 : 0;  // Secondary CTA
  embedding[dimensions - 7] = /free delivery|delivery|takeaway/i.test(text) ? 1 : 0;  // Delivery
  embedding[dimensions - 8] = /limited|flash sale|today only|while stock/i.test(text) ? 1 : 0;  // Urgency
  embedding[dimensions - 9] = /featured|voted|best|award/i.test(text) ? 1 : 0;  // Social proof
  embedding[dimensions - 10] = /ugx\s*\d/i.test(text) ? 1 : 0;  // Price with number
  embedding[dimensions - 11] = /0700|0772|0312|0780/i.test(text) ? 1 : 0;  // Ugandan phone
  embedding[dimensions - 12] = bestScore / Math.max(1, CATEGORY_KEYWORDS[bestCategory]?.length || 1);  // Category confidence
  embedding[dimensions - 13] = hashCount >= 5 && hashCount <= 10 ? 1 : 0;  // Optimal hashtag range
  embedding[dimensions - 14] = Math.min(1, (text.match(/[.!?]/g) || []).length / 5);  // Sentence count
  embedding[dimensions - 15] = words.filter(w => w === w.toUpperCase() && w.length > 2).length / 5;  // Emphasis words

  // Normalize
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= norm;
    }
  }

  return embedding;
}

// Backward-compatible alias
export const generateSimpleEmbedding = generateEnhancedEmbedding;

function multiHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// ─── In-Memory Cosine Similarity Search ─────────────────────────────────────
// This solves Weakness 4: No need for Atlas Vector Search index setup.
// Pre-loads embeddings from MongoDB and computes cosine similarity in JS.

interface CachedEmbeddingDoc {
  _id: string;
  caption: string;
  category: string;
  engagement_rate: number;
  hashtags: string[];
  has_cta: boolean;
  has_price: boolean;
  embedding: number[];
}

let embeddingDocCache: CachedEmbeddingDoc[] = [];
let embeddingCacheTime = 0;
const EMBEDDING_DOC_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

async function loadEmbeddingDocs(): Promise<CachedEmbeddingDoc[]> {
  if (embeddingDocCache.length > 0 && Date.now() - embeddingCacheTime < EMBEDDING_DOC_CACHE_TTL) {
    return embeddingDocCache;
  }

  try {
    const dbConnected = await healthCheck();
    if (!dbConnected) return [];

    const collection = await getCollection('embeddings');
    const docs = await collection.find({}).sort({ engagement_rate: -1 }).limit(200).toArray();

    embeddingDocCache = docs.map(d => ({
      _id: d._id?.toString() || '',
      caption: (d.caption as string) || '',
      category: (d.category as string) || '',
      engagement_rate: (d.engagement_rate as number) || 0,
      hashtags: (d.hashtags as string[]) || [],
      has_cta: (d.has_cta as boolean) || false,
      has_price: (d.has_price as boolean) || false,
      embedding: Array.isArray(d.embedding) ? (d.embedding as number[]) : [],
    })).filter(d => d.embedding.length === 384);

    embeddingCacheTime = Date.now();
    return embeddingDocCache;
  } catch {
    return [];
  }
}

async function inMemoryVectorSearch(
  queryEmbedding: number[],
  category: string,
  limit: number,
): Promise<VectorSearchResult[]> {
  const docs = await loadEmbeddingDocs();
  if (docs.length === 0) return [];

  // Filter by category if specified
  const filtered = category
    ? docs.filter(d => d.category === category)
    : docs;

  if (filtered.length === 0) return [];

  // Compute cosine similarity for each doc
  const scored = filtered.map(doc => ({
    doc,
    similarity: cosineSimilarity(queryEmbedding, doc.embedding),
  }));

  // Sort by similarity descending
  scored.sort((a, b) => b.similarity - a.similarity);

  // Return top results
  return scored.slice(0, limit).map(({ doc, similarity }) => ({
    _id: doc._id,
    caption: doc.caption,
    engagementRate: doc.engagement_rate,
    category: doc.category,
    score: Math.round(similarity * 10000) / 10000,
    hashtags: doc.hashtags,
    hasCta: doc.has_cta,
    hasPrice: doc.has_price,
  }));
}

// ─── Silent LLM Embedding Enhancement ──────────────────────────────────────

/**
 * Uses the silent LLM to generate a semantic summary of the caption,
 * then blends it with the TF-based embedding for richer semantic representation.
 * Falls back to enhanced TF embedding if LLM is unavailable.
 */
async function generateLLMEnhancedEmbedding(
  text: string,
  category: string,
  dimensions: number = 384,
): Promise<number[]> {
  // Check cache first
  const cached = getCachedEmbedding(text);
  if (cached) return cached;

  const baseEmbedding = generateEnhancedEmbedding(text, dimensions);

  try {
    // Dynamic import to avoid issues if Z-AI is not configured
    const ZAI = (await import('z-ai-web-dev-sdk')).default;
    const zai = await ZAI.create();

    const response = await zai.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: 'You are a social media analytics assistant for Ugandan food businesses. Extract key semantic concepts from the caption. Return ONLY a comma-separated list of 10-15 descriptive keywords/phrases that capture the meaning, intent, and context. No explanations.',
        },
        {
          role: 'user',
          content: `Extract semantic keywords from this Ugandan food business social media post (category: ${category}):\n\n"${text}"`,
        },
      ],
      max_tokens: 150,
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      setCachedEmbedding(text, baseEmbedding);
      return baseEmbedding;
    }

    // Parse LLM-generated keywords and blend into embedding
    const llmKeywords = content.toLowerCase().split(',').map(k => k.trim()).filter(k => k.length > 2);
    
    // Create a secondary embedding from LLM keywords
    const llmEmbedding = new Array(dimensions).fill(0);
    for (const keyword of llmKeywords) {
      const words = keyword.split(/\s+/);
      // Unigram
      for (const word of words) {
        const hash = multiHash(word) % (dimensions - 20);
        llmEmbedding[hash] += 1.5;
      }
      // Bigram for multi-word keywords
      if (words.length > 1) {
        const bigram = words.join('_');
        const hash = multiHash(bigram) % (dimensions - 20);
        llmEmbedding[hash] += 1.0;
      }
    }

    // Normalize LLM embedding
    const llmNorm = Math.sqrt(llmEmbedding.reduce((s, v) => s + v * v, 0)) || 1;
    for (let i = 0; i < llmEmbedding.length; i++) {
      llmEmbedding[i] /= llmNorm;
    }

    // Blend: 65% TF + 35% LLM (LLM adds semantic richness without dominating)
    const blended = baseEmbedding.map((v, i) => v * 0.65 + llmEmbedding[i] * 0.35);

    // Re-normalize
    const blendNorm = Math.sqrt(blended.reduce((s, v) => s + v * v, 0)) || 1;
    const result = blended.map(v => Number((v / blendNorm).toFixed(6)));

    setCachedEmbedding(text, result);
    return result;

  } catch {
    // LLM unavailable — use enhanced TF embedding
    setCachedEmbedding(text, baseEmbedding);
    return baseEmbedding;
  }
}

// ─── RAG Search (Three-Tier) ───────────────────────────────────────────────

export async function searchSimilarPosts(
  caption: string,
  category: string,
  limit: number = 5,
): Promise<VectorSearchResult[]> {
  try {
    // Generate embedding (try LLM-enhanced first, fall back to enhanced TF)
    const embedding = await generateLLMEnhancedEmbedding(caption, category);

    // Tier 1: Try Atlas Vector Search
    try {
      const repo = new EmbeddingsRepository();
      const results = await repo.vectorSearch(embedding, limit, { category });
      if (results && results.length > 0) {
        return results as VectorSearchResult[];
      }
    } catch {
      // Atlas Vector Search not available (no index created)
    }

    // Tier 2: In-memory cosine similarity search (automatic fallback, no Atlas index needed)
    try {
      const results = await inMemoryVectorSearch(embedding, category, limit);
      if (results.length > 0) {
        return results;
      }
    } catch {
      // In-memory search failed
    }

    // Tier 3: Text-based regex search (last resort)
    return await enhancedTextSearch(caption, category, limit);
  } catch {
    return [];
  }
}

/**
 * Enhanced text-based search using MongoDB text search + keyword matching.
 * This is the fallback when Atlas Vector Search and in-memory search both fail.
 */
async function enhancedTextSearch(
  caption: string,
  category: string,
  limit: number,
): Promise<VectorSearchResult[]> {
  try {
    const dbConnected = await healthCheck();
    if (!dbConnected) return [];

    const collection = await getCollection('embeddings');
    
    // Extract meaningful keywords from caption
    const keywords = caption.toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['that', 'this', 'with', 'from', 'have', 'been', 'they', 'will', 'what', 'when', 'make', 'like', 'just', 'over', 'such', 'take', 'than', 'them', 'very', 'also', 'into', 'more', 'some', 'could', 'time', 'these', 'about', 'which', 'their', 'would', 'there', 'other', 'after', 'most', 'being', 'where'].includes(w))
      .slice(0, 8);

    if (keywords.length === 0) return [];

    // Use MongoDB $or with regex for flexible matching
    const results = await collection.find({
      category,
      $or: keywords.map(kw => ({ caption: { $regex: kw, $options: 'i' } })),
    }).sort({ engagement_rate: -1 }).limit(limit).toArray();

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

    if (post.hasCta && !captionFeatures.hasCta) {
      patterns.push('Uses a call-to-action');
    }
    if (post.hasPrice && !captionFeatures.hasPrice) {
      patterns.push('Includes pricing info');
    }
    if (post.hashtags.length >= rules.idealHashtags && captionFeatures.hashtagCount < rules.idealHashtags) {
      patterns.push(`Uses ${post.hashtags.length}+ hashtags`);
    }
    if (post.engagementRate > 0.07) {
      patterns.push('High engagement rate');
    }

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
    // Try LLM-enhanced embedding, fall back to enhanced TF
    const embedding = await generateLLMEnhancedEmbedding(caption, category);
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

    // Invalidate in-memory cache so new embeddings are picked up
    embeddingDocCache = [];
    embeddingCacheTime = 0;
  } catch {
    // Non-critical — don't fail the evaluation
  }
}
