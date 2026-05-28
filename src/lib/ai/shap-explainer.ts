/**
 * TrendLens AI v6.0 — SHAP Explainer
 * Simplified SHAP (SHapley Additive exPlanations) value computation
 * for explaining feature contributions to the evaluation score.
 * No external APIs — all computation is local.
 */

import { CaptionFeatures, ImageQualityMetrics, ShapValue } from './types';

// ─── Feature Definitions ───────────────────────────────────────────────────

interface FeatureDef {
  name: string;
  description: string;
  getValue: (cf: CaptionFeatures, iq: ImageQualityMetrics | null) => number;
  getWeight: () => number; // Base weight for this feature
  getContribution: (value: number, weight: number) => number;
}

const FEATURE_DEFINITIONS: FeatureDef[] = [
  {
    name: 'Hashtags',
    description: 'Number of hashtags in the caption',
    getValue: (cf) => Math.min(1, cf.hashtagCount / 10),
    getWeight: () => 12,
    getContribution: (v, w) => v > 0.7 ? w : v > 0.4 ? w * (v - 0.2) : -w * (0.5 - v),
  },
  {
    name: 'Call to Action',
    description: 'Presence of a call-to-action phrase',
    getValue: (cf) => cf.hasCta ? 1 : 0,
    getWeight: () => 10,
    getContribution: (v, w) => v ? w : -w * 0.8,
  },
  {
    name: 'Price Mention',
    description: 'Includes pricing information (UGX)',
    getValue: (cf) => cf.hasPrice ? 1 : 0,
    getWeight: () => 8,
    getContribution: (v, w) => v ? w : -w * 0.3,
  },
  {
    name: 'Caption Length',
    description: 'Word count in the caption',
    getValue: (cf) => {
      if (cf.wordCount >= 50 && cf.wordCount <= 200) return 1;
      if (cf.wordCount >= 20 && cf.wordCount < 50) return 0.5;
      return cf.wordCount < 20 ? 0 : 0.7;
    },
    getWeight: () => 8,
    getContribution: (v, w) => v > 0.8 ? w : v > 0.4 ? w * (v - 0.1) : -w * (0.9 - v),
  },
  {
    name: 'Sentiment',
    description: 'Positive tone in the caption',
    getValue: (cf) => (cf.sentiment.polarity + 1) / 2,
    getWeight: () => 5,
    getContribution: (v, w) => v > 0.6 ? w * (v - 0.4) : v < 0.4 ? -w * (0.5 - v) : 0,
  },
  {
    name: 'Trend Alignment',
    description: 'Alignment with current trending topics',
    getValue: (cf) => cf.trendAlignment?.score ?? 0,
    getWeight: () => 10,
    getContribution: (v, w) => v > 0.3 ? w * v : v > 0.1 ? w * v * 0.5 : -w * (0.1 - v),
  },
  {
    name: 'Emojis',
    description: 'Visual appeal from emoji usage',
    getValue: (cf) => Math.min(1, cf.emojiCount / 3),
    getWeight: () => 2,
    getContribution: (v, w) => v > 0 ? w * v : -w * 0.1,
  },
  {
    name: 'Readability',
    description: 'How easy the caption is to read',
    getValue: (cf) => cf.readability,
    getWeight: () => 3,
    getContribution: (v, w) => v > 0.6 ? w * (v - 0.3) : -w * (0.4 - v),
  },
  {
    name: 'Image Brightness',
    description: 'Poster image brightness level',
    getValue: (_, iq) => {
      if (!iq) return 0.5;
      // Continuous: sweet spot 0.35-0.65 scores highest, too dark/bright scores low
      const b = iq.brightness;
      if (b >= 0.35 && b <= 0.65) return 0.8 + (0.2 * (1 - Math.abs(b - 0.5) / 0.15));
      if (b >= 0.2 && b <= 0.8) return 0.4 + 0.4 * (1 - Math.min(Math.abs(b - 0.5), 0.3) / 0.3);
      return Math.max(0.1, 0.3 - Math.abs(b - 0.5));
    },
    getWeight: () => 5,
    getContribution: (v, w) => v > 0.8 ? w * v * 0.8 : v > 0.5 ? w * v * 0.5 : -w * (0.5 - v),
  },
  {
    name: 'Image Sharpness',
    description: 'Image clarity (blur detection)',
    getValue: (_, iq) => iq ? iq.blurScore : 0.5,
    getWeight: () => 4,
    getContribution: (v, w) => v > 0.6 ? w * v * 0.6 : v > 0.3 ? w * v * 0.3 : -w * (0.3 - v),
  },
  {
    name: 'Color Saturation',
    description: 'Vibrancy of poster colors',
    getValue: (_, iq) => {
      if (!iq) return 0.3;
      // Continuous: higher saturation = more vibrant food photos
      return Math.min(1, iq.saturation * 2.5);
    },
    getWeight: () => 3,
    getContribution: (v, w) => v > 0.6 ? w * v * 0.6 : v > 0.3 ? w * v * 0.3 : -w * (0.3 - v),
  },
  {
    name: 'Image Resolution',
    description: 'Image pixel dimensions',
    getValue: (_, iq) => {
      if (!iq) return 0.3;
      const w = iq.resolution?.width ?? 0;
      if (w >= 1080) return 1.0;
      if (w >= 720) return 0.7;
      if (w >= 480) return 0.4;
      return 0.15;
    },
    getWeight: () => 3,
    getContribution: (v, w) => v > 0.7 ? w * 0.5 : v > 0.4 ? w * v * 0.3 : -w * (0.4 - v),
  },
];

// ─── SHAP Computation ──────────────────────────────────────────────────────

export function computeShapValues(
  captionFeatures: CaptionFeatures,
  imageQuality: ImageQualityMetrics | null,
): ShapValue[] {
  const shapValues: ShapValue[] = [];
  let totalContribution = 0;

  for (const feature of FEATURE_DEFINITIONS) {
    const value = feature.getValue(captionFeatures, imageQuality);
    const weight = feature.getWeight();
    const contribution = feature.getContribution(value, weight);

    totalContribution += contribution;

    shapValues.push({
      feature: feature.name,
      value: Math.round(value * 100) / 100,
      contribution: Math.round(contribution * 10) / 10,
      description: feature.description,
    });
  }

  // Normalize contributions so they sum to the score range
  // Base score is 40/100, contributions adjust from there
  const maxPossibleContribution = FEATURE_DEFINITIONS.reduce((sum, f) => sum + f.getWeight(), 0);
  const scale = 60 / maxPossibleContribution; // 60 is the range we adjust over

  return shapValues.map(sv => ({
    ...sv,
    contribution: Math.round(sv.contribution * scale * 10) / 10,
  })).sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

// ─── Feature Importance Summary ────────────────────────────────────────────

export function getFeatureImportanceSummary(shapValues: ShapValue[]): {
  topPositive: ShapValue[];
  topNegative: ShapValue[];
  summary: string;
} {
  const positive = shapValues.filter(s => s.contribution > 0).sort((a, b) => b.contribution - a.contribution);
  const negative = shapValues.filter(s => s.contribution < 0).sort((a, b) => a.contribution - b.contribution);

  let summary = '';
  if (positive.length > 0) {
    summary += `Your strongest points: ${positive.slice(0, 3).map(p => p.feature).join(', ')}. `;
  }
  if (negative.length > 0) {
    summary += `Areas to improve: ${negative.slice(0, 3).map(n => n.feature).join(', ')}.`;
  }

  return {
    topPositive: positive.slice(0, 5),
    topNegative: negative.slice(0, 5),
    summary,
  };
}
