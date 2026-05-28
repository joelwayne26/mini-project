"""
trendlens/config.py
Enhanced Settings class with all configuration keys for TrendLens AI v5.
"""

import os
import logging
from pathlib import Path
from typing import List, Optional

# ── Load .env files BEFORE reading any env vars ──────────────────────────
# python-dotenv is in requirements.txt but was never called.
# We load from multiple locations so it works both locally and in Docker.
_BASE_DIR = Path(__file__).resolve().parent.parent

try:
    from dotenv import load_dotenv

    _PROJECT_ROOT = _BASE_DIR.parent

    # 1. .env in the backend directory (local dev — highest priority)
    _backend_env = _BASE_DIR / ".env"
    if _backend_env.exists():
        load_dotenv(_backend_env, override=True)
        logging.getLogger(__name__).info("Loaded backend/.env")

    # 2. .env.docker at project root (Docker / existing config)
    _docker_env = _PROJECT_ROOT / ".env.docker"
    if _docker_env.exists():
        load_dotenv(_docker_env, override=False)  # don't override already-set vars
        logging.getLogger(__name__).info("Loaded .env.docker from project root")

    # 3. Generic .env at project root
    _root_env = _PROJECT_ROOT / ".env"
    if _root_env.exists():
        load_dotenv(_root_env, override=False)
        logging.getLogger(__name__).info("Loaded .env from project root")

except ImportError:
    pass  # python-dotenv not installed; rely on system env vars only

logger = logging.getLogger(__name__)


class Settings:
    """Centralised configuration for TrendLens AI v5."""

    # ── General ──────────────────────────────────────────────────────
    APP_NAME: str = "TrendLens AI v5"
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    BASE_DIR: Path = _BASE_DIR

    # ── MongoDB ──────────────────────────────────────────────────────
    MONGO_URI: str = os.getenv("MONGO_URI", "")
    MONGO_DB_NAME: str = os.getenv("MONGO_DB_NAME", "trendlens")
    MONGO_MAX_POOL_SIZE: int = int(os.getenv("MONGO_MAX_POOL_SIZE", "10"))
    MONGO_MIN_POOL_SIZE: int = int(os.getenv("MONGO_MIN_POOL_SIZE", "2"))

    # ── Redis / Caching (optional) ───────────────────────────────────
    REDIS_URL: Optional[str] = os.getenv("REDIS_URL", None)

    # ── Apify ────────────────────────────────────────────────────────
    APIFY_API_TOKEN: Optional[str] = os.getenv("APIFY_API_TOKEN", None)

    # ── Google Trends / PyTrends ─────────────────────────────────────
    PYTRENDS_GEO: str = os.getenv("PYTRENDS_GEO", "UG")

    # ── Reddit ───────────────────────────────────────────────────────
    REDDIT_CLIENT_ID: Optional[str] = os.getenv("REDDIT_CLIENT_ID", None)
    REDDIT_CLIENT_SECRET: Optional[str] = os.getenv("REDDIT_CLIENT_SECRET", None)
    REDDIT_USER_AGENT: str = os.getenv(
        "REDDIT_USER_AGENT", "TrendLensAI/5.0 (by /u/trendlens_bot)"
    )

    # ── YouTube ──────────────────────────────────────────────────────
    YOUTUBE_API_KEY: Optional[str] = os.getenv("YOUTUBE_API_KEY", None)

    # ── NewsAPI ──────────────────────────────────────────────────────
    NEWSAPI_KEY: Optional[str] = os.getenv("NEWSAPI_KEY", None)

    # ── Instagram / Meta ─────────────────────────────────────────────
    INSTAGRAM_ACCESS_TOKEN: Optional[str] = os.getenv("INSTAGRAM_ACCESS_TOKEN", None)
    INSTAGRAM_BUSINESS_ID: Optional[str] = os.getenv("INSTAGRAM_BUSINESS_ID", None)
    META_APP_ID: Optional[str] = os.getenv("META_APP_ID", None)
    META_APP_SECRET: Optional[str] = os.getenv("META_APP_SECRET", None)

    # ── Twitter ──────────────────────────────────────────────────────
    TWITTER_BEARER_TOKEN: Optional[str] = os.getenv("TWITTER_BEARER_TOKEN", None)

    # ── CLIP / Vision ───────────────────────────────────────────────
    CLIP_MODEL_NAME: str = os.getenv("CLIP_MODEL_NAME", "ViT-B/32")
    CLIP_DEVICE: str = os.getenv("CLIP_DEVICE", "cpu")

    # ── EasyOCR ──────────────────────────────────────────────────────
    OCR_LANGUAGES: List[str] = os.getenv("OCR_LANGUAGES", "en").split(",")

    # ── Model / Training ────────────────────────────────────────────
    MODEL_DIR: Path = Path(os.getenv("MODEL_DIR", str(_BASE_DIR / "models")))
    XGBOOST_MAX_DEPTH: int = int(os.getenv("XGBOOST_MAX_DEPTH", "6"))
    XGBOOST_N_ESTIMATORS: int = int(os.getenv("XGBOOST_N_ESTIMATORS", "200"))
    XGBOOST_LEARNING_RATE: float = float(os.getenv("XGBOOST_LEARNING_RATE", "0.1"))
    RETRAIN_MIN_SAMPLES: int = int(os.getenv("RETRAIN_MIN_SAMPLES", "30"))
    RETRAIN_INTERVAL_HOURS: int = int(os.getenv("RETRAIN_INTERVAL_HOURS", "24"))

    # ── Transfer Learning ────────────────────────────────────────────
    SBERT_MODEL_NAME: str = os.getenv(
        "SBERT_MODEL_NAME", "paraphrase-MiniLM-L6-v2"
    )
    ADAPTER_DIM: int = int(os.getenv("ADAPTER_DIM", "64"))
    VISUAL_ADAPTER_DIM: int = int(os.getenv("VISUAL_ADAPTER_DIM", "32"))

    # ── Detection / Background ───────────────────────────────────────
    DETECTION_INTERVAL_MINUTES: int = int(
        os.getenv("DETECTION_INTERVAL_MINUTES", "30")
    )
    TRACK_CATEGORIES: List[str] = os.getenv(
        "TRACK_CATEGORIES", "cake,bakery,restaurant,general"
    ).split(",")

    # ── Caption Intelligence ─────────────────────────────────────────
    LLM_CAPTION_ENABLED: bool = (
        os.getenv("LLM_CAPTION_ENABLED", "false").lower() == "true"
    )

    # ── Sentry (optional) ───────────────────────────────────────────
    SENTRY_DSN: Optional[str] = os.getenv("SENTRY_DSN", None)

    # ── Prometheus ───────────────────────────────────────────────────
    PROMETHEUS_PORT: int = int(os.getenv("PROMETHEUS_PORT", "9090"))

    # ── Flask ────────────────────────────────────────────────────────
    FLASK_HOST: str = os.getenv("FLASK_HOST", "0.0.0.0")
    FLASK_PORT: int = int(os.getenv("FLASK_PORT", "5000"))
    FLASK_SECRET_KEY: str = os.getenv("FLASK_SECRET_KEY", "trendlens-v5-secret")

    # ── Image Processing ─────────────────────────────────────────────
    MAX_IMAGE_SIZE_MB: int = int(os.getenv("MAX_IMAGE_SIZE_MB", "10"))
    IMAGE_CACHE_DIR: Path = Path(
        os.getenv("IMAGE_CACHE_DIR", str(_BASE_DIR / "image_cache"))
    )

    def validate(self) -> List[str]:
        """Validate configuration and return list of warnings."""
        warnings: List[str] = []

        if not self.MONGO_URI:
            warnings.append("MONGO_URI is not set — MongoDB features will be unavailable")
        elif "localhost" in self.MONGO_URI or self.MONGO_URI.startswith("mongodb://mongo:"):
            warnings.append("MONGO_URI is pointing to localhost — ensure this is intentional")

        if self.DEBUG:
            warnings.append("DEBUG mode is enabled — not for production")

        if self.FLASK_SECRET_KEY == "trendlens-v5-secret":
            warnings.append("FLASK_SECRET_KEY is using default value — change in production")

        # Check at least one trend source has credentials
        source_keys = [
            self.APIFY_API_TOKEN,
            self.REDDIT_CLIENT_ID,
            self.YOUTUBE_API_KEY,
            self.INSTAGRAM_ACCESS_TOKEN,
            self.TWITTER_BEARER_TOKEN,
            self.NEWSAPI_KEY,
        ]
        configured = sum(1 for k in source_keys if k)
        if configured == 0:
            warnings.append(
                "No premium API keys configured — only free sources (RSS, PyTrends, Twitter RSS) will work"
            )

        # Validate CLIP model name
        valid_clip_models = {"ViT-B/32", "ViT-B/16", "ViT-L/14"}
        if self.CLIP_MODEL_NAME not in valid_clip_models:
            warnings.append(
                f"CLIP_MODEL_NAME '{self.CLIP_MODEL_NAME}' may not be a standard model name"
            )

        # Ensure model directory exists
        self.MODEL_DIR.mkdir(parents=True, exist_ok=True)
        self.IMAGE_CACHE_DIR.mkdir(parents=True, exist_ok=True)

        if self.RETRAIN_MIN_SAMPLES < 10:
            warnings.append("RETRAIN_MIN_SAMPLES is very low — model quality may suffer")

        if self.LLM_CAPTION_ENABLED:
            warnings.append(
                "LLM_CAPTION_ENABLED is true — TrendLens v5 uses transfer learning, not LLM APIs"
            )

        for w in warnings:
            logger.warning("Config warning: %s", w)

        return warnings


# Global singleton
settings = Settings()
