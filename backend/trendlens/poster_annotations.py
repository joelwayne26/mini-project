"""
trendlens/poster_annotations.py
Poster annotation generation module for TrendLens AI.

Generates numbered, positioned annotations that highlight issues and good
elements on a social-media poster image.  Each annotation carries a
severity level (``critical`` > ``warning`` > ``info``) and is placed at
a logical region of the poster so a front-end overlay can render it.

Uses OCR results and caption feature dicts already produced by the
evaluation pipeline — no LLM APIs are involved.
"""

import logging
from typing import Any, Dict, List

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore[assignment]

try:
    from trendlens.models import PosterAnnotation
except ImportError:
    # Fallback so the module can still be imported for testing
    PosterAnnotation = None  # type: ignore[assignment,misc]

try:
    from trendlens.config import settings
except ImportError:
    settings = None  # type: ignore[assignment]

try:
    from trendlens.monitoring import structured_log
except ImportError:
    structured_log = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


# ─── Layout Constants (0-1 normalised) ───────────────────────────────────────

POSITION_PRICE = (0.5, 0.7)       # Where a price typically appears
POSITION_CTA = (0.5, 0.85)        # Bottom area — CTA zone
POSITION_HASHTAG = (0.9, 0.95)    # Very bottom-right — hashtag area
POSITION_HEADLINE = (0.5, 0.15)   # Top centre — headline zone
POSITION_BODY = (0.5, 0.45)       # Middle — body text zone

MAX_ANNOTATIONS = 8

# Severity ordering for priority sorting (lower = higher priority)
_SEVERITY_ORDER = {"critical": 0, "warning": 1, "info": 2}


class PosterAnnotator:
    """Generate positioned annotations for a social-media poster.

    Inspects OCR results and caption features to identify both problems
    (missing price, no CTA, low hashtags, …) and positive elements.
    Annotations are sorted by severity so that critical issues appear
    first, and the list is capped at :data:`MAX_ANNOTATIONS` entries.
    """

    def __init__(self) -> None:
        # Category-specific ideal values (mirrors phase5_caption_intelligence)
        self._category_ideals: Dict[str, Dict[str, Any]] = {
            "cake": {"ideal_hashtags": 8, "min_hashtags": 5},
            "bakery": {"ideal_hashtags": 7, "min_hashtags": 4},
            "restaurant": {"ideal_hashtags": 8, "min_hashtags": 5},
            "general": {"ideal_hashtags": 6, "min_hashtags": 3},
        }

    # ── Public API ────────────────────────────────────────────────────

    def annotate(
        self,
        ocr_results: List[dict],
        caption_features: dict,
        score: float,
    ) -> List["PosterAnnotation"]:
        """Generate annotations for a poster.

        Args:
            ocr_results: List of OCR text-block dicts (each with keys
                ``text``, ``confidence``, ``x_min``, ``y_min``, …).
                May be empty if OCR did not detect text.
            caption_features: Feature dict from
                :class:`~trendlens.text_processor.TextProcessor` and
                :class:`~trendlens.phase5_caption_intelligence.CaptionIntelligence`.
            score: Overall poster score (0-100).

        Returns:
            List of :class:`~trendlens.models.PosterAnnotation` instances,
            sorted by severity (critical first) and limited to 8 entries.
        """
        if structured_log is not None:
            structured_log.info("Generating poster annotations", score=score)
        else:
            logger.info("Generating poster annotations (score=%.1f)", score)

        if PosterAnnotation is None:
            logger.error("PosterAnnotation model unavailable — returning empty list")
            return []

        annotations: List[PosterAnnotation] = []
        number = 1

        # ── 1. Missing price ──────────────────────────────────────────
        has_price_caption = bool(caption_features.get("has_price", False))
        has_price_ocr = self._ocr_has_price(ocr_results)
        if not has_price_caption and not has_price_ocr:
            category = caption_features.get("category_checks", {}).get("price_required", False)
            severity = "critical" if category else "warning"
            annotations.append(PosterAnnotation(
                number=number,
                x=POSITION_PRICE[0],
                y=POSITION_PRICE[1],
                title="Missing Price",
                detail="Add a clear price (e.g., 'UGX 50,000') — posts with prices get significantly more engagement",
                severity=severity,
            ))
            number += 1

        # ── 2. Missing CTA ────────────────────────────────────────────
        has_cta = bool(caption_features.get("cta", {}).get("has_cta", False))
        has_cta_ocr = self._ocr_has_cta(ocr_results)
        if not has_cta and not has_cta_ocr:
            annotations.append(PosterAnnotation(
                number=number,
                x=POSITION_CTA[0],
                y=POSITION_CTA[1],
                title="No Call-to-Action",
                detail="Add a CTA like 'DM to order', 'Link in bio', or 'WhatsApp us' to drive conversions",
                severity="warning",
            ))
            number += 1

        # ── 3. Low hashtag count ──────────────────────────────────────
        ht_count = int(caption_features.get("hashtag_count", 0))
        category = self._detect_category(caption_features)
        ideals = self._category_ideals.get(category, self._category_ideals["general"])
        if ht_count < ideals["min_hashtags"]:
            gap = ideals["ideal_hashtags"] - ht_count
            annotations.append(PosterAnnotation(
                number=number,
                x=POSITION_HASHTAG[0],
                y=POSITION_HASHTAG[1],
                title="Low Hashtag Count",
                detail=f"Only {ht_count} hashtags found — add {gap}+ more for better reach (aim for {ideals['ideal_hashtags']})",
                severity="warning" if ht_count < ideals["min_hashtags"] // 2 else "info",
            ))
            number += 1

        # ── 4. Text too small / dim (low OCR confidence) ──────────────
        low_conf_blocks = self._find_low_confidence_blocks(ocr_results)
        if low_conf_blocks:
            avg_conf = sum(b.get("confidence", 0) for b in low_conf_blocks) / len(low_conf_blocks)
            # Use the position of the worst block, normalised to 0-1
            worst = min(low_conf_blocks, key=lambda b: b.get("confidence", 1))
            pos = self._normalised_block_position(worst, ocr_results, POSITION_HEADLINE)
            annotations.append(PosterAnnotation(
                number=number,
                x=pos[0],
                y=pos[1],
                title="Text May Be Too Small or Dim",
                detail=f"{len(low_conf_blocks)} text block(s) have low OCR confidence (avg {avg_conf:.0%}) — consider larger or higher-contrast text",
                severity="info",
            ))
            number += 1

        # ── 5. Text overflow / too much text ──────────────────────────
        block_count = len(ocr_results)
        if block_count > 15:
            annotations.append(PosterAnnotation(
                number=number,
                x=POSITION_BODY[0],
                y=POSITION_BODY[1],
                title="Too Much Text",
                detail=f"{block_count} text blocks detected — a clean poster with less text and strong visuals performs better",
                severity="warning",
            ))
            number += 1
        elif block_count > 10:
            annotations.append(PosterAnnotation(
                number=number,
                x=POSITION_BODY[0],
                y=POSITION_BODY[1],
                title="Dense Text",
                detail=f"{block_count} text blocks — consider simplifying the layout for better readability",
                severity="info",
            ))
            number += 1

        # ── 6. Positive annotations (good elements) ───────────────────
        # Only add if we have room and there are genuinely good things
        good_annotations = self._find_good_elements(
            ocr_results, caption_features, score, number
        )
        annotations.extend(good_annotations)
        number += len(good_annotations)

        # ── 7. Caption improvement suggestions ────────────────────────
        suggestions = caption_features.get("suggestions", [])
        if suggestions and number <= MAX_ANNOTATIONS:
            top_suggestion = suggestions[0] if suggestions else ""
            if top_suggestion:
                annotations.append(PosterAnnotation(
                    number=number,
                    x=POSITION_HEADLINE[0],
                    y=POSITION_HEADLINE[1] + 0.10,
                    title="Caption Improvement",
                    detail=top_suggestion,
                    severity="info",
                ))
                number += 1

        # ── Sort by severity and cap ──────────────────────────────────
        annotations.sort(key=lambda a: _SEVERITY_ORDER.get(a.severity, 2))

        # Re-number after sorting
        capped = annotations[:MAX_ANNOTATIONS]
        for idx, ann in enumerate(capped, start=1):
            ann.number = idx

        if structured_log is not None:
            structured_log.debug(
                "Generated annotations",
                count=len(capped),
                severities=[a.severity for a in capped],
            )

        return capped

    # ── Private Helpers ───────────────────────────────────────────────

    @staticmethod
    def _ocr_has_price(ocr_results: List[dict]) -> bool:
        """Check whether any OCR-detected text block contains a price."""
        import re
        price_patterns = [
            r"(?:UGX|ush|USh|ugx)\s?[\d,]+",
            r"[\d,]+\s?(?:UGX|ush|USh|ugx)",
            r"/=",
        ]
        for block in ocr_results:
            text = block.get("text", "")
            for pat in price_patterns:
                if re.search(pat, text, re.IGNORECASE):
                    return True
        return False

    @staticmethod
    def _ocr_has_cta(ocr_results: List[dict]) -> bool:
        """Check whether any OCR-detected text block contains a CTA."""
        cta_keywords = [
            "order", "dm", "call", "book", "buy", "shop", "visit",
            "whatsapp", "contact", "deliver", "link in bio",
        ]
        for block in ocr_results:
            text = block.get("text", "").lower()
            if any(kw in text for kw in cta_keywords):
                return True
        return False

    @staticmethod
    def _find_low_confidence_blocks(
        ocr_results: List[dict],
        threshold: float = 0.5,
    ) -> List[dict]:
        """Return OCR blocks with confidence below *threshold*."""
        return [
            b for b in ocr_results
            if b.get("confidence", 1.0) < threshold
        ]

    @staticmethod
    def _normalised_block_position(
        block: dict,
        all_blocks: List[dict],
        fallback: tuple = (0.5, 0.5),
    ) -> tuple:
        """Normalise a block's position to 0-1 coordinates.

        Uses the max bounding-box extents across *all_blocks* as the
        denominator so that coordinates are normalised even when the
        image dimensions are unknown.

        Falls back to *fallback* if the block lacks bounding-box data.
        """
        x_min = block.get("x_min")
        x_max = block.get("x_max")
        y_min = block.get("y_min")
        y_max = block.get("y_max")

        if x_min is not None and x_max is not None and y_min is not None and y_max is not None:
            # Derive normalisation bounds from all blocks
            all_x_max = max((b.get("x_max", 0) for b in all_blocks), default=1)
            all_y_max = max((b.get("y_max", 0) for b in all_blocks), default=1)
            if all_x_max > 0 and all_y_max > 0:
                cx = ((x_min + x_max) / 2.0) / all_x_max
                cy = ((y_min + y_max) / 2.0) / all_y_max
                # Clamp to 0-1
                return (max(0.0, min(1.0, cx)), max(0.0, min(1.0, cy)))

        return fallback

    def _detect_category(self, caption_features: dict) -> str:
        """Best-effort category detection from caption feature dict."""
        checks = caption_features.get("category_checks", {})
        # category_checks may have been set by CaptionIntelligence
        # but doesn't directly store the category name.  We infer it.
        if checks.get("price_required") and checks.get("cta_required"):
            if checks.get("has_price") is not None:
                return "cake"  # most strict category
        if checks.get("cta_required") and not checks.get("price_required"):
            return "restaurant"
        return "general"

    def _find_good_elements(
        self,
        ocr_results: List[dict],
        caption_features: dict,
        score: float,
        start_number: int,
    ) -> List["PosterAnnotation"]:
        """Identify positive elements and return info-level annotations."""
        good: List[PosterAnnotation] = []
        number = start_number

        # High overall score
        if score >= 75:
            good.append(PosterAnnotation(
                number=number,
                x=0.5, y=0.05,
                title="Great Overall Score",
                detail=f"Score of {score:.0f}/100 — this poster is performing well above average",
                severity="info",
            ))
            number += 1

        # Strong hashtag usage
        ht_count = int(caption_features.get("hashtag_count", 0))
        if ht_count >= 8:
            good.append(PosterAnnotation(
                number=number,
                x=POSITION_HASHTAG[0],
                y=POSITION_HASHTAG[1] - 0.03,
                title="Strong Hashtag Usage",
                detail=f"{ht_count} hashtags — great for discoverability",
                severity="info",
            ))
            number += 1

        # Good emoji usage
        emoji_count = int(caption_features.get("emoji_count", 0))
        if emoji_count >= 3:
            good.append(PosterAnnotation(
                number=number,
                x=0.15, y=0.95,
                title="Good Emoji Usage",
                detail=f"{emoji_count} emojis — makes the caption visually appealing",
                severity="info",
            ))
            number += 1

        # Positive sentiment
        sentiment = caption_features.get("sentiment", {})
        if sentiment.get("polarity", 0) > 0.3:
            good.append(PosterAnnotation(
                number=number,
                x=0.5, y=0.50,
                title="Positive Tone",
                detail="Caption has a positive, engaging tone — keep it up!",
                severity="info",
            ))
            number += 1

        return good
