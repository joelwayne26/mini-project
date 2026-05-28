/**
 * TrendLens AI v6.0 — MongoDB Client & Repositories
 * Native MongoDB driver with connection pooling for Vercel serverless.
 * Supports MongoDB Atlas Vector Search for RAG.
 */

import { MongoClient, Db, Collection } from 'mongodb';
import { config } from '../config';

// ─── Connection Manager ────────────────────────────────────────────────────

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function getDb(): Promise<Db> {
  if (cachedDb && cachedClient) {
    try {
      await cachedClient.db('admin').command({ ping: 1 });
      return cachedDb;
    } catch {
      cachedClient = null;
      cachedDb = null;
    }
  }

  if (!config.mongoUri) {
    throw new Error('MONGO_URI not configured');
  }

  const client = new MongoClient(config.mongoUri, {
    maxPoolSize: config.mongoMaxPoolSize,
    minPoolSize: config.mongoMinPoolSize,
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000,
  });

  await client.connect();
  cachedClient = client;
  cachedDb = client.db(config.mongoDbName);
  return cachedDb;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export function getCollection(name: string): Promise<Collection> {
  return getDb().then(db => db.collection(name));
}

// ─── Base Repository ───────────────────────────────────────────────────────

export class BaseRepository {
  protected collectionName: string;

  constructor(collectionName: string) {
    this.collectionName = collectionName;
  }

  protected async coll(): Promise<Collection> {
    return getCollection(this.collectionName);
  }

  async findOne(query: Record<string, unknown>) {
    const c = await this.coll();
    return c.findOne(query);
  }

  async findMany(query: Record<string, unknown>, options?: { sort?: Record<string, number>; limit?: number; skip?: number }) {
    const c = await this.coll();
    let cursor = c.find(query);
    if (options?.sort) cursor = cursor.sort(options.sort);
    if (options?.skip) cursor = cursor.skip(options.skip);
    if (options?.limit) cursor = cursor.limit(options.limit);
    return cursor.toArray();
  }

  async insertOne(doc: Record<string, unknown>) {
    const c = await this.coll();
    const result = await c.insertOne({ ...doc, created_at: new Date().toISOString() });
    return result.insertedId.toString();
  }

  async updateOne(query: Record<string, unknown>, update: Record<string, unknown>, upsert = false) {
    const c = await this.coll();
    const result = await c.updateOne(
      query,
      { $set: { ...update, updated_at: new Date().toISOString() } },
      { upsert }
    );
    return result.acknowledged;
  }

  async count(query: Record<string, unknown> = {}) {
    const c = await this.coll();
    return c.countDocuments(query);
  }

  async aggregate(pipeline: Record<string, unknown>[]) {
    const c = await this.coll();
    return c.aggregate(pipeline).toArray();
  }

  async deleteMany(query: Record<string, unknown>) {
    const c = await this.coll();
    return c.deleteMany(query);
  }
}

// ─── Specialized Repositories ──────────────────────────────────────────────

export class PostsRepository extends BaseRepository {
  constructor() { super('posts'); }

  async getHighEngagement(category?: string, limit = 20) {
    const query: Record<string, unknown> = {};
    if (category) query.category = category;
    return this.findMany(query, { sort: { engagement_rate: -1 }, limit });
  }
}

export class GroundTruthRepository extends BaseRepository {
  constructor() { super('ground_truth_posts'); }

  async getLabelled() {
    return this.findMany({ label: { $exists: true } }, { sort: { engagement_rate: -1 } });
  }

  async getHighEngagement(threshold = 0.7) {
    return this.findMany({ engagement_rate: { $gte: threshold } });
  }
}

export class ModelRegistryRepository extends BaseRepository {
  constructor() { super('model_registry'); }

  async getLatest(modelType: string) {
    const results = await this.findMany({ model_type: modelType }, { sort: { trained_at: -1 }, limit: 1 });
    return results[0] || null;
  }

  async getAllVersions(modelType: string) {
    return this.findMany({ model_type: modelType }, { sort: { trained_at: -1 } });
  }
}

export class EvaluationRepository extends BaseRepository {
  constructor() { super('evaluations'); }

  async getRecent(limit = 20) {
    return this.findMany({}, { sort: { evaluated_at: -1 }, limit });
  }

  async getAverageScore() {
    const result = await this.aggregate([
      { $group: { _id: null, avgScore: { $avg: '$overall_score' }, count: { $sum: 1 } } }
    ]);
    return result[0] || { avgScore: 0, count: 0 };
  }
}

export class TrendSnapshotRepository extends BaseRepository {
  constructor() { super('trend_snapshots'); }

  async getLatestByCategory(category: string, hours = 24) {
    const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
    return this.findMany({ category, fetched_at: { $gte: cutoff } }, { sort: { score: -1 } });
  }
}

export class FeedbackRepository extends BaseRepository {
  constructor() { super('user_feedback'); }

  async getStats() {
    const result = await this.aggregate([
      { $group: { _id: '$type', thumbsUp: { $sum: { $cond: [{ $eq: ['$rating', 'thumbs_up'] }, 1, 0] } }, thumbsDown: { $sum: { $cond: [{ $eq: ['$rating', 'thumbs_down'] }, 1, 0] } }, total: { $sum: 1 } } }
    ]);
    return result;
  }
}

export class DriftStateRepository extends BaseRepository {
  constructor() { super('drift_state'); }

  async getLatest() {
    const results = await this.findMany({}, { sort: { timestamp: -1 }, limit: 1 });
    return results[0] || null;
  }

  async getHistory(limit = 50) {
    return this.findMany({}, { sort: { timestamp: -1 }, limit });
  }
}

export class EmbeddingsRepository extends BaseRepository {
  constructor() { super('embeddings'); }

  async vectorSearch(embedding: number[], limit = 5, filter?: Record<string, unknown>) {
    const db = await getDb();
    const pipeline: Record<string, unknown>[] = [
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'embedding',
          queryVector: embedding,
          numCandidates: limit * 10,
          limit,
        }
      },
      {
        $project: {
          caption: 1,
          engagement_rate: 1,
          category: 1,
          hashtags: 1,
          has_cta: 1,
          has_price: 1,
          score: { $meta: 'vectorSearchScore' },
        }
      }
    ];
    if (filter) {
      pipeline[0].$vectorSearch.filter = filter;
    }
    return db.collection(this.collectionName).aggregate(pipeline).toArray();
  }

  async storeEmbedding(doc: Record<string, unknown>) {
    return this.insertOne(doc);
  }
}

export class ActivityLogRepository extends BaseRepository {
  constructor() { super('system_activity_log'); }

  async logEvent(eventType: string, message: string, metadata?: Record<string, unknown>) {
    return this.insertOne({ event_type: eventType, message, metadata: metadata || {} });
  }

  async getRecent(limit = 20) {
    return this.findMany({}, { sort: { timestamp: -1 }, limit });
  }
}
