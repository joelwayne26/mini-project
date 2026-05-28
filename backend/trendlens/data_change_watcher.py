"""
trendlens/data_change_watcher.py
Watches for new data in templates_db and posts_db, and automatically
triggers the transformation + retraining pipeline when changes are detected.

This is the "automatic improvement" trigger: when new raw data is added,
the watcher detects it and kicks off the full pipeline so the system
self-improves without manual intervention.

Monitoring strategy:
  - Polls MongoDB collections on a configurable interval
  - Compares document counts against last-seen counts
  - Triggers DataTransformationPipeline when new untransformed docs are found
  - Optionally triggers AutoRetrainingPipeline after transformation

Usage:
  # As a background thread (within the API server):
  watcher = DataChangeWatcher(interval_seconds=60)
  watcher.start()

  # As a standalone cron script:
  watcher = DataChangeWatcher()
  watcher.check_and_trigger()
"""

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from trendlens.config import settings
from trendlens.database import BaseRepository, ActivityLogRepository, get_collection
from trendlens.monitoring import structured_log

logger = logging.getLogger(__name__)


class WatcherStateRepository(BaseRepository):
    """Persists the watcher's last-seen counts so state survives restarts."""
    collection_name = "pipeline_watcher_state"

    def get_last_counts(self) -> Dict[str, int]:
        """Get the last-seen document counts for each collection."""
        doc = self.find_one({"type": "last_counts"})
        if doc:
            return {
                "templates_db": doc.get("templates_db", 0),
                "posts_db": doc.get("posts_db", 0),
            }
        return {"templates_db": 0, "posts_db": 0}

    def save_counts(self, templates_count: int, posts_count: int) -> None:
        """Save current document counts."""
        self.update_one(
            {"type": "last_counts"},
            {"$set": {
                "type": "last_counts",
                "templates_db": templates_count,
                "posts_db": posts_count,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )


class DataChangeWatcher:
    """Watches for new data in raw collections and triggers the pipeline.

    The watcher monitors templates_db and posts_db for new documents that
    haven't been transformed yet (i.e., lack a 'transformed_at' field).
    When new data is detected, it automatically runs the transformation
    pipeline and optionally triggers auto-retraining.

    This creates the automatic improvement loop:
      New data arrives → Watcher detects it → Transformation runs →
      Drift check → Retrain if needed → System improves
    """

    def __init__(
        self,
        interval_seconds: int = 60,
        auto_retrain: bool = True,
    ) -> None:
        self.interval_seconds = interval_seconds
        self.auto_retrain = auto_retrain
        self.state_repo = WatcherStateRepository()
        self.activity_log = ActivityLogRepository()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def check_for_new_data(self) -> Dict[str, Any]:
        """Check if there's new untransformed data in the raw collections.

        Returns:
            Dict with counts of new documents and whether a pipeline run is needed.
        """
        templates_coll = get_collection("templates_db")
        posts_coll = get_collection("posts_db")

        # Count total documents
        total_templates = templates_coll.count_documents({})
        total_posts = posts_coll.count_documents({})

        # Count untransformed documents (the ones that need processing)
        untransformed_templates = templates_coll.count_documents(
            {"transformed_at": {"$exists": False}}
        )
        untransformed_posts = posts_coll.count_documents(
            {"transformed_at": {"$exists": False}}
        )

        # Get last seen counts
        last_counts = self.state_repo.get_last_counts()

        # Detect new data: either more docs than last seen, or untransformed docs exist
        new_templates = total_templates - last_counts.get("templates_db", 0)
        new_posts = total_posts - last_counts.get("posts_db", 0)

        needs_transform = untransformed_templates > 0 or untransformed_posts > 0

        result = {
            "total_templates": total_templates,
            "total_posts": total_posts,
            "untransformed_templates": untransformed_templates,
            "untransformed_posts": untransformed_posts,
            "new_templates_since_last": new_templates,
            "new_posts_since_last": new_posts,
            "needs_transform": needs_transform,
        }

        structured_log.info(
            "Data change check",
            **result,
        )

        return result

    def trigger_pipeline(self) -> Dict[str, Any]:
        """Run the full pipeline: transformation → retraining.

        This is the automatic improvement cycle triggered by new data.
        """
        from trendlens.data_transformation_pipeline import DataTransformationPipeline

        results: Dict[str, Any] = {
            "triggered_at": datetime.now(timezone.utc).isoformat(),
        }

        # Step 1: Run transformation pipeline
        structured_log.info("Auto-triggering transformation pipeline")
        transform_pipeline = DataTransformationPipeline()
        transform_result = transform_pipeline.run()
        results["transformation"] = transform_result

        # Step 2: Update counts after transformation
        templates_coll = get_collection("templates_db")
        posts_coll = get_collection("posts_db")
        self.state_repo.save_counts(
            templates_coll.count_documents({}),
            posts_coll.count_documents({}),
        )

        # Step 3: Optionally trigger auto-retraining
        if self.auto_retrain:
            from trendlens.auto_retraining_pipeline import AutoRetrainingPipeline

            structured_log.info("Auto-triggering retraining check")
            retrain_pipeline = AutoRetrainingPipeline()

            # Check triggers first
            triggers = retrain_pipeline.check_retrain_triggers()
            results["retrain_triggers"] = triggers

            if triggers["needs_retrain"]:
                retrain_result = retrain_pipeline.run(force=False)
                results["retraining"] = retrain_result
            else:
                results["retraining"] = {"status": "no_retrain_needed"}

        # Log the event
        self.activity_log.log_event(
            event_type="auto_pipeline_trigger",
            message=f"Auto-pipeline triggered: {transform_result.get('templates_transformed', 0)} templates, "
                    f"{transform_result.get('posts_transformed', 0)} posts transformed",
            metadata=results,
        )

        return results

    def check_and_trigger(self) -> Optional[Dict[str, Any]]:
        """Check for new data and trigger the pipeline if needed.

        This is the main entry point for the watcher — can be called
        from a cron job or background thread.

        Returns:
            Pipeline results if triggered, None if no new data.
        """
        check_result = self.check_for_new_data()

        if not check_result["needs_transform"]:
            structured_log.info("No new data to transform — skipping pipeline")
            return None

        structured_log.info(
            "New data detected! Triggering pipeline",
            untransformed_templates=check_result["untransformed_templates"],
            untransformed_posts=check_result["untransformed_posts"],
        )

        return self.trigger_pipeline()

    def start(self) -> None:
        """Start the background watcher (blocking)."""
        self._running = True
        structured_log.info(
            "Data change watcher started",
            interval_seconds=self.interval_seconds,
            auto_retrain=self.auto_retrain,
        )

        while self._running:
            try:
                self.check_and_trigger()
            except Exception as exc:
                structured_log.error("Watcher error", error=str(exc))

            time.sleep(self.interval_seconds)

    def start_background(self) -> threading.Thread:
        """Start the watcher as a background daemon thread."""
        if self._thread and self._thread.is_alive():
            return self._thread

        self._thread = threading.Thread(target=self.start, daemon=True)
        self._thread.start()
        return self._thread

    def stop(self) -> None:
        """Stop the background watcher."""
        self._running = False
        structured_log.info("Data change watcher stopped")
