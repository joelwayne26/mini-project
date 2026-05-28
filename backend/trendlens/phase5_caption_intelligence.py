"""
trendlens/phase5_caption_intelligence.py
CaptionIntelligence — comprehensive caption analysis with trend alignment.
"""

import logging
import re
from typing import Any, Dict, List, Optional

from trendlens.text_processor import TextProcessor
from trendlens.config import settings

logger = logging.getLogger(__name__)

# Category-specific validation rules
CATEGORY_RULES: Dict[str, Dict[str, Any]] = {
    "cake": {
        "ideal_hashtags": 8,
        "min_hashtags": 5,
        "ideal_caption_length": (80, 200),
        "required_keywords": ["cake", "order", "delivery"],
        "price_required": True,
        "cta_required": True,
    },
    "bakery": {
        "ideal_hashtags": 7,
        "min_hashtags": 4,
        "ideal_caption_length": (60, 180),
        "required_keywords": ["bakery", "fresh", "bread"],
        "price_required": True,
        "cta_required": True,
    },
    "restaurant": {
        "ideal_hashtags": 8,
        "min_hashtags": 5,
        "ideal_caption_length": (80, 220),
        "required_keywords": ["food", "restaurant", "menu"],
        "price_required": False,
        "cta_required": True,
    },
    "general": {
        "ideal_hashtags": 6,
        "min_hashtags": 3,
        "ideal_caption_length": (50, 200),
        "required_keywords": [],
        "price_required": False,
        "cta_required": False,
    },
}


class CaptionIntelligence:
    """Analyse captions with trend alignment, sentiment, and category checks."""

    def __init__(self) -> None:
        self._text_processor = TextProcessor()
        self._trend_encoder = None
        self._trend_keywords: List[str] = []
        self._try_init_trend_encoder()

    def _try_init_trend_encoder(self) -> None:
        """Attempt to load TrendAlignmentEncoder for trend-caption alignment."""
        try:
            from trendlens.transfer.trend_encoder import TrendAlignmentEncoder
            self._trend_encoder = TrendAlignmentEncoder()
            logger.info("TrendAlignmentEncoder loaded for caption intelligence")
        except Exception as exc:
            logger.debug("TrendAlignmentEncoder not available: %s", exc)
            self._trend_encoder = None

    def set_trend_keywords(self, keywords: List[str]) -> None:
        """Set current trend keywords for alignment scoring."""
        self._trend_keywords = keywords

    def analyze(
        self,
        caption: str,
        category: str = "general",
        trend_keywords: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Full caption analysis returning feature dict."""
        if trend_keywords:
            self._trend_keywords = trend_keywords

        # Base text features
        features = self._text_processor.compute_caption_features(caption)

        # Trend alignment
        alignment = self._compute_trend_alignment(caption)
        features["trend_alignment"] = alignment

        # Category checks
        checks = self._category_checks(caption, features, category)
        features["category_checks"] = checks

        # Overall caption score (0-100)
        features["caption_score"] = self._compute_overall_score(features, category)

        # Improvement suggestions
        features["suggestions"] = self._generate_suggestions(features, category)

        return features

    def _compute_trend_alignment(self, caption: str) -> Dict[str, Any]:
        """Compute trend-caption alignment score using encoder or keyword matching."""
        if self._trend_encoder is not None and self._trend_keywords:
            try:
                # Use TrendAlignmentEncoder for semantic alignment
                scores = []
                for kw in self._trend_keywords[:5]:
                    score = self._trend_encoder.alignment_score(caption, kw)
                    scores.append(score)
                avg_score = sum(scores) / len(scores) if scores else 0.0
                best_kw = self._trend_keywords[scores.index(max(scores))] if scores else ""
                return {
                    "score": round(avg_score, 3),
                    "method": "encoder",
                    "best_trend_keyword": best_kw,
                    "all_scores": {kw: round(s, 3) for kw, s in zip(self._trend_keywords[:5], scores)},
                }
            except Exception as exc:
                logger.debug("TrendAlignmentEncoder scoring failed: %s", exc)

        # Fallback: keyword matching
        if not self._trend_keywords:
            return {"score": 0.0, "method": "none", "best_trend_keyword": "", "all_scores": {}}

        lower_caption = caption.lower()
        matches = []
        for kw in self._trend_keywords:
            kw_lower = kw.lower().strip()
            if kw_lower in lower_caption:
                matches.append(kw)
            # Also check partial match (each word)
            elif any(w in lower_caption for w in kw_lower.split() if len(w) > 3):
                matches.append(kw)

        score = min(len(matches) / max(len(self._trend_keywords), 1), 1.0)
        return {
            "score": round(score, 3),
            "method": "keyword_matching",
            "best_trend_keyword": matches[0] if matches else "",
            "all_scores": {kw: (1.0 if kw in matches else 0.0) for kw in self._trend_keywords[:5]},
            "matched_keywords": matches,
        }

    def _category_checks(
        self,
        caption: str,
        features: Dict[str, Any],
        category: str,
    ) -> Dict[str, Any]:
        """Run category-specific validation checks."""
        rules = CATEGORY_RULES.get(category, CATEGORY_RULES["general"])
        checks: Dict[str, Any] = {}

        # Hashtag count check
        ht_count = features.get("hashtag_count", 0)
        checks["hashtag_count_ok"] = ht_count >= rules["min_hashtags"]
        checks["hashtag_count_ideal"] = ht_count >= rules["ideal_hashtags"]
        checks["hashtag_gap"] = max(0, rules["ideal_hashtags"] - ht_count)

        # Caption length check
        word_count = features.get("word_count", 0)
        min_len, max_len = rules["ideal_caption_length"]
        checks["caption_length_ok"] = min_len <= word_count <= max_len
        checks["caption_too_short"] = word_count < min_len
        checks["caption_too_long"] = word_count > max_len

        # Required keywords
        lower_caption = caption.lower()
        missing_keywords = [
            kw for kw in rules["required_keywords"]
            if kw.lower() not in lower_caption
        ]
        checks["missing_required_keywords"] = missing_keywords
        checks["has_required_keywords"] = len(missing_keywords) == 0

        # Price check
        checks["has_price"] = features.get("has_price", False)
        checks["price_required"] = rules["price_required"]
        checks["price_check_pass"] = (not rules["price_required"]) or checks["has_price"]

        # CTA check
        cta = features.get("cta", {})
        checks["has_cta"] = cta.get("has_cta", False)
        checks["cta_required"] = rules["cta_required"]
        checks["cta_check_pass"] = (not rules["cta_required"]) or checks["has_cta"]

        # Emoji check
        emoji_count = features.get("emoji_count", 0)
        checks["emoji_count"] = emoji_count
        checks["emoji_ok"] = emoji_count >= 1

        # Sentiment check
        sentiment = features.get("sentiment", {})
        polarity = sentiment.get("polarity", 0)
        checks["sentiment_positive"] = polarity > 0.1
        checks["sentiment_neutral"] = -0.1 <= polarity <= 0.1
        checks["sentiment_negative"] = polarity < -0.1

        return checks

    def _compute_overall_score(self, features: Dict[str, Any], category: str) -> float:
        """Compute overall caption score (0-100)."""
        checks = features.get("category_checks", {})

        # Weighted scoring
        score = 50.0  # Base score

        # Hashtag bonus/penalty
        ht_count = features.get("hashtag_count", 0)
        if checks.get("hashtag_count_ideal"):
            score += 15
        elif checks.get("hashtag_count_ok"):
            score += 8
        else:
            score -= 10

        # Caption length
        if checks.get("caption_length_ok"):
            score += 10
        elif checks.get("caption_too_short"):
            score -= 8
        else:
            score -= 3

        # Price
        if checks.get("price_check_pass"):
            score += 8
        else:
            score -= 5

        # CTA
        if checks.get("cta_check_pass"):
            score += 10
        else:
            score -= 8

        # Trend alignment
        alignment_score = features.get("trend_alignment", {}).get("score", 0)
        score += alignment_score * 15

        # Sentiment
        if checks.get("sentiment_positive"):
            score += 5
        elif checks.get("sentiment_negative"):
            score -= 5

        # Required keywords
        if checks.get("has_required_keywords"):
            score += 5
        else:
            missing = checks.get("missing_required_keywords", [])
            score -= len(missing) * 3

        # Emoji
        if checks.get("emoji_ok"):
            score += 3

        return round(max(0.0, min(100.0, score)), 1)

    def _generate_suggestions(self, features: Dict[str, Any], category: str) -> List[str]:
        """Generate actionable improvement suggestions."""
        suggestions: List[str] = []
        checks = features.get("category_checks", {})

        if not checks.get("hashtag_count_ok"):
            gap = checks.get("hashtag_gap", 0)
            if gap > 0:
                suggestions.append(f"Add {gap} more hashtags for better reach")

        if checks.get("caption_too_short"):
            suggestions.append("Caption is too short — add more descriptive text about your product")
        elif checks.get("caption_too_long"):
            suggestions.append("Caption is very long — consider being more concise")

        if not checks.get("price_check_pass"):
            suggestions.append("Add a price (e.g., 'UGX 50,000') — posts with prices get more engagement")

        if not checks.get("cta_check_pass"):
            suggestions.append("Add a call-to-action like 'DM to order' or 'Link in bio'")

        if not checks.get("has_required_keywords"):
            missing = checks.get("missing_required_keywords", [])
            if missing:
                suggestions.append(f"Include these keywords: {', '.join(missing)}")

        alignment = features.get("trend_alignment", {})
        if alignment.get("score", 0) < 0.2 and self._trend_keywords:
            top_kw = self._trend_keywords[:3]
            suggestions.append(f"Incorporate trending topics like: {', '.join(top_kw)}")

        if not checks.get("emoji_ok"):
            suggestions.append("Add relevant emojis to make the caption more visually appealing")

        if checks.get("sentiment_negative"):
            suggestions.append("Caption has negative sentiment — try a more positive tone")

        return suggestions
