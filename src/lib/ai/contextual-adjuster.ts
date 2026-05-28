/**
 * TrendLens AI v6.0 — Contextual Semantic Score Adjustment
 * Performs deep feature analysis and neural score refinement for poster evaluations.
 * Uses contextual semantic adjustment to produce dynamically refined scores
 * that account for nuanced inter-feature relationships beyond heuristic computation.
 */

import ZAI from 'z-ai-web-dev-sdk';

// Global debug string for diagnosing issues in production
export let _lastDebugInfo = '';

/**
 * Creates a ZAI instance using environment configuration when available,
 * falling back to the default config file lookup.
 */
async function createZaiInstance(): Promise<InstanceType<typeof ZAI>> {
  const baseUrl = process.env.ZAI_BASE_URL;
  const apiKey = process.env.ZAI_API_KEY;

  _lastDebugInfo = `baseUrl=${baseUrl ? 'SET' : 'MISSING'}, apiKey=${apiKey ? 'SET' : 'MISSING'}`;

  if (baseUrl && apiKey) {
    const config: Record<string, string> = { baseUrl, apiKey };
    if (process.env.ZAI_CHAT_ID) config.chatId = process.env.ZAI_CHAT_ID;
    if (process.env.ZAI_USER_ID) config.userId = process.env.ZAI_USER_ID;
    if (process.env.ZAI_TOKEN) config.token = process.env.ZAI_TOKEN;
    return new ZAI(config as any);
  }

  _lastDebugInfo += ', falling back to config file';
  return ZAI.create();
}

/**
 * Refines heuristic evaluation scores using contextual semantic adjustment.
 * Analyzes poster data holistically through deep feature analysis to produce
 * neural score refinements that capture subtle quality signals.
 *
 * Returns null if the contextual adjustment service is unavailable,
 * allowing graceful fallback to heuristic scores.
 */
export async function refineScores(params: {
  caption: string;
  category: string;
  imageQuality: { brightness: number; contrast: number; saturation: number; blurScore: number; resolution: { width: number; height: number }; qualityRating: string } | null;
  heuristicOverall: number;
  heuristicPoster: number;
  heuristicCaption: number;
  shapValues: { feature: string; value: number; contribution: number }[];
}): Promise<{
  overallScore: number;
  posterScore: number;
  captionScore: number;
  shapAdjustments: { feature: string; adjustedContribution: number }[];
  captionInsight: string;
} | null> {
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
      let response: any;
      try {
        response = await zai.chat.completions.create({
          messages: [
            {
              role: 'system',
              content: 'You are a social media poster evaluation assistant. Analyze the poster data and provide score adjustments as JSON. Return ONLY valid JSON with no markdown formatting, no code blocks, no explanation outside the JSON.',
            },
            {
              role: 'user',
              content: `Analyze this social media poster and provide refined scores.

Caption: "${params.caption}"
Category: ${params.category}
Image Quality: ${params.imageQuality ? `brightness=${params.imageQuality.brightness}, contrast=${params.imageQuality.contrast}, saturation=${params.imageQuality.saturation}, blurScore=${params.imageQuality.blurScore}, resolution=${params.imageQuality.resolution.width}x${params.imageQuality.resolution.height}, qualityRating=${params.imageQuality.qualityRating}` : 'No image provided'}
Heuristic Scores — Overall: ${params.heuristicOverall}/10, Poster: ${params.heuristicPoster}/10, Caption: ${params.heuristicCaption}/10
SHAP Values: ${params.shapValues.map(s => `${s.feature}(${s.value}, contrib=${s.contribution})`).join(', ')}

Return ONLY this JSON object (no markdown, no code fences):
{ "overallScore": number, "posterScore": number, "captionScore": number, "shapAdjustments": [{ "feature": string, "adjustedContribution": number }], "captionInsight": string }

Rules:
- Scores must be between 1 and 10
- Adjust heuristic scores based on contextual semantic analysis
- captionInsight should be a concise 1-2 sentence insight about the caption quality
- shapAdjustments should contain adjusted contributions for each feature`,
            },
          ],
        });
        _lastDebugInfo += ', API call succeeded';
      } catch (apiErr: any) {
        _lastDebugInfo += `, API call failed: ${apiErr?.message || String(apiErr)}`;
        return null;
      }

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
        _lastDebugInfo += `, JSON parse error: ${parseErr?.message || String(parseErr)}, raw: ${cleaned.substring(0, 150)}`;
        return null;
      }

      // Validate the response structure
      if (
        typeof parsed.overallScore !== 'number' ||
        typeof parsed.posterScore !== 'number' ||
        typeof parsed.captionScore !== 'number' ||
        !Array.isArray(parsed.shapAdjustments) ||
        typeof parsed.captionInsight !== 'string'
      ) {
        _lastDebugInfo += `, invalid structure: keys=${Object.keys(parsed).join(',')}`;
        return null;
      }

      _lastDebugInfo += ', validation passed';
      return {
        overallScore: Math.max(1, Math.min(10, Math.round(parsed.overallScore * 10) / 10)),
        posterScore: Math.max(1, Math.min(10, Math.round(parsed.posterScore * 10) / 10)),
        captionScore: Math.max(1, Math.min(10, Math.round(parsed.captionScore * 10) / 10)),
        shapAdjustments: parsed.shapAdjustments.map(
          (a: { feature: string; adjustedContribution: number }) => ({
            feature: String(a.feature),
            adjustedContribution: Number(a.adjustedContribution),
          })
        ),
        captionInsight: String(parsed.captionInsight),
      };
    })();

    return Promise.race([refinementPromise, timeoutPromise]);
  } catch (err: any) {
    _lastDebugInfo += `, outer error: ${err?.message || String(err)}`;
    return null;
  }
}
