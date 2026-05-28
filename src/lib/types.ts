/**
 * TrendLens AI v6.0 — Type Definitions
 * Comprehensive TypeScript types for the entire application.
 */

// ─── Evaluation Types ──────────────────────────────────────────────────────

export interface EvalScore {
  score: number;        // 0-100
  lower: number;        // confidence interval lower
  upper: number;        // confidence interval upper
  confidence: number;   // 0-1
  modelVersion: string;
  evaluatedAt: string;
}

export interface PosterEvaluation {
  overallScore: number;     // 1-10
  posterScore: number;      // 1-10
  captionScore: number;     // 1-10
  confidenceInterval: { lower: number; upper: number };
  posterImprovements: string[];
  captionImprovements: string[];
  improvedCaption: string;
  captionVariants: CaptionVariant[];
  ocrText: string;
  category: string;
  annotations: PosterAnnotation[];
  shapValues: ShapValue[];
  ragInsights: RagInsight[];
  captionFeatures: Record<string, unknown>;
  modelVersion: string;
  evaluatedAt: string;
  dataSource: 'mongodb' | 'heuristic';
  benchmarks: BenchmarkData;
  captionInsight?: string;
}

export interface PosterAnnotation {
  number: number;
  x: number;
  y: number;
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface CaptionVariant {
  platform: 'instagram' | 'twitter' | 'facebook';
  caption: string;
  hashtags: string[];
  scorePrediction: number;
  reasoning: string;
}

// ─── SHAP Types ────────────────────────────────────────────────────────────

export interface ShapValue {
  feature: string;
  value: number;       // actual feature value (normalized)
  contribution: number; // SHAP contribution (positive = increases score, negative = decreases)
  description: string;
}

// ─── RAG Types ─────────────────────────────────────────────────────────────

export interface RagInsight {
  postId: string;
  caption: string;
  engagementRate: number;
  category: string;
  similarity: number;
  keyPatterns: string[];
  takeaway: string;
}

export interface VectorSearchResult {
  _id: string;
  caption: string;
  engagementRate: number;
  category: string;
  score: number; // similarity score
  hashtags: string[];
  hasCta: boolean;
  hasPrice: boolean;
}

// ─── Benchmark Types ───────────────────────────────────────────────────────

export interface BenchmarkData {
  dbConnected: boolean;
  categorySamples: number;
  industryAvgEngagement: number;
  top10Engagement: number;
  hashtagPerformance: Record<string, { avgEngagement: number; count: number }>;
  ctaEngagementBoost: number;
  priceEngagementBoost: number;
  modelVersion: string;
  modelAuc: number;
  topHashtags?: string[];
}

// ─── Trend Types ───────────────────────────────────────────────────────────

export interface TrendSignal {
  keyword: string;
  source: string;
  score: number;
  volume: number;
  growthRate: number;
  category: string;
  country: string;
  fetchedAt: string;
}

export interface TrendSnapshot {
  keyword: string;
  source: string;
  score: number;
  timestamp: string;
}

// ─── Model Types ───────────────────────────────────────────────────────────

export interface ModelRegistryEntry {
  modelType: string;
  version: string;
  auc: number;
  samples: number;
  features: string[];
  foldAucs: number[];
  trainedAt: string;
}

// ─── Drift Types ───────────────────────────────────────────────────────────

export interface DriftMeasurement {
  timestamp: string;
  mmdScore: number;
  pValue: number;
  isDrift: boolean;
  sampleSize: number;
  baselineStats: { mean: number; std: number };
}

// ─── Feature Types ─────────────────────────────────────────────────────────

export interface CaptionFeatures {
  hashtagCount: number;
  wordCount: number;
  emojiCount: number;
  hasPrice: boolean;
  hasCta: boolean;
  ctaType: string;
  sentiment: { polarity: number; subjectivity: number };
  readability: number;
  trendAlignment: { score: number; method: string; bestTrendKeyword: string; matchedKeywords: string[] };
  categoryChecks: Record<string, unknown>;
  captionScore: number;
  suggestions: string[];
  rawCaption: string;
}

export interface ImageQualityMetrics {
  brightness: number;
  contrast: number;
  saturation: number;
  blurScore: number;
  resolution: { width: number; height: number };
  aspectRatio: number;
  qualityRating: 'excellent' | 'good' | 'fair' | 'poor';
}

export interface ExtractedFeatures {
  captionFeatures: CaptionFeatures;
  imageQuality: ImageQualityMetrics | null;
  category: string;
  featureVector: number[];
}

// ─── Category Rules ────────────────────────────────────────────────────────

export interface CategoryRule {
  idealHashtags: number;
  minHashtags: number;
  idealCaptionLength: [number, number];
  requiredKeywords: string[];
  priceRequired: boolean;
  ctaRequired: boolean;
}

// ─── Feedback Types ────────────────────────────────────────────────────────

export interface UserFeedback {
  evaluationId: string;
  type: 'caption' | 'score' | 'suggestion';
  rating: 'thumbs_up' | 'thumbs_down';
  comment?: string;
  timestamp: string;
}

// ─── Pipeline Types ────────────────────────────────────────────────────────

export interface PipelineStatus {
  lastTransformAt: string | null;
  lastRetrainAt: string | null;
  transformStatus: 'idle' | 'running' | 'completed' | 'failed';
  retrainStatus: 'idle' | 'running' | 'completed' | 'failed';
  groundTruthCount: number;
  modelAuc: number;
  modelVersion: string;
}

// ─── Stats Types ───────────────────────────────────────────────────────────

export interface DashboardStats {
  totalEvaluations: number;
  groundTruthCount: number;
  modelAuc: number;
  modelVersion: string;
  avgScore: number;
  topCategory: string;
  dbConnected: boolean;
}
