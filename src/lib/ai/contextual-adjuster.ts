/**
 * TrendLens AI v6.0 — Contextual Semantic Score Adjustment
 * Performs deep feature analysis and neural score refinement for poster evaluations.
 * Uses contextual semantic adjustment with visual analysis to produce dynamically
 * refined scores, improvement suggestions, and insights that account for nuanced
 * inter-feature relationships beyond heuristic computation.
 *
 * Key capability: Sends the poster IMAGE to a vision model so it can detect
 * visual elements like CTA text, prices, logos, and design quality that the
 * caption-only feature extractor cannot see.
 *
 * Falls back gracefully if the service is unavailable.
 */

import ZAI from 'z-ai-web-dev-sdk';

export let _lastDebugInfo = '';

// ─── Visual Analysis Result ────────────────────────────────────────────────

export interface VisualAnalysisResult {
  /** Whether a call-to-action was detected ON the poster image */
  visualCtaDetected: boolean;
  /** The CTA text found on the image */
  visualCtaText: string;
  /** Whether a price was detected ON the poster image */
  visualPriceDetected: boolean;
  /** The price text found on the image */
  visualPriceText: string;
  /** Other text detected on the poster */
  visualTextContent: string;
  /** Design quality assessment from visual analysis */
  visualDesignQuality: 'excellent' | 'good' | 'fair' | 'poor';
  /** Visual elements detected (e.g., logo, food photo, text overlay, etc.) */
  visualElements: string[];
}

export interface RefinedResult {
  overallScore: number;
  posterScore: number;
  captionScore: number;
  shapAdjustments: { feature: string; adjustedContribution: number }[];
  captionInsight: string;
  posterImprovements: string[];
  captionImprovements: string[];
  visualAnalysis: VisualAnalysisResult | null;
}

// ─── ZAI Instance Creation ─────────────────────────────────────────────────

async function createZaiInstance(): Promise<InstanceType<typeof ZAI>> {
  const baseUrl = process.env.ZAI_BASE_URL;
  const apiKey = process.env.ZAI_API_KEY;

  _lastDebugInfo = `env: baseUrl=${baseUrl ? 'SET' : 'MISSING'}, apiKey=${apiKey ? 'SET' : 'MISSING'}`;

  if (baseUrl && apiKey) {
    const config: Record<string, string> = { baseUrl, apiKey };
    if (process.env.ZAI_CHAT_ID) config.chatId = process.env.ZAI_CHAT_ID;
    if (process.env.ZAI_USER_ID) config.userId = process.env.ZAI_USER_ID;
    if (process.env.ZAI_TOKEN) config.token = process.env.ZAI_TOKEN;
    _lastDebugInfo += ', using env config';
    return new ZAI(config as any);
  }

  _lastDebugInfo += ', using ZAI.create()';
  return ZAI.create();
}

// ─── Step 1: Visual Analysis ───────────────────────────────────────────────

async function performVisualAnalysis(
  imageBase64: string,
  caption: string,
): Promise<VisualAnalysisResult | null> {
  try {
    const zai = await createZaiInstance();
    _lastDebugInfo += ', visual analysis: zai instance created';

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        _lastDebugInfo += ', VISUAL_TIMED_OUT';
        resolve(null);
      }, 30000);
    });

    const analysisPromise = (async () => {
      // Use the vision API to analyze the poster image
      const response = await zai.chat.completions.createVision({
        messages: [
          {
            role: 'system',
            content: `You are a social media poster analysis assistant for Ugandan food businesses. Analyze the poster image and return ONLY valid JSON — no markdown, no code blocks, no explanation outside the JSON.`,
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Analyze this social media poster image carefully. The caption for this post is: "${caption}"

Look at the IMAGE and identify:

1. Is there a call-to-action (CTA) visible on the poster? (e.g., "DM to order", "WhatsApp 0700...", "Call now", "Visit us", "Link in bio", "Order now", etc.)
2. Is there a price visible on the poster? (e.g., "UGX 50,000", "Starting at 30,000", "$20", "Shs 15,000", any number with currency)
3. What other text is visible on the poster?
4. What is the overall design quality of the poster? (text readability, layout, color contrast, professionalism)
5. What visual elements are present? (food photo, logo, brand name, phone number, social media icons, etc.)

Return ONLY this JSON (no markdown):
{
  "visualCtaDetected": <boolean - true if ANY CTA text is on the image>,
  "visualCtaText": "<the exact CTA text found on the image, or empty string>",
  "visualPriceDetected": <boolean - true if ANY price/currency is on the image>,
  "visualPriceText": "<the exact price text found on the image, or empty string>",
  "visualTextContent": "<all other notable text visible on the poster>",
  "visualDesignQuality": "<excellent|good|fair|poor>",
  "visualElements": [<list of visual elements detected: "logo", "food_photo", "phone_number", "social_icons", "text_overlay", "brand_name", "address", etc>]
}

CRITICAL: Be thorough. If you see ANY phone number, "DM", "order", "WhatsApp", "call", "visit", "link" text on the poster image, set visualCtaDetected to true. If you see ANY number that could be a price with a currency symbol (UGX, Shs, $, etc.), set visualPriceDetected to true.`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64.replace(/^data:image\/\w+;base64,/, '')}`,
                },
              },
            ],
          },
        ],
        thinking: { type: 'disabled' },
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        _lastDebugInfo += ', visual: empty response content';
        return null;
      }

      _lastDebugInfo += `, visual content length: ${content.length}`;

      // Strip markdown code fences if present
      const cleaned = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch (parseErr: any) {
        _lastDebugInfo += `, visual JSON parse error: ${parseErr?.message}`;
        return null;
      }

      _lastDebugInfo += ', visual analysis parsed successfully';
      return {
        visualCtaDetected: !!parsed.visualCtaDetected,
        visualCtaText: String(parsed.visualCtaText || ''),
        visualPriceDetected: !!parsed.visualPriceDetected,
        visualPriceText: String(parsed.visualPriceText || ''),
        visualTextContent: String(parsed.visualTextContent || ''),
        visualDesignQuality: ['excellent', 'good', 'fair', 'poor'].includes(parsed.visualDesignQuality)
          ? parsed.visualDesignQuality
          : 'fair',
        visualElements: Array.isArray(parsed.visualElements)
          ? parsed.visualElements.map((s: any) => String(s))
          : [],
      } as VisualAnalysisResult;
    })();

    return Promise.race([analysisPromise, timeoutPromise]);
  } catch (err: any) {
    _lastDebugInfo += `, visual analysis error: ${err?.message || String(err)}`;
    return null;
  }
}

// ─── Step 2: Score Refinement ──────────────────────────────────────────────

async function performScoreRefinement(params: {
  caption: string;
  category: string;
  imageQuality: { brightness: number; contrast: number; saturation: number; blurScore: number; resolution: { width: number; height: number }; qualityRating: string } | null;
  heuristicOverall: number;
  heuristicPoster: number;
  heuristicCaption: number;
  shapValues: { feature: string; value: number; contribution: number }[];
  hasCta: boolean;
  hasPrice: boolean;
  hashtagCount: number;
  wordCount: number;
  emojiCount: number;
  sentiment: string;
  benchmarkSamples: number;
  modelAuc: number;
  visualAnalysis: VisualAnalysisResult | null;
}): Promise<Omit<RefinedResult, 'visualAnalysis'> | null> {
  try {
    const zai = await createZaiInstance();
    _lastDebugInfo += ', score refinement: zai instance created';

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        _lastDebugInfo += ', REFINE_TIMED_OUT';
        resolve(null);
      }, 25000);
    });

    const refinementPromise = (async () => {
      const baseUrl = process.env.ZAI_BASE_URL || '';
      const apiKey = process.env.ZAI_API_KEY || '';
      const chatId = process.env.ZAI_CHAT_ID || '';
      const token = process.env.ZAI_TOKEN || '';
      const userId = process.env.ZAI_USER_ID || '';

      const fetchUrl = `${baseUrl}/chat/completions`;
      const fetchHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Z-AI-From': 'Z',
      };
      if (chatId) fetchHeaders['X-Chat-Id'] = chatId;
      if (userId) fetchHeaders['X-User-Id'] = userId;
      if (token) fetchHeaders['X-Token'] = token;

      const imageDesc = params.imageQuality
        ? `Brightness: ${params.imageQuality.brightness}, Contrast: ${params.imageQuality.contrast}, Saturation: ${params.imageQuality.saturation}, Sharpness: ${params.imageQuality.blurScore}, Resolution: ${params.imageQuality.resolution.width}x${params.imageQuality.resolution.height}, Quality: ${params.imageQuality.qualityRating}`
        : 'No image provided';

      const shapDesc = params.shapValues.map(s => `${s.feature}(val=${s.value}, contrib=${s.contribution})`).join(', ');

      // Include visual analysis results in the prompt
      const visualDesc = params.visualAnalysis
        ? `VISUAL ANALYSIS (from poster image):
- CTA detected on image: ${params.visualAnalysis.visualCtaDetected ? `YES ("${params.visualAnalysis.visualCtaText}")` : 'NO'}
- Price detected on image: ${params.visualAnalysis.visualPriceDetected ? `YES ("${params.visualAnalysis.visualPriceText}")` : 'NO'}
- Other text on image: "${params.visualAnalysis.visualTextContent}"
- Design quality: ${params.visualAnalysis.visualDesignQuality}
- Visual elements: ${params.visualAnalysis.visualElements.join(', ')}`
        : 'Visual analysis unavailable';

      const effectiveCta = params.hasCta || (params.visualAnalysis?.visualCtaDetected ?? false);
      const effectivePrice = params.hasPrice || (params.visualAnalysis?.visualPriceDetected ?? false);

      const fetchBody = JSON.stringify({
        messages: [
          {
            role: 'system',
            content: `You are a social media poster evaluation assistant for Ugandan food businesses. Analyze the poster data and provide refined scores, specific improvement suggestions, and insights. Return ONLY valid JSON — no markdown, no code blocks, no explanation outside the JSON.`,
          },
          {
            role: 'user',
            content: `Analyze this social media poster and provide refined evaluation.

Caption: "${params.caption}"
Category: ${params.category}
Image Quality: ${imageDesc}

${visualDesc}

EFFECTIVE FEATURES (combining caption + visual analysis):
- Has CTA: ${effectiveCta ? 'YES' : 'NO'} (caption: ${params.hasCta ? 'YES' : 'NO'}, image: ${params.visualAnalysis?.visualCtaDetected ? 'YES' : 'NO'})
- Has Price: ${effectivePrice ? 'YES' : 'NO'} (caption: ${params.hasPrice ? 'YES' : 'NO'}, image: ${params.visualAnalysis?.visualPriceDetected ? 'YES' : 'NO'})
- Hashtag Count: ${params.hashtagCount}
- Word Count: ${params.wordCount}
- Emoji Count: ${params.emojiCount}
- Sentiment: ${params.sentiment}
MongoDB Benchmark Samples: ${params.benchmarkSamples}
Model AUC: ${params.modelAuc}
Heuristic Scores — Overall: ${params.heuristicOverall}/10, Poster: ${params.heuristicPoster}/10, Caption: ${params.heuristicCaption}/10
SHAP Values: ${shapDesc}

Return ONLY this JSON (no markdown):
{
  "overallScore": <number 1-10 adjusted for THIS specific poster>,
  "posterScore": <number 1-10>,
  "captionScore": <number 1-10>,
  "shapAdjustments": [{"feature": "<name from list>", "adjustedContribution": <number>}],
  "captionInsight": "<1-2 sentence specific insight about THIS poster's strengths/weaknesses, referencing actual elements detected>",
  "posterImprovements": [<2-5 specific, actionable improvement strings for THIS poster - reference actual visual elements, CTA, price, design quality>],
  "captionImprovements": [<2-5 specific, actionable improvement strings for THIS caption's text>]
}

CRITICAL RULES:
- The effective Has CTA is ${effectiveCta ? 'YES, so do NOT suggest adding a CTA, instead praise it or suggest making it more prominent' : 'NO, so DO suggest adding a CTA'}
- The effective Has Price is ${effectivePrice ? 'YES, so do NOT suggest adding a price, instead mention it as a strength' : 'NO, so DO suggest adding a price'}
- posterImprovements MUST reference specific things about THIS poster (e.g., if design quality is poor, mention it; if it has a food photo, mention it; if CTA is on the image, say it is clearly visible etc.)
- captionImprovements MUST reference THIS caption's actual content (word count, hashtag count, sentiment, etc.)
- A poster WITH CTA + price + good design should score noticeably HIGHER than one without
- Use actual image quality numbers to give specific suggestions
- Every improvement suggestion must be DIFFERENT for different posters, no generic text`,
          },
        ],
        thinking: { type: 'disabled' },
      });

      const fetchResponse = await fetch(fetchUrl, {
        method: 'POST',
        headers: fetchHeaders,
        body: fetchBody,
      });

      if (!fetchResponse.ok) {
        const errorBody = await fetchResponse.text();
        _lastDebugInfo += `, API HTTP error ${fetchResponse.status}: ${errorBody.substring(0, 200)}`;
        return null;
      }

      const response = await fetchResponse.json();
      _lastDebugInfo += ', score refinement API call succeeded';

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        _lastDebugInfo += ', empty response content';
        return null;
      }

      _lastDebugInfo += `, refinement content length: ${content.length}`;

      // Strip markdown code fences if present
      const cleaned = content.replace(/```json?\n?/g, '').replace(/```/g, '').trim();

      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch (parseErr: any) {
        _lastDebugInfo += `, JSON parse error: ${parseErr?.message}`;
        return null;
      }

      // Validate required fields
      if (typeof parsed.overallScore !== 'number' || typeof parsed.posterScore !== 'number' || typeof parsed.captionScore !== 'number') {
        _lastDebugInfo += `, invalid score structure`;
        return null;
      }

      _lastDebugInfo += ', refinement validation passed';
      return {
        overallScore: Math.max(1, Math.min(10, Math.round(parsed.overallScore * 10) / 10)),
        posterScore: Math.max(1, Math.min(10, Math.round(parsed.posterScore * 10) / 10)),
        captionScore: Math.max(1, Math.min(10, Math.round(parsed.captionScore * 10) / 10)),
        shapAdjustments: Array.isArray(parsed.shapAdjustments)
          ? parsed.shapAdjustments.map((a: any) => ({
              feature: String(a.feature || ''),
              adjustedContribution: Number(a.adjustedContribution || 0),
            }))
          : [],
        captionInsight: String(parsed.captionInsight || '').slice(0, 500),
        posterImprovements: Array.isArray(parsed.posterImprovements)
          ? parsed.posterImprovements.map((s: any) => String(s)).slice(0, 8)
          : [],
        captionImprovements: Array.isArray(parsed.captionImprovements)
          ? parsed.captionImprovements.map((s: any) => String(s)).slice(0, 8)
          : [],
      };
    })();

    return Promise.race([refinementPromise, timeoutPromise]);
  } catch (err: any) {
    _lastDebugInfo += `, refinement error: ${err?.message || String(err)}`;
    return null;
  }
}

// ─── Main Entry Point ──────────────────────────────────────────────────────

export async function refineScores(params: {
  caption: string;
  category: string;
  imageBase64?: string;
  imageQuality: { brightness: number; contrast: number; saturation: number; blurScore: number; resolution: { width: number; height: number }; qualityRating: string } | null;
  heuristicOverall: number;
  heuristicPoster: number;
  heuristicCaption: number;
  shapValues: { feature: string; value: number; contribution: number }[];
  hasCta: boolean;
  hasPrice: boolean;
  hashtagCount: number;
  wordCount: number;
  emojiCount: number;
  sentiment: string;
  benchmarkSamples: number;
  modelAuc: number;
}): Promise<RefinedResult | null> {
  try {
    _lastDebugInfo = 'starting contextual adjustment';

    // Step 1: Visual analysis of the poster image (if image provided)
    let visualAnalysis: VisualAnalysisResult | null = null;
    if (params.imageBase64) {
      visualAnalysis = await performVisualAnalysis(params.imageBase64, params.caption);
      if (visualAnalysis) {
        _lastDebugInfo += `, visual CTA: ${visualAnalysis.visualCtaDetected}, visual Price: ${visualAnalysis.visualPriceDetected}`;
      }
    }

    // Step 2: Score refinement with visual analysis context
    const refinement = await performScoreRefinement({
      ...params,
      visualAnalysis,
    });

    if (!refinement) {
      // Return just the visual analysis even if score refinement failed
      if (visualAnalysis) {
        return {
          overallScore: params.heuristicOverall,
          posterScore: params.heuristicPoster,
          captionScore: params.heuristicCaption,
          shapAdjustments: [],
          captionInsight: '',
          posterImprovements: [],
          captionImprovements: [],
          visualAnalysis,
        };
      }
      return null;
    }

    return {
      ...refinement,
      visualAnalysis,
    };
  } catch (err: any) {
    _lastDebugInfo += `, outer error: ${err?.message || String(err)}`;
    return null;
  }
}
