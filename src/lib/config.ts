/**
 * TrendLens AI v6.0 — Configuration
 * All settings loaded from environment variables with sensible defaults.
 * Designed for Vercel deployment with MongoDB Atlas free tier.
 */

export const config = {
  // MongoDB Atlas
  mongoUri: process.env.MONGO_URI || '',
  mongoDbName: process.env.MONGO_DB_NAME || 'trendlens',
  mongoMaxPoolSize: parseInt(process.env.MONGO_MAX_POOL_SIZE || '10'),
  mongoMinPoolSize: parseInt(process.env.MONGO_MIN_POOL_SIZE || '2'),

  // App
  appName: 'TrendLens AI v6',
  appVersion: '6.0.0',
  debug: process.env.DEBUG === 'true',

  // ML / Scoring
  retrainMinSamples: parseInt(process.env.RETRAIN_MIN_SAMPLES || '30'),
  retrainIntervalHours: parseInt(process.env.RETRAIN_INTERVAL_HOURS || '24'),
  xgboostMaxDepth: parseInt(process.env.XGBOOST_MAX_DEPTH || '6'),
  xgboostNEstimators: parseInt(process.env.XGBOOST_N_ESTIMATORS || '200'),
  xgboostLearningRate: parseFloat(process.env.XGBOOST_LEARNING_RATE || '0.1'),

  // Trend Sources
  pytrendsGeo: process.env.PYTRENDS_GEO || 'UG',

  // API Keys (optional — free sources work without them)
  apifyToken: process.env.APIFY_API_TOKEN || '',
  redditClientId: process.env.REDDIT_CLIENT_ID || '',
  redditClientSecret: process.env.REDDIT_CLIENT_SECRET || '',
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',

  // Feature flags
  ragEnabled: process.env.RAG_ENABLED !== 'false',
  shapEnabled: process.env.SHAP_ENABLED !== 'false',
  captionGenEnabled: process.env.CAPTION_GEN_ENABLED !== 'false',

  // Category tracking
  trackCategories: (process.env.TRACK_CATEGORIES || 'cake,bakery,restaurant,general').split(','),

  // Image processing
  maxImageSizeMB: parseInt(process.env.MAX_IMAGE_SIZE_MB || '10'),
} as const;

export type Config = typeof config;
