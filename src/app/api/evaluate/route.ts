/**
 * POST /api/evaluate — Poster evaluation with SHAP + RAG + local caption generation
 * The core endpoint of TrendLens AI v6.0.
 * Now supports real server-side image analysis via Sharp.
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractCaptionFeatures, buildFeatureVector } from '@/lib/ai/feature-extractor';
import { heuristicScore, scoreTo1to10, adjustScoreWithBenchmarks, computeConfidenceInterval, computePosterScore, computeCaptionScore } from '@/lib/ai/scoring-engine';
import { computeShapValues, getFeatureImportanceSummary } from '@/lib/ai/shap-explainer';
import { generateImprovedCaption, generatePlatformVariants } from '@/lib/ai/caption-generator';
import { searchSimilarPosts, generateRagInsights } from '@/lib/ai/rag-engine';
import { computeTrendAlignment } from '@/lib/ai/trend-engine';
import { classifyCategory, getCategoryRule } from '@/lib/ai/category-rules';
import { analyzeImageQuality, generateImageImprovementSuggestions } from '@/lib/ai/server-image-analysis';
import { healthCheck, PostsRepository, GroundTruthRepository, ModelRegistryRepository, EvaluationRepository } from '@/lib/db/client';
import { PosterEvaluation, BenchmarkData, RagInsight, ShapValue, CaptionVariant, ImageQualityMetrics } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { caption = '', imageUrl = '', imageBase64 = '' } = body;

    if (!caption && !imageUrl && !imageBase64) {
      return NextResponse.json(
        { error: 'Provide at least a caption, imageUrl, or imageBase64' },
        { status: 400 }
      );
    }

    // 1. Extract features
    const category = classifyCategory(caption);
    let captionFeatures = extractCaptionFeatures(caption, category);

    // Update trend alignment with actual trend data
    const trendAlignment = computeTrendAlignment(caption, category);
    captionFeatures = {
      ...captionFeatures,
      trendAlignment,
    };

    // 2. Server-side image analysis (if image provided)
    let imageQuality: ImageQualityMetrics | null = null;
    let imageImprovements: string[] = [];
    if (imageBase64) {
      try {
        imageQuality = await analyzeImageQuality(imageBase64);
        imageImprovements = generateImageImprovementSuggestions(imageQuality);
      } catch (err) {
        console.warn('Image analysis failed, proceeding without it:', err);
      }
    }

    // Build feature vector (now with real image quality if available)
    const featureVector = buildFeatureVector(captionFeatures, imageQuality);

    // 3. Fetch MongoDB benchmarks
    const benchmarks = await fetchBenchmarks(category);

    // 4. Compute scores (now using real image quality)
    const rawScore = heuristicScore(captionFeatures, imageQuality);
    const overall10 = scoreTo1to10(rawScore);
    const adjustedOverall = benchmarks.dbConnected && benchmarks.categorySamples >= 5
      ? adjustScoreWithBenchmarks(overall10, captionFeatures, benchmarks)
      : overall10;

    const posterScore = computePosterScore(imageQuality, captionFeatures, benchmarks);
    const captionScoreValue = computeCaptionScore(captionFeatures, category, benchmarks);
    const confidenceInterval = computeConfidenceInterval(rawScore);

    // 5. Compute SHAP values (with image quality)
    const shapValues = computeShapValues(captionFeatures, imageQuality);

    // 6. RAG — search for similar high-performing posts
    let ragInsights: RagInsight[] = [];
    try {
      const similarPosts = await searchSimilarPosts(caption, category, 5);
      ragInsights = generateRagInsights(similarPosts, captionFeatures, category);
    } catch {
      // RAG is non-critical
    }

    // 7. Generate improved caption
    const topHashtags = benchmarks.hashtagPerformance
      ? Object.keys(benchmarks.hashtagPerformance).slice(0, 5)
      : [];
    const improvedCaption = generateImprovedCaption(
      caption, captionFeatures, category,
      trendAlignment.matchedKeywords,
      topHashtags,
    );

    // 8. Generate platform variants
    const captionVariants = generatePlatformVariants(improvedCaption, captionFeatures, category);

    // 9. Generate improvements
    const posterImprovements = generatePosterImprovements(captionFeatures, benchmarks, imageQuality);
    const captionImprovements = generateCaptionImprovements(captionFeatures, category, benchmarks);

    // 10. Generate annotations (now with image-based annotations)
    const annotations = generateAnnotations(captionFeatures, rawScore, imageQuality);

    // 11. Get model version
    let modelVersion = 'heuristic';
    try {
      const modelRepo = new ModelRegistryRepository();
      const latest = await modelRepo.getLatest('xgboost');
      if (latest) modelVersion = (latest.version as string) || 'unknown';
    } catch { /* ignore */ }

    // 12. Store evaluation (with image quality data)
    try {
      const evalRepo = new EvaluationRepository();
      await evalRepo.insertOne({
        caption,
        image_url: imageUrl || '',
        overall_score: adjustedOverall,
        poster_score: posterScore,
        caption_score: captionScoreValue,
        category,
        model_version: modelVersion,
        shap_values: shapValues.map(s => ({ feature: s.feature, contribution: s.contribution })),
        rag_insights_count: ragInsights.length,
        image_quality: imageQuality ? {
          brightness: imageQuality.brightness,
          contrast: imageQuality.contrast,
          saturation: imageQuality.saturation,
          blur_score: imageQuality.blurScore,
          resolution: imageQuality.resolution,
          quality_rating: imageQuality.qualityRating,
        } : null,
      });
    } catch { /* Non-critical */ }

    const result: PosterEvaluation & { imageQuality?: ImageQualityMetrics | null; imageImprovements?: string[] } = {
      overallScore: adjustedOverall,
      posterScore,
      captionScore: captionScoreValue,
      confidenceInterval: {
        lower: scoreTo1to10(confidenceInterval.lower),
        upper: scoreTo1to10(confidenceInterval.upper),
      },
      posterImprovements,
      captionImprovements,
      improvedCaption,
      captionVariants,
      ocrText: '',
      category,
      annotations,
      shapValues,
      ragInsights,
      captionFeatures: {
        hashtagCount: captionFeatures.hashtagCount,
        wordCount: captionFeatures.wordCount,
        emojiCount: captionFeatures.emojiCount,
        hasPrice: captionFeatures.hasPrice,
        hasCta: captionFeatures.hasCta,
        sentiment: captionFeatures.sentiment,
        readability: captionFeatures.readability,
        trendAlignment: captionFeatures.trendAlignment,
        captionScore: captionFeatures.captionScore,
        categoryChecks: captionFeatures.categoryChecks,
      },
      modelVersion,
      evaluatedAt: new Date().toISOString(),
      dataSource: benchmarks.dbConnected ? 'mongodb' : 'heuristic',
      benchmarks,
      imageQuality,
      imageImprovements,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Evaluation failed:', error);
    return NextResponse.json(
      { error: 'Evaluation failed', detail: String(error) },
      { status: 500 }
    );
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function fetchBenchmarks(category: string): Promise<BenchmarkData> {
  const defaults: BenchmarkData = {
    dbConnected: false,
    categorySamples: 0,
    industryAvgEngagement: 0,
    top10Engagement: 0,
    hashtagPerformance: {},
    ctaEngagementBoost: 0,
    priceEngagementBoost: 0,
    modelVersion: 'none',
    modelAuc: 0,
  };

  try {
    const connected = await healthCheck();
    if (!connected) return defaults;

    const gtRepo = new GroundTruthRepository();
    const gtData = await gtRepo.findMany({ category }, { sort: { engagement_rate: -1 }, limit: 200 });

    if (gtData.length === 0) return { ...defaults, dbConnected: true };

    const engagementRates = gtData.map((d: Record<string, unknown>) => Number(d.engagement_rate || 0));
    const avg = engagementRates.reduce((s: number, r: number) => s + r, 0) / engagementRates.length;
    engagementRates.sort((a: number, b: number) => a - b);
    const top10Idx = engagementRates.length >= 10 ? Math.floor(engagementRates.length * 0.9) : engagementRates.length - 1;

    // Hashtag performance
    const hashtagCounts: Record<string, number[]> = {};
    for (const doc of gtData) {
      const caption = String(doc.caption || '');
      const er = Number(doc.engagement_rate || 0);
      const tags = caption.match(/#(\w+)/g) || [];
      for (const tag of tags) {
        const t = tag.slice(1).toLowerCase();
        if (!hashtagCounts[t]) hashtagCounts[t] = [];
        hashtagCounts[t].push(er);
      }
    }
    const hashtagPerf: Record<string, { avgEngagement: number; count: number }> = {};
    for (const [tag, rates] of Object.entries(hashtagCounts)) {
      if (rates.length >= 3) {
        hashtagPerf[tag] = { avgEngagement: rates.reduce((s, r) => s + r, 0) / rates.length, count: rates.length };
      }
    }

    // CTA vs no-CTA
    const ctaPatterns = ['dm to', 'dm us', 'whatsapp', 'link in bio', 'order now'];
    let ctaEr: number[] = [], noCtaEr: number[] = [];
    for (const doc of gtData) {
      const c = String(doc.caption || '').toLowerCase();
      const er = Number(doc.engagement_rate || 0);
      if (ctaPatterns.some(p => c.includes(p))) ctaEr.push(er);
      else noCtaEr.push(er);
    }
    const ctaBoost = ctaEr.length > 0 && noCtaEr.length > 0
      ? (ctaEr.reduce((s, r) => s + r, 0) / ctaEr.length) - (noCtaEr.reduce((s, r) => s + r, 0) / noCtaEr.length)
      : 0;

    // Price vs no-price
    const pricePatterns = ['ugx', 'ush', '$', 'price', 'starting at'];
    let priceEr: number[] = [], noPriceEr: number[] = [];
    for (const doc of gtData) {
      const c = String(doc.caption || '').toLowerCase();
      const er = Number(doc.engagement_rate || 0);
      if (pricePatterns.some(p => c.includes(p))) priceEr.push(er);
      else noPriceEr.push(er);
    }
    const priceBoost = priceEr.length > 0 && noPriceEr.length > 0
      ? (priceEr.reduce((s, r) => s + r, 0) / priceEr.length) - (noPriceEr.reduce((s, r) => s + r, 0) / noPriceEr.length)
      : 0;

    // Model info
    let modelVersion = 'none', modelAuc = 0;
    try {
      const modelRepo = new ModelRegistryRepository();
      const latest = await modelRepo.getLatest('xgboost');
      if (latest) {
        modelVersion = (latest.version as string) || 'unknown';
        modelAuc = (latest.auc as number) || 0;
      }
    } catch { /* ignore */ }

    return {
      dbConnected: true,
      categorySamples: gtData.length,
      industryAvgEngagement: Math.round(avg * 10000) / 10000,
      top10Engagement: Math.round(engagementRates[top10Idx] * 10000) / 10000,
      hashtagPerformance: hashtagPerf,
      ctaEngagementBoost: Math.round(ctaBoost * 10000) / 10000,
      priceEngagementBoost: Math.round(priceBoost * 10000) / 10000,
      modelVersion,
      modelAuc,
      topHashtags: Object.keys(hashtagPerf).slice(0, 10).map(t => `#${t}`),
    };
  } catch {
    return defaults;
  }
}

function generatePosterImprovements(
  cf: import('@/lib/types').CaptionFeatures,
  benchmarks: BenchmarkData,
  imageQuality: ImageQualityMetrics | null,
): string[] {
  const improvements: string[] = [];
  const db = benchmarks.dbConnected;
  const samples = benchmarks.categorySamples;

  if (!cf.hasPrice) {
    if (db && benchmarks.priceEngagementBoost > 0) {
      improvements.push(`Add a visible price (e.g., 'UGX 50,000') — based on ${samples} posts, prices boost engagement by ${Math.abs(benchmarks.priceEngagementBoost * 100).toFixed(1)}%`);
    } else {
      improvements.push("No price found — add a visible price (e.g., 'UGX 50,000') to boost buyer intent");
    }
  }

  if (!cf.hasCta) {
    if (db && benchmarks.ctaEngagementBoost > 0) {
      improvements.push(`Add a call-to-action like 'DM to order' — our data shows CTAs boost engagement by ${Math.abs(benchmarks.ctaEngagementBoost * 100).toFixed(1)}%`);
    } else {
      improvements.push("No call-to-action — add text like 'DM to order' or 'WhatsApp 0700 XXX XXX'");
    }
  }

  if (cf.sentiment.polarity < -0.1) {
    improvements.push('Caption tone is negative — use positive, enthusiastic language to attract customers');
  }

  // Image-based improvements
  if (imageQuality) {
    if (imageQuality.brightness < 0.25) {
      improvements.push('Your poster image is too dark — use better lighting to make the food look appetizing');
    }
    if (imageQuality.blurScore < 0.25) {
      improvements.push('Image appears blurry — use a stable camera and tap to focus for sharp food photos');
    }
    if (imageQuality.resolution.width < 480) {
      improvements.push('Image resolution is too low for social media — use at least 1080px wide');
    }
  } else {
    improvements.push('Add a poster image — posts with images get 2.3x more engagement than text-only posts');
  }

  return improvements.slice(0, 8);
}

function generateCaptionImprovements(cf: import('@/lib/types').CaptionFeatures, category: string, benchmarks: BenchmarkData): string[] {
  const suggestions: string[] = [];
  const rules = getCategoryRule(category);
  const db = benchmarks.dbConnected;

  if (cf.hashtagCount < rules.minHashtags) {
    const gap = rules.idealHashtags - cf.hashtagCount;
    if (db && benchmarks.topHashtags?.length) {
      suggestions.push(`Add ${gap} more hashtags — top performers: ${benchmarks.topHashtags.slice(0, 5).join(' ')}`);
    } else {
      suggestions.push(`Add ${gap} more hashtags — ${rules.idealHashtags}+ is ideal for ${category} posts`);
    }
  }

  const checks = cf.categoryChecks as Record<string, unknown>;
  if (!checks.cta_check_pass) {
    suggestions.push("Add a call-to-action like 'DM to order', 'Link in bio', or 'WhatsApp 0700 123456'");
  }

  if (!checks.price_check_pass) {
    suggestions.push("Include pricing (e.g., 'Starting at UGX 50,000') — price mentions increase engagement by up to 30%");
  }

  if (cf.wordCount < rules.idealCaptionLength[0]) {
    suggestions.push(`Caption is too short (${cf.wordCount} words) — aim for ${rules.idealCaptionLength[0]}-${rules.idealCaptionLength[1]} words`);
  }

  if (cf.trendAlignment.score < 0.2 && cf.trendAlignment.bestTrendKeyword) {
    suggestions.push(`Low trend alignment — incorporate trending topics like '${cf.trendAlignment.bestTrendKeyword}'`);
  }

  return suggestions.slice(0, 6);
}

function generateAnnotations(
  cf: import('@/lib/types').CaptionFeatures,
  score: number,
  imageQuality: ImageQualityMetrics | null,
): import('@/lib/types').PosterAnnotation[] {
  const annotations: import('@/lib/types').PosterAnnotation[] = [];
  let num = 1;

  if (!cf.hasPrice) {
    annotations.push({ number: num++, x: 0.5, y: 0.7, title: 'Missing Price', detail: 'Add a clear price to increase engagement', severity: 'warning' });
  }
  if (!cf.hasCta) {
    annotations.push({ number: num++, x: 0.5, y: 0.85, title: 'No CTA', detail: "Add a call-to-action like 'DM to order'", severity: 'warning' });
  }
  if (cf.hashtagCount < 5) {
    annotations.push({ number: num++, x: 0.9, y: 0.95, title: 'Low Hashtags', detail: `Only ${cf.hashtagCount} hashtags — aim for 8+`, severity: 'info' });
  }

  // Image-based annotations
  if (imageQuality) {
    if (imageQuality.blurScore < 0.25) {
      annotations.push({ number: num++, x: 0.5, y: 0.5, title: 'Blurry Image', detail: 'Image is too blurry — retake with stable camera', severity: 'critical' });
    }
    if (imageQuality.brightness < 0.2) {
      annotations.push({ number: num++, x: 0.3, y: 0.3, title: 'Too Dark', detail: 'Increase lighting for better food visibility', severity: 'warning' });
    }
    if (imageQuality.saturation < 0.15) {
      annotations.push({ number: num++, x: 0.7, y: 0.3, title: 'Low Color', detail: 'Boost colors to make food look more appealing', severity: 'info' });
    }
  }

  return annotations;
}
