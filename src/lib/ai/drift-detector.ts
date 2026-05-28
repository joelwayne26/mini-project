/**
 * TrendLens AI v6.0 — Drift Detector
 * Maximum Mean Discrepancy (MMD) based drift detection.
 * No external APIs — all computation is local.
 */

import { DriftMeasurement } from './types';

// ─── MMD Computation ───────────────────────────────────────────────────────

function rbfKernel(x: number[], y: number[], sigma: number): number {
  const diff = x.map((xi, i) => xi - y[i]);
  const sqDist = diff.reduce((sum, d) => sum + d * d, 0);
  return Math.exp(-sqDist / (2 * sigma * sigma));
}

function medianHeuristic(samples: number[][]): number {
  const distances: number[] = [];
  const n = Math.min(samples.length, 100); // Subsample for efficiency
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = samples[i].reduce((sum, xi, k) => sum + (xi - samples[j][k]) ** 2, 0);
      distances.push(Math.sqrt(Math.max(0, d)));
    }
  }
  distances.sort((a, b) => a - b);
  return distances[Math.floor(distances.length / 2)] || 1.0;
}

export function computeMMD(
  reference: number[][],
  current: number[][],
  permutations: number = 200,
): { mmdScore: number; pValue: number; isDrift: boolean } {
  if (reference.length < 5 || current.length < 5) {
    return { mmdScore: 0, pValue: 1, isDrift: false };
  }

  const sigma = medianHeuristic([...reference.slice(0, 50), ...current.slice(0, 50)]);
  const nRef = reference.length;
  const nCur = current.length;

  // Compute MMD between reference and current
  let mmdXY = 0;
  for (let i = 0; i < Math.min(nRef, 50); i++) {
    for (let j = 0; j < Math.min(nCur, 50); j++) {
      mmdXY += rbfKernel(reference[i], current[j], sigma);
    }
  }
  mmdXY /= (Math.min(nRef, 50) * Math.min(nCur, 50));

  let mmdXX = 0;
  for (let i = 0; i < Math.min(nRef, 50); i++) {
    for (let j = i + 1; j < Math.min(nRef, 50); j++) {
      mmdXX += rbfKernel(reference[i], reference[j], sigma);
    }
  }
  mmdXX /= (Math.min(nRef, 50) * (Math.min(nRef, 50) - 1) / 2);

  let mmdYY = 0;
  for (let i = 0; i < Math.min(nCur, 50); i++) {
    for (let j = i + 1; j < Math.min(nCur, 50); j++) {
      mmdYY += rbfKernel(current[i], current[j], sigma);
    }
  }
  mmdYY /= (Math.min(nCur, 50) * (Math.min(nCur, 50) - 1) / 2);

  const mmdScore = mmdXX + mmdYY - 2 * mmdXY;

  // Permutation test for p-value
  const combined = [...reference, ...current];
  let exceedCount = 0;

  for (let p = 0; p < permutations; p++) {
    // Shuffle combined
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }

    const permRef = combined.slice(0, nRef);
    const permCur = combined.slice(nRef);

    const permMmd = computeMMDNoPermTest(permRef, permCur, sigma);
    if (permMmd >= mmdScore) exceedCount++;
  }

  const pValue = (exceedCount + 1) / (permutations + 1);
  const isDrift = pValue < 0.05;

  return { mmdScore: Math.max(0, mmdScore), pValue, isDrift };
}

function computeMMDNoPermTest(ref: number[][], cur: number[][], sigma: number): number {
  const nRef = ref.length;
  const nCur = cur.length;

  let mmdXY = 0;
  for (let i = 0; i < Math.min(nRef, 30); i++) {
    for (let j = 0; j < Math.min(nCur, 30); j++) {
      mmdXY += rbfKernel(ref[i], cur[j], sigma);
    }
  }
  mmdXY /= (Math.min(nRef, 30) * Math.min(nCur, 30));

  let mmdXX = 0;
  for (let i = 0; i < Math.min(nRef, 30); i++) {
    for (let j = i + 1; j < Math.min(nRef, 30); j++) {
      mmdXX += rbfKernel(ref[i], ref[j], sigma);
    }
  }
  mmdXX /= (Math.min(nRef, 30) * (Math.min(nRef, 30) - 1) / 2);

  let mmdYY = 0;
  for (let i = 0; i < Math.min(nCur, 30); i++) {
    for (let j = i + 1; j < Math.min(nCur, 30); j++) {
      mmdYY += rbfKernel(cur[i], cur[j], sigma);
    }
  }
  mmdYY /= (Math.min(nCur, 30) * (Math.min(nCur, 30) - 1) / 2);

  return mmdXX + mmdYY - 2 * mmdXY;
}

// ─── Drift Check with MongoDB ──────────────────────────────────────────────

export async function checkDrift(
  currentFeatures: number[][],
): Promise<DriftMeasurement | null> {
  if (currentFeatures.length < 10) return null;

  try {
    const { DriftStateRepository } = await import('../db/client');
    const driftRepo = new DriftStateRepository();
    const baseline = await driftRepo.getLatest();

    if (!baseline?.baseline_stats) {
      // No baseline yet — store current as baseline
      const mean = computeMean(currentFeatures);
      const std = computeStd(currentFeatures, mean);
      await driftRepo.insertOne({
        baseline_stats: { mean, std },
        timestamp: new Date().toISOString(),
        sample_size: currentFeatures.length,
      });
      return null;
    }

    // Generate reference samples from baseline stats
    const baselineMean = baseline.baseline_stats.mean as number[];
    const baselineStd = baseline.baseline_stats.std as number[];
    const reference = generateSamples(baselineMean, baselineStd, 50);

    const result = computeMMD(reference, currentFeatures);

    const measurement: DriftMeasurement = {
      timestamp: new Date().toISOString(),
      mmdScore: result.mmdScore,
      pValue: result.pValue,
      isDrift: result.isDrift,
      sampleSize: currentFeatures.length,
      baselineStats: { mean: baselineMean, std: baselineStd },
    };

    // Store measurement
    await driftRepo.insertOne({
      mmd_score: result.mmdScore,
      p_value: result.pValue,
      is_drift: result.isDrift,
      sample_size: currentFeatures.length,
      baseline_stats: baseline.baseline_stats,
      timestamp: new Date().toISOString(),
    });

    return measurement;
  } catch {
    return null;
  }
}

function computeMean(samples: number[][]): number[] {
  if (samples.length === 0) return [];
  const dims = samples[0].length;
  const mean = new Array(dims).fill(0);
  for (const s of samples) {
    for (let i = 0; i < dims; i++) {
      mean[i] += s[i];
    }
  }
  return mean.map(m => m / samples.length);
}

function computeStd(samples: number[][], mean: number[]): number[] {
  if (samples.length <= 1) return mean.map(() => 1);
  const dims = mean.length;
  const std = new Array(dims).fill(0);
  for (const s of samples) {
    for (let i = 0; i < dims; i++) {
      std[i] += (s[i] - mean[i]) ** 2;
    }
  }
  return std.map(s => Math.sqrt(s / (samples.length - 1)) || 0.01);
}

function generateSamples(mean: number[], std: number[], n: number): number[][] {
  const samples: number[][] = [];
  for (let i = 0; i < n; i++) {
    const sample = mean.map((m, j) => m + std[j] * (Math.random() + Math.random() + Math.random() - 1.5) * 1.2);
    samples.push(sample);
  }
  return samples;
}
