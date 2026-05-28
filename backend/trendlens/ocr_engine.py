"""
trendlens/ocr_engine.py
PosterOCR class — EasyOCR-based text extraction with bounding boxes and poster analysis.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

_ocr_reader = None


def _get_easyocr_reader(languages: Optional[List[str]] = None):
    """Lazy-load EasyOCR reader singleton."""
    global _ocr_reader
    if _ocr_reader is not None:
        return _ocr_reader
    try:
        import easyocr
        langs = languages or ["en"]
        _ocr_reader = easyocr.Reader(langs, gpu=False)
        logger.info("EasyOCR reader initialised for languages: %s", langs)
        return _ocr_reader
    except ImportError:
        logger.warning("easyocr not installed — OCR features unavailable")
        return None
    except Exception as exc:
        logger.error("EasyOCR init failed: %s", exc)
        return None


class PosterOCR:
    """Complete poster OCR with text extraction, feature analysis, and annotation support."""

    CTA_KEYWORDS = [
        "order", "dm", "call", "book", "buy", "shop", "visit", "subscribe",
        "follow", "link", "click", "grab", "whatsapp", "contact", "deliver",
        "free delivery", "tap", "check out", "limited offer", "get yours",
    ]

    PRICE_PATTERNS = [
        r"(?:UGX|ush|USh|ugx)\s?[\d,]+(?:\.\d{2})?",
        r"[\d,]+(?:\.\d{2})?\s?(?:UGX|ush|USh|ugx)",
        r"/=",
        r"k\b",
    ]

    def __init__(self, languages: Optional[List[str]] = None) -> None:
        self._languages = languages or ["en"]
        self._reader = None

    def _ensure_reader(self):
        if self._reader is None:
            self._reader = _get_easyocr_reader(self._languages)
        return self._reader

    # ── Image Preprocessing ──────────────────────────────────────────

    @staticmethod
    def preprocess_image(image: np.ndarray) -> np.ndarray:
        """Preprocess image for better OCR results."""
        try:
            import cv2
            # Convert to grayscale if needed
            if len(image.shape) == 3:
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image.copy()

            # Apply adaptive thresholding
            gray = cv2.medianBlur(gray, 3)
            thresh = cv2.adaptiveThreshold(
                gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY, 11, 2,
            )

            # Denoise
            denoised = cv2.fastNlMeansDenoising(thresh, None, 10, 7, 21)
            return denoised
        except ImportError:
            logger.warning("cv2 not installed — returning image without preprocessing")
            return image
        except Exception as exc:
            logger.warning("Image preprocessing failed: %s", exc)
            return image

    # ── Core OCR ─────────────────────────────────────────────────────

    def extract_text(
        self,
        image_path: str,
        detail: int = 1,
    ) -> List[Dict[str, Any]]:
        """Run OCR on an image and return structured results.

        Returns list of dicts with keys: text, bbox, confidence.
        """
        reader = self._ensure_reader()
        if reader is None:
            logger.error("EasyOCR reader unavailable")
            return []

        try:
            results = reader.readtext(image_path, detail=detail)
            extracted: List[Dict[str, Any]] = []
            for item in results:
                if detail == 1:
                    bbox, text, conf = item
                    # bbox is [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
                    xs = [p[0] for p in bbox]
                    ys = [p[1] for p in bbox]
                    extracted.append({
                        "text": text,
                        "bbox": bbox,
                        "confidence": float(conf),
                        "x_min": min(xs),
                        "x_max": max(xs),
                        "y_min": min(ys),
                        "y_max": max(ys),
                    })
                else:
                    extracted.append({
                        "text": item,
                        "bbox": [],
                        "confidence": 1.0,
                        "x_min": 0,
                        "x_max": 0,
                        "y_min": 0,
                        "y_max": 0,
                    })
            return extracted
        except Exception as exc:
            logger.error("OCR extraction failed for %s: %s", image_path, exc)
            return []

    # ── Feature Extraction ───────────────────────────────────────────

    def extract_features(
        self,
        image_path: str,
        image_width: int = 0,
        image_height: int = 0,
    ) -> Dict[str, Any]:
        """Extract full OCR features from a poster image."""
        ocr_results = self.extract_text(image_path, detail=1)

        if not ocr_results:
            return {
                "raw_text": "",
                "text_blocks": [],
                "full_text": "",
                "has_price": False,
                "has_cta": False,
                "text_box_ratio": 0.0,
                "safe_zone_coverage": 0.0,
                "dominant_text_color": "unknown",
                "block_count": 0,
                "avg_confidence": 0.0,
                "price_texts": [],
                "cta_texts": [],
            }

        full_text = " ".join(r["text"] for r in ocr_results)

        # Detect prices and CTAs
        import re
        price_texts = []
        for r in ocr_results:
            t = r["text"]
            for pat in self.PRICE_PATTERNS:
                if re.search(pat, t, re.IGNORECASE):
                    price_texts.append(t)
                    break

        cta_texts = []
        lower_full = full_text.lower()
        for keyword in self.CTA_KEYWORDS:
            if keyword in lower_full:
                # Find the block containing this CTA
                for r in ocr_results:
                    if keyword in r["text"].lower():
                        cta_texts.append(r["text"])
                        break

        # Compute text box ratio
        tbr = self.text_box_ratio(ocr_results, image_width, image_height)

        # Compute safe zone coverage
        szc = self.safe_zone_coverage(ocr_results, image_width, image_height)

        # Estimate dominant text color
        dominant_color = self._estimate_text_color(ocr_results)

        avg_conf = sum(r["confidence"] for r in ocr_results) / len(ocr_results) if ocr_results else 0.0

        return {
            "raw_text": full_text,
            "text_blocks": ocr_results,
            "full_text": full_text,
            "has_price": len(price_texts) > 0,
            "has_cta": len(cta_texts) > 0,
            "text_box_ratio": tbr,
            "safe_zone_coverage": szc,
            "dominant_text_color": dominant_color,
            "block_count": len(ocr_results),
            "avg_confidence": round(avg_conf, 3),
            "price_texts": price_texts,
            "cta_texts": cta_texts,
        }

    # ── Metrics ──────────────────────────────────────────────────────

    @staticmethod
    def text_box_ratio(
        ocr_results: List[Dict[str, Any]],
        image_width: int = 0,
        image_height: int = 0,
    ) -> float:
        """Calculate the ratio of text bounding-box area to total image area."""
        if not ocr_results or image_width <= 0 or image_height <= 0:
            if ocr_results:
                # Estimate from bounding boxes if image dims unknown
                all_x_max = max(r.get("x_max", 0) for r in ocr_results)
                all_y_max = max(r.get("y_max", 0) for r in ocr_results)
                if all_x_max > 0 and all_y_max > 0:
                    image_width = all_x_max
                    image_height = all_y_max
                else:
                    return 0.0
            else:
                return 0.0

        total_text_area = 0.0
        for r in ocr_results:
            w = r.get("x_max", 0) - r.get("x_min", 0)
            h = r.get("y_max", 0) - r.get("y_min", 0)
            total_text_area += w * h

        image_area = image_width * image_height
        if image_area <= 0:
            return 0.0

        return min(total_text_area / image_area, 1.0)

    @staticmethod
    def safe_zone_coverage(
        ocr_results: List[Dict[str, Any]],
        image_width: int = 0,
        image_height: int = 0,
        margin_pct: float = 0.1,
    ) -> float:
        """Calculate how much of the safe (non-margin) zone is covered by text."""
        if not ocr_results or image_width <= 0 or image_height <= 0:
            return 0.0

        mx = image_width * margin_pct
        my = image_height * margin_pct
        safe_area = (image_width - 2 * mx) * (image_height - 2 * my)

        if safe_area <= 0:
            return 0.0

        text_in_safe = 0.0
        for r in ocr_results:
            bx1 = max(r.get("x_min", 0), mx)
            by1 = max(r.get("y_min", 0), my)
            bx2 = min(r.get("x_max", 0), image_width - mx)
            by2 = min(r.get("y_max", 0), image_height - my)
            if bx2 > bx1 and by2 > by1:
                text_in_safe += (bx2 - bx1) * (by2 - by1)

        return min(text_in_safe / safe_area, 1.0)

    @staticmethod
    def _estimate_text_color(ocr_results: List[Dict[str, Any]]) -> str:
        """Estimate dominant text color from confidence and position heuristics.

        Since EasyOCR doesn't return color info, we use position heuristics:
        - Text at top of image is likely headline (often dark/bold)
        - Text at bottom is often CTA (often colored)
        """
        if not ocr_results:
            return "unknown"

        # Sort by y_min — topmost block
        sorted_blocks = sorted(ocr_results, key=lambda r: r.get("y_min", 0))
        top_count = max(1, len(sorted_blocks) // 3)
        top_blocks = sorted_blocks[:top_count]

        avg_conf_top = sum(r["confidence"] for r in top_blocks) / len(top_blocks)

        if avg_conf_top > 0.85:
            return "dark"  # High confidence usually means strong contrast (dark on light)
        elif avg_conf_top > 0.6:
            return "medium"
        else:
            return "light"  # Low confidence may indicate light text or low contrast
