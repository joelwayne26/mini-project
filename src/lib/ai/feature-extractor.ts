/**
 * TrendLens AI v6.0 — Feature Extractor
 * Extracts features from captions and images for scoring.
 * No external APIs — all computation is local.
 */

import { CaptionFeatures, ImageQualityMetrics, ExtractedFeatures } from './types';
import { classifyCategory, getCategoryRule } from './category-rules';

// ─── CTA Detection Patterns ────────────────────────────────────────────────

const CTA_PATTERNS = [
  'dm to', 'dm us', 'dm me', 'whatsapp', 'link in bio', 'order now',
  'call ', 'visit our', 'book now', 'get yours', 'place your order',
  'slide into our dm', 'hit us up', 'reach out', 'tap the link',
  'click the link', 'shop now', 'order yours', 'limited offer',
  'while stock lasts', 'don\'t miss out', 'contact us',
];

const PRICE_PATTERNS = [
  'ugx', 'ush', 'u_sh', 'ugandan shilling', 'starting at',
  'from ', 'only ', 'price', 'kampala price', '$', 'shs',
];

// ─── Caption Feature Extraction ────────────────────────────────────────────

export function extractCaptionFeatures(caption: string, category?: string): CaptionFeatures {
  if (!caption) caption = '';
  const lower = caption.toLowerCase();
  const words = caption.split(/\s+/).filter(w => w.length > 0);
  const hashtags = caption.match(/#\w+/g) || [];
  const emojis = caption.match(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || [];

  // CTA detection
  const ctaMatch = CTA_PATTERNS.find(p => lower.includes(p));
  const hasCta = !!ctaMatch;

  // Price detection
  const hasPrice = PRICE_PATTERNS.some(p => lower.includes(p)) ||
    /\d{3,}/.test(caption); // Number with 3+ digits likely a price in UGX

  // Sentiment (simple lexicon-based)
  const positiveWords = ['amazing', 'delicious', 'best', 'fresh', 'love', 'perfect', 'special', 'premium', 'quality', 'tasty', 'yummy', 'mouthwatering', 'irresistible', 'incredible', 'fantastic', 'awesome', 'wonderful', 'excellent', 'great', 'beautiful', 'gorgeous'];
  const negativeWords = ['bad', 'terrible', 'worst', 'disappointed', 'poor', 'awful', 'horrible', 'sad', 'sorry', 'unfortunately', 'expired', 'stale', 'burnt'];
  let polarity = 0;
  for (const w of positiveWords) if (lower.includes(w)) polarity += 0.15;
  for (const w of negativeWords) if (lower.includes(w)) polarity -= 0.2;
  polarity = Math.max(-1, Math.min(1, polarity));

  // Readability (simple metric based on sentence length and word length)
  const avgWordLen = words.length > 0 ? words.reduce((sum, w) => sum + w.replace(/[^a-zA-Z]/g, '').length, 0) / words.length : 0;
  const readability = Math.max(0, Math.min(1, 1 - (avgWordLen - 4) * 0.1));

  // Detected category
  const detectedCategory = category || classifyCategory(caption);
  const rules = getCategoryRule(detectedCategory);

  // Category checks
  const categoryChecks = {
    hashtag_count_ok: hashtags.length >= rules.minHashtags,
    hashtag_count_ideal: hashtags.length >= rules.idealHashtags,
    hashtag_gap: Math.max(0, rules.idealHashtags - hashtags.length),
    caption_length_ok: rules.idealCaptionLength[0] <= words.length && words.length <= rules.idealCaptionLength[1],
    caption_too_short: words.length < rules.idealCaptionLength[0],
    caption_too_long: words.length > rules.idealCaptionLength[1],
    has_price: hasPrice,
    price_required: rules.priceRequired,
    price_check_pass: !rules.priceRequired || hasPrice,
    has_cta: hasCta,
    cta_required: rules.ctaRequired,
    cta_check_pass: !rules.ctaRequired || hasCta,
    emoji_count: emojis.length,
    emoji_ok: emojis.length >= 1,
    sentiment_positive: polarity > 0.1,
    sentiment_neutral: -0.1 <= polarity && polarity <= 0.1,
    sentiment_negative: polarity < -0.1,
    has_required_keywords: rules.requiredKeywords.every(kw => lower.includes(kw)),
    missing_required_keywords: rules.requiredKeywords.filter(kw => !lower.includes(kw)),
  };

  // Overall caption score (0-100)
  let captionScore = 50;
  if (categoryChecks.hashtag_count_ideal) captionScore += 15;
  else if (categoryChecks.hashtag_count_ok) captionScore += 8;
  else captionScore -= 10;

  if (categoryChecks.caption_length_ok) captionScore += 10;
  else if (categoryChecks.caption_too_short) captionScore -= 8;
  else captionScore -= 3;

  if (categoryChecks.price_check_pass) captionScore += 8;
  else captionScore -= 5;

  if (categoryChecks.cta_check_pass) captionScore += 10;
  else captionScore -= 8;

  if (categoryChecks.sentiment_positive) captionScore += 5;
  else if (categoryChecks.sentiment_negative) captionScore -= 5;

  if (categoryChecks.has_required_keywords) captionScore += 5;
  else captionScore -= (categoryChecks.missing_required_keywords as string[]).length * 3;

  if (categoryChecks.emoji_ok) captionScore += 3;

  captionScore = Math.max(0, Math.min(100, captionScore));

  // Trend alignment (placeholder — populated by trend engine)
  const trendAlignment = {
    score: 0,
    method: 'none',
    bestTrendKeyword: '',
    matchedKeywords: [] as string[],
  };

  // Suggestions
  const suggestions: string[] = [];
  if (!categoryChecks.hashtag_count_ok) {
    suggestions.push(`Add ${categoryChecks.hashtag_gap} more hashtags for better reach`);
  }
  if (categoryChecks.caption_too_short) {
    suggestions.push('Caption is too short — add more descriptive text');
  }
  if (!categoryChecks.price_check_pass) {
    suggestions.push("Add a price (e.g., 'UGX 50,000') — posts with prices get more engagement");
  }
  if (!categoryChecks.cta_check_pass) {
    suggestions.push("Add a call-to-action like 'DM to order'");
  }
  if (!categoryChecks.has_required_keywords) {
    const missing = categoryChecks.missing_required_keywords as string[];
    if (missing.length > 0) suggestions.push(`Include these keywords: ${missing.join(', ')}`);
  }
  if (!categoryChecks.emoji_ok) {
    suggestions.push('Add relevant emojis to make the caption more visually appealing');
  }

  return {
    hashtagCount: hashtags.length,
    wordCount: words.length,
    emojiCount: emojis.length,
    hasPrice,
    hasCta,
    ctaType: ctaMatch || '',
    sentiment: { polarity, subjectivity: Math.abs(polarity) },
    readability,
    trendAlignment,
    categoryChecks,
    captionScore,
    suggestions,
    rawCaption: caption,
  };
}

// ─── Image Quality Assessment ──────────────────────────────────────────────

export async function assessImageQuality(imageData: string): Promise<ImageQualityMetrics | null> {
  try {
    // For base64 data URLs
    if (!imageData.startsWith('data:image') && !imageData.startsWith('/')) {
      return null; // Can't assess URLs server-side without fetching
    }

    // We'll implement a simplified version that works with canvas on the client side
    // Server-side we return null and let the client-side handle it
    return null;
  } catch {
    return null;
  }
}

// ─── Client-Side Image Quality ─────────────────────────────────────────────

export function assessImageQualityClient(img: HTMLImageElement): ImageQualityMetrics {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return defaultImageQuality(img.naturalWidth, img.naturalHeight);
  }

  canvas.width = img.naturalWidth || 400;
  canvas.height = img.naturalHeight || 400;
  ctx.drawImage(img, 0, 0);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return defaultImageQuality(canvas.width, canvas.height);
  }

  const data = imageData.data;
  const pixelCount = data.length / 4;

  // Brightness
  let totalBrightness = 0;
  for (let i = 0; i < data.length; i += 4) {
    totalBrightness += (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
  }
  const brightness = totalBrightness / pixelCount;

  // Contrast
  let brightnessSum = 0;
  let brightnessSqSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const b = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
    brightnessSum += b;
    brightnessSqSum += b * b;
  }
  const meanBrightness = brightnessSum / pixelCount;
  const variance = brightnessSqSum / pixelCount - meanBrightness * meanBrightness;
  const contrast = Math.sqrt(Math.max(0, variance));

  // Saturation (approximate via HSV)
  let totalSaturation = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const diff = max - min;
    totalSaturation += max > 0 ? diff / max : 0;
  }
  const saturation = totalSaturation / pixelCount;

  // Blur detection (Laplacian variance approximation)
  let laplacianSum = 0;
  let laplacianSqSum = 0;
  let lapCount = 0;
  for (let y = 1; y < canvas.height - 1; y++) {
    for (let x = 1; x < canvas.width - 1; x++) {
      const idx = (y * canvas.width + x) * 4;
      const center = data[idx];
      const top = data[((y - 1) * canvas.width + x) * 4];
      const bottom = data[((y + 1) * canvas.width + x) * 4];
      const left = data[(y * canvas.width + x - 1) * 4];
      const right = data[(y * canvas.width + x + 1) * 4];
      const lap = center * 4 - top - bottom - left - right;
      laplacianSum += lap;
      laplacianSqSum += lap * lap;
      lapCount++;
    }
  }
  const lapMean = lapCount > 0 ? laplacianSum / lapCount : 0;
  const lapVariance = lapCount > 0 ? laplacianSqSum / lapCount - lapMean * lapMean : 0;
  const blurScore = Math.sqrt(Math.max(0, lapVariance)) / 100; // Normalize

  const resolution = { width: canvas.width, height: canvas.height };
  const aspectRatio = canvas.width / canvas.height;

  let qualityRating: ImageQualityMetrics['qualityRating'];
  if (brightness > 0.2 && brightness < 0.8 && contrast > 0.15 && blurScore > 0.5) {
    qualityRating = 'excellent';
  } else if (brightness > 0.15 && contrast > 0.1 && blurScore > 0.3) {
    qualityRating = 'good';
  } else if (brightness > 0.1 && contrast > 0.05) {
    qualityRating = 'fair';
  } else {
    qualityRating = 'poor';
  }

  return { brightness, contrast, saturation, blurScore, resolution, aspectRatio, qualityRating };
}

function defaultImageQuality(w: number, h: number): ImageQualityMetrics {
  return {
    brightness: 0.5,
    contrast: 0.2,
    saturation: 0.3,
    blurScore: 0.5,
    resolution: { width: w || 400, height: h || 400 },
    aspectRatio: w && h ? w / h : 1,
    qualityRating: 'fair',
  };
}

// ─── Build Feature Vector ──────────────────────────────────────────────────

export function buildFeatureVector(captionFeatures: CaptionFeatures, imageQuality: ImageQualityMetrics | null): number[] {
  const cf = captionFeatures;
  const iq = imageQuality;

  return [
    // Caption features (10 dims)
    cf.hashtagCount / 20,
    cf.wordCount / 200,
    cf.emojiCount / 10,
    cf.hasPrice ? 1 : 0,
    cf.hasCta ? 1 : 0,
    cf.sentiment.polarity,
    cf.readability,
    cf.trendAlignment.score,
    cf.captionScore / 100,
    cf.categoryChecks.has_required_keywords ? 1 : 0,

    // Image quality features (6 dims)
    iq ? iq.brightness : 0.5,
    iq ? iq.contrast : 0.2,
    iq ? iq.saturation : 0.3,
    iq ? iq.blurScore : 0.5,
    iq ? iq.aspectRatio : 1,
    iq ? (iq.qualityRating === 'excellent' ? 1 : iq.qualityRating === 'good' ? 0.7 : iq.qualityRating === 'fair' ? 0.4 : 0.1) : 0.5,
  ];
}
