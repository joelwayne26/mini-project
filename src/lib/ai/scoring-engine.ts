/**
 * TrendLens AI v6.0 — Scoring Engine (ML-Enhanced Edition)
 * Heuristic + data-driven hybrid scoring with MongoDB benchmarks.
 * Now supports logistic regression model predictions when a trained model is available.
 * Falls back gracefully to heuristic scoring.
 */

import { CaptionFeatures, ImageQualityMetrics, BenchmarkData, ShapValue } from './types';
import { getCategoryRule } from './category-rules';
import { ModelRegistryRepository } from '../db/client';

// ─── Score Conversion ──────────────────────────────────────────────────────

export function scoreTo1to10(score100: number): number {
  const scaled = 1 + (score100 / 100) * 9;
  return Math.round(Math.max(1, Math.min(10, scaled)) * 10) / 10;
}

// ─── ML Model Prediction ───────────────────────────────────────────────────

interface TrainedModel {
  weights: number[];
  bias: number;
  means: number[];
  stds: number[];
  version: string;
  auc: number;
}

let cachedModel: TrainedModel | null = null;
let modelCacheTime = 0;
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
}

/**
 * Load the latest trained logistic regression model from MongoDB.
 * Uses caching to avoid repeated DB queries.
 */
async function loadTrainedModel(): Promise<TrainedModel | null> {
  if (cachedModel && Date.now() - modelCacheTime < MODEL_CACHE_TTL) {
    return cachedModel;
  }

  try {
    const repo = new ModelRegistryRepository();
    const latest = await repo.getLatest('logistic_regression');

    if (!latest || !latest.weights || !latest.normalization) {
      return null;
    }

    cachedModel = {
      weights: latest.weights as number[],
      bias: latest.bias as number,
      means: (latest.normalization as any).means as number[],
      stds: (latest.normalization as any).stds as number[],
      version: latest.version as string,
      auc: latest.auc as number,
    };
    modelCacheTime = Date.now();

    return cachedModel;
  } catch {
    return null;
  }
}

/**
 * Predict engagement probability using the trained logistic regression model.
 * Returns a value between 0 and 1, where higher = more likely high engagement.
 */
function predictWithModel(model: TrainedModel, featureVector: number[]): number {
  if (featureVector.length !== model.weights.length) return 0.5;

  // Normalize features using training normalization parameters
  const normalized = featureVector.map((v, i) =>
    (v - (model.means[i] || 0)) / (model.stds[i] || 1)
  );

  let z = model.bias;
  for (let i = 0; i < normalized.length; i++) {
    z += model.weights[i] * normalized[i];
  }

  return sigmoid(z);
}

// ─── Heuristic Scoring ─────────────────────────────────────────────────────

export function heuristicScore(
  captionFeatures: CaptionFeatures,
  imageQuality: ImageQualityMetrics | null,
): number {
  let score = 40; // Neutral baseline

  const cf = captionFeatures;

  // Hashtags
  if (cf.hashtagCount >= 8) score += 12;
  else if (cf.hashtagCount >= 5) score += 8;
  else if (cf.hashtagCount >= 3) score += 3;
  else score -= 5;

  // CTA
  if (cf.hasCta) score += 10;
  else score -= 8;

  // Price
  if (cf.hasPrice) score += 8;
  else score -= 3;

  // Caption length
  if (cf.wordCount >= 50 && cf.wordCount <= 200) score += 8;
  else if (cf.wordCount < 20) score -= 10;
  else if (cf.wordCount > 300) score -= 3;

  // Trend alignment
  score += cf.trendAlignment.score * 10;

  // Sentiment
  if (cf.sentiment.polarity > 0.2) score += 5;
  else if (cf.sentiment.polarity < -0.2) score -= 5;

  // Readability
  if (cf.readability > 0.7) score += 3;

  // Emoji
  if (cf.emojiCount >= 1) score += 2;

  // Image quality
  if (imageQuality) {
    if (imageQuality.brightness > 0.2 && imageQuality.brightness < 0.8) score += 5;
    else if (imageQuality.brightness < 0.15) score -= 5;

    if (imageQuality.contrast > 0.15) score += 4;
    else if (imageQuality.contrast < 0.08) score -= 3;

    if (imageQuality.saturation > 0.2) score += 3;

    if (imageQuality.blurScore > 0.5) score += 4;
    else if (imageQuality.blurScore < 0.2) score -= 5;

    if (imageQuality.resolution.width < 400) score -= 3;

    if (imageQuality.qualityRating === 'excellent') score += 3;
    else if (imageQuality.qualityRating === 'poor') score -= 4;
  }

  return Math.max(0, Math.min(100, score));
}

// ─── ML-Enhanced Scoring ───────────────────────────────────────────────────

/**
 * Compute a score that blends heuristic scoring with ML model prediction.
 * If no trained model is available, falls back to pure heuristic scoring.
 */
export async function mlEnhancedScore(
  captionFeatures: CaptionFeatures,
  imageQuality: ImageQualityMetrics | null,
  featureVector: number[],
): Promise<{ score: number; modelUsed: boolean; modelVersion: string; modelAuc: number }> {
  const heuristic = heuristicScore(captionFeatures, imageQuality);

  const model = await loadTrainedModel();
  if (!model) {
    return { score: heuristic, modelUsed: false, modelVersion: 'heuristic', modelAuc: 0 };
  }

  const mlProb = predictWithModel(model, featureVector);
  // Convert ML probability to 0-100 scale
  const mlScore = mlProb * 100;

  // Blend: 60% heuristic + 40% ML (ML complements but doesn't replace heuristics)
  const blended = heuristic * 0.6 + mlScore * 0.4;

  return {
    score: Math.max(0, Math.min(100, blended)),
    modelUsed: true,
    modelVersion: model.version,
    modelAuc: model.auc,
  };
}

// ─── Data-Driven Score Adjustment ──────────────────────────────────────────

export function adjustScoreWithBenchmarks(
  heuristicScore10: number,
  captionFeatures: CaptionFeatures,
  benchmarks: BenchmarkData,
): number {
  let adjusted = heuristicScore10;

  if (!benchmarks.dbConnected || benchmarks.categorySamples < 5) {
    return adjusted;
  }

  // CTA adjustment
  const ctaBoost = benchmarks.ctaEngagementBoost;
  if (ctaBoost > 0 && captionFeatures.hasCta) {
    adjusted += Math.min(0.5, ctaBoost * 2);
  } else if (ctaBoost > 0 && !captionFeatures.hasCta) {
    adjusted -= Math.min(0.4, ctaBoost * 1.5);
  }

  // Price adjustment
  const priceBoost = benchmarks.priceEngagementBoost;
  if (priceBoost > 0 && captionFeatures.hasPrice) {
    adjusted += Math.min(0.4, priceBoost * 2);
  } else if (priceBoost > 0 && !captionFeatures.hasPrice) {
    adjusted -= Math.min(0.3, priceBoost * 1.5);
  }

  // Hashtag alignment with top performers
  const hashtagPerf = benchmarks.hashtagPerformance;
  if (Object.keys(hashtagPerf).length > 0) {
    const lower = captionFeatures.rawCaption.toLowerCase();
    const matching = Object.keys(hashtagPerf).filter(tag => lower.includes(`#${tag}`)).length;
    if (matching >= 3) adjusted += 0.3;
    else if (matching >= 1) adjusted += 0.1;
  }

  return Math.round(Math.max(1, Math.min(10, adjusted)) * 10) / 10;
}

// ─── Confidence Interval ───────────────────────────────────────────────────

export function computeConfidenceInterval(score: number): { lower: number; upper: number } {
  const width = 10 + (100 - score) * 0.05; // More uncertainty for lower scores
  return {
    lower: Math.max(0, score - width / 2),
    upper: Math.min(100, score + width / 2),
  };
}

// ─── Poster Score (1-10) ───────────────────────────────────────────────────

export function computePosterScore(
  imageQuality: ImageQualityMetrics | null,
  captionFeatures: CaptionFeatures,
  benchmarks: BenchmarkData | null,
): number {
  let score = 5.0; // baseline

  if (imageQuality) {
    if (imageQuality.brightness >= 0.3 && imageQuality.brightness <= 0.7) score += 0.8;
    else if (imageQuality.brightness < 0.2) score -= 0.3;

    if (imageQuality.contrast > 0.4) score += 0.7;
    else if (imageQuality.contrast > 0.25) score += 0.3;

    if (imageQuality.saturation > 0.3) score += 0.6;
    else if (imageQuality.saturation > 0.15) score += 0.3;

    if (imageQuality.blurScore > 0.5) score += 0.5;
    else if (imageQuality.blurScore < 0.2) score -= 0.4;

    if (imageQuality.resolution.width >= 1080) score += 0.3;

    if (imageQuality.qualityRating === 'excellent') score += 0.4;
    else if (imageQuality.qualityRating === 'poor') score -= 0.5;
  }

  if (captionFeatures.hasPrice) score += 0.5;
  if (captionFeatures.hasCta) score += 0.5;

  if (benchmarks?.dbConnected && benchmarks.categorySamples >= 5) {
    const priceBoost = benchmarks.priceEngagementBoost;
    if (priceBoost > 0 && captionFeatures.hasPrice) score += Math.min(0.4, priceBoost);

    const ctaBoost = benchmarks.ctaEngagementBoost;
    if (ctaBoost > 0 && captionFeatures.hasCta) score += Math.min(0.3, ctaBoost);
  }

  return Math.round(Math.max(1, Math.min(10, score)) * 10) / 10;
}

// ─── Caption Score (1-10) ──────────────────────────────────────────────────

export function computeCaptionScore(
  captionFeatures: CaptionFeatures,
  category: string,
  benchmarks: BenchmarkData | null,
): number {
  const rawScore = captionFeatures.captionScore;
  let baseScore = rawScore > 0 ? scoreTo1to10(rawScore) : 4.0;

  if (rawScore <= 0) {
    if (captionFeatures.hashtagCount >= 8) baseScore += 1.5;
    else if (captionFeatures.hashtagCount >= 5) baseScore += 1.0;
    else if (captionFeatures.hashtagCount >= 3) baseScore += 0.5;

    if (captionFeatures.hasCta) baseScore += 1.0;
    if (captionFeatures.hasPrice) baseScore += 0.8;

    const wc = captionFeatures.wordCount;
    if (wc >= 50 && wc <= 200) baseScore += 1.0;
    else if (wc >= 20 && wc < 50) baseScore += 0.5;
    else if (wc < 20) baseScore -= 0.5;

    if (captionFeatures.sentiment.polarity > 0.2) baseScore += 0.5;
    else if (captionFeatures.sentiment.polarity < -0.2) baseScore -= 0.5;

    baseScore += captionFeatures.trendAlignment.score;
    if (captionFeatures.emojiCount >= 1) baseScore += 0.3;
  }

  if (benchmarks?.dbConnected && benchmarks.categorySamples >= 5) {
    const ctaBoost = benchmarks.ctaEngagementBoost;
    if (ctaBoost > 0 && captionFeatures.hasCta) baseScore += Math.min(0.5, ctaBoost * 2);
    else if (ctaBoost > 0) baseScore -= Math.min(0.3, ctaBoost);

    const priceBoost = benchmarks.priceEngagementBoost;
    if (priceBoost > 0 && captionFeatures.hasPrice) baseScore += Math.min(0.4, priceBoost * 2);
    else if (priceBoost > 0) baseScore -= Math.min(0.2, priceBoost);
  }

  return Math.round(Math.max(1, Math.min(10, baseScore)) * 10) / 10;
}
