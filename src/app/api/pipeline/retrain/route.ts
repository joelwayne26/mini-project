/**
 * POST /api/pipeline/retrain — Real ML Model Training
 * 
 * Implements lightweight logistic regression training in TypeScript
 * using ground truth data from MongoDB. No Python dependency needed.
 * 
 * Training pipeline:
 * 1. Load labelled ground truth data from MongoDB
 * 2. Extract features using the existing feature extractor
 * 3. Train logistic regression with gradient descent + L2 regularization
 * 4. Evaluate with 5-fold stratified cross-validation
 * 5. Store model weights in MongoDB model_registry
 * 6. Update the live model cache
 */

import { NextResponse } from 'next/server';
import { healthCheck, GroundTruthRepository, ModelRegistryRepository } from '@/lib/db/client';
import { extractCaptionFeatures, buildFeatureVector } from '@/lib/ai/feature-extractor';
import { classifyCategory } from '@/lib/ai/category-rules';

// ─── Lightweight Logistic Regression ────────────────────────────────────────

interface TrainingResult {
  success: boolean;
  modelVersion: string;
  aucScore: number;
  accuracy: number;
  duration: number;
  samples: number;
  message: string;
  foldAucs?: number[];
}

/**
 * Sigmoid function: maps any value to (0, 1)
 */
function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, z))));
}

/**
 * Train logistic regression with gradient descent.
 * Returns weights and training metrics.
 */
function trainLogisticRegression(
  X: number[][],
  y: number[],
  learningRate: number = 0.01,
  epochs: number = 200,
  lambda: number = 0.01, // L2 regularization
): { weights: number[]; bias: number; losses: number[] } {
  const n = X.length;
  const d = X[0]?.length || 0;
  if (n === 0 || d === 0) return { weights: [], bias: 0, losses: [] };

  // Initialize weights to small random values
  let weights = Array.from({ length: d }, () => (Math.random() - 0.5) * 0.1);
  let bias = 0;
  const losses: number[] = [];

  for (let epoch = 0; epoch < epochs; epoch++) {
    let totalLoss = 0;
    const gradW = new Array(d).fill(0);
    let gradB = 0;

    for (let i = 0; i < n; i++) {
      // Forward pass
      let z = bias;
      for (let j = 0; j < d; j++) {
        z += weights[j] * X[i][j];
      }
      const pred = sigmoid(z);

      // Binary cross-entropy loss
      const eps = 1e-7;
      const loss = -y[i] * Math.log(pred + eps) - (1 - y[i]) * Math.log(1 - pred + eps);
      totalLoss += loss;

      // Backward pass
      const error = pred - y[i];
      for (let j = 0; j < d; j++) {
        gradW[j] += error * X[i][j];
      }
      gradB += error;
    }

    // L2 regularization gradient
    for (let j = 0; j < d; j++) {
      gradW[j] += lambda * weights[j];
    }

    // Average gradients
    for (let j = 0; j < d; j++) {
      gradW[j] /= n;
    }
    gradB /= n;

    // Update weights
    for (let j = 0; j < d; j++) {
      weights[j] -= learningRate * gradW[j];
    }
    bias -= learningRate * gradB;

    // Record loss every 10 epochs
    if (epoch % 10 === 0) {
      losses.push(totalLoss / n);
    }
  }

  return { weights, bias, losses };
}

/**
 * Predict probability using trained logistic regression model.
 */
function predictProb(weights: number[], bias: number, x: number[]): number {
  let z = bias;
  for (let j = 0; j < weights.length; j++) {
    z += weights[j] * x[j];
  }
  return sigmoid(z);
}

/**
 * Compute AUC (Area Under ROC Curve) using trapezoidal rule.
 */
function computeAUC(predictions: { pred: number; label: number }[]): number {
  // Sort by prediction descending
  const sorted = [...predictions].sort((a, b) => b.pred - a.pred);
  
  let tp = 0, fp = 0, fn = 0, tn = 0;
  const pos = sorted.filter(p => p.label === 1).length;
  const neg = sorted.length - pos;
  
  if (pos === 0 || neg === 0) return 0.5;
  
  // Compute ROC curve points
  const points: { tpr: number; fpr: number }[] = [];
  for (const p of sorted) {
    if (p.label === 1) tp++;
    else fp++;
    fn = pos - tp;
    tn = neg - fp;
    points.push({ tpr: tp / pos, fpr: fp / neg });
  }
  
  // Add (0, 0) as starting point
  points.unshift({ tpr: 0, fpr: 0 });
  
  // Compute AUC using trapezoidal rule
  let auc = 0;
  for (let i = 1; i < points.length; i++) {
    auc += (points[i].fpr - points[i - 1].fpr) * (points[i].tpr + points[i - 1].tpr) / 2;
  }
  
  return auc;
}

/**
 * Stratified K-Fold split.
 */
function stratifiedKFold(X: number[][], y: number[], k: number = 5): { trainIdx: number[]; valIdx: number[] }[] {
  const posIdx = X.map((_, i) => i).filter(i => y[i] === 1);
  const negIdx = X.map((_, i) => i).filter(i => y[i] === 0);
  
  // Shuffle
  for (let i = posIdx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [posIdx[i], posIdx[j]] = [posIdx[j], posIdx[i]];
  }
  for (let i = negIdx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [negIdx[i], negIdx[j]] = [negIdx[j], negIdx[i]];
  }
  
  const folds: { trainIdx: number[]; valIdx: number[] }[] = [];
  
  for (let f = 0; f < k; f++) {
    const valPosIdx = posIdx.filter((_, i) => i % k === f);
    const valNegIdx = negIdx.filter((_, i) => i % k === f);
    const valIdx = [...valPosIdx, ...valNegIdx];
    const trainIdx = [...posIdx, ...negIdx].filter(i => !valIdx.includes(i));
    folds.push({ trainIdx, valIdx });
  }
  
  return folds;
}

// ─── Main Retrain Endpoint ──────────────────────────────────────────────────

export async function POST() {
  const startTime = Date.now();

  try {
    const connected = await healthCheck();

    if (!connected) {
      return NextResponse.json({
        success: false,
        modelVersion: 'heuristic',
        aucScore: 0,
        accuracy: 0,
        duration: Date.now() - startTime,
        samples: 0,
        message: 'Cannot retrain: MongoDB not connected',
      });
    }

    // 1. Load ground truth data
    const gtRepo = new GroundTruthRepository();
    const gtData = await gtRepo.getLabelled();

    if (gtData.length < 10) {
      return NextResponse.json({
        success: false,
        modelVersion: 'heuristic',
        aucScore: 0,
        accuracy: 0,
        duration: Date.now() - startTime,
        samples: gtData.length,
        message: `Not enough ground truth data (${gtData.length} samples, need 10+)`,
      });
    }

    // 2. Extract features from ground truth data
    const XList: number[][] = [];
    const yList: number[] = [];

    for (const doc of gtData) {
      const caption = String(doc.caption || '');
      const category = String(doc.category || 'general');
      const engagementRate = Number(doc.engagement_rate || 0);

      if (!caption) continue;

      try {
        const captionFeatures = extractCaptionFeatures(caption, category);
        const featureVector = buildFeatureVector(captionFeatures, null);

        XList.push(featureVector);
        // Binary label: high engagement (>5%) = 1, else 0
        yList.push(engagementRate > 0.05 ? 1 : 0);
      } catch {
        continue;
      }
    }

    if (XList.length < 10) {
      return NextResponse.json({
        success: false,
        modelVersion: 'heuristic',
        aucScore: 0,
        accuracy: 0,
        duration: Date.now() - startTime,
        samples: XList.length,
        message: `Too few valid feature vectors (${XList.length})`,
      });
    }

    // 3. Feature normalization (z-score)
    const d = XList[0].length;
    const means = new Array(d).fill(0);
    const stds = new Array(d).fill(1);

    for (let j = 0; j < d; j++) {
      let sum = 0;
      for (let i = 0; i < XList.length; i++) sum += XList[i][j];
      means[j] = sum / XList.length;

      let sqSum = 0;
      for (let i = 0; i < XList.length; i++) sqSum += (XList[i][j] - means[j]) ** 2;
      stds[j] = Math.sqrt(sqSum / XList.length) || 0.01;
    }

    // Normalize features
    const XNormalized = XList.map(x => x.map((v, j) => (v - means[j]) / stds[j]));

    // 4. Cross-validation
    const k = Math.min(5, XNormalized.length >= 25 ? 5 : XNormalized.length >= 15 ? 3 : 2);
    const folds = stratifiedKFold(XNormalized, yList, k);
    const foldAucs: number[] = [];
    const foldAccuracies: number[] = [];

    for (const fold of folds) {
      const XTrain = fold.trainIdx.map(i => XNormalized[i]);
      const yTrain = fold.trainIdx.map(i => yList[i]);
      const XVal = fold.valIdx.map(i => XNormalized[i]);
      const yVal = fold.valIdx.map(i => yList[i]);

      // Train on fold
      const { weights, bias } = trainLogisticRegression(XTrain, yTrain, 0.05, 300, 0.01);

      // Evaluate on validation
      const predictions = XVal.map((x, i) => ({
        pred: predictProb(weights, bias, x),
        label: yVal[i],
      }));

      const auc = computeAUC(predictions);
      const accuracy = predictions.filter(p => (p.pred > 0.5 ? 1 : 0) === p.label).length / predictions.length;

      foldAucs.push(Math.round(auc * 10000) / 10000);
      foldAccuracies.push(Math.round(accuracy * 10000) / 10000);
    }

    // 5. Train final model on ALL data
    const { weights, bias } = trainLogisticRegression(XNormalized, yList, 0.05, 400, 0.01);

    // 6. Store model in MongoDB
    const modelVersion = `v${Date.now()}`;
    const meanAuc = foldAucs.reduce((s, a) => s + a, 0) / foldAucs.length;
    const meanAccuracy = foldAccuracies.reduce((s, a) => s + a, 0) / foldAccuracies.length;

    const modelRepo = new ModelRegistryRepository();
    await modelRepo.insertOne({
      model_type: 'logistic_regression',
      version: modelVersion,
      auc: meanAuc,
      samples: XList.length,
      features: [
        'hashtag_count', 'word_count', 'emoji_count', 'has_price', 'has_cta',
        'sentiment_polarity', 'readability', 'trend_alignment', 'caption_score',
        'has_required_keywords', 'image_brightness', 'image_contrast',
        'image_saturation', 'image_sharpness', 'image_aspect_ratio', 'image_quality',
      ],
      fold_aucs: foldAucs,
      fold_accuracies: foldAccuracies,
      weights: weights.map(w => Math.round(w * 10000) / 10000),
      bias: Math.round(bias * 10000) / 10000,
      normalization: {
        means: means.map(m => Math.round(m * 10000) / 10000),
        stds: stds.map(s => Math.round(s * 10000) / 10000),
      },
      trained_at: new Date().toISOString(),
      status: 'production',
      training_duration_ms: Date.now() - startTime,
    });

    return NextResponse.json({
      success: true,
      modelVersion,
      aucScore: meanAuc,
      accuracy: meanAccuracy,
      duration: Date.now() - startTime,
      samples: XList.length,
      foldAucs,
      message: `Logistic regression trained on ${XList.length} samples with ${k}-fold CV (AUC: ${meanAuc.toFixed(4)})`,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, modelVersion: '', aucScore: 0, accuracy: 0, duration: Date.now() - startTime, samples: 0, message: String(error) },
      { status: 500 }
    );
  }
}
