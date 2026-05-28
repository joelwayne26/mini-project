"""
trendlens/shap_explainer.py
SHAP-like feature contribution explainer for poster evaluations.
Computes how each feature contributes to the final score (positive or negative).
No external LLM APIs — uses heuristic baseline and marginal contribution method.
"""

import math
from typing import Any, Dict, List, Tuple


# Feature weights learned from historical data patterns
FEATURE_WEIGHTS: Dict[str, float] = {
    "hashtag_count": 0.12,
    "has_cta": 0.18,
    "has_price": 0.15,
    "word_count": 0.08,
    "sentiment": 0.06,
    "trend_alignment": 0.14,
    "emoji_count": 0.04,
    "readability": 0.05,
    "has_location": 0.06,
    "has_contact": 0.08,
    "image_brightness": 0.04,
    "image_contrast": 0.05,
    "image_saturation": 0.04,
    "text_on_image": 0.06,
}

# Baseline (average) feature values
BASELINE_VALUES: Dict[str, float] = {
    "hashtag_count": 5.0,
    "has_cta": 0.5,
    "has_price": 0.4,
    "word_count": 80.0,
    "sentiment": 0.15,
    "trend_alignment": 0.3,
    "emoji_count": 1.5,
    "readability": 0.6,
    "has_location": 0.3,
    "has_contact": 0.4,
    "image_brightness": 0.5,
    "image_contrast": 0.4,
    "image_saturation": 0.35,
    "text_on_image": 0.6,
}


class SHAPExplainer:
    """Compute SHAP-like feature contributions for poster evaluations."""

    def explain(
        self,
        caption_features: Dict[str, Any],
        overall_score: float = 5.0,
        category: str = "general",
    ) -> List[Dict[str, Any]]:
        """Compute feature contributions to the evaluation score.

        Returns a list of {feature, value, contribution, direction} dicts.
        """
        shap_values: List[Dict[str, Any]] = []

        # Hashtag count
        ht_count = int(caption_features.get("hashtag_count", 0))
        ht_contribution = self._feature_contribution("hashtag_count", self._ht_score(ht_count), self._ht_score(BASELINE_VALUES["hashtag_count"]))
        shap_values.append({
            "feature": "hashtag_count",
            "value": ht_count,
            "contribution": round(ht_contribution, 3),
            "direction": "positive" if ht_contribution >= 0 else "negative",
        })

        # Has CTA
        has_cta = bool(caption_features.get("cta", {}).get("has_cta", False)) if isinstance(caption_features.get("cta"), dict) else bool(caption_features.get("has_cta", False))
        cta_val = 1.0 if has_cta else 0.0
        cta_contribution = (cta_val - BASELINE_VALUES["has_cta"]) * FEATURE_WEIGHTS["has_cta"] * 10
        shap_values.append({
            "feature": "has_cta",
            "value": has_cta,
            "contribution": round(cta_contribution, 3),
            "direction": "positive" if cta_contribution >= 0 else "negative",
        })

        # Has price
        has_price = bool(caption_features.get("has_price", False))
        price_val = 1.0 if has_price else 0.0
        price_contribution = (price_val - BASELINE_VALUES["has_price"]) * FEATURE_WEIGHTS["has_price"] * 10
        shap_values.append({
            "feature": "has_price",
            "value": has_price,
            "contribution": round(price_contribution, 3),
            "direction": "positive" if price_contribution >= 0 else "negative",
        })

        # Word count
        wc = int(caption_features.get("word_count", 0))
        wc_score = self._wc_score(wc)
        wc_baseline_score = self._wc_score(BASELINE_VALUES["word_count"])
        wc_contribution = (wc_score - wc_baseline_score) * FEATURE_WEIGHTS["word_count"] * 10
        shap_values.append({
            "feature": "word_count",
            "value": wc,
            "contribution": round(wc_contribution, 3),
            "direction": "positive" if wc_contribution >= 0 else "negative",
        })

        # Sentiment
        sentiment = caption_features.get("sentiment", {})
        polarity = float(sentiment.get("polarity", 0)) if isinstance(sentiment, dict) else 0.0
        sent_contribution = (polarity - BASELINE_VALUES["sentiment"]) * FEATURE_WEIGHTS["sentiment"] * 10
        shap_values.append({
            "feature": "sentiment",
            "value": round(polarity, 2),
            "contribution": round(sent_contribution, 3),
            "direction": "positive" if sent_contribution >= 0 else "negative",
        })

        # Trend alignment
        alignment = caption_features.get("trend_alignment", {})
        alignment_score = float(alignment.get("score", 0)) if isinstance(alignment, dict) else 0.0
        trend_contribution = (alignment_score - BASELINE_VALUES["trend_alignment"]) * FEATURE_WEIGHTS["trend_alignment"] * 10
        shap_values.append({
            "feature": "trend_alignment",
            "value": round(alignment_score, 2),
            "contribution": round(trend_contribution, 3),
            "direction": "positive" if trend_contribution >= 0 else "negative",
        })

        # Emoji count
        emoji_count = int(caption_features.get("emoji_count", 0))
        emoji_contribution = (min(emoji_count, 5) - BASELINE_VALUES["emoji_count"]) * FEATURE_WEIGHTS["emoji_count"] * 2
        shap_values.append({
            "feature": "emoji_count",
            "value": emoji_count,
            "contribution": round(emoji_contribution, 3),
            "direction": "positive" if emoji_contribution >= 0 else "negative",
        })

        # Sort by absolute contribution
        shap_values.sort(key=lambda x: abs(x["contribution"]), reverse=True)
        return shap_values

    def _feature_contribution(self, name: str, actual_score: float, baseline_score: float) -> float:
        return actual_score - baseline_score

    def _ht_score(self, count: float) -> float:
        c = int(count)
        if c >= 10: return 1.0
        elif c >= 8: return 0.85
        elif c >= 5: return 0.65
        elif c >= 3: return 0.45
        elif c >= 1: return 0.25
        return 0.0

    def _wc_score(self, wc: float) -> float:
        w = int(wc)
        if 50 <= w <= 200: return 1.0
        elif 30 <= w < 50: return 0.7
        elif 200 < w <= 300: return 0.7
        elif 15 <= w < 30: return 0.4
        elif 300 < w <= 500: return 0.4
        elif w < 15: return 0.2
        return 0.2
