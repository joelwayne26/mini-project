"""
trendlens/phase7_evaluator.py
Enhanced poster evaluator with CLIP, XGBoost, OCR, transfer learning adapters,
and competitor gap features. Returns 3-tuple: (EvalScoreWithInterval, ocr_meta, annotations).
"""

import hashlib
import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from trendlens.config import settings
from trendlens.database import (
    GroundTruthRepository,
    ModelRegistryRepository,
    PostsRepository,
    UserHistoryRepository,
)
from trendlens.models import EvalScoreWithInterval, PosterAnnotation
from trendlens.monitoring import prometheus, structured_log, timing_metric
from trendlens.ocr_engine import PosterOCR
from trendlens.processors import ImageProcessor
from trendlens.text_processor import TextProcessor
from trendlens.phase5_caption_intelligence import CaptionIntelligence

logger = logging.getLogger(__name__)


# ─── Model Cache ─────────────────────────────────────────────────────────────

class ModelCache:
    """Lazy-load and cache all ML models used by the evaluator."""

    def __init__(self) -> None:
        self._clip_model = None
        self._clip_preprocess = None
        self._xgb_model = None
        self._ocr: Optional[PosterOCR] = None
        self._caption_adapter = None
        self._visual_adapter = None
        self._trend_encoder = None
        self._caption_intel: Optional[CaptionIntelligence] = None

    @property
    def clip_model(self):
        if self._clip_model is None:
            self._load_clip()
        return self._clip_model

    @property
    def clip_preprocess(self):
        if self._clip_preprocess is None:
            self._load_clip()
        return self._clip_preprocess

    @property
    def xgb_model(self):
        if self._xgb_model is None:
            self._load_xgb()
        return self._xgb_model

    @property
    def ocr(self) -> PosterOCR:
        if self._ocr is None:
            self._ocr = PosterOCR(languages=settings.OCR_LANGUAGES)
        return self._ocr

    @property
    def caption_adapter(self):
        if self._caption_adapter is None:
            self._load_caption_adapter()
        return self._caption_adapter

    @property
    def visual_adapter(self):
        if self._visual_adapter is None:
            self._load_visual_adapter()
        return self._visual_adapter

    @property
    def trend_encoder(self):
        if self._trend_encoder is None:
            self._load_trend_encoder()
        return self._trend_encoder

    @property
    def caption_intel(self) -> CaptionIntelligence:
        if self._caption_intel is None:
            self._caption_intel = CaptionIntelligence()
        return self._caption_intel

    def _load_clip(self) -> None:
        try:
            import torch
            import clip
            device = settings.CLIP_DEVICE
            model, preprocess = clip.load(settings.CLIP_MODEL_NAME, device=device)
            self._clip_model = model
            self._clip_preprocess = preprocess
            logger.info("CLIP model loaded: %s on %s", settings.CLIP_MODEL_NAME, device)
        except ImportError:
            logger.warning("clip/torch not installed — CLIP features unavailable")
        except Exception as exc:
            logger.error("CLIP loading failed: %s", exc)

    def _load_xgb(self) -> None:
        repo = ModelRegistryRepository()
        entry = repo.get_latest("xgboost")
        if entry and entry.get("path") and os.path.exists(entry["path"]):
            try:
                import xgboost as xgb
                self._xgb_model = xgb.XGBClassifier()
                self._xgb_model.load_model(entry["path"])
                logger.info("XGBoost model loaded from %s", entry["path"])
            except Exception as exc:
                logger.error("XGBoost loading failed: %s", exc)
        else:
            logger.info("No trained XGBoost model found — will use heuristic scoring")

    def _load_caption_adapter(self) -> None:
        try:
            from trendlens.transfer.caption_adapter import CaptionAdapter
            self._caption_adapter = CaptionAdapter()
            logger.info("CaptionAdapter loaded")
        except Exception as exc:
            logger.debug("CaptionAdapter not available: %s", exc)

    def _load_visual_adapter(self) -> None:
        try:
            from trendlens.transfer.visual_adapter import VisualAdapter
            self._visual_adapter = VisualAdapter()
            logger.info("VisualAdapter loaded")
        except Exception as exc:
            logger.debug("VisualAdapter not available: %s", exc)

    def _load_trend_encoder(self) -> None:
        try:
            from trendlens.transfer.trend_encoder import TrendAlignmentEncoder
            self._trend_encoder = TrendAlignmentEncoder()
            logger.info("TrendAlignmentEncoder loaded")
        except Exception as exc:
            logger.debug("TrendAlignmentEncoder not available: %s", exc)


# ─── Feature Extractor ───────────────────────────────────────────────────────

class PosterFeatureExtractor:
    """Extract all features from a poster image + caption."""

    def __init__(self, model_cache: Optional[ModelCache] = None) -> None:
        self._cache = model_cache or ModelCache()
        self._image_processor = ImageProcessor()
        self._text_processor = TextProcessor()

    @staticmethod
    def _ensure_local_image(image_url: str) -> Optional[str]:
        """Download image if URL, return local path."""
        if os.path.exists(image_url):
            return image_url
        processor = ImageProcessor()
        return processor.cache_from_url(image_url)

    @staticmethod
    def _validate_image(image_path: str) -> bool:
        """Quick validation of image file."""
        if not image_path or not os.path.exists(image_path):
            return False
        return os.path.getsize(image_path) > 0

    def extract_clip(self, image_path: str) -> np.ndarray:
        """Extract CLIP image embedding (512-dim by default)."""
        model = self._cache.clip_model
        preprocess = self._cache.clip_preprocess
        if model is None or preprocess is None:
            return np.zeros(512, dtype=np.float32)

        try:
            import torch
            device = settings.CLIP_DEVICE
            img = preprocess(self._pil_open(image_path)).unsqueeze(0).to(device)
            with torch.no_grad():
                features = model.encode_image(img)
            return features.cpu().numpy().flatten()
        except Exception as exc:
            logger.error("CLIP extraction failed: %s", exc)
            return np.zeros(512, dtype=np.float32)

    @staticmethod
    def _pil_open(path: str):
        from PIL import Image
        return Image.open(path).convert("RGB")

    def extract_style(self, image_path: str) -> np.ndarray:
        """Extract style features (color histogram, brightness, etc.)."""
        features: List[float] = []
        try:
            from PIL import Image
            import numpy as np

            img = Image.open(image_path).convert("RGB")
            arr = np.array(img)

            # Average color per channel
            for c in range(3):
                features.append(float(arr[:, :, c].mean()) / 255.0)

            # Brightness
            brightness = arr.mean() / 255.0
            features.append(float(brightness))

            # Contrast
            contrast = arr.std() / 128.0
            features.append(float(contrast))

            # Color variance per channel
            for c in range(3):
                features.append(float(arr[:, :, c].std()) / 128.0)

            # Saturation estimate
            hsv = np.array(img.convert("HSV"))
            saturation = hsv[:, :, 1].mean() / 255.0
            features.append(float(saturation))

        except Exception as exc:
            logger.debug("Style extraction failed: %s", exc)
            features = [0.0] * 9

        return np.array(features, dtype=np.float32)

    def extract_text(self, image_path: str) -> Dict[str, Any]:
        """Extract OCR features from the poster image."""
        ocr = self._cache.ocr
        dims = self._image_processor.get_image_dimensions(image_path)
        w, h = dims
        return ocr.extract_features(image_path, image_width=w, image_height=h)

    def classify_category(self, caption: str, ocr_text: str = "") -> str:
        """Classify the poster into a category based on text content."""
        combined = f"{caption} {ocr_text}".lower()

        category_keywords = {
            "cake": ["cake", "birthday", "wedding cake", "cupcake", "icing", "fondant", "bakery"],
            "bakery": ["bakery", "bread", "pastry", "croissant", "loaf", "dough", "flour"],
            "restaurant": ["restaurant", "menu", "dish", "meal", "food", "kitchen", "chef", "dining"],
        }

        scores: Dict[str, int] = {}
        for cat, keywords in category_keywords.items():
            scores[cat] = sum(1 for kw in keywords if kw in combined)

        best = max(scores, key=scores.get)  # type: ignore[arg-type]
        if scores[best] >= 2:
            return best
        return "general"

    def extract_all(
        self,
        image_url: str,
        caption: str = "",
    ) -> Dict[str, Any]:
        """Extract ALL features from a poster. Returns dict with features + image path."""
        # Ensure local image
        local_path = self._ensure_local_image(image_url)

        if local_path is None or not self._validate_image(local_path):
            logger.warning("Cannot access image: %s — using zero features", image_url)
            return {
                "clip_features": np.zeros(512, dtype=np.float32),
                "style_features": np.zeros(9, dtype=np.float32),
                "ocr_features": {},
                "caption_features": {},
                "category": "general",
                "caption_adapter_score": 0.0,
                "competitor_gap": np.zeros(10, dtype=np.float32),
                "image_path": None,
            }

        # CLIP features
        clip_vec = self.extract_clip(local_path)

        # Visual adapter projection
        visual_adapter = self._cache.visual_adapter
        if visual_adapter is not None:
            try:
                visual_vec = visual_adapter.adapt(clip_vec)
            except Exception:
                visual_vec = clip_vec[:32]
        else:
            visual_vec = clip_vec[:32]

        # Style features
        style_vec = self.extract_style(local_path)

        # OCR features
        ocr_feats = self.extract_text(local_path)

        # Caption features
        category = self.classify_category(caption, ocr_feats.get("full_text", ""))
        caption_intel = self._cache.caption_intel
        caption_feats = caption_intel.analyze(caption, category=category)

        # Caption adapter score
        adapter_score = 0.0
        caption_adapter = self._cache.caption_adapter
        if caption_adapter is not None:
            try:
                vec = caption_adapter.encode(caption)
                centroid = caption_adapter.positive_centroid
                if centroid is not None:
                    from numpy.linalg import norm
                    sim = np.dot(vec, centroid) / (norm(vec) * norm(centroid) + 1e-8)
                    adapter_score = float(sim)
            except Exception:
                adapter_score = 0.0

        # Competitor gap features
        gap_vec = np.zeros(10, dtype=np.float32)
        try:
            from trendlens.competitor_intelligence import CompetitorPatternLearner
            learner = CompetitorPatternLearner()
            learner.load_patterns(category)
            gap_vec = learner.extract_gap_features(caption_feats, category)
        except Exception:
            pass

        return {
            "clip_features": clip_vec,
            "visual_adapted": visual_vec,
            "style_features": style_vec,
            "ocr_features": ocr_feats,
            "caption_features": caption_feats,
            "category": category,
            "caption_adapter_score": adapter_score,
            "competitor_gap": gap_vec,
            "image_path": local_path,
        }


# ─── Poster Evaluator ────────────────────────────────────────────────────────

class PosterEvaluator:
    """Evaluate a poster and return score with confidence interval + annotations."""

    def __init__(
        self,
        feature_extractor: Optional[PosterFeatureExtractor] = None,
        ground_truth_repo: Optional[GroundTruthRepository] = None,
        model_registry_repo: Optional[ModelRegistryRepository] = None,
    ) -> None:
        self._extractor = feature_extractor or PosterFeatureExtractor()
        self._gt_repo = ground_truth_repo or GroundTruthRepository()
        self._model_repo = model_registry_repo or ModelRegistryRepository()
        self._model_cache = self._extractor._cache

    @timing_metric("evaluator_predict")
    def predict(
        self,
        image_url: str,
        caption: str = "",
    ) -> Tuple[EvalScoreWithInterval, Dict[str, Any], List[PosterAnnotation]]:
        """Evaluate a poster.

        Returns:
            (EvalScoreWithInterval, ocr_meta, annotations_list) — 3-tuple
        """
        structured_log.info("Evaluating poster", image_url=image_url[:80])

        # Extract features
        feats = self._extractor.extract_all(image_url, caption)
        ocr_meta = feats.get("ocr_features", {})
        image_path = feats.get("image_path")

        # Build feature vector for XGBoost
        feature_vec = self._build_feature_vector(feats)

        # Score
        xgb_model = self._model_cache.xgb_model
        if xgb_model is not None:
            try:
                import xgboost as xgb
                dmatrix = xgb.DMatrix(feature_vec.reshape(1, -1))
                raw_score = float(xgb_model.predict(dmatrix)[0])
                score = max(0.0, min(100.0, raw_score * 100))
            except Exception as exc:
                logger.debug("XGBoost prediction failed, using heuristic: %s", exc)
                score = self._heuristic_score(feats)
        else:
            score = self._heuristic_score(feats)

        # Confidence interval
        interval_width = 10.0  # Default width
        if xgb_model is not None:
            try:
                import xgboost as xgb
                dmatrix = xgb.DMatrix(feature_vec.reshape(1, -1))
                margins = xgb_model.predict(dmatrix, output_margin=True)
                interval_width = min(20.0, max(5.0, abs(float(margins[0])) * 2))
            except Exception:
                pass

        lower = max(0.0, score - interval_width / 2)
        upper = min(100.0, score + interval_width / 2)

        model_version = "heuristic"
        entry = self._model_repo.get_latest("xgboost")
        if entry:
            model_version = entry.get("version", "unknown")

        eval_score = EvalScoreWithInterval(
            score=round(score, 1),
            lower=round(lower, 1),
            upper=round(upper, 1),
            model_version=model_version,
        )

        # Generate annotations
        annotations = self._generate_annotations(feats, score, image_path)

        prometheus.inc_counter("poster_evaluated")
        structured_log.info(
            "Poster evaluation complete",
            score=score,
            category=feats.get("category", "general"),
        )

        return eval_score, ocr_meta, annotations

    def _build_feature_vector(self, feats: Dict[str, Any]) -> np.ndarray:
        """Build a flat feature vector from all extracted features."""
        parts: List[np.ndarray] = []

        # CLIP (512-dim)
        clip = feats.get("clip_features", np.zeros(512))
        parts.append(clip)

        # Visual adapted (32-dim)
        visual = feats.get("visual_adapted", np.zeros(32))
        parts.append(visual[:32])

        # Style (9-dim)
        style = feats.get("style_features", np.zeros(9))
        parts.append(style)

        # OCR numeric features
        ocr = feats.get("ocr_features", {})
        ocr_nums = np.array([
            float(ocr.get("text_box_ratio", 0)),
            float(ocr.get("safe_zone_coverage", 0)),
            float(ocr.get("has_price", 0)),
            float(ocr.get("has_cta", 0)),
            float(ocr.get("block_count", 0)) / 20.0,
            float(ocr.get("avg_confidence", 0)),
        ], dtype=np.float32)
        parts.append(ocr_nums)

        # Caption numeric features
        cap = feats.get("caption_features", {})
        cap_nums = np.array([
            float(cap.get("hashtag_count", 0)) / 20.0,
            float(cap.get("word_count", 0)) / 200.0,
            float(cap.get("emoji_count", 0)) / 10.0,
            float(cap.get("has_price", 0)),
            float(cap.get("cta", {}).get("has_cta", 0)),
            float(cap.get("sentiment", {}).get("polarity", 0)),
            float(cap.get("readability", 0)),
            float(cap.get("caption_adapter_score", 0)),
            float(cap.get("trend_alignment", {}).get("score", 0)),
            float(cap.get("caption_score", 0)) / 100.0,
        ], dtype=np.float32)
        parts.append(cap_nums)

        # Competitor gap (10-dim)
        gap = feats.get("competitor_gap", np.zeros(10))
        parts.append(gap[:10])

        return np.concatenate(parts)

    @staticmethod
    def _heuristic_score(feats: Dict[str, Any]) -> float:
        """Compute a heuristic score when no ML model is available."""
        score = 40.0  # Start with a neutral baseline

        cap = feats.get("caption_features", {})
        ocr = feats.get("ocr_features", {})

        # Hashtags
        ht_count = cap.get("hashtag_count", 0)
        if ht_count >= 8:
            score += 12
        elif ht_count >= 5:
            score += 8
        elif ht_count >= 3:
            score += 3
        else:
            score -= 5

        # CTA
        if cap.get("cta", {}).get("has_cta"):
            score += 10
        else:
            score -= 8

        # Price
        if cap.get("has_price") or ocr.get("has_price"):
            score += 8
        else:
            score -= 3

        # Caption length
        wc = cap.get("word_count", 0)
        if 50 <= wc <= 200:
            score += 8
        elif wc < 20:
            score -= 10
        elif wc > 300:
            score -= 3

        # Trend alignment
        alignment = cap.get("trend_alignment", {}).get("score", 0)
        score += alignment * 10

        # OCR quality
        if ocr.get("text_box_ratio", 0) > 0.05:
            score += 5
        if ocr.get("safe_zone_coverage", 0) > 0.1:
            score += 3

        # Sentiment
        polarity = cap.get("sentiment", {}).get("polarity", 0)
        if polarity > 0.2:
            score += 5
        elif polarity < -0.2:
            score -= 5

        # Caption adapter
        adapter_score = feats.get("caption_adapter_score", 0)
        score += adapter_score * 8

        return max(0.0, min(100.0, score))

    def _generate_annotations(
        self,
        feats: Dict[str, Any],
        score: float,
        image_path: Optional[str],
    ) -> List[PosterAnnotation]:
        """Generate poster annotations using the annotation module."""
        try:
            from trendlens.poster_annotations import PosterAnnotator
            annotator = PosterAnnotator()
            ocr_results = feats.get("ocr_features", {}).get("text_blocks", [])
            caption_feats = feats.get("caption_features", {})
            return annotator.annotate(ocr_results, caption_feats, score)
        except ImportError:
            logger.debug("PosterAnnotator not available — generating basic annotations")
            return self._basic_annotations(feats, score)

    @staticmethod
    def _basic_annotations(feats: Dict[str, Any], score: float) -> List[PosterAnnotation]:
        """Fallback annotations when PosterAnnotator is unavailable."""
        annotations: List[PosterAnnotation] = []
        cap = feats.get("caption_features", {})

        if not cap.get("has_price") and not feats.get("ocr_features", {}).get("has_price"):
            annotations.append(PosterAnnotation(
                number=1, x=0.5, y=0.7,
                title="Missing Price",
                detail="Add a clear price to increase engagement",
                severity="warning",
            ))

        if not cap.get("cta", {}).get("has_cta"):
            annotations.append(PosterAnnotation(
                number=2, x=0.5, y=0.85,
                title="No CTA",
                detail="Add a call-to-action like 'DM to order'",
                severity="warning",
            ))

        if cap.get("hashtag_count", 0) < 5:
            annotations.append(PosterAnnotation(
                number=3, x=0.9, y=0.95,
                title="Low Hashtags",
                detail=f"Only {cap.get('hashtag_count', 0)} hashtags — aim for 8+",
                severity="info",
            ))

        return annotations[:5]

    # ── Retraining ───────────────────────────────────────────────────

    @timing_metric("evaluator_retrain")
    def retrain_if_needed(self) -> Optional[Dict[str, Any]]:
        """Retrain XGBoost + adapters if enough new ground truth data is available.

        Does REAL XGBoost training with cross-validation — no fake AUC.
        """
        gt_repo = self._gt_repo
        model_repo = self._model_repo

        # Check if retrain is needed
        latest = model_repo.get_latest("xgboost")
        if latest:
            trained_at = latest.get("trained_at", "")
            if trained_at:
                try:
                    last_train = datetime.fromisoformat(trained_at)
                    hours_since = (datetime.now(timezone.utc) - last_train).total_seconds() / 3600
                    if hours_since < settings.RETRAIN_INTERVAL_HOURS:
                        logger.info("Skipping retrain — last trained %.1f hours ago", hours_since)
                        return None
                except ValueError:
                    pass

        # Load ground truth data
        labelled = gt_repo.get_labelled(min_samples=settings.RETRAIN_MIN_SAMPLES)
        if len(labelled) < settings.RETRAIN_MIN_SAMPLES:
            logger.info(
                "Not enough labelled data for retrain: %d < %d",
                len(labelled), settings.RETRAIN_MIN_SAMPLES,
            )
            return None

        structured_log.info("Starting retrain", samples=len(labelled))

        # Build training data
        X_list: List[np.ndarray] = []
        y_list: List[int] = []

        for doc in labelled:
            caption = doc.get("caption", "")
            image_url = doc.get("image_url", "")
            er = float(doc.get("engagement_rate", 0))

            try:
                feats = self._extractor.extract_all(image_url, caption)
                vec = self._build_feature_vector(feats)
                X_list.append(vec)
                # Binary label: high engagement (top 40%)
                y_list.append(1 if er >= 0.5 else 0)
            except Exception as exc:
                logger.debug("Skipping sample during retrain: %s", exc)
                continue

        if len(X_list) < settings.RETRAIN_MIN_SAMPLES:
            logger.info("Too few valid samples after feature extraction: %d", len(X_list))
            return None

        X = np.vstack(X_list)
        y = np.array(y_list)

        # Check class balance
        pos_rate = y.mean()
        if pos_rate < 0.1 or pos_rate > 0.9:
            logger.warning("Class imbalance detected: positive rate %.2f", pos_rate)

        # Train XGBoost with cross-validation
        auc_scores: List[float] = []
        try:
            import xgboost as xgb
            from sklearn.model_selection import StratifiedKFold

            skf = StratifiedKFold(n_splits=min(5, len(np.unique(y))), shuffle=True, random_state=42)

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
                model.fit(
                    X_train, y_train,
                    eval_set=[(X_val, y_val)],
                    verbose=False,
                )

                # Compute AUC on validation
                from sklearn.metrics import roc_auc_score
                y_pred_proba = model.predict_proba(X_val)[:, 1]
                fold_auc = roc_auc_score(y_val, y_pred_proba)
                auc_scores.append(fold_auc)
                logger.info("Fold %d AUC: %.4f", fold, fold_auc)

            # Train final model on all data
            final_model = xgb.XGBClassifier(**params)
            final_model.fit(X, y)

            # Save model
            model_dir = settings.MODEL_DIR
            model_dir.mkdir(parents=True, exist_ok=True)
            version = f"v{int(time.time())}"
            model_path = model_dir / f"xgboost_{version}.json"
            final_model.save_model(str(model_path))

            # Update cache
            self._model_cache._xgb_model = final_model

            # Update registry
            mean_auc = np.mean(auc_scores) if auc_scores else 0.0
            model_repo.insert_one({
                "model_type": "xgboost",
                "version": version,
                "path": str(model_path),
                "auc": float(mean_auc),
                "samples": len(X_list),
                "features": [f"f{i}" for i in range(X.shape[1])],
                "fold_aucs": [float(a) for a in auc_scores],
                "trained_at": datetime.now(timezone.utc).isoformat(),
            })

            prometheus.set_gauge("model_xgboost_auc", float(mean_auc))

        except ImportError:
            logger.warning("xgboost/sklearn not installed — cannot retrain XGBoost")
            mean_auc = 0.0
            auc_scores = []
        except Exception as exc:
            logger.error("XGBoost training failed: %s", exc)
            mean_auc = 0.0
            auc_scores = []

        # Train transfer learning adapters
        adapter_results = self._train_adapters(labelled)

        result = {
            "xgboost_auc": float(mean_auc),
            "fold_aucs": [float(a) for a in auc_scores],
            "samples": len(X_list),
            "adapters": adapter_results,
            "trained_at": datetime.now(timezone.utc).isoformat(),
        }

        structured_log.info("Retrain complete", **result)
        return result

    def _train_adapters(self, labelled: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Train all transfer learning adapters."""
        results: Dict[str, Any] = {}

        # Train CaptionAdapter
        try:
            from trendlens.transfer.caption_adapter import CaptionAdapter
            adapter = CaptionAdapter()
            captions = [d.get("caption", "") for d in labelled if d.get("caption")]
            labels = [1 if float(d.get("engagement_rate", 0)) >= 0.5 else 0 for d in labelled if d.get("caption")]
            if captions and len(captions) >= settings.RETRAIN_MIN_SAMPLES:
                adapter.train(captions, labels)
                self._model_cache._caption_adapter = adapter
                results["caption_adapter"] = "trained"
            else:
                results["caption_adapter"] = "skipped_insufficient_data"
        except Exception as exc:
            results["caption_adapter"] = f"failed: {exc}"

        # Train VisualAdapter
        try:
            from trendlens.transfer.visual_adapter import VisualAdapter
            adapter = VisualAdapter()
            image_urls = [d.get("image_url", "") for d in labelled if d.get("image_url")]
            labels = [1 if float(d.get("engagement_rate", 0)) >= 0.5 else 0 for d in labelled if d.get("image_url")]
            if image_urls and len(image_urls) >= settings.RETRAIN_MIN_SAMPLES:
                adapter.train(image_urls, labels, feature_extractor=self._extractor)
                self._model_cache._visual_adapter = adapter
                results["visual_adapter"] = "trained"
            else:
                results["visual_adapter"] = "skipped_insufficient_data"
        except Exception as exc:
            results["visual_adapter"] = f"failed: {exc}"

        # Train TrendAlignmentEncoder
        try:
            from trendlens.transfer.trend_encoder import TrendAlignmentEncoder
            encoder = TrendAlignmentEncoder()
            captions = [d.get("caption", "") for d in labelled if d.get("caption")]
            engagement = [float(d.get("engagement_rate", 0)) for d in labelled if d.get("caption")]
            if captions and len(captions) >= settings.RETRAIN_MIN_SAMPLES:
                encoder.train(captions, engagement)
                self._model_cache._trend_encoder = encoder
                results["trend_encoder"] = "trained"
            else:
                results["trend_encoder"] = "skipped_insufficient_data"
        except Exception as exc:
            results["trend_encoder"] = f"failed: {exc}"

        return results
