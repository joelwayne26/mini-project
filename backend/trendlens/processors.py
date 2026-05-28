"""
trendlens/processors.py
ImageProcessor class — validate, cache from URL, resize.
"""

import hashlib
import logging
import os
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import urlparse

import requests

from trendlens.config import settings

logger = logging.getLogger(__name__)


class ImageProcessor:
    """Handles image validation, caching from URLs, and resizing."""

    SUPPORTED_FORMATS = {"jpg", "jpeg", "png", "webp", "bmp", "gif"}
    MAX_DIMENSION = 4096

    def __init__(self) -> None:
        self._cache_dir = settings.IMAGE_CACHE_DIR
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    # ── Validation ───────────────────────────────────────────────────

    def validate(self, image_path: str) -> Tuple[bool, str]:
        """Validate an image file. Returns (is_valid, error_message)."""
        if not os.path.exists(image_path):
            return False, f"File not found: {image_path}"

        # Check extension
        ext = os.path.splitext(image_path)[1].lower().lstrip(".")
        if ext not in self.SUPPORTED_FORMATS:
            return False, f"Unsupported format: {ext}. Supported: {self.SUPPORTED_FORMATS}"

        # Check file size
        file_size_mb = os.path.getsize(image_path) / (1024 * 1024)
        if file_size_mb > settings.MAX_IMAGE_SIZE_MB:
            return False, f"File too large: {file_size_mb:.1f}MB (max {settings.MAX_IMAGE_SIZE_MB}MB)"

        if file_size_mb == 0:
            return False, "File is empty"

        # Try to open with PIL to verify it's a real image
        try:
            from PIL import Image
            with Image.open(image_path) as img:
                img.verify()
            # Re-open for dimension check (verify() can close the file)
            with Image.open(image_path) as img:
                w, h = img.size
                if w > self.MAX_DIMENSION or h > self.MAX_DIMENSION:
                    return False, f"Image dimensions too large: {w}x{h}"
            return True, ""
        except ImportError:
            # If PIL not available, just check file size and extension
            logger.warning("PIL not available — skipping image content validation")
            return True, ""
        except Exception as exc:
            return False, f"Invalid image file: {exc}"

    # ── Cache from URL ───────────────────────────────────────────────

    def cache_from_url(self, url: str, timeout: int = 30) -> Optional[str]:
        """Download an image from URL and cache it locally.

        Returns the local file path or None on failure.
        """
        # Generate cache key from URL
        url_hash = hashlib.sha256(url.encode()).hexdigest()[:16]
        parsed = urlparse(url)
        ext = os.path.splitext(parsed.path)[1].lower()
        if ext not in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}:
            ext = ".jpg"  # Default extension

        cache_path = self._cache_dir / f"{url_hash}{ext}"

        # Return cached file if it exists
        if cache_path.exists() and os.path.getsize(cache_path) > 0:
            logger.debug("Cache hit for %s → %s", url, cache_path)
            return str(cache_path)

        # Download
        try:
            resp = requests.get(url, timeout=timeout, stream=True)
            resp.raise_for_status()

            content_type = resp.headers.get("content-type", "")
            if "image" not in content_type and not ext:
                logger.warning("URL does not appear to be an image: %s", content_type)

            # Write to temp file first, then move
            tmp_path = str(cache_path) + ".tmp"
            with open(tmp_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)

            # Validate downloaded file
            is_valid, err = self.validate(tmp_path)
            if not is_valid:
                logger.warning("Downloaded image invalid: %s", err)
                os.unlink(tmp_path)
                return None

            os.rename(tmp_path, str(cache_path))
            logger.info("Cached image from %s → %s", url, cache_path)
            return str(cache_path)

        except requests.RequestException as exc:
            logger.error("Failed to download image from %s: %s", url, exc)
            return None
        except Exception as exc:
            logger.error("Image caching failed for %s: %s", url, exc)
            # Clean up temp file if it exists
            tmp_path = str(cache_path) + ".tmp"
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            return None

    # ── Resize ───────────────────────────────────────────────────────

    def resize(
        self,
        image_path: str,
        max_width: int = 1024,
        max_height: int = 1024,
        output_path: Optional[str] = None,
    ) -> Optional[str]:
        """Resize image to fit within max dimensions while preserving aspect ratio.

        Returns the output file path or None on failure.
        """
        try:
            from PIL import Image

            with Image.open(image_path) as img:
                w, h = img.size
                if w <= max_width and h <= max_height:
                    # No resize needed
                    if output_path:
                        img.save(output_path)
                        return output_path
                    return image_path

                # Compute new dimensions
                ratio = min(max_width / w, max_height / h)
                new_w = int(w * ratio)
                new_h = int(h * ratio)

                resized = img.resize((new_w, new_h), Image.LANCZOS)

                if output_path is None:
                    # Save to temp file
                    ext = os.path.splitext(image_path)[1].lower() or ".jpg"
                    fd, output_path = tempfile.mkstemp(suffix=ext)
                    os.close(fd)

                resized.save(output_path, quality=90)
                logger.info("Resized %s from %dx%d to %dx%d", image_path, w, h, new_w, new_h)
                return output_path

        except ImportError:
            logger.error("PIL not installed — cannot resize image")
            return None
        except Exception as exc:
            logger.error("Image resize failed for %s: %s", image_path, exc)
            return None

    # ── Utility ──────────────────────────────────────────────────────

    def get_image_dimensions(self, image_path: str) -> Tuple[int, int]:
        """Return (width, height) of an image."""
        try:
            from PIL import Image
            with Image.open(image_path) as img:
                return img.size
        except Exception:
            return (0, 0)

    def clear_cache(self, max_age_days: int = 30) -> int:
        """Remove cached images older than max_age_days. Returns count removed."""
        import time
        cutoff = time.time() - (max_age_days * 86400)
        removed = 0
        for f in self._cache_dir.iterdir():
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink()
                removed += 1
        logger.info("Cleared %d cached images older than %d days", removed, max_age_days)
        return removed
