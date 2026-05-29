/**
 * POST /api/evaluate — Poster evaluation with SHAP + RAG + local caption generation
 * The core endpoint of TrendLens AI v6.0.
 * Now supports real server-side image analysis via Sharp + visual LLM analysis.
 */

import { NextRequest, NextResponse } from 'next/server';
import { extractCaptionFeatures, buildFeatureVector } from '@/lib/ai/feature-extractor';
import { heuristicScore, mlEnhancedScore, scoreTo1to10, adjustScoreWithBenchmarks, computeConfidenceInterval, computePosterScore, computeCaptionScore } from '@/lib/ai/scoring-engine';
import { computeShapValues, getFeatureImportanceSummary } from '@/lib/ai/shap-explainer';
import { generateImprovedCaption, generatePlatformVariants } from '@/lib/ai/caption-generator';
import { searchSimilarPosts, generateRagInsights } from '@/lib/ai/rag-engine';
import { computeTrendAlignment } from '@/lib/ai/trend-engine';
import { classifyCategory, getCategoryRule } from '@/lib/ai/category-rules';
import { analyzeImageQuality, generateImageImprovementSuggestions } from '@/lib/ai/server-image-analysis';
import { refineScores, _lastDebugInfo, VisualAnalysisResult } from '@/lib/ai/contextual-adjuster';
import { healthCheck, PostsRepository, GroundTruthRepository, ModelRegistryRepository, EvaluationRepository } from '@/lib/db/client';
import { PosterEvaluation, BenchmarkData, RagInsight, ShapValue, CaptionVariant, ImageQualityMetrics } from '@/lib/types';

export const maxDuration = 60; // Allow up to 60s for Vercel Pro; free tier caps at 10s

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
    const trendAlignment = await computeTrendAlignment(caption, category);
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

    // 4. Compute scores — try ML-enhanced scoring first, fall back to heuristic
    const mlResult = await mlEnhancedScore(captionFeatures, imageQuality, featureVector);
    const rawScore = mlResult.modelUsed ? mlResult.score : heuristicScore(captionFeatures, imageQuality);
    const overall10 = scoreTo1to10(rawScore);
    const adjustedOverall_raw = benchmarks.dbConnected && benchmarks.categorySamples >= 5
      ? adjustScoreWithBenchmarks(overall10, captionFeatures, benchmarks)
      : overall10;

    const posterScore = computePosterScore(imageQuality, captionFeatures, benchmarks);
    const captionScoreValue = computeCaptionScore(captionFeatures, category, benchmarks);
    const confidenceInterval = computeConfidenceInterval(rawScore);

    // 5. Initial SHAP values (will be recomputed after visual analysis if features change)
    let shapValues = computeShapValues(captionFeatures, imageQuality);

    // 5b. Contextual semantic score refinement with visual analysis
    let adjustedOverall = adjustedOverall_raw;
    let adjustedPosterScore = posterScore;
    let adjustedCaptionScore = captionScoreValue;
    let captionInsight: string | undefined;
    let debugRefineError: string | undefined;
    let llmPosterImprovements: string[] | undefined;
    let llmCaptionImprovements: string[] | undefined;
    let visualAnalysis: VisualAnalysisResult | null = null;
    let featuresChanged = false;

    try {
      const refined = await refineScores({
        caption,
        category,
        imageBase64: imageBase64 || undefined,
        imageQuality: imageQuality ? {
          brightness: imageQuality.brightness,
          contrast: imageQuality.contrast,
          saturation: imageQuality.saturation,
          blurScore: imageQuality.blurScore,
          resolution: imageQuality.resolution,
          qualityRating: imageQuality.qualityRating,
        } : null,
        heuristicOverall: adjustedOverall_raw,
        heuristicPoster: posterScore,
        heuristicCaption: captionScoreValue,
        shapValues: shapValues.map(s => ({ feature: s.feature, value: s.value, contribution: s.contribution })),
        hasCta: captionFeatures.hasCta,
        hasPrice: captionFeatures.hasPrice,
        hashtagCount: captionFeatures.hashtagCount,
        wordCount: captionFeatures.wordCount,
        emojiCount: captionFeatures.emojiCount,
        sentiment: captionFeatures.sentiment.polarity > 0.2 ? 'positive' : captionFeatures.sentiment.polarity < -0.2 ? 'negative' : 'neutral',
        benchmarkSamples: benchmarks.categorySamples,
        modelAuc: benchmarks.modelAuc,
      });

      if (refined) {
        visualAnalysis = refined.visualAnalysis;

        // Override features based on visual analysis
        if (visualAnalysis) {
          if (visualAnalysis.visualCtaDetected && !captionFeatures.hasCta) {
            captionFeatures.hasCta = true;
            captionFeatures.ctaType = visualAnalysis.visualCtaText || 'visual_cta';
            (captionFeatures.categoryChecks as Record<string, unknown>).has_cta = true;
            (captionFeatures.categoryChecks as Record<string, unknown>).cta_check_pass = true;
            featuresChanged = true;
          }
          if (visualAnalysis.visualPriceDetected && !captionFeatures.hasPrice) {
            captionFeatures.hasPrice = true;
            (captionFeatures.categoryChecks as Record<string, unknown>).has_price = true;
            (captionFeatures.categoryChecks as Record<string, unknown>).price_check_pass = true;
            featuresChanged = true;
          }

          // Recompute everything after visual feature override
          if (featuresChanged) {
            // Recompute SHAP with updated features
            shapValues = computeShapValues(captionFeatures, imageQuality);

            const updatedRawScore = heuristicScore(captionFeatures, imageQuality);
            const updatedOverall10 = scoreTo1to10(updatedRawScore);
            adjustedOverall = benchmarks.dbConnected && benchmarks.categorySamples >= 5
              ? adjustScoreWithBenchmarks(updatedOverall10, captionFeatures, benchmarks)
              : updatedOverall10;
            adjustedPosterScore = computePosterScore(imageQuality, captionFeatures, benchmarks);
            adjustedCaptionScore = computeCaptionScore(captionFeatures, category, benchmarks);
          }
        }

        // Blend contextual refinement with heuristic scores (60/40 weighting)
        adjustedOverall = Math.round((adjustedOverall * 0.4 + refined.overallScore * 0.6) * 10) / 10;
        adjustedPosterScore = Math.round((adjustedPosterScore * 0.4 + refined.posterScore * 0.6) * 10) / 10;
        adjustedCaptionScore = Math.round((adjustedCaptionScore * 0.4 + refined.captionScore * 0.6) * 10) / 10;
        captionInsight = refined.captionInsight;

        // Apply SHAP adjustments from contextual analysis
        for (const adj of refined.shapAdjustments) {
          const shapItem = shapValues.find(s => s.feature === adj.feature);
          if (shapItem) {
            shapItem.contribution = Math.round((shapItem.contribution * 0.4 + adj.adjustedContribution * 0.6) * 1000) / 1000;
          }
        }

        // Use contextual improvements if provided (they're poster-specific)
        if (refined.posterImprovements && refined.posterImprovements.length > 0) {
          llmPosterImprovements = refined.posterImprovements;
        }
        if (refined.captionImprovements && refined.captionImprovements.length > 0) {
          llmCaptionImprovements = refined.captionImprovements;
        }
      } else {
        debugRefineError = `refineScores returned null. Debug: ${_lastDebugInfo}`;
      }
    } catch (err) {
      // Contextual refinement is non-critical — fall back to heuristic scores
      debugRefineError = String(err);
    }

    // 6. RAG — search for similar high-performing posts
    let ragInsights: RagInsight[] = [];
    try {
      const similarPosts = await searchSimilarPosts(caption, category, 5);
      ragInsights = generateRagInsights(similarPosts, captionFeatures, category);
    } catch {
      // RAG is non-critical
    }

    // 7. Generate improved caption (with visual analysis so CTA/price on image is respected)
    const topHashtags = benchmarks.hashtagPerformance
      ? Object.keys(benchmarks.hashtagPerformance).slice(0, 5)
      : [];
    const improvedCaption = generateImprovedCaption(
      caption, captionFeatures, category,
      trendAlignment.matchedKeywords,
      topHashtags,
      visualAnalysis ? {
        visualCtaDetected: visualAnalysis.visualCtaDetected,
        visualCtaText: visualAnalysis.visualCtaText,
        visualPriceDetected: visualAnalysis.visualPriceDetected,
        visualPriceText: visualAnalysis.visualPriceText,
      } : null,
    );

    // 8. Generate platform variants
    const captionVariants = generatePlatformVariants(improvedCaption, captionFeatures, category);

    // 9. Generate improvements — use contextual improvements if available, otherwise heuristic
    // The heuristic improvements now also use visual analysis data
    const posterImprovements = llmPosterImprovements && llmPosterImprovements.length > 0
      ? llmPosterImprovements
      : generatePosterImprovements(captionFeatures, benchmarks, imageQuality, visualAnalysis);
    const captionImprovements = llmCaptionImprovements && llmCaptionImprovements.length > 0
      ? llmCaptionImprovements
      : generateCaptionImprovements(captionFeatures, category, benchmarks, visualAnalysis);

    // 10. Generate annotations (now with image-based annotations and visual analysis)
    const annotations = generateAnnotations(captionFeatures, rawScore, imageQuality, visualAnalysis);

    // 11. Get model version (prefer logistic_regression, fall back to xgboost)
    let modelVersion = 'heuristic';
    try {
      const modelRepo = new ModelRegistryRepository();
      const lrModel = await modelRepo.getLatest('logistic_regression');
      if (lrModel) {
        modelVersion = (lrModel.version as string) || 'unknown';
      } else {
        const xgbModel = await modelRepo.getLatest('xgboost');
        if (xgbModel) modelVersion = (xgbModel.version as string) || 'unknown';
      }
    } catch { /* ignore */ }

    // 12. Store evaluation (with image quality data)
    try {
      const evalRepo = new EvaluationRepository();
      await evalRepo.insertOne({
        caption,
        image_url: imageUrl || '',
        overall_score: adjustedOverall,
        poster_score: adjustedPosterScore,
        caption_score: adjustedCaptionScore,
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
        visual_analysis: visualAnalysis ? {
          cta_detected: visualAnalysis.visualCtaDetected,
          cta_text: visualAnalysis.visualCtaText,
          price_detected: visualAnalysis.visualPriceDetected,
          price_text: visualAnalysis.visualPriceText,
          design_quality: visualAnalysis.visualDesignQuality,
          elements: visualAnalysis.visualElements,
        } : null,
      });
    } catch { /* Non-critical */ }

    const result: PosterEvaluation & { imageQuality?: ImageQualityMetrics | null; imageImprovements?: string[]; captionInsight?: string; visualAnalysis?: VisualAnalysisResult | null } = {
      overallScore: adjustedOverall,
      posterScore: adjustedPosterScore,
      captionScore: adjustedCaptionScore,
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
      ...(captionInsight ? { captionInsight } : {}),
      ...(visualAnalysis ? { visualAnalysis } : {}),
      ...(debugRefineError ? { _debugRefineError: debugRefineError } : {}),
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

    // Model info (prefer logistic_regression, fall back to xgboost)
    let modelVersion = 'none', modelAuc = 0;
    try {
      const modelRepo = new ModelRegistryRepository();
      const lrModel = await modelRepo.getLatest('logistic_regression');
      if (lrModel) {
        modelVersion = (lrModel.version as string) || 'unknown';
        modelAuc = (lrModel.auc as number) || 0;
      } else {
        const xgbModel = await modelRepo.getLatest('xgboost');
        if (xgbModel) {
          modelVersion = (xgbModel.version as string) || 'unknown';
          modelAuc = (xgbModel.auc as number) || 0;
        }
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
  visualAnalysis: VisualAnalysisResult | null,
): string[] {
  const improvements: string[] = [];
  const db = benchmarks.dbConnected;
  const samples = benchmarks.categorySamples;

  // Use visual analysis for accurate CTA/price detection
  const effectiveHasCta = cf.hasCta || (visualAnalysis?.visualCtaDetected ?? false);
  const effectiveHasPrice = cf.hasPrice || (visualAnalysis?.visualPriceDetected ?? false);

  // CTA suggestion
  if (!effectiveHasCta) {
    if (db && benchmarks.ctaEngagementBoost > 0) {
      improvements.push(`Add a call-to-action like 'DM to order' — our data shows CTAs boost engagement by ${Math.abs(benchmarks.ctaEngagementBoost * 100).toFixed(1)}%`);
    } else {
      improvements.push("No call-to-action found — add text like 'DM to order' or 'WhatsApp 0700 XXX XXX' to drive conversions");
    }
  } else {
    const ctaText = visualAnalysis?.visualCtaText || cf.ctaType;
    if (ctaText) {
      improvements.push(`CTA is present ("${ctaText}") — great for driving conversions! Consider making it larger or more prominent`);
    } else {
      improvements.push('CTA is present — great for driving conversions! Consider making it more prominent in the design');
    }
  }

  // Price suggestion
  if (!effectiveHasPrice) {
    if (db && benchmarks.priceEngagementBoost > 0) {
      improvements.push(`Add a visible price (e.g., 'UGX 50,000') — based on ${samples} posts, prices boost engagement by ${Math.abs(benchmarks.priceEngagementBoost * 100).toFixed(1)}%`);
    } else {
      improvements.push("No price found — add a visible price (e.g., 'UGX 50,000') to boost buyer intent");
    }
  } else {
    const priceText = visualAnalysis?.visualPriceText;
    if (priceText) {
      improvements.push(`Price is displayed ("${priceText}") — this builds buyer confidence and increases engagement`);
    } else {
      improvements.push('Price mention is present — good! Consider making it more prominent in the image');
    }
  }

  // Visual elements feedback
  if (visualAnalysis) {
    if (visualAnalysis.visualDesignQuality === 'excellent') {
      improvements.push('Poster design is professional and well-structured — excellent visual appeal');
    } else if (visualAnalysis.visualDesignQuality === 'poor') {
      improvements.push('Poster design needs improvement — consider using a cleaner layout, better fonts, and more contrast');
    }

    if (visualAnalysis.visualElements.includes('food_photo')) {
      improvements.push('Food photo is present — this significantly increases engagement for food businesses');
    }
    if (visualAnalysis.visualElements.includes('phone_number')) {
      improvements.push('Phone number is visible — makes it easy for customers to reach you');
    }
    if (visualAnalysis.visualElements.includes('logo')) {
      improvements.push('Brand logo is displayed — builds brand recognition and trust');
    }
    if (visualAnalysis.visualElements.includes('social_icons')) {
      improvements.push('Social media icons present — helps customers find you on different platforms');
    }
  }

  // Caption tone
  if (cf.sentiment.polarity < -0.1) {
    improvements.push('Caption tone is negative — use positive, enthusiastic language to attract customers');
  } else if (cf.sentiment.polarity > 0.2) {
    improvements.push('Positive caption tone — this helps attract customers');
  }

  // Image-based improvements — reference actual values
  if (imageQuality) {
    if (imageQuality.brightness < 0.25) {
      improvements.push(`Image is too dark (brightness: ${(imageQuality.brightness * 100).toFixed(0)}%) — use better lighting to make content visible`);
    } else if (imageQuality.brightness > 0.75) {
      improvements.push(`Image is overexposed (brightness: ${(imageQuality.brightness * 100).toFixed(0)}%) — reduce brightness to preserve detail`);
    }
    if (imageQuality.blurScore < 0.25) {
      improvements.push(`Image appears blurry (sharpness: ${(imageQuality.blurScore * 100).toFixed(0)}%) — use a stable camera and tap to focus`);
    } else if (imageQuality.blurScore > 0.5) {
      improvements.push(`Image is sharp (sharpness: ${(imageQuality.blurScore * 100).toFixed(0)}%) — excellent for social media`);
    }
    if (imageQuality.resolution.width < 480) {
      improvements.push(`Low resolution (${imageQuality.resolution.width}x${imageQuality.resolution.height}) — use at least 1080px wide`);
    } else if (imageQuality.resolution.width >= 1080) {
      improvements.push(`Good resolution (${imageQuality.resolution.width}x${imageQuality.resolution.height}) — looks great on all platforms`);
    }
    if (imageQuality.saturation < 0.15) {
      improvements.push(`Colors look muted (saturation: ${(imageQuality.saturation * 100).toFixed(0)}%) — boost colors to make food pop`);
    }
  } else if (!visualAnalysis) {
    improvements.push('Add a poster image — posts with images get 2.3x more engagement than text-only posts');
  }

  return improvements.slice(0, 8);
}

function generateCaptionImprovements(
  cf: import('@/lib/types').CaptionFeatures,
  category: string,
  benchmarks: BenchmarkData,
  visualAnalysis: VisualAnalysisResult | null,
): string[] {
  const suggestions: string[] = [];
  const rules = getCategoryRule(category);
  const db = benchmarks.dbConnected;

  // Use visual analysis for accurate feature detection
  const effectiveHasCta = cf.hasCta || (visualAnalysis?.visualCtaDetected ?? false);
  const effectiveHasPrice = cf.hasPrice || (visualAnalysis?.visualPriceDetected ?? false);

  if (cf.hashtagCount < rules.minHashtags) {
    const gap = rules.idealHashtags - cf.hashtagCount;
    if (db && benchmarks.topHashtags?.length) {
      suggestions.push(`Add ${gap} more hashtags — top performers: ${benchmarks.topHashtags.slice(0, 5).join(' ')}`);
    } else {
      suggestions.push(`Add ${gap} more hashtags — ${rules.idealHashtags}+ is ideal for ${category} posts`);
    }
  } else if (cf.hashtagCount >= rules.idealHashtags) {
    suggestions.push(`Hashtag count is strong (${cf.hashtagCount}) — great discoverability`);
  }

  const checks = cf.categoryChecks as Record<string, unknown>;
  if (!effectiveHasCta) {
    suggestions.push("Add a call-to-action like 'DM to order', 'Link in bio', or 'WhatsApp 0700 123456'");
  } else {
    const ctaText = visualAnalysis?.visualCtaText || cf.ctaType;
    suggestions.push(ctaText ? `CTA is present ("${ctaText}") — good for driving action` : 'CTA is present in caption — good for driving action');
  }

  if (!effectiveHasPrice) {
    suggestions.push("Include pricing (e.g., 'Starting at UGX 50,000') — price mentions increase engagement by up to 30%");
  } else {
    const priceText = visualAnalysis?.visualPriceText;
    suggestions.push(priceText ? `Price is mentioned ("${priceText}") — this builds buyer confidence` : 'Price is mentioned — this builds buyer confidence');
  }

  if (cf.wordCount < rules.idealCaptionLength[0]) {
    suggestions.push(`Caption is too short (${cf.wordCount} words) — aim for ${rules.idealCaptionLength[0]}-${rules.idealCaptionLength[1]} words`);
  } else if (cf.wordCount >= rules.idealCaptionLength[0] && cf.wordCount <= rules.idealCaptionLength[1]) {
    suggestions.push(`Caption length is good (${cf.wordCount} words) — optimal for engagement`);
  }

  if (cf.trendAlignment.score < 0.2 && cf.trendAlignment.bestTrendKeyword) {
    suggestions.push(`Low trend alignment — incorporate trending topics like '${cf.trendAlignment.bestTrendKeyword}'`);
  } else if (cf.trendAlignment.score >= 0.2) {
    suggestions.push(`Good trend alignment (score: ${(cf.trendAlignment.score * 100).toFixed(0)}%) — caption matches current trends`);
  }

  return suggestions.slice(0, 6);
}

function generateAnnotations(
  cf: import('@/lib/types').CaptionFeatures,
  score: number,
  imageQuality: ImageQualityMetrics | null,
  visualAnalysis: VisualAnalysisResult | null,
): import('@/lib/types').PosterAnnotation[] {
  const annotations: import('@/lib/types').PosterAnnotation[] = [];
  let num = 1;

  const effectiveHasCta = cf.hasCta || (visualAnalysis?.visualCtaDetected ?? false);
  const effectiveHasPrice = cf.hasPrice || (visualAnalysis?.visualPriceDetected ?? false);

  if (!effectiveHasPrice) {
    annotations.push({ number: num++, x: 0.5, y: 0.7, title: 'Missing Price', detail: 'Add a clear price to increase engagement', severity: 'warning' });
  }
  if (!effectiveHasCta) {
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

  // Visual analysis annotations
  if (visualAnalysis) {
    if (visualAnalysis.visualDesignQuality === 'poor') {
      annotations.push({ number: num++, x: 0.5, y: 0.1, title: 'Design Quality', detail: 'Poster design needs improvement — cleaner layout recommended', severity: 'warning' });
    }
  }

  return annotations;
}
