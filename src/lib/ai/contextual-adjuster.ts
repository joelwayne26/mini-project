/**
 * TrendLens AI v6.0 — Contextual Semantic Score Adjustment
 * Performs deep feature analysis and neural score refinement for poster evaluations.
 * Uses contextual semantic adjustment to produce dynamically refined scores,
 * improvement suggestions, and insights that account for nuanced inter-feature
 * relationships beyond heuristic computation.
 * Falls back gracefully if the service is unavailable.
 */

import ZAI from 'z-ai-web-dev-sdk';

export let _lastDebugInfo = '';

async function createZaiInstance(): Promise<InstanceType<typeof ZAI>> {
  // Try env vars first (set on Vercel), then fall back to config file
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

export interface RefinedResult {
  overallScore: number;
  posterScore: number;
  captionScore: number;
  shapAdjustments: { feature: string; adjustedContribution: number }[];
  captionInsight: string;
  posterImprovements: string[];
  captionImprovements: string[];
}

export async function refineScores(params: {
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
}): Promise<RefinedResult | null> {
  try {
    const zai = await createZaiInstance();
    _lastDebugInfo += ', zai instance created';

    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        _lastDebugInfo += ', TIMED_OUT';
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
Has CTA: ${params.hasCta ? 'YES' : 'NO'}
Has Price: ${params.hasPrice ? 'YES' : 'NO'}
Hashtag Count: ${params.hashtagCount}
Word Count: ${params.wordCount}
Emoji Count: ${params.emojiCount}
Sentiment: ${params.sentiment}
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
  "captionInsight": "<1-2 sentence specific insight about THIS caption's strengths/weaknesses>",
  "posterImprovements": [<2-4 specific, actionable improvement strings for THIS poster's image>],
  "captionImprovements": [<2-4 specific, actionable improvement strings for THIS caption's text>]
}

CRITICAL RULES:
- Scores MUST be different for different posters — a poster WITH CTA should score higher on CTA features than one WITHOUT
- If hasCta is NO, mention the missing CTA in improvements. If YES, do NOT suggest adding a CTA
- If hasPrice is NO, suggest adding price. If YES, do NOT suggest adding price
- posterImprovements must be specific to THIS poster's image quality metrics (dark/bright/blurry/sharp/etc)
- captionImprovements must be specific to THIS caption's actual content (too short, missing hashtags, etc)
- A poster with CTA + price + many hashtags should score noticeably higher than one without
- Use the actual image quality numbers to give specific suggestions (e.g. "brightness at 0.15 is too dark" not generic "improve lighting")`,
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
      _lastDebugInfo += `, API call succeeded`;

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        _lastDebugInfo += ', empty response content';
        return null;
      }

      _lastDebugInfo += `, content length: ${content.length}`;

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

      _lastDebugInfo += ', validation passed';
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
        captionInsight: String(parsed.captionInsight || '').slice(0, 300),
        posterImprovements: Array.isArray(parsed.posterImprovements)
          ? parsed.posterImprovements.map((s: any) => String(s)).slice(0, 6)
          : [],
        captionImprovements: Array.isArray(parsed.captionImprovements)
          ? parsed.captionImprovements.map((s: any) => String(s)).slice(0, 6)
          : [],
      };
    })();

    return Promise.race([refinementPromise, timeoutPromise]);
  } catch (err: any) {
    _lastDebugInfo += `, outer error: ${err?.message || String(err)}`;
    return null;
  }
}
