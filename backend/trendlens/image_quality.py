"""
trendlens/image_quality.py
Image quality analysis using Pillow — no external APIs.
"""

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class ImageQualityAnalyzer:
    """Analyzes uploaded images for quality metrics using Pillow."""

    def analyze(self, image_path: str) -> Dict[str, Any]:
        """Analyze an image for quality metrics.

        Args:
            image_path: Path to the image file (local path or URL).

        Returns:
            Dict with brightness, contrast, saturation, sharpness, quality score.
        """
        result: Dict[str, Any] = {
            "analyzed": False,
            "brightness": 0.0,
            "contrast": 0.0,
            "saturation": 0.0,
            "sharpness": 0.0,
            "width": 0,
            "height": 0,
            "aspect_ratio": 0.0,
            "format": "",
            "size_kb": 0,
            "quality_score": 0.0,
            "quality_label": "unknown",
            "issues": [],
        }

        if not image_path or not image_path.strip():
            return result

        try:
            from PIL import Image
            import numpy as np
        except ImportError:
            logger.warning("PIL/numpy not available for image analysis")
            return result

        try:
            # Load image
            if image_path.startswith(("http://", "https://")):
                import requests
                from io import BytesIO
                resp = requests.get(image_path, timeout=10)
                img = Image.open(BytesIO(resp.content))
            else:
                img = Image.open(image_path)

            result["width"] = img.width
            result["height"] = img.height
            result["aspect_ratio"] = round(img.width / img.height, 2) if img.height else 0
            result["format"] = img.format or "unknown"

            import os
            if not image_path.startswith(("http://", "https://")) and os.path.exists(image_path):
                result["size_kb"] = round(os.path.getsize(image_path) / 1024, 1)

            img_rgb = img.convert("RGB")
            arr = np.array(img_rgb, dtype=np.float32) / 255.0

            # Brightness
            luminance = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
            brightness = float(np.mean(luminance))
            result["brightness"] = round(brightness, 4)

            # Contrast
            contrast = float(np.std(luminance))
            result["contrast"] = round(contrast, 4)

            # Saturation
            img_hsv = img.convert("HSV")
            hsv_arr = np.array(img_hsv, dtype=np.float32)
            if hsv_arr.shape[2] >= 2:
                saturation = float(np.mean(hsv_arr[:, :, 1])) / 255.0
            else:
                saturation = 0.0
            result["saturation"] = round(saturation, 4)

            # Sharpness
            try:
                from PIL import ImageFilter
                img_gray = img.convert("L")
                img_blurred = img_gray.filter(ImageFilter.BLUR)
                gray_arr = np.array(img_gray, dtype=np.float32)
                blurred_arr = np.array(img_blurred, dtype=np.float32)
                detail = np.abs(gray_arr - blurred_arr)
                sharpness = min(1.0, float(np.mean(detail)) / 50.0)
            except Exception:
                sharpness = 0.5
            result["sharpness"] = round(sharpness, 4)

            # Overall quality score
            quality = 50.0
            if 0.3 <= brightness <= 0.7: quality += 15
            elif 0.2 <= brightness <= 0.8: quality += 8
            elif brightness < 0.15: quality -= 10

            if contrast > 0.3: quality += 15
            elif contrast > 0.2: quality += 10
            elif contrast > 0.1: quality += 5
            else: quality -= 5

            if saturation > 0.3: quality += 12
            elif saturation > 0.15: quality += 7
            else: quality -= 3

            if sharpness > 0.5: quality += 8
            elif sharpness > 0.3: quality += 4
            else: quality -= 5

            if img.width >= 1080 and img.height >= 1080: quality += 5
            elif img.width >= 600 and img.height >= 600: quality += 2
            else:
                quality -= 5
                result["issues"].append("Image resolution is low — use at least 1080x1080 for social media")

            quality = max(0, min(100, quality))
            result["quality_score"] = round(quality, 1)
            result["quality_label"] = self._quality_label(quality)
            result["analyzed"] = True

            if brightness < 0.2:
                result["issues"].append("Image is too dark — increase brightness for better visibility")
            elif brightness > 0.85:
                result["issues"].append("Image is very bright — reduce brightness slightly")

            if contrast < 0.15:
                result["issues"].append("Low contrast — use bolder colors for better visibility")

            if saturation < 0.1:
                result["issues"].append("Colors appear muted — increase saturation")

            if sharpness < 0.2:
                result["issues"].append("Image appears blurry — use a higher resolution source")

        except Exception as exc:
            logger.warning("Image quality analysis failed: %s", exc)
            result["issues"].append(f"Could not analyze image: {str(exc)[:100]}")

        return result

    def _quality_label(self, score: float) -> str:
        if score >= 80: return "excellent"
        elif score >= 65: return "good"
        elif score >= 50: return "fair"
        elif score >= 35: return "poor"
        return "very_poor"
