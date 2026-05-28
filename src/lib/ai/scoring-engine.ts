/**
 * TrendLens AI v6.0 — Scoring Engine
 * Heuristic + data-driven hybrid scoring with MongoDB benchmarks.
 * No external APIs — all computation is local.
 */

import { CaptionFeatures, ImageQualityMetrics, BenchmarkData, ShapValue } from './types';
import { getCategoryRule } from './category-rules';

// ─── Score Conversion ──────────────────────────────────────────────────────

export function scoreTo1to10(score100: number): number {
  const scaled = 1 + (score100 / 100) * 9;
  return Math.round(Math.max(1, Math.min(10, scaled)) * 10) / 10;
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
    else if (imageQuality.blurScore < 0.2) score -= 5; // Blurry image penalty

    if (imageQuality.resolution.width < 400) score -= 3; // Low resolution

    if (imageQuality.qualityRating === 'excellent') score += 3;
    else if (imageQuality.qualityRating === 'poor') score -= 4;
  }

  return Math.max(0, Math.min(100, score));
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
    // Brightness
    if (imageQuality.brightness >= 0.3 && imageQuality.brightness <= 0.7) score += 0.8;
    else if (imageQuality.brightness < 0.2) score -= 0.3;

    // Contrast
    if (imageQuality.contrast > 0.4) score += 0.7;
    else if (imageQuality.contrast > 0.25) score += 0.3;

    // Saturation
    if (imageQuality.saturation > 0.3) score += 0.6;
    else if (imageQuality.saturation > 0.15) score += 0.3;

    // Blur
    if (imageQuality.blurScore > 0.5) score += 0.5;
    else if (imageQuality.blurScore < 0.2) score -= 0.4;

    // Resolution
    if (imageQuality.resolution.width >= 1080) score += 0.3;

    // Quality rating bonus
    if (imageQuality.qualityRating === 'excellent') score += 0.4;
    else if (imageQuality.qualityRating === 'poor') score -= 0.5;
  }

  // OCR-derived features (from caption if image analyzed)
  if (captionFeatures.hasPrice) score += 0.5;
  if (captionFeatures.hasCta) score += 0.5;

  // MongoDB benchmarks
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
    // Fallback manual scoring
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

  // MongoDB benchmark adjustments
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
