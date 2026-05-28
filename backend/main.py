"""
TrendLens AI v6.0 — FastAPI Backend
Social media trend analytics platform for Ugandan food businesses.
With MongoDB-backed data-driven evaluation, SHAP explainability,
RAG-powered insights, and image quality analysis.
"""

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import shutil
import tempfile

from fastapi import FastAPI, HTTPException, Query, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware

from trendlens.config import settings
from trendlens.monitoring import structured_log

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)


# ─── Lifespan ────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Validate DB connection on startup."""
    logger.info("Starting TrendLens AI v6.0 backend...")
    try:
        from trendlens.database import DatabaseManager
        db_mgr = DatabaseManager()
        if db_mgr.health_check():
            logger.info("MongoDB connection validated successfully")
        else:
            logger.warning("MongoDB health check failed — some features may be unavailable")
    except Exception as exc:
        logger.warning("MongoDB connection error: %s — continuing in degraded mode", exc)

    yield

    # Shutdown
    try:
        from trendlens.database import DatabaseManager
        DatabaseManager().close()
    except Exception:
        pass
    logger.info("TrendLens AI backend shut down")


# ─── App ─────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="TrendLens AI",
    description="Social media trend analytics platform for Ugandan food businesses",
    version="6.0.0",
    lifespan=lifespan,
)

# CORS — allow all origins for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Include Pipeline Router ─────────────────────────────────────────────────

from trendlens.pipeline_api import router as pipeline_router
from trendlens.auth import require_api_key
from fastapi import Depends

app.include_router(
    pipeline_router,
    dependencies=[Depends(require_api_key)],
)


# ─── Health Endpoint ─────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """System health check endpoint."""
    db_status = "disconnected"
    try:
        from trendlens.database import DatabaseManager
        db_mgr = DatabaseManager()
        if db_mgr.health_check():
            db_status = "connected"
    except Exception:
        db_status = "error"

    return {
        "status": "healthy" if db_status == "connected" else "degraded",
        "version": "6.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "database": db_status,
        "mongo_uri_set": bool(settings.MONGO_URI),
        "app_name": settings.APP_NAME,
    }


# ─── Core Endpoints ──────────────────────────────────────────────────────────

@app.get("/evaluate/poster")
async def evaluate_poster(
    image_url: str = Query("", description="Poster image URL"),
    caption: str = Query("", description="Post caption text"),
):
    """Evaluate a social media poster image + caption."""
    if not image_url and not caption:
        raise HTTPException(
            status_code=400,
            detail="Provide at least an image_url or caption parameter",
        )

    try:
        from trendlens.phase7_evaluator import PosterEvaluator
        evaluator = PosterEvaluator()
        eval_score, ocr_meta, annotations = evaluator.predict(
            image_url=image_url or "",
            caption=caption or "",
        )
        return {
            "score": eval_score.to_dict(),
            "ocr": ocr_meta,
            "annotations": [a.to_dict() for a in annotations],
        }
    except Exception as exc:
        structured_log.error("Poster evaluation failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/trends/current")
async def current_trends(
    category: str = Query("general", description="Trend category"),
    limit: int = Query(20, description="Max results"),
):
    """Get current trending terms for Ugandan food businesses."""
    try:
        from trendlens.phase1_trend_engine import fetch_trends
        signals = fetch_trends(category=category, limit=limit)
        return {
            "category": category,
            "count": len(signals),
            "trends": [s.to_dict() for s in signals],
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        structured_log.error("Trend fetch failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/benchmark/{category}")
async def benchmark_category(category: str):
    """Get benchmark data for a specific food business category."""
    try:
        from trendlens.database import (
            GroundTruthRepository,
            PostsRepository,
            TemplateRepository,
        )

        gt_repo = GroundTruthRepository()
        posts_repo = PostsRepository()
        template_repo = TemplateRepository()

        # Get ground truth data for the category
        gt_data = gt_repo.find_many(
            {"category": category},
            sort=[("engagement_rate", -1)],
            limit=100,
        )

        # Compute benchmark stats
        if gt_data:
            engagement_rates = [float(d.get("engagement_rate", 0)) for d in gt_data]
            engagement_rates.sort()

            industry_avg = sum(engagement_rates) / len(engagement_rates) if engagement_rates else 0
            top_10_threshold = engagement_rates[int(len(engagement_rates) * 0.9)] if len(engagement_rates) >= 10 else max(engagement_rates) if engagement_rates else 0

            return {
                "category": category,
                "sample_count": len(gt_data),
                "industry_avg_engagement": round(industry_avg, 4),
                "industry_top10_engagement": round(top_10_threshold, 4),
                "total_posts": posts_repo.count({"category": category}),
                "total_templates": template_repo.count({"category": category}),
            }
        else:
            return {
                "category": category,
                "sample_count": 0,
                "industry_avg_engagement": 0,
                "industry_top10_engagement": 0,
                "total_posts": posts_repo.count({"category": category}),
                "total_templates": template_repo.count({"category": category}),
                "message": "No ground truth data available for this category",
            }
    except Exception as exc:
        structured_log.error("Benchmark failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Stats Endpoint ──────────────────────────────────────────────────────────

@app.get("/stats")
async def quick_stats():
    """Get quick dashboard statistics."""
    try:
        from trendlens.database import (
            TemplateRepository,
            PostsRepository,
            GroundTruthRepository,
            ModelRegistryRepository,
        )

        template_repo = TemplateRepository()
        posts_repo = PostsRepository()
        gt_repo = GroundTruthRepository()
        model_repo = ModelRegistryRepository()

        latest_model = model_repo.get_latest("xgboost")

        return {
            "total_templates": template_repo.count(),
            "total_posts": posts_repo.count(),
            "ground_truth_count": gt_repo.count(),
            "model": {
                "latest_auc": latest_model.get("auc", 0) if latest_model else 0,
                "version": latest_model.get("version", "none") if latest_model else "none",
                "samples": latest_model.get("samples", 0) if latest_model else 0,
                "trained_at": latest_model.get("trained_at", "") if latest_model else "",
            } if latest_model else {
                "latest_auc": 0,
                "version": "none",
                "samples": 0,
                "trained_at": "",
            },
        }
    except Exception as exc:
        structured_log.error("Stats fetch failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Activity Endpoint ───────────────────────────────────────────────────────

@app.get("/activity")
async def recent_activity(limit: int = Query(20, description="Max results")):
    """Get recent system activity."""
    try:
        from trendlens.database import ActivityLogRepository
        repo = ActivityLogRepository()
        activities = repo.get_recent(limit=limit)
        return {
            "count": len(activities),
            "activities": activities,
        }
    except Exception as exc:
        structured_log.error("Activity fetch failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Model History Endpoint ──────────────────────────────────────────────────

@app.get("/models/history")
async def model_history(limit: int = Query(20, description="Max results")):
    """Get model version history."""
    try:
        from trendlens.database import ModelRegistryRepository
        repo = ModelRegistryRepository()
        versions = repo.get_all_versions("xgboost")
        return {
            "count": len(versions),
            "versions": versions[:limit],
        }
    except Exception as exc:
        structured_log.error("Model history fetch failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


# ─── MongoDB Benchmark Data Helper ───────────────────────────────────────

def _fetch_mongodb_benchmarks(category: str) -> Dict[str, Any]:
    """Fetch benchmark data from MongoDB to inform evaluation scoring.

    This queries the ground_truth_posts and posts collections for:
    - Average engagement rate by category
    - Top-performing post patterns (hashtags, CTA, price)
    - Hashtag performance data
    - Model version info

    Returns empty dict if MongoDB is unavailable.
    """
    benchmarks: Dict[str, Any] = {
        "db_connected": False,
        "category_samples": 0,
        "industry_avg_engagement": 0.0,
        "top_10_engagement": 0.0,
        "hashtag_performance": {},
        "cta_engagement_boost": 0.0,
        "price_engagement_boost": 0.0,
        "model_version": "none",
        "model_auc": 0.0,
    }

    try:
        from trendlens.database import (
            DatabaseManager,
            GroundTruthRepository,
            PostsRepository,
            ModelRegistryRepository,
        )

        # Check DB connection
        db_mgr = DatabaseManager()
        if not db_mgr.health_check():
            return benchmarks

        benchmarks["db_connected"] = True

        # ── Ground truth engagement benchmarks ───────────────────────
        gt_repo = GroundTruthRepository()
        gt_data = gt_repo.find_many(
            {"category": category},
            sort=[("engagement_rate", -1)],
            limit=200,
        )

        if gt_data:
            engagement_rates = [float(d.get("engagement_rate", 0)) for d in gt_data]
            benchmarks["category_samples"] = len(gt_data)
            benchmarks["industry_avg_engagement"] = round(
                sum(engagement_rates) / len(engagement_rates), 4
            )
            engagement_rates.sort()
            top10_idx = int(len(engagement_rates) * 0.9) if len(engagement_rates) >= 10 else len(engagement_rates) - 1
            benchmarks["top_10_engagement"] = round(engagement_rates[top10_idx], 4)

            # ── Hashtag performance analysis ─────────────────────────
            # Analyze which hashtags appear most in top-performing posts
            hashtag_counts: Dict[str, List[float]] = {}
            for doc in gt_data:
                caption = doc.get("caption", "")
                er = float(doc.get("engagement_rate", 0))
                # Extract hashtags from caption
                import re
                tags = re.findall(r'#(\w+)', caption)
                for tag in tags:
                    tag_lower = tag.lower()
                    if tag_lower not in hashtag_counts:
                        hashtag_counts[tag_lower] = []
                    hashtag_counts[tag_lower].append(er)

            # Compute average engagement per hashtag (min 3 occurrences)
            hashtag_perf = {}
            for tag, rates in sorted(hashtag_counts.items(), key=lambda x: -sum(x[1]) / len(x[1])):
                if len(rates) >= 3:
                    avg_er = round(sum(rates) / len(rates), 4)
                    hashtag_perf[tag] = {
                        "avg_engagement": avg_er,
                        "count": len(rates),
                    }

            # Top 10 performing hashtags
            benchmarks["hashtag_performance"] = dict(
                sorted(hashtag_perf.items(), key=lambda x: -x[1]["avg_engagement"])[:10]
            )

            # ── CTA vs no-CTA engagement comparison ──────────────────
            cta_patterns = ['dm to', 'dm us', 'whatsapp', 'link in bio', 'order now', 'call ']
            cta_er = []
            no_cta_er = []
            for doc in gt_data:
                caption_lower = doc.get("caption", "").lower()
                er = float(doc.get("engagement_rate", 0))
                if any(p in caption_lower for p in cta_patterns):
                    cta_er.append(er)
                else:
                    no_cta_er.append(er)

            if cta_er and no_cta_er:
                avg_cta = sum(cta_er) / len(cta_er)
                avg_no_cta = sum(no_cta_er) / len(no_cta_er)
                benchmarks["cta_engagement_boost"] = round(avg_cta - avg_no_cta, 4)

            # ── Price vs no-price engagement comparison ──────────────
            price_patterns = ['ugx', 'ush', '$', 'price', 'starting at', 'from ']
            price_er = []
            no_price_er = []
            for doc in gt_data:
                caption_lower = doc.get("caption", "").lower()
                er = float(doc.get("engagement_rate", 0))
                if any(p in caption_lower for p in price_patterns):
                    price_er.append(er)
                else:
                    no_price_er.append(er)

            if price_er and no_price_er:
                avg_price = sum(price_er) / len(price_er)
                avg_no_price = sum(no_price_er) / len(no_price_er)
                benchmarks["price_engagement_boost"] = round(avg_price - avg_no_price, 4)

        # ── Model registry info ─────────────────────────────────────
        model_repo = ModelRegistryRepository()
        latest_model = model_repo.get_latest("xgboost")
        if latest_model:
            benchmarks["model_version"] = latest_model.get("version", "unknown")
            benchmarks["model_auc"] = latest_model.get("auc", 0.0)

    except Exception as exc:
        logger.debug("MongoDB benchmark fetch failed: %s", exc)

    return benchmarks


# ─── Enhanced POST /evaluate/poster endpoint ─────────────────────────────

@app.post("/evaluate/poster")
async def evaluate_poster_upload(
    image: UploadFile | None = File(None),
    image_url: str = Form(""),
    caption: str = Form(""),
):
    """Evaluate a social media poster image + caption.

    Accepts either:
    - A file upload (multipart/form-data with 'image' field)
    - An image_url parameter
    - Or both, plus a caption

    Returns 1-10 scores for overall, poster, and caption,
    improvement suggestions, and an improved caption version.

    When MongoDB is connected, evaluation is enhanced with:
    - Real historical engagement benchmarks from ground_truth_posts
    - Hashtag performance data from past posts
    - CTA and price engagement boost metrics
    - XGBoost model predictions (if a trained model exists)
    """
    if not image and not image_url and not caption:
        raise HTTPException(
            status_code=400,
            detail="Provide at least an image file, image_url, or caption parameter",
        )

    # ── Save uploaded image to a temp file ────────────────────────────
    local_image_path = ""
    if image:
        try:
            suffix = Path(image.filename or "upload.jpg").suffix or ".jpg"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
                shutil.copyfileobj(image.file, tmp)
                local_image_path = tmp.name
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed to save image: {exc}")
    elif image_url:
        local_image_path = image_url

    # ── Run evaluation ────────────────────────────────────────────────
    try:
        from trendlens.phase7_evaluator import PosterEvaluator, PosterFeatureExtractor
        from trendlens.phase5_caption_intelligence import CaptionIntelligence
        from trendlens.text_processor import TextProcessor

        evaluator = PosterEvaluator()
        eval_score, ocr_meta, annotations = evaluator.predict(
            image_url=local_image_path or "",
            caption=caption or "",
        )

        # ── Extract features for detailed scoring ─────────────────────
        extractor = PosterFeatureExtractor()
        feats = extractor.extract_all(local_image_path or "", caption or "")

        cap_feats = feats.get("caption_features", {})
        ocr_feats = feats.get("ocr_features", {})
        category = feats.get("category", "general")

        # ── Fetch MongoDB benchmarks for data-driven scoring ──────────
        benchmarks = _fetch_mongodb_benchmarks(category)

        # ── Compute separate poster & caption scores (1-10) ───────────
        overall_10 = _score_to_1_10(eval_score.score)
        poster_10 = _compute_poster_score_1_10(feats, ocr_meta, benchmarks)
        caption_10 = _compute_caption_score_1_10(cap_feats, category, benchmarks)

        # If MongoDB has data, blend the heuristic score with benchmark data
        if benchmarks["db_connected"] and benchmarks["category_samples"] >= 5:
            # Adjust overall score based on how it compares to industry average
            # This makes the score data-driven rather than purely heuristic
            overall_10 = _adjust_score_with_benchmarks(
                overall_10, cap_feats, benchmarks
            )

        # ── Generate improvement suggestions ──────────────────────────
        poster_improvements = _generate_poster_improvements(
            feats, ocr_meta, annotations, benchmarks
        )
        caption_improvements = _generate_caption_improvements(
            cap_feats, category, benchmarks
        )

        # ── Generate improved caption (using CaptionGenerator module) ──
        try:
            from trendlens.caption_generator import CaptionGenerator
            caption_gen = CaptionGenerator()
            improved_caption = caption_gen.generate(
                caption, cap_feats, category, ocr_meta, benchmarks
            )
        except Exception:
            improved_caption = _generate_improved_caption(
                caption, cap_feats, category, ocr_meta, benchmarks
            )

        # ── SHAP feature contributions ────────────────────────────────
        shap_contributions = []
        try:
            from trendlens.shap_explainer import SHAPExplainer
            shap_explainer = SHAPExplainer()
            shap_contributions = shap_explainer.explain(
                cap_feats, overall_10, category
            )
        except Exception as exc:
            logger.debug("SHAP explanation failed: %s", exc)

        # ── RAG: Find similar high-performing posts ───────────────────
        similar_posts = []
        try:
            from trendlens.rag_engine import RAGEngine
            rag = RAGEngine()
            similar_posts = rag.find_similar_posts(
                caption or "", category, top_k=5
            )
        except Exception as exc:
            logger.debug("RAG engine failed: %s", exc)

        # ── Image quality analysis ────────────────────────────────────
        image_quality = {}
        try:
            from trendlens.image_quality import ImageQualityAnalyzer
            quality_analyzer = ImageQualityAnalyzer()
            image_quality = quality_analyzer.analyze(local_image_path or "")
        except Exception as exc:
            logger.debug("Image quality analysis failed: %s", exc)

        # ── OCR text ──────────────────────────────────────────────────
        ocr_text = ocr_meta.get("full_text", "") if isinstance(ocr_meta, dict) else ""

        # Clean up temp file
        if image and local_image_path and os.path.exists(local_image_path):
            try:
                os.unlink(local_image_path)
            except OSError:
                pass

        # ── Build response ────────────────────────────────────────────
        result = {
            "overall_score": overall_10,
            "poster_score": poster_10,
            "caption_score": caption_10,
            "confidence_interval": {
                "lower": _score_to_1_10(eval_score.lower),
                "upper": _score_to_1_10(eval_score.upper),
            },
            "poster_improvements": poster_improvements,
            "caption_improvements": caption_improvements,
            "improved_caption": improved_caption,
            "ocr_text": ocr_text,
            "category": category,
            "annotations": [a.to_dict() for a in annotations],
            "caption_features": {k: v for k, v in cap_feats.items() if isinstance(v, (str, int, float, bool, list, dict))},
            "model_version": eval_score.model_version,
            "evaluated_at": eval_score.evaluated_at,
            # ── Data source transparency ──────────────────────────────
            "data_source": "mongodb" if benchmarks["db_connected"] else "heuristic",
            "benchmarks": {
                "db_connected": benchmarks["db_connected"],
                "category_samples": benchmarks["category_samples"],
                "industry_avg_engagement": benchmarks["industry_avg_engagement"],
                "top_10_engagement": benchmarks["top_10_engagement"],
                "model_version": benchmarks["model_version"],
                "model_auc": benchmarks["model_auc"],
                "cta_engagement_boost": benchmarks["cta_engagement_boost"],
                "price_engagement_boost": benchmarks["price_engagement_boost"],
            } if benchmarks["db_connected"] else {
                "db_connected": False,
                "category_samples": 0,
            },
        }

        # Include top-performing hashtags from DB if available
        if benchmarks["hashtag_performance"]:
            result["benchmarks"]["top_hashtags"] = [
                f"#{tag}" for tag in benchmarks["hashtag_performance"].keys()
            ]

        # Include SHAP contributions
        if shap_contributions:
            result["shap_contributions"] = shap_contributions

        # Include RAG similar posts
        if similar_posts:
            result["similar_posts"] = similar_posts

        # Include image quality metrics
        if image_quality:
            result["image_quality"] = image_quality

        # Store evaluation in DB
        try:
            from trendlens.database import EvaluationsRepository
            eval_repo = EvaluationsRepository()
            eval_repo.add_evaluation(
                overall_score=overall_10,
                poster_score=poster_10,
                caption_score=caption_10,
                category=category,
                caption=caption[:500] if caption else "",
                caption_features={k: v for k, v in cap_feats.items() if isinstance(v, (str, int, float, bool))},
                model_version=eval_score.model_version,
            )
        except Exception:
            pass

        return result

    except HTTPException:
        raise
    except Exception as exc:
        # Clean up temp file on error
        if image and local_image_path and os.path.exists(local_image_path):
            try:
                os.unlink(local_image_path)
            except OSError:
                pass
        structured_log.error("Poster evaluation failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Scoring helper functions ────────────────────────────────────────────

def _score_to_1_10(score_100: float) -> float:
    """Convert a 0-100 score to a 1-10 scale (rounded to 1 decimal)."""
    scaled = 1 + (score_100 / 100) * 9
    return round(max(1.0, min(10.0, scaled)), 1)


def _adjust_score_with_benchmarks(
    heuristic_score: float,
    cap_feats: dict,
    benchmarks: dict,
) -> float:
    """Adjust the heuristic score based on MongoDB benchmark data.

    If the user's caption has features that historically perform above
    average (e.g., CTA, price, good hashtag count), the score is
    boosted. If features that typically underperform are present, the
    score is reduced. This makes the score data-driven.
    """
    adjusted = heuristic_score

    # ── CTA adjustment: if data shows CTA boosts engagement ───────
    cta_boost = benchmarks.get("cta_engagement_boost", 0)
    has_cta = bool(cap_feats.get("cta", {}).get("has_cta", False))
    if cta_boost > 0 and has_cta:
        # Positive boost proportional to the measured effect
        adjusted += min(0.5, cta_boost * 2)
    elif cta_boost > 0 and not has_cta:
        # Penalty for missing CTA when data shows it helps
        adjusted -= min(0.4, cta_boost * 1.5)

    # ── Price adjustment ──────────────────────────────────────────
    price_boost = benchmarks.get("price_engagement_boost", 0)
    has_price = bool(cap_feats.get("has_price", False))
    if price_boost > 0 and has_price:
        adjusted += min(0.4, price_boost * 2)
    elif price_boost > 0 and not has_price:
        adjusted -= min(0.3, price_boost * 1.5)

    # ── Hashtag count vs industry top performers ──────────────────
    ht_count = int(cap_feats.get("hashtag_count", 0))
    hashtag_perf = benchmarks.get("hashtag_performance", {})
    if hashtag_perf:
        # Check if user's hashtags match top-performing ones
        import re
        user_caption_lower = str(cap_feats.get("raw_caption", "")).lower()
        matching_top = sum(
            1 for tag in hashtag_perf.keys()
            if f"#{tag}" in user_caption_lower
        )
        if matching_top >= 3:
            adjusted += 0.3
        elif matching_top >= 1:
            adjusted += 0.1

    return round(max(1.0, min(10.0, adjusted)), 1)


def _compute_poster_score_1_10(feats: dict, ocr_meta: dict, benchmarks: dict = None) -> float:
    """Compute a poster-specific score (1-10) based on visual & OCR features.

    When MongoDB benchmarks are available, the score is adjusted based on
    how similar poster features correlate with engagement in historical data.
    """
    score = 5.0  # baseline

    # Style features
    style = feats.get("style_features", None)
    if style is not None and len(style) >= 9:
        # Brightness (style[3]): moderate is best
        brightness = float(style[3])
        if 0.3 <= brightness <= 0.7:
            score += 0.8
        elif brightness < 0.2:
            score -= 0.5
            score += 0.2  # slightly dim is ok

        # Contrast (style[4]): higher is usually better for posters
        contrast = float(style[4])
        if contrast > 0.4:
            score += 0.7
        elif contrast > 0.25:
            score += 0.3

        # Saturation (style[8]): vivid colors attract attention
        saturation = float(style[8])
        if saturation > 0.3:
            score += 0.6
        elif saturation > 0.15:
            score += 0.3

    # OCR features
    ocr = feats.get("ocr_features", {})
    if isinstance(ocr, dict):
        # Text box ratio
        text_ratio = float(ocr.get("text_box_ratio", 0))
        if 0.05 <= text_ratio <= 0.5:
            score += 0.8
        elif text_ratio > 0.5:
            score -= 0.3

        if ocr.get("has_price"):
            score += 0.5
        if ocr.get("has_cta"):
            score += 0.5

        avg_conf = float(ocr.get("avg_confidence", 0))
        if avg_conf > 0.7:
            score += 0.4
        elif avg_conf > 0.4:
            score += 0.2

        safe_zone = float(ocr.get("safe_zone_coverage", 0))
        if safe_zone > 0.1:
            score += 0.3

    # CLIP features
    clip = feats.get("clip_features", None)
    if clip is not None:
        try:
            import numpy as np
            clip_norm = float(np.linalg.norm(clip))
            if clip_norm > 10:
                score += 0.5
        except Exception:
            pass

    # ── MongoDB benchmark adjustments ─────────────────────────────
    if benchmarks and benchmarks.get("db_connected"):
        # If we have engagement data, adjust based on how the poster's
        # features compare to top-performing posts
        if benchmarks.get("category_samples", 0) >= 5:
            # Price on poster is especially important when data shows
            # price boosts engagement
            price_boost = benchmarks.get("price_engagement_boost", 0)
            if price_boost > 0 and isinstance(ocr, dict) and ocr.get("has_price"):
                score += min(0.4, price_boost)

            cta_boost = benchmarks.get("cta_engagement_boost", 0)
            if cta_boost > 0 and isinstance(ocr, dict) and ocr.get("has_cta"):
                score += min(0.3, cta_boost)

    return round(max(1.0, min(10.0, score)), 1)


def _compute_caption_score_1_10(cap_feats: dict, category: str, benchmarks: dict = None) -> float:
    """Compute a caption-specific score (1-10) based on text features.

    When MongoDB benchmarks are available, the score incorporates real
    engagement data to validate the heuristic scoring.
    """
    # Use the caption_score from CaptionIntelligence if available
    raw_score = float(cap_feats.get("caption_score", 0))
    if raw_score > 0:
        base_score = _score_to_1_10(raw_score)
    else:
        # Fallback: manual scoring
        base_score = 4.0

        ht_count = int(cap_feats.get("hashtag_count", 0))
        if ht_count >= 8:
            base_score += 1.5
        elif ht_count >= 5:
            base_score += 1.0
        elif ht_count >= 3:
            base_score += 0.5

        cta = cap_feats.get("cta", {})
        if isinstance(cta, dict) and cta.get("has_cta"):
            base_score += 1.0

        if cap_feats.get("has_price"):
            base_score += 0.8

        wc = int(cap_feats.get("word_count", 0))
        if 50 <= wc <= 200:
            base_score += 1.0
        elif 20 <= wc < 50:
            base_score += 0.5
        elif wc < 20:
            base_score -= 0.5

        sentiment = cap_feats.get("sentiment", {})
        if isinstance(sentiment, dict):
            polarity = float(sentiment.get("polarity", 0))
            if polarity > 0.2:
                base_score += 0.5
            elif polarity < -0.2:
                base_score -= 0.5

        alignment = cap_feats.get("trend_alignment", {})
        if isinstance(alignment, dict):
            alignment_score = float(alignment.get("score", 0))
            base_score += alignment_score * 1.0

        emoji_count = int(cap_feats.get("emoji_count", 0))
        if emoji_count >= 1:
            base_score += 0.3

    # ── MongoDB benchmark adjustments ─────────────────────────────
    if benchmarks and benchmarks.get("db_connected") and benchmarks.get("category_samples", 0) >= 5:
        # Data-driven adjustments based on real engagement metrics
        cta_boost = benchmarks.get("cta_engagement_boost", 0)
        if cta_boost > 0 and cap_feats.get("cta", {}).get("has_cta"):
            base_score += min(0.5, cta_boost * 2)
        elif cta_boost > 0:
            base_score -= min(0.3, cta_boost)

        price_boost = benchmarks.get("price_engagement_boost", 0)
        if price_boost > 0 and cap_feats.get("has_price"):
            base_score += min(0.4, price_boost * 2)
        elif price_boost > 0:
            base_score -= min(0.2, price_boost)

        # Hashtag alignment with top performers
        hashtag_perf = benchmarks.get("hashtag_performance", {})
        if hashtag_perf:
            import re
            user_caption_lower = str(cap_feats.get("raw_caption", "")).lower()
            matching = sum(1 for tag in hashtag_perf if f"#{tag}" in user_caption_lower)
            if matching >= 3:
                base_score += 0.4
            elif matching >= 1:
                base_score += 0.15

    return round(max(1.0, min(10.0, base_score)), 1)


def _generate_poster_improvements(
    feats: dict,
    ocr_meta: dict,
    annotations: list,
    benchmarks: dict = None,
) -> list:
    """Generate actionable poster improvement suggestions.

    When MongoDB data is available, suggestions reference real data
    (e.g., "Posts with prices get X% more engagement based on Y samples").
    """
    improvements = []
    ocr = feats.get("ocr_features", {})
    db_connected = benchmarks and benchmarks.get("db_connected")
    samples = benchmarks.get("category_samples", 0) if benchmarks else 0

    # From annotations
    for ann in annotations:
        title = ann.title if hasattr(ann, 'title') else ann.get('title', '')
        detail = ann.detail if hasattr(ann, 'detail') else ann.get('detail', '')
        severity = ann.severity if hasattr(ann, 'severity') else ann.get('severity', 'info')

        if severity in ('warning', 'critical'):
            improvements.append(detail)

    # Style-based suggestions
    style = feats.get("style_features", None)
    if style is not None and len(style) >= 9:
        brightness = float(style[3])
        if brightness < 0.2:
            improvements.append("Poster is too dark — increase brightness or add more light areas for better visibility on mobile screens")
        elif brightness > 0.8:
            improvements.append("Poster is very bright — add darker contrast areas so key text stands out")

        contrast = float(style[4])
        if contrast < 0.2:
            improvements.append("Low contrast detected — use bolder colors and larger text to make the poster pop in social feeds")

        saturation = float(style[8])
        if saturation < 0.15:
            improvements.append("Colors are muted — increase saturation to catch attention while scrolling")

    # OCR-based suggestions (data-driven when possible)
    if isinstance(ocr, dict):
        text_ratio = float(ocr.get("text_box_ratio", 0))
        if text_ratio < 0.05:
            improvements.append("Very little text detected on the poster — add key info like product name, price, and CTA")
        elif text_ratio > 0.6:
            improvements.append("Too much text on the poster — simplify to a clear headline + price + CTA for quick scanning")

        if not ocr.get("has_price"):
            if db_connected and samples > 0 and benchmarks.get("price_engagement_boost", 0) > 0:
                boost = benchmarks["price_engagement_boost"]
                improvements.append(
                    f"Add a visible price on the poster (e.g., 'UGX 50,000') — based on {samples} posts in our database, "
                    f"posts with prices get {abs(boost)*100:.1f}% more engagement"
                )
            else:
                improvements.append("No price found on the poster — add a visible price (e.g., 'UGX 50,000') to boost buyer intent")

        if not ocr.get("has_cta"):
            if db_connected and samples > 0 and benchmarks.get("cta_engagement_boost", 0) > 0:
                boost = benchmarks["cta_engagement_boost"]
                improvements.append(
                    f"Add a call-to-action on the poster like 'DM to order' — our data from {samples} posts shows "
                    f"CTAs boost engagement by {abs(boost)*100:.1f}%"
                )
            else:
                improvements.append("No call-to-action on the poster — add text like 'DM to order' or 'WhatsApp 0700 XXX XXX'")

        avg_conf = float(ocr.get("avg_confidence", 0))
        if 0 < avg_conf < 0.5:
            improvements.append("Poster text is hard to read — use larger, bolder fonts with high contrast against the background")

    # Deduplicate while preserving order
    seen = set()
    unique = []
    for imp in improvements:
        if imp not in seen:
            seen.add(imp)
            unique.append(imp)

    return unique[:8]


def _generate_caption_improvements(cap_feats: dict, category: str, benchmarks: dict = None) -> list:
    """Generate actionable caption improvement suggestions.

    When MongoDB data is available, suggestions reference real engagement
    data and top-performing hashtags from the database.
    """
    from trendlens.phase5_caption_intelligence import CATEGORY_RULES

    suggestions = []
    checks = cap_feats.get("category_checks", {})
    rules = CATEGORY_RULES.get(category, CATEGORY_RULES["general"])
    db_connected = benchmarks and benchmarks.get("db_connected")
    samples = benchmarks.get("category_samples", 0) if benchmarks else 0

    # Hashtags
    ht_count = int(cap_feats.get("hashtag_count", 0))
    ideal = int(rules.get("ideal_hashtags", 8))
    min_ht = int(rules.get("min_hashtags", 3))
    if ht_count < min_ht:
        gap = ideal - ht_count
        if db_connected and benchmarks.get("hashtag_performance"):
            top_tags = [f"#{t}" for t in list(benchmarks["hashtag_performance"].keys())[:5]]
            suggestions.append(
                f"Add {gap} more hashtags — {ideal}+ is ideal for {category} posts. "
                f"Top performers in our database: {' '.join(top_tags)}"
            )
        else:
            suggestions.append(f"Add {gap} more hashtags — {ideal}+ is ideal for {category} posts to maximize discoverability")
    elif ht_count < ideal:
        if db_connected and benchmarks.get("hashtag_performance"):
            top_tags = [f"#{t}" for t in list(benchmarks["hashtag_performance"].keys())[:3]]
            suggestions.append(f"Good start, but adding {ideal - ht_count} more hashtags could boost reach. Try: {' '.join(top_tags)}")
        else:
            suggestions.append(f"Good hashtag count, but adding {ideal - ht_count} more could boost your reach further")

    # CTA
    if isinstance(checks, dict) and not checks.get("cta_check_pass", True):
        if db_connected and samples > 0 and benchmarks.get("cta_engagement_boost", 0) > 0:
            boost = benchmarks["cta_engagement_boost"]
            suggestions.append(
                f"Add a call-to-action like 'DM to order' — based on {samples} {category} posts, "
                f"CTAs boost engagement by {abs(boost)*100:.1f}%"
            )
        else:
            suggestions.append("Add a call-to-action like 'DM to order', 'Link in bio', or 'WhatsApp 0700 123456' — posts with CTAs get significantly more responses")

    # Price
    if isinstance(checks, dict) and not checks.get("price_check_pass", True):
        if db_connected and samples > 0 and benchmarks.get("price_engagement_boost", 0) > 0:
            boost = benchmarks["price_engagement_boost"]
            suggestions.append(
                f"Include pricing (e.g., 'UGX 50,000') — our data from {samples} posts shows "
                f"price mentions boost serious inquiries by {abs(boost)*100:.1f}%"
            )
        else:
            suggestions.append("Include pricing info (e.g., 'Starting at UGX 50,000') — price mentions increase serious buyer engagement by up to 30%")

    # Caption length
    wc = int(cap_feats.get("word_count", 0))
    ideal_min, ideal_max = rules.get("ideal_caption_length", (50, 200))
    if wc < ideal_min:
        suggestions.append(f"Caption is too short ({wc} words) — aim for {ideal_min}-{ideal_max} words to describe your product and create desire")
    elif wc > ideal_max:
        suggestions.append(f"Caption is very long ({wc} words) — keep it between {ideal_min}-{ideal_max} words so readers don't skip it")

    # Sentiment
    sentiment = cap_feats.get("sentiment", {})
    if isinstance(sentiment, dict):
        polarity = float(sentiment.get("polarity", 0))
        if polarity < -0.1:
            suggestions.append("Caption tone is negative — use positive, enthusiastic language to attract customers")

    # Trend alignment
    alignment = cap_feats.get("trend_alignment", {})
    if isinstance(alignment, dict):
        alignment_score = float(alignment.get("score", 0))
        if alignment_score < 0.2:
            best_kw = alignment.get("best_trend_keyword", "")
            if best_kw:
                suggestions.append(f"Low trend alignment — incorporate trending topics like '{best_kw}' in your caption for more visibility")
            else:
                suggestions.append("Low trend alignment — research current food trends in Uganda and reference them in your caption")

    # Required keywords
    if isinstance(checks, dict) and not checks.get("has_required_keywords", True):
        missing = checks.get("missing_required_keywords", [])
        if missing:
            suggestions.append(f"Include these important keywords for better categorization: {', '.join(missing)}")

    # Emoji
    emoji_count = int(cap_feats.get("emoji_count", 0))
    if emoji_count == 0:
        suggestions.append("Add relevant emojis to make the caption visually appealing and break up text for easy reading")

    # Readability
    readability = float(cap_feats.get("readability", 0))
    if readability > 0 and readability < 40:
        suggestions.append("Caption readability is low — use shorter sentences and simpler words so it's easy to scan")

    # Line breaks tip
    suggestions.append("Use line breaks and spacing to make the caption easier to read on mobile screens")

    # ── Data-driven industry comparison ────────────────────────────
    if db_connected and samples > 0:
        avg_eng = benchmarks.get("industry_avg_engagement", 0)
        top10_eng = benchmarks.get("top_10_engagement", 0)
        if avg_eng > 0:
            suggestions.append(
                f"Based on {samples} {category} posts in our database, the average engagement rate is "
                f"{avg_eng:.1%} and top 10% achieve {top10_eng:.1%} — aim for the top!"
            )

    return suggestions[:8]


def _generate_improved_caption(
    original_caption: str,
    cap_feats: dict,
    category: str,
    ocr_meta: dict,
    benchmarks: dict = None,
) -> str:
    """Generate an improved version of the caption based on analysis.

    When MongoDB data is available, the improved caption uses top-performing
    hashtags from the database instead of generic ones.
    """
    from trendlens.phase5_caption_intelligence import CATEGORY_RULES

    if not original_caption.strip():
        # Return a template if no caption was provided
        templates = {
            "cake": "Celebrate with a stunning custom cake! From birthdays to weddings, we craft edible works of art just for you.\n\nDM to order or WhatsApp 0700 123456\nStarting at UGX 80,000\n\n#KampalaCakes #CustomCakes #BirthdayCake #WeddingCake #UgandaCakes #CakeDelivery #CakeLover #UgandanBusiness",
            "bakery": "Fresh from the oven! Our artisan breads and pastries are made daily with the finest ingredients.\n\nDM to order or WhatsApp 0700 123456\nPrices from UGX 5,000\n\n#KampalaBakery #FreshBread #ArtisanBakery #UgandaFood #BakeryLife #PastryLover #LocalBakery #UgandanBusiness",
            "restaurant": "Experience the best flavors in town! Our menu features authentic Ugandan dishes made with love.\n\nVisit us today or call 0700 123456 for reservations\n\n#KampalaFood #UgandanCuisine #RestaurantLife #FoodieUg #LocalEats #UgandaRestaurant #FoodLovers #VisitUganda",
            "general": "Discover something amazing! Quality products at great prices.\n\nDM to order or WhatsApp 0700 123456\n\n#Kampala #UgandaBusiness #SupportLocal #Uganda #QualityProducts #LocalBusiness #MadeInUganda #ShopUganda",
        }
        return templates.get(category, templates["general"])

    # Start with the original caption
    improved = original_caption.strip()
    rules = CATEGORY_RULES.get(category, CATEGORY_RULES["general"])
    checks = cap_feats.get("category_checks", {})

    # ── Add CTA if missing ────────────────────────────────────────────
    has_cta = False
    if isinstance(checks, dict):
        has_cta = bool(checks.get("has_cta"))
    if not has_cta:
        cta_patterns = ['dm to', 'dm us', 'whatsapp', 'link in bio', 'call ', 'order now', 'book now']
        if not any(p in improved.lower() for p in cta_patterns):
            improved += "\n\nDM us to order or WhatsApp 0700 123456"

    # ── Add price if missing ───────────────────────────────────────────
    has_price = bool(cap_feats.get("has_price", False))
    if not has_price and rules.get("price_required", False):
        price_patterns = ['ugx', 'ush', '$', 'price']
        if not any(p in improved.lower() for p in price_patterns):
            improved += "\nStarting at UGX 50,000"

    # ── Add missing required keywords naturally ────────────────────────
    missing_keywords = []
    if isinstance(checks, dict):
        missing_keywords = checks.get("missing_required_keywords", [])
    for kw in missing_keywords[:2]:
        if kw.lower() not in improved.lower():
            improved = improved.rstrip() + f" #{kw.title()}"

    # ── Add hashtags if needed (use DB data when available) ────────────
    ht_count = int(cap_feats.get("hashtag_count", 0))
    ideal_ht = int(rules.get("ideal_hashtags", 8))
    if ht_count < ideal_ht:
        # Use top-performing hashtags from MongoDB if available
        db_hashtags = []
        if benchmarks and benchmarks.get("hashtag_performance"):
            db_hashtags = [f"#{tag}" for tag in benchmarks["hashtag_performance"].keys()]

        # Fallback to generic hashtags
        recommended_hashtags = {
            "cake": ["#KampalaCakes", "#CustomCakes", "#BirthdayCake", "#WeddingCake", "#UgandaCakes", "#CakeDelivery", "#CakeDesign", "#UgandanBusiness"],
            "bakery": ["#KampalaBakery", "#FreshBread", "#ArtisanBakery", "#UgandaFood", "#BakeryLife", "#PastryLover", "#LocalBakery", "#UgandanBusiness"],
            "restaurant": ["#KampalaFood", "#UgandanCuisine", "#RestaurantLife", "#FoodieUg", "#LocalEats", "#UgandaRestaurant", "#FoodLovers", "#VisitUganda"],
            "general": ["#Kampala", "#UgandaBusiness", "#SupportLocal", "#Uganda", "#QualityProducts", "#LocalBusiness", "#MadeInUganda", "#ShopUganda"],
        }

        # Prefer DB hashtags, fill remaining with generic
        extra_tags = db_hashtags if db_hashtags else recommended_hashtags.get(category, recommended_hashtags["general"])
        generic_tags = recommended_hashtags.get(category, recommended_hashtags["general"])

        # Combine: DB tags first, then generic ones not already included
        all_tags = extra_tags[:]
        for tag in generic_tags:
            if tag.lower() not in [t.lower() for t in all_tags]:
                all_tags.append(tag)

        needed = ideal_ht - ht_count
        new_tags = [t for t in all_tags if t.lower() not in improved.lower()][:needed]
        if new_tags:
            improved = improved.rstrip() + "\n\n" + " ".join(new_tags)

    # ── Add emojis if missing ──────────────────────────────────────────
    emoji_count = int(cap_feats.get("emoji_count", 0))
    if emoji_count == 0:
        emoji_map = {
            "cake": "\U0001f382\U0001f389",
            "bakery": "\U0001f35e\u2728",
            "restaurant": "\U0001f37d\ufe0f\U0001f525",
            "general": "\u2b50\u2728",
        }
        emojis = emoji_map.get(category, "\u2b50\u2728")
        lines = improved.split("\n")
        if lines:
            lines[0] = lines[0].rstrip() + f" {emojis}"
            improved = "\n".join(lines)

    # ── Improve readability with line breaks ───────────────────────────
    if "\n" not in improved and len(improved) > 100:
        for separator in [". ", "! ", "? "]:
            if separator in improved:
                parts = improved.split(separator)
                result = []
                for i, part in enumerate(parts):
                    suffix = separator.strip() if i < len(parts) - 1 else ""
                    result.append(part + suffix)
                    if i % 2 == 1 and i < len(parts) - 1:
                        result.append("\n")
                improved = " ".join(result)
                break

    return improved.strip()


# ─── Feedback Endpoint ────────────────────────────────────────────────────

@app.post("/feedback")
async def submit_feedback(
    evaluation_id: str = Form(""),
    feedback_type: str = Form(...),
    score: float = Form(0),
    comment: str = Form(""),
):
    """Store user feedback (thumbs up/down) for an evaluation.

    Args:
        evaluation_id: The ID of the evaluation (optional)
        feedback_type: "thumbs_up" or "thumbs_down"
        score: The evaluation score that was given
        comment: Optional user comment
    """
    if feedback_type not in ("thumbs_up", "thumbs_down"):
        raise HTTPException(
            status_code=400,
            detail="feedback_type must be 'thumbs_up' or 'thumbs_down'",
        )

    try:
        from trendlens.database import FeedbackRepository
        repo = FeedbackRepository()
        inserted_id = repo.add_feedback(
            evaluation_id=evaluation_id,
            feedback_type=feedback_type,
            score=score if score else None,
            comment=comment,
        )
        return {
            "status": "ok",
            "feedback_id": inserted_id,
            "message": "Feedback recorded successfully",
        }
    except Exception as exc:
        structured_log.error("Feedback storage failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/feedback/stats")
async def feedback_stats():
    """Get aggregate feedback statistics."""
    try:
        from trendlens.database import FeedbackRepository
        repo = FeedbackRepository()
        stats = repo.get_stats()
        return stats
    except Exception as exc:
        structured_log.error("Feedback stats fetch failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Drift Measurements Endpoint ─────────────────────────────────────────

@app.get("/drift/measurements")
async def drift_measurements(
    limit: int = Query(20, description="Max results"),
    drift_type: str = Query("", description="Drift type filter"),
):
    """Get recent drift measurements from the drift_state collection."""
    try:
        from trendlens.database import DriftStateRepository
        repo = DriftStateRepository()
        measurements = repo.get_measurements(
            limit=limit,
            drift_type=drift_type if drift_type else None,
        )
        return {
            "count": len(measurements),
            "measurements": measurements,
        }
    except Exception as exc:
        structured_log.error("Drift measurements fetch failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Evaluations History Endpoint ────────────────────────────────────────

@app.get("/evaluations/history")
async def evaluations_history(
    limit: int = Query(20, description="Max results"),
):
    """Get recent evaluation history."""
    try:
        from trendlens.database import EvaluationsRepository
        repo = EvaluationsRepository()
        evaluations = repo.get_recent(limit=limit)
        return {
            "count": len(evaluations),
            "evaluations": evaluations,
        }
    except Exception as exc:
        structured_log.error("Evaluation history fetch failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@app.get("/evaluations/avg_scores")
async def evaluations_avg_scores(
    category: str = Query("", description="Category filter"),
):
    """Get average evaluation scores."""
    try:
        from trendlens.database import EvaluationsRepository
        repo = EvaluationsRepository()
        avg = repo.get_average_scores(category=category if category else "")
        return avg
    except Exception as exc:
        structured_log.error("Evaluation avg scores fetch failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Caption Variants Endpoint ───────────────────────────────────────────

@app.post("/caption/variants")
async def generate_caption_variants(
    caption: str = Form(""),
    category: str = Form("general"),
):
    """Generate platform-specific caption variants."""
    if not caption:
        raise HTTPException(status_code=400, detail="Caption is required")

    try:
        from trendlens.caption_generator import CaptionGenerator
        from trendlens.text_processor import TextProcessor

        tp = TextProcessor()
        cap_feats = tp.compute_caption_features(caption)

        gen = CaptionGenerator()
        variants = gen.generate_variants(caption, cap_feats, category)

        return {
            "original_caption": caption,
            "category": category,
            "variants": variants,
        }
    except Exception as exc:
        structured_log.error("Caption variant generation failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))
