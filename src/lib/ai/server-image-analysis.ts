/**
 * TrendLens AI v6.0 — Server-Side Image Analysis using Sharp
 * Analyzes poster images for quality metrics in Vercel-compatible serverless.
 * No temp files — all processing done in memory via Buffers.
 */

import sharp from 'sharp';
import { ImageQualityMetrics } from './types';

/**
 * Analyze an image from a Buffer or base64 string and return quality metrics.
 * Uses Sharp for fast, serverless-compatible image processing.
 */
export async function analyzeImageQuality(
  input: Buffer | string,
): Promise<ImageQualityMetrics> {
  let imageBuffer: Buffer;

  if (typeof input === 'string') {
    // Strip data URL prefix if present (e.g., "data:image/jpeg;base64,")
    const base64 = input.replace(/^data:image\/\w+;base64,/, '');
    imageBuffer = Buffer.from(base64, 'base64');
  } else {
    imageBuffer = input;
  }

  // Get image metadata
  const metadata = await sharp(imageBuffer).metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;

  if (width === 0 || height === 0) {
    return getDefaultMetrics('Invalid image dimensions');
  }

  // Compute luminance statistics for brightness & contrast
  const { data, info } = await sharp(imageBuffer)
    .resize(200, 200, { fit: 'inside' }) // Downscale for fast stats
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixelCount = info.width * info.height;
  const channels = info.channels;

  // Calculate per-pixel luminance (rec. 709)
  let luminanceSum = 0;
  let luminanceSqSum = 0;
  const luminances: number[] = [];

  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * channels] || 0;
    const g = data[i * channels + 1] || 0;
    const b = data[i * channels + 2] || 0;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    luminanceSum += lum;
    luminanceSqSum += lum * lum;
    luminances.push(lum);
  }

  const meanLum = luminanceSum / pixelCount;
  const varLum = luminanceSqSum / pixelCount - meanLum * meanLum;
  const stdLum = Math.sqrt(Math.max(0, varLum));

  // Brightness: 0 = completely dark, 1 = completely bright
  const brightness = meanLum;

  // Contrast: normalized standard deviation of luminance
  const contrast = Math.min(1, stdLum * 3);

  // Saturation: average saturation in HSL space
  let satSum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const r = data[i * channels] / 255;
    const g = data[i * channels + 1] / 255;
    const b = data[i * channels + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) continue; // achromatic
    const s = l > 0.5
      ? (max - min) / (2 - max - min)
      : (max - min) / (max + min);
    satSum += s;
  }
  const saturation = satSum / pixelCount;

  // Blur detection: Laplacian variance
  // Convert to grayscale, apply Laplacian-like kernel, measure variance
  const grayscale = await sharp(imageBuffer)
    .resize(200, 200, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer();

  const blurScore = computeLaplacianVariance(grayscale, info.width);

  // Aspect ratio
  const aspectRatio = width / height;

  // Quality rating
  const qualityScore = computeQualityScore(brightness, contrast, saturation, blurScore, width);
  const qualityRating = getQualityRating(qualityScore);

  return {
    brightness: Number(brightness.toFixed(4)),
    contrast: Number(contrast.toFixed(4)),
    saturation: Number(saturation.toFixed(4)),
    blurScore: Number(blurScore.toFixed(4)),
    resolution: { width, height },
    aspectRatio: Number(aspectRatio.toFixed(3)),
    qualityRating,
  };
}

/**
 * Compute Laplacian variance as a blur indicator.
 * Higher values = sharper image; lower values = blurrier.
 */
function computeLaplacianVariance(grayscale: Buffer, width: number): number {
  const height = Math.floor(grayscale.length / width);
  if (width < 3 || height < 3) return 0.3;

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      // Laplacian kernel: [0, 1, 0; 1, -4, 1; 0, 1, 0]
      const idx = y * width + x;
      const center = grayscale[idx];
      const top = grayscale[(y - 1) * width + x];
      const bottom = grayscale[(y + 1) * width + x];
      const left = grayscale[y * width + (x - 1)];
      const right = grayscale[y * width + (x + 1)];

      const laplacian = top + bottom + left + right - 4 * center;
      sum += laplacian;
      sumSq += laplacian * laplacian;
      count++;
    }
  }

  if (count === 0) return 0.3;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  // Normalize to 0-1 range (typical laplacian variance range is 0-5000)
  return Math.min(1, Math.max(0, Math.sqrt(Math.max(0, variance)) / 100));
}

/**
 * Compute an overall quality score from individual metrics.
 */
function computeQualityScore(
  brightness: number,
  contrast: number,
  saturation: number,
  blurScore: number,
  width: number,
): number {
  let score = 0;

  // Brightness: sweet spot is 0.3-0.7
  if (brightness >= 0.3 && brightness <= 0.7) score += 25;
  else if (brightness >= 0.2 && brightness <= 0.8) score += 15;
  else score += 5;

  // Contrast: higher is generally better for food photos
  score += contrast * 25;

  // Saturation: vibrant food photos benefit from higher saturation
  score += saturation * 25;

  // Sharpness: sharper is better
  score += blurScore * 15;

  // Resolution: higher resolution is better
  if (width >= 1080) score += 10;
  else if (width >= 720) score += 7;
  else if (width >= 480) score += 4;
  else score += 1;

  return Math.min(100, Math.max(0, score));
}

/**
 * Convert quality score to rating label.
 */
function getQualityRating(score: number): ImageQualityMetrics['qualityRating'] {
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'fair';
  return 'poor';
}

/**
 * Default metrics when image analysis is unavailable.
 */
function getDefaultMetrics(reason: string): ImageQualityMetrics {
  return {
    brightness: 0.5,
    contrast: 0.5,
    saturation: 0.5,
    blurScore: 0.5,
    resolution: { width: 0, height: 0 },
    aspectRatio: 1,
    qualityRating: 'fair',
  };
}

/**
 * Generate food-photography specific image improvement suggestions
 * based on the computed quality metrics.
 */
export function generateImageImprovementSuggestions(metrics: ImageQualityMetrics): string[] {
  const suggestions: string[] = [];

  if (metrics.brightness < 0.25) {
    suggestions.push('Image is too dark — use natural daylight or add lighting to make the food look more appetizing');
  } else if (metrics.brightness > 0.75) {
    suggestions.push('Image is overexposed — reduce brightness to preserve food detail and texture');
  }

  if (metrics.contrast < 0.25) {
    suggestions.push('Low contrast — increase contrast slightly to make food colors pop and text more readable');
  }

  if (metrics.saturation < 0.2) {
    suggestions.push('Colors look muted — boost saturation to make the food look more vibrant and appealing');
  }

  if (metrics.blurScore < 0.25) {
    suggestions.push('Image appears blurry — use a stable camera and tap to focus before shooting');
  }

  if (metrics.resolution.width < 480) {
    suggestions.push('Image resolution is too low — use at least 1080px width for social media posts');
  }

  if (metrics.aspectRatio > 2 || metrics.aspectRatio < 0.4) {
    suggestions.push('Unusual aspect ratio — Instagram works best with 1:1 (square) or 4:5 (portrait)');
  }

  if (metrics.qualityRating === 'poor') {
    suggestions.push('Overall image quality is low — consider retaking the photo with better lighting and focus');
  }

  // If no issues found, give positive feedback
  if (suggestions.length === 0) {
    suggestions.push('Image quality looks great! Your food photography is on point');
  }

  return suggestions;
}
