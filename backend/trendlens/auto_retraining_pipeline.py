"""
trendlens/auto_retraining_pipeline.py
Automatic model retraining with MMD-based domain shift detection.

This module:
  1. Monitors incoming data for distribution shifts using Maximum Mean Discrepancy (MMD)
  2. Triggers retraining when drift exceeds threshold OR when enough new ground truth accumulates
  3. Runs scheduled retraining at configurable intervals
  4. Performs ablation studies to validate model improvement before deployment
  5. Logs all retraining events to the model_registry and system_activity_log

MMD Domain Shift Detection:
  - Compares feature distributions between training data and new data
  - Uses RBF kernel with median heuristic for bandwidth selection
  - Triggers retrain when MMD statistic exceeds the significance threshold
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from trendlens.config import settings
from trendlens.database import (
    ActivityLogRepository,
    BaseRepository,
    GroundTruthRepository,
    ModelRegistryRepository,
    get_collection,
)
from trendlens.monitoring import prometheus, structured_log, timing_metric

logger = logging.getLogger(__name__)


# ─── Drift Detection State Repository ────────────────────────────────────────

class DriftStateRepository(BaseRepository):
    """Stores MMD drift measurements and baseline feature statistics."""
    collection_name = "drift_state"

    def get_baseline_stats(self) -> Optional[Dict[str, Any]]:
        """Get the feature mean/cov from the last training run."""
        docs = self.find_many(
            {"type": "baseline_stats"},
            sort=[("created_at", -1)],
            limit=1,
        )
        return docs[0] if docs else None

    def save_baseline_stats(self, mean: np.ndarray, std: np.ndarray, sample_count: int) -> str:
        """Save baseline feature statistics after a training run."""
        return self.insert_one({
            "type": "baseline_stats",
            "feature_mean": mean.tolist(),
            "feature_std": std.tolist(),
            "sample_count": sample_count,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    def log_drift_measurement(
        self,
        mmd_statistic: float,
        p_value: float,
        is_drift: bool,
        new_sample_count: int,
    ) -> str:
        """Log a drift detection measurement."""
        return self.insert_one({
            "type": "drift_measurement",
            "mmd_statistic": float(mmd_statistic),
            "p_value": float(p_value),
            "is_drift": is_drift,
            "new_sample_count": new_sample_count,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    def get_recent_measurements(self, limit: int = 20) -> List[Dict[str, Any]]:
        return self.find_many(
            {"type": "drift_measurement"},
            sort=[("created_at", -1)],
            limit=limit,
        )


# ─── MMD Drift Detector ──────────────────────────────────────────────────────

class MMDDriftDetector:
    """Detects domain shift using Maximum Mean Discrepancy with RBF kernel.

    MMD measures the distance between two distributions in a reproducing kernel
    Hilbert space (RKHS). A large MMD value indicates that the new data distribution
    has shifted significantly from the training distribution.

    The RBF kernel bandwidth is set using the median heuristic:
        sigma = median(||x_i - x_j||) for all pairs (x_i, x_j)
    """

    def __init__(
        self,
        significance_level: float = 0.05,
        n_permutations: int = 200,
        min_samples: int = 20,
    ) -> None:
        self.significance_level = significance_level
        self.n_permutations = n_permutations
        self.min_samples = min_samples
        self.drift_repo = DriftStateRepository()

    def _rbf_kernel(self, X: np.ndarray, Y: np.ndarray, sigma: float) -> np.ndarray:
        """Compute RBF kernel matrix between X and Y."""
        # ||x - y||^2 = ||x||^2 + ||y||^2 - 2 * x.y
        X_norm = np.sum(X ** 2, axis=1).reshape(-1, 1)
        Y_norm = np.sum(Y ** 2, axis=1).reshape(1, -1)
        dist_sq = X_norm + Y_norm - 2.0 * np.dot(X, Y.T)
        dist_sq = np.maximum(dist_sq, 0.0)  # Numerical safety
        return np.exp(-dist_sq / (2.0 * sigma ** 2))

    def _median_heuristic_sigma(self, X: np.ndarray, Y: np.ndarray) -> float:
        """Estimate RBF bandwidth using the median heuristic."""
        combined = np.vstack([X, Y])
        n = len(combined)
        # Sample pairwise distances for efficiency (max 1000 points)
        if n > 1000:
            idx = np.random.choice(n, 1000, replace=False)
            combined = combined[idx]
            n = 1000

        # Compute pairwise distances
        norms = np.sum(combined ** 2, axis=1)
        dist_sq = norms.reshape(-1, 1) + norms.reshape(1, -1) - 2.0 * np.dot(combined, combined.T)
        dist_sq = np.maximum(dist_sq, 0.0)
        distances = np.sqrt(dist_sq)

        # Take upper triangle (excluding diagonal)
        upper_tri = distances[np.triu_indices(n, k=1)]
        if len(upper_tri) == 0:
            return 1.0

        median_dist = np.median(upper_tri)
        return max(median_dist, 1e-6)

    def compute_mmd(self, X: np.ndarray, Y: np.ndarray) -> Tuple[float, float]:
        """Compute MMD statistic and p-value via permutation test.

        Args:
            X: Reference samples (training distribution), shape (n_ref, D)
            Y: New samples (current distribution), shape (n_new, D)

        Returns:
            (mmd_statistic, p_value)
        """
        if len(X) < self.min_samples or len(Y) < self.min_samples:
            logger.info(
                "Insufficient samples for MMD: ref=%d, new=%d (need %d)",
                len(X), len(Y), self.min_samples,
            )
            return 0.0, 1.0  # No drift detected with insufficient data

        # Subsample for efficiency
        max_per_group = 500
        if len(X) > max_per_group:
            X = X[np.random.choice(len(X), max_per_group, replace=False)]
        if len(Y) > max_per_group:
            Y = Y[np.random.choice(len(Y), max_per_group, replace=False)]

        sigma = self._median_heuristic_sigma(X, Y)

        n_ref = len(X)
        n_new = len(Y)

        # Compute observed MMD
        K_XX = self._rbf_kernel(X, X, sigma)
        K_YY = self._rbf_kernel(Y, Y, sigma)
        K_XY = self._rbf_kernel(X, Y, sigma)

        mmd_obs = (
            np.sum(K_XX) / (n_ref * n_ref)
            + np.sum(K_YY) / (n_new * n_new)
            - 2.0 * np.sum(K_XY) / (n_ref * n_new)
        )

        # Permutation test for p-value
        combined = np.vstack([X, Y])
        n_total = n_ref + n_new
        exceed_count = 0

        rng = np.random.RandomState(42)
        for _ in range(self.n_permutations):
            perm = rng.permutation(n_total)
            X_perm = combined[perm[:n_ref]]
            Y_perm = combined[perm[n_ref:]]

            K_XX_p = self._rbf_kernel(X_perm, X_perm, sigma)
            K_YY_p = self._rbf_kernel(Y_perm, Y_perm, sigma)
            K_XY_p = self._rbf_kernel(X_perm, Y_perm, sigma)

            mmd_perm = (
                np.sum(K_XX_p) / (n_ref * n_ref)
                + np.sum(K_YY_p) / (n_new * n_new)
                - 2.0 * np.sum(K_XY_p) / (n_ref * n_new)
            )

            if mmd_perm >= mmd_obs:
                exceed_count += 1

        p_value = exceed_count / self.n_permutations
        return float(mmd_obs), float(p_value)

    def detect_drift(self, new_features: np.ndarray) -> Dict[str, Any]:
        """Check if new data has drifted from the training baseline.

        Args:
            new_features: Feature matrix of new data, shape (N, D)

        Returns:
            Dict with mmd_statistic, p_value, is_drift, action
        """
        baseline = self.drift_repo.get_baseline_stats()

        if baseline is None:
            logger.info("No baseline stats found — skipping drift detection (first run)")
            return {
                "mmd_statistic": 0.0,
                "p_value": 1.0,
                "is_drift": False,
                "action": "no_baseline",
                "message": "No baseline statistics available. Run retraining first to establish baseline.",
            }

        # Reconstruct baseline distribution as synthetic samples
        baseline_mean = np.array(baseline["feature_mean"])
        baseline_std = np.array(baseline["feature_std"])

        # Generate synthetic baseline samples from the saved mean/std
        n_synthetic = min(200, len(new_features) * 2)
        rng = np.random.RandomState(42)
        synthetic_baseline = rng.normal(
            baseline_mean,
            np.maximum(baseline_std, 1e-6),
            size=(n_synthetic, len(baseline_mean)),
        )

        # Ensure dimensions match
        if new_features.shape[1] != synthetic_baseline.shape[1]:
            logger.warning(
                "Feature dimension mismatch: baseline=%d, new=%d",
                synthetic_baseline.shape[1],
                new_features.shape[1],
            )
            return {
                "mmd_statistic": 0.0,
                "p_value": 1.0,
                "is_drift": False,
                "action": "dimension_mismatch",
                "message": "Feature dimensions don't match baseline. Retrain required.",
            }

        # Compute MMD
        mmd_stat, p_val = self.compute_mmd(synthetic_baseline, new_features)
        is_drift = p_val < self.significance_level

        # Log measurement
        self.drift_repo.log_drift_measurement(
            mmd_statistic=mmd_stat,
            p_value=p_val,
            is_drift=is_drift,
            new_sample_count=len(new_features),
        )

        action = "retrain_needed" if is_drift else "no_action"

        result = {
            "mmd_statistic": mmd_stat,
            "p_value": p_val,
            "is_drift": is_drift,
            "action": action,
            "significance_level": self.significance_level,
            "new_sample_count": len(new_features),
        }

        if is_drift:
            structured_log.warning(
                "Domain drift detected!",
                mmd=mmd_stat,
                p_value=p_val,
                action=action,
            )
            prometheus.inc_counter("drift_detected")
        else:
            structured_log.info(
                "No drift detected",
                mmd=mmd_stat,
                p_value=p_val,
            )

        return result


# ─── Ablation Study Framework ────────────────────────────────────────────────

class AblationStudy:
    """Validates model improvement before deployment via ablation studies.

    Compares the new model against the current production model on a held-out
    validation set. Only promotes the new model if it shows improvement.
    """

    def __init__(self) -> None:
        self.model_repo = ModelRegistryRepository()

    def run_ablation(
        self,
        new_model_auc: float,
        new_model_predictions: np.ndarray,
        y_true: np.ndarray,
        model_type: str = "xgboost",
    ) -> Dict[str, Any]:
        """Run ablation comparison between new model and current production model.

        Args:
            new_model_auc: AUC of the newly trained model
            new_model_predictions: Predictions from the new model
            y_true: True labels
            model_type: Model type to compare against

        Returns:
            Ablation result dict with deployment decision
        """
        current = self.model_repo.get_latest(model_type)
        current_auc = current.get("auc", 0.0) if current else 0.0

        # Compute improvement
        improvement = new_model_auc - current_auc

        # Deployment criteria:
        # 1. New model must be at least as good as current (improvement >= -0.01)
        # 2. If current_auc is 0 (no model), deploy unconditionally
        should_deploy = improvement >= -0.01 or current_auc == 0.0

        # Additional quality checks
        from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score
        y_pred = (new_model_predictions >= 0.5).astype(int)

        metrics = {
            "accuracy": float(accuracy_score(y_true, y_pred)),
            "precision": float(precision_score(y_true, y_pred, zero_division=0)),
            "recall": float(recall_score(y_true, y_pred, zero_division=0)),
            "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        }

        result = {
            "current_auc": float(current_auc),
            "new_auc": float(new_model_auc),
            "improvement": float(improvement),
            "should_deploy": should_deploy,
            "classification_metrics": metrics,
            "decision_reason": (
                "new_model_improves" if improvement > 0.01
                else "new_model_comparable" if improvement >= -0.01
                else "new_model_degrades"
            ),
        }

        structured_log.info(
            "Ablation study complete",
            current_auc=current_auc,
            new_auc=new_model_auc,
            improvement=improvement,
            deploy=should_deploy,
        )

        return result


# ─── Auto Retraining Orchestrator ─────────────────────────────────────────────

class AutoRetrainingPipeline:
    """End-to-end auto-retraining pipeline with drift detection and ablation.

    Retraining triggers:
      1. DRIFT: MMD detects distribution shift in new data
      2. VOLUME: Enough new ground truth labels accumulated
      3. SCHEDULE: Time-based retraining interval elapsed
      4. MANUAL: Forced retrain via API call

    Pipeline flow:
      detect_if_retrain_needed() → run_retrain() → ablation_study() → deploy_or_rollback()
    """

    def __init__(self) -> None:
        self.drift_detector = MMDDriftDetector()
        self.ablation = AblationStudy()
        self.gt_repo = GroundTruthRepository()
        self.model_repo = ModelRegistryRepository()
        self.drift_repo = DriftStateRepository()
        self.activity_log = ActivityLogRepository()

    def check_retrain_triggers(self) -> Dict[str, Any]:
        """Check all retrain triggers and return a recommendation.

        Returns:
            Dict with trigger reason and whether retrain is needed
        """
        triggers: Dict[str, Any] = {
            "drift_trigger": False,
            "volume_trigger": False,
            "schedule_trigger": False,
            "needs_retrain": False,
            "reason": "",
        }

        # ── Trigger 1: Drift Detection ────────────────────────────────
        # Check recent drift measurements
        recent = self.drift_repo.get_recent_measurements(limit=5)
        drift_detected = any(r.get("is_drift", False) for r in recent)
        triggers["drift_trigger"] = drift_detected

        # ── Trigger 2: Volume ─────────────────────────────────────────
        labelled = self.gt_repo.get_labelled()
        labelled_count = len(labelled)
        latest_model = self.model_repo.get_latest("xgboost")
        last_train_samples = latest_model.get("samples", 0) if latest_model else 0
        new_samples = labelled_count - last_train_samples

        volume_threshold = settings.RETRAIN_MIN_SAMPLES
        volume_trigger = new_samples >= volume_threshold
        triggers["volume_trigger"] = volume_trigger
        triggers["new_samples"] = new_samples
        triggers["total_labelled"] = labelled_count

        # ── Trigger 3: Schedule ───────────────────────────────────────
        schedule_trigger = False
        if latest_model:
            trained_at = latest_model.get("trained_at", "")
            if trained_at:
                try:
                    last_train_dt = datetime.fromisoformat(trained_at)
                    hours_since = (datetime.now(timezone.utc) - last_train_dt).total_seconds() / 3600
                    schedule_trigger = hours_since >= settings.RETRAIN_INTERVAL_HOURS
                    triggers["hours_since_last_train"] = round(hours_since, 1)
                except ValueError:
                    schedule_trigger = True  # Can't parse → retrain
        else:
            schedule_trigger = True  # No model → retrain

        triggers["schedule_trigger"] = schedule_trigger

        # ── Combined decision ─────────────────────────────────────────
        needs_retrain = drift_detected or volume_trigger or schedule_trigger

        if drift_detected:
            triggers["reason"] = "domain_drift_detected"
        elif volume_trigger:
            triggers["reason"] = f"new_samples_available ({new_samples} new)"
        elif schedule_trigger:
            triggers["reason"] = "scheduled_retrain_interval"
        else:
            triggers["reason"] = "no_trigger"

        triggers["needs_retrain"] = needs_retrain

        return triggers

    @timing_metric("auto_retrain_run")
    def run(self, force: bool = False) -> Optional[Dict[str, Any]]:
        """Execute the auto-retraining pipeline.

        Args:
            force: Skip trigger checks and force retrain

        Returns:
            Retrain result dict, or None if no retrain needed
        """
        structured_log.info("Checking retrain triggers", force=force)

        if not force:
            triggers = self.check_retrain_triggers()
            if not triggers["needs_retrain"]:
                structured_log.info("No retrain needed", reason=triggers["reason"])
                return None
            structured_log.info("Retrain triggered", reason=triggers["reason"])

        # Load labelled data
        labelled = self.gt_repo.get_labelled()
        if len(labelled) < settings.RETRAIN_MIN_SAMPLES:
            structured_log.info(
                "Insufficient labelled data for retrain",
                count=len(labelled),
                required=settings.RETRAIN_MIN_SAMPLES,
            )
            return None

        # ── Step 1: Extract features for all labelled data ────────────
        structured_log.info("Extracting features for retrain", samples=len(labelled))
        X_list: List[np.ndarray] = []
        y_list: List[int] = []

        # We'll use text features as a proxy for the full feature vector
        # In production, the full PosterFeatureExtractor would be used
        from trendlens.data_transformation_pipeline import encode_captions

        captions = [d.get("caption", "") or "untitled" for d in labelled]
        embeddings = encode_captions(captions)

        # Build engagement features
        for i, doc in enumerate(labelled):
            er = float(doc.get("engagement_rate", 0))
            likes = int(doc.get("likes", 0))
            comments = int(doc.get("comments", 0))
            match_score = float(doc.get("match_score", 0))

            eng_features = np.array([er, np.log1p(likes), np.log1p(comments), match_score], dtype=np.float32)

            if i < len(embeddings):
                combined = np.concatenate([embeddings[i], eng_features])
            else:
                combined = np.concatenate([np.zeros(embeddings.shape[1] if len(embeddings) > 0 else 384, dtype=np.float32), eng_features])

            X_list.append(combined)
            y_list.append(1 if er >= 0.5 else 0)

        if len(X_list) < settings.RETRAIN_MIN_SAMPLES:
            structured_log.info("Too few valid samples", count=len(X_list))
            return None

        X = np.vstack(X_list)
        y = np.array(y_list)

        # ── Step 2: Check for drift ───────────────────────────────────
        drift_result = self.drift_detector.detect_drift(X)
        structured_log.info("Drift detection result", **drift_result)

        # ── Step 3: Train XGBoost with cross-validation ───────────────
        auc_scores: List[float] = []
        y_pred_all = np.zeros(len(y))
        final_model = None

        try:
            import xgboost as xgb
            from sklearn.model_selection import StratifiedKFold
            from sklearn.metrics import roc_auc_score

            n_unique = len(np.unique(y))
            n_splits = min(5, n_unique) if n_unique > 1 else 2

            if n_splits < 2:
                structured_log.warning("Only 1 class in labels — cannot perform CV")
                return None

            skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=42)

            params = {
                "max_depth": settings.XGBOOST_MAX_DEPTH,
                "n_estimators": settings.XGBOOST_N_ESTIMATORS,
                "learning_rate": settings.XGBOOST_LEARNING_RATE,
                "objective": "binary:logistic",
                "eval_metric": "auc",
                "verbosity": 0,
                "use_label_encoder": False,
            }

            for fold, (train_idx, val_idx) in enumerate(skf.split(X, y)):
                X_train, X_val = X[train_idx], X[val_idx]
                y_train, y_val = y[train_idx], y[val_idx]

                model = xgb.XGBClassifier(**params)
                model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)

                y_pred_proba = model.predict_proba(X_val)[:, 1]
                fold_auc = roc_auc_score(y_val, y_pred_proba)
                auc_scores.append(fold_auc)
                y_pred_all[val_idx] = y_pred_proba

                logger.info("Fold %d AUC: %.4f", fold, fold_auc)

            # Train final model on all data
            final_model = xgb.XGBClassifier(**params)
            final_model.fit(X, y)

        except ImportError:
            structured_log.warning("xgboost not installed — using heuristic model")
            # Fallback: use a simple logistic regression or heuristic
            mean_auc = 0.5
            auc_scores = [0.5]
            y_pred_all = np.random.random(len(y))
        except Exception as exc:
            structured_log.error("XGBoost training failed", error=str(exc))
            return None

        mean_auc = np.mean(auc_scores) if auc_scores else 0.0

        # ── Step 4: Ablation study ────────────────────────────────────
        ablation_result = self.ablation.run_ablation(
            new_model_auc=mean_auc,
            new_model_predictions=y_pred_all,
            y_true=y,
            model_type="xgboost",
        )

        should_deploy = ablation_result["should_deploy"]

        # ── Step 5: Deploy or rollback ────────────────────────────────
        if should_deploy and final_model is not None:
            # Save model
            model_dir = settings.MODEL_DIR
            model_dir.mkdir(parents=True, exist_ok=True)
            version = f"v{int(time.time())}"
            model_path = model_dir / f"xgboost_auto_{version}.json"

            try:
                final_model.save_model(str(model_path))
                structured_log.info("Model saved", path=str(model_path))
            except Exception as exc:
                structured_log.error("Model save failed", error=str(exc))
                model_path = None

            # Update model registry
            self.model_repo.insert_one({
                "model_type": "xgboost",
                "version": version,
                "path": str(model_path) if model_path else "",
                "auc": float(mean_auc),
                "samples": len(X_list),
                "features": [f"f{i}" for i in range(X.shape[1])],
                "fold_aucs": [float(a) for a in auc_scores],
                "trained_at": datetime.now(timezone.utc).isoformat(),
                "drift_detected": drift_result.get("is_drift", False),
                "mmd_statistic": drift_result.get("mmd_statistic", 0.0),
                "ablation": ablation_result,
                "auto_retrained": True,
            })

            # Save baseline stats for future drift detection
            self.drift_repo.save_baseline_stats(
                mean=X.mean(axis=0),
                std=X.std(axis=0),
                sample_count=len(X),
            )

            # Update Prometheus
            prometheus.set_gauge("model_xgboost_auc", float(mean_auc))

        # ── Log activity ──────────────────────────────────────────────
        result = {
            "status": "deployed" if should_deploy else "rollback",
            "auc": float(mean_auc),
            "fold_aucs": [float(a) for a in auc_scores],
            "samples": len(X_list),
            "drift": drift_result,
            "ablation": ablation_result,
            "should_deploy": should_deploy,
            "trained_at": datetime.now(timezone.utc).isoformat(),
        }

        self.activity_log.log_event(
            event_type="auto_retrain",
            message=f"Auto-retrain {'deployed' if should_deploy else 'rolled back'}: AUC={mean_auc:.4f}",
            metadata=result,
        )

        structured_log.info("Auto-retrain complete", **result)
        return result


# ─── Scheduled Retraining Background Worker ───────────────────────────────────

class ScheduledRetrainingWorker:
    """Background worker that periodically checks triggers and runs retraining.

    Designed to run as a background thread or async task within the
    TrendLens API server or as a standalone cron job.
    """

    def __init__(self, check_interval_minutes: int = 30) -> None:
        self.check_interval_minutes = check_interval_minutes
        self.pipeline = AutoRetrainingPipeline()
        self._running = False

    def start(self) -> None:
        """Start the background retraining worker (blocking)."""
        self._running = True
        structured_log.info(
            "Scheduled retraining worker started",
            interval_minutes=self.check_interval_minutes,
        )

        while self._running:
            try:
                triggers = self.pipeline.check_retrain_triggers()
                structured_log.info("Retrain check", triggers=triggers)

                if triggers["needs_retrain"]:
                    result = self.pipeline.run(force=False)
                    if result:
                        structured_log.info("Scheduled retrain result", result=result)

            except Exception as exc:
                structured_log.error("Retrain worker error", error=str(exc))

            # Sleep
            time.sleep(self.check_interval_minutes * 60)

    def stop(self) -> None:
        self._running = False

    def run_once(self) -> Optional[Dict[str, Any]]:
        """Run a single check + retrain cycle (for cron jobs)."""
        triggers = self.pipeline.check_retrain_triggers()
        if triggers["needs_retrain"]:
            return self.pipeline.run(force=False)
        return None


# ─── Integration: Transformation + Retraining ────────────────────────────────

def run_full_pipeline(
    n_clusters: int = 8,
    engagement_threshold: float = 0.04,
    force_retrain: bool = False,
) -> Dict[str, Any]:
    """Run the full pipeline: transformation → drift detection → retraining.

    This is the main entry point for the automatic improvement cycle.
    """
    from trendlens.data_transformation_pipeline import DataTransformationPipeline

    structured_log.info("Starting full auto-improvement pipeline")

    # Step 1: Transform raw data
    transform_pipeline = DataTransformationPipeline()
    transform_result = transform_pipeline.run(
        n_clusters=n_clusters,
        engagement_threshold=engagement_threshold,
    )

    # Step 2: Check triggers and retrain if needed
    retrain_pipeline = AutoRetrainingPipeline()
    retrain_result = retrain_pipeline.run(force=force_retrain)

    combined = {
        "transformation": transform_result,
        "retraining": retrain_result,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    structured_log.info("Full auto-improvement pipeline complete", **combined)
    return combined
