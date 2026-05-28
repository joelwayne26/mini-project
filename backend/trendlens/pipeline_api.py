"""
trendlens/pipeline_api.py
FastAPI endpoints for the data transformation, auto-retraining, and
data change watcher pipelines.
"""

import logging
import os
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Depends

from trendlens.auth import require_api_key
from trendlens.config import settings
from trendlens.monitoring import structured_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


# ─── Module-level State ───────────────────────────────────────────────────────

_worker_thread: Optional[threading.Thread] = None
_worker = None
_watcher = None
_watcher_thread: Optional[threading.Thread] = None


# ─── Transformation Endpoints ─────────────────────────────────────────────────

@router.post("/transform")
async def run_transformation(
    n_clusters: int = 8,
    engagement_threshold: float = 0.04,
    limit: int = 0,
):
    """Run the data transformation pipeline: raw → clustered → ground truth.

    Transforms unprocessed templates_db and posts_db documents into the
    clustered format that TrendLens expects for evaluation and retraining.

    This is the key parsing layer that maps the different field structures
    from the raw collections to the normalized clustered format.
    """
    from trendlens.data_transformation_pipeline import DataTransformationPipeline

    try:
        pipeline = DataTransformationPipeline()
        result = pipeline.run(
            n_clusters=n_clusters,
            engagement_threshold=engagement_threshold,
            limit=limit or 0,
        )
        return result
    except Exception as exc:
        structured_log.error("Transformation pipeline failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/transform/status")
async def transformation_status():
    """Get the status of the last transformation run."""
    from trendlens.database import ActivityLogRepository
    repo = ActivityLogRepository()
    recent = repo.get_recent(event_type="data_transformation", limit=1)
    if recent:
        return recent[0]
    return {"status": "no_transformations_run"}


@router.get("/transform/field-map")
async def field_mapping_reference():
    """Get the field mapping reference between raw and clustered collections.

    This documents the different field structures between the raw data
    collections (templates_db, posts_db) and the clustered collections
    that TrendLens expects.
    """
    return {
        "templates_db_raw_fields": {
            "caption": "or ocr_text, text_content, description",
            "category": "or niche, topic",
            "likes": "simulated likes",
            "comments": "simulated comments",
            "real_likes": "actual engagement likes",
            "real_comments": "actual engagement comments",
            "is_simulated": "whether engagement data is simulated",
            "image_url": "or image, media_url",
            "primary_confidence": "OCR confidence score",
            "owner_followers": "or followers",
            "hashtags": "or tags, tags_list",
        },
        "clustered_templates_fields": {
            "source_id": "MongoDB _id from raw collection",
            "caption": "normalized caption text",
            "category": "normalized category (cake/bakery/restaurant/general)",
            "likes": "simulated likes",
            "comments": "simulated comments",
            "real_likes": "real engagement likes",
            "real_comments": "real engagement comments",
            "is_simulated": "boolean",
            "image_url": "normalized image URL",
            "primary_confidence": "confidence score",
            "owner_followers": "follower count",
            "hashtags": "list of hashtags",
            "engagement_rate": "computed: (likes+comments)/followers",
            "label": "binary: 1=high, 0=low engagement",
            "cluster_id": "KMeans cluster assignment",
            "original_data": "preserved raw doc for auditing",
            "transformed_at": "timestamp of transformation",
        },
        "posts_db_raw_fields": {
            "caption": "or text, text_content",
            "category": "or niche",
            "likes": "engagement likes",
            "comments": "engagement comments",
            "shares": "or retweets",
            "ownerUsername": "or owner_username, username",
            "ownerFollowers": "or owner_followers, followers",
            "timestamp": "or created_at, posted_at",
            "media_url": "or image_url, image",
            "media_type": "IMAGE or VIDEO",
            "post_id": "or id, shortcode",
            "hashtags": "or tags",
        },
        "clustered_posts_fields": {
            "source_id": "MongoDB _id from raw collection",
            "caption": "normalized caption text",
            "category": "normalized category",
            "likes": "engagement likes",
            "comments": "engagement comments",
            "shares": "share count",
            "owner_username": "normalized username",
            "owner_followers": "follower count",
            "timestamp": "ISO timestamp",
            "image_url": "normalized image URL",
            "post_id": "post identifier",
            "hashtags": "list of hashtags",
            "media_type": "IMAGE or VIDEO",
            "engagement_rate": "computed: (likes+comments)/followers",
            "label": "binary: 1=high, 0=low engagement",
            "cluster_id": "KMeans cluster assignment",
            "original_data": "preserved raw doc for auditing",
            "transformed_at": "timestamp of transformation",
        },
    }


# ─── Auto-Retraining Endpoints ────────────────────────────────────────────────

@router.get("/retrain/triggers")
async def check_retrain_triggers():
    """Check all retrain triggers (drift, volume, schedule)."""
    from trendlens.auto_retraining_pipeline import AutoRetrainingPipeline
    pipeline = AutoRetrainingPipeline()
    return pipeline.check_retrain_triggers()


@router.post("/retrain/run")
async def run_retrain(force: bool = False, api_key: str = Depends(require_api_key)):
    """Trigger the auto-retraining pipeline.

    - force: Skip trigger checks and force retrain
    """
    from trendlens.auto_retraining_pipeline import AutoRetrainingPipeline

    try:
        pipeline = AutoRetrainingPipeline()
        result = pipeline.run(force=force)
        if result is None:
            return {"status": "no_retrain_needed", "message": "No retrain triggers active. Use force=true to override."}
        return result
    except Exception as exc:
        structured_log.error("Auto-retrain failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/retrain/history")
async def retrain_history(limit: int = 10):
    """Get retraining history from the model registry."""
    from trendlens.database import ModelRegistryRepository
    repo = ModelRegistryRepository()
    versions = repo.find_many(
        {"model_type": "xgboost", "auto_retrained": True},
        sort=[("trained_at", -1)],
        limit=limit,
    )
    return {"count": len(versions), "versions": versions}


# ─── Drift Detection Endpoints ────────────────────────────────────────────────

@router.get("/drift/measurements")
async def drift_measurements(limit: int = 20):
    """Get recent drift detection measurements."""
    from trendlens.auto_retraining_pipeline import DriftStateRepository
    repo = DriftStateRepository()
    measurements = repo.get_recent_measurements(limit=limit)
    return {"count": len(measurements), "measurements": measurements}


@router.get("/drift/baseline")
async def drift_baseline():
    """Get the current baseline statistics used for drift detection."""
    from trendlens.auto_retraining_pipeline import DriftStateRepository
    repo = DriftStateRepository()
    baseline = repo.get_baseline_stats()
    if baseline:
        return baseline
    return {"status": "no_baseline", "message": "Run retraining first to establish baseline statistics."}


# ─── Data Change Watcher Endpoints ────────────────────────────────────────────

@router.get("/watcher/check")
async def check_for_new_data():
    """Check if there's new untransformed data in the raw collections.

    This endpoint shows how many documents in templates_db and posts_db
    haven't been transformed yet into the clustered format.
    """
    from trendlens.data_change_watcher import DataChangeWatcher
    watcher = DataChangeWatcher()
    return watcher.check_for_new_data()


@router.post("/watcher/trigger")
async def trigger_pipeline_manually():
    """Manually trigger the full pipeline: transform → retrain.

    This does the same thing the automatic watcher does, but on demand.
    """
    from trendlens.data_change_watcher import DataChangeWatcher
    watcher = DataChangeWatcher()
    result = watcher.trigger_pipeline()
    return result


@router.post("/watcher/start")
async def start_watcher(interval_seconds: int = 60, api_key: str = Depends(require_api_key)):
    """Start the background data change watcher.

    The watcher will periodically check for new data and automatically
    trigger the transformation + retraining pipeline.
    """
    global _watcher, _watcher_thread

    if _watcher_thread and _watcher_thread.is_alive():
        return {"status": "already_running", "interval_seconds": interval_seconds}

    from trendlens.data_change_watcher import DataChangeWatcher
    _watcher = DataChangeWatcher(interval_seconds=interval_seconds, auto_retrain=True)
    _watcher_thread = _watcher.start_background()

    return {"status": "started", "interval_seconds": interval_seconds}


@router.post("/watcher/stop")
async def stop_watcher():
    """Stop the background data change watcher."""
    global _watcher, _watcher_thread

    if _watcher:
        _watcher.stop()
        return {"status": "stopped"}

    return {"status": "not_running"}


@router.get("/watcher/status")
async def watcher_status():
    """Check if the background data change watcher is running."""
    global _watcher_thread

    if _watcher_thread and _watcher_thread.is_alive():
        return {"status": "running", "thread_id": _watcher_thread.ident}
    return {"status": "not_running"}


# ─── Full Pipeline Endpoint ───────────────────────────────────────────────────

@router.post("/full")
async def run_full_pipeline(
    n_clusters: int = 8,
    engagement_threshold: float = 0.04,
    force_retrain: bool = False,
):
    """Run the full auto-improvement pipeline: transform → drift detection → retrain."""
    from trendlens.auto_retraining_pipeline import run_full_pipeline

    try:
        result = run_full_pipeline(
            n_clusters=n_clusters,
            engagement_threshold=engagement_threshold,
            force_retrain=force_retrain,
        )
        return result
    except Exception as exc:
        structured_log.error("Full pipeline failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Simulation Endpoint ──────────────────────────────────────────────────────

@router.post("/simulate")
async def run_simulation(
    iterations: int = 2,
    templates: int = 100,
    posts: int = 150,
    inject_drift: bool = True,
    clear: bool = False,
    api_key: str = Depends(require_api_key),
):
    """Run an end-to-end simulation (for demo/testing purposes).

    This seeds realistic Ugandan food business data, runs the transformation
    pipeline, triggers auto-retraining, and measures improvement.

    The simulation generates data that matches the EXACT field structures
    of templates_db and posts_db, then shows how the transformation pipeline
    correctly maps them to the clustered format.

    WARNING: This will modify database data. Use only in development/testing.
    """
    from trendlens.simulation import SimulationRunner

    try:
        runner = SimulationRunner()

        if clear:
            if os.getenv("ENVIRONMENT", "production") == "production":
                raise HTTPException(
                    status_code=403,
                    detail="clear=true is not allowed in production. Set ENVIRONMENT=development to enable."
                )
            runner._clear_simulation_data()

        # Seed
        runner.seed_data(n_templates=templates, n_posts=posts)

        # Run iterations
        for i in range(1, iterations + 1):
            if i > 1:
                runner.add_more_data(n_templates=50, n_posts=75)

            if inject_drift and i == iterations:
                runner.inject_drift(n_posts=50)

            runner.run_iteration(i)

        report = runner.generate_report()
        return {"report": report, "iterations": iterations}

    except Exception as exc:
        structured_log.error("Simulation failed", error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc))


# ─── Background Worker Control ────────────────────────────────────────────────

@router.post("/worker/start")
async def start_retrain_worker(interval_minutes: int = 30):
    """Start the background retraining worker."""
    global _worker_thread, _worker

    if _worker_thread and _worker_thread.is_alive():
        return {"status": "already_running", "interval_minutes": interval_minutes}

    from trendlens.auto_retraining_pipeline import ScheduledRetrainingWorker
    _worker = ScheduledRetrainingWorker(check_interval_minutes=interval_minutes)
    _worker_thread = threading.Thread(target=_worker.start, daemon=True)
    _worker_thread.start()

    return {"status": "started", "interval_minutes": interval_minutes}


@router.post("/worker/stop")
async def stop_retrain_worker():
    """Stop the background retraining worker."""
    global _worker_thread, _worker

    if _worker:
        _worker.stop()
        return {"status": "stopped"}

    return {"status": "not_running"}


@router.get("/worker/status")
async def worker_status():
    """Check if the background retraining worker is running."""
    global _worker_thread

    if _worker_thread and _worker_thread.is_alive():
        return {"status": "running", "thread_id": _worker_thread.ident}
    return {"status": "not_running"}
