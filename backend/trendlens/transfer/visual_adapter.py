"""
trendlens/transfer/visual_adapter.py

Visual feature adapter for poster images.

Projects CLIP 512-dim image embeddings down to a lower-dimensional space
(32-dim by default) using a PCA-like linear projection that can be trained
on labelled data.  When the adapter has not been trained it falls back to
simple truncation of the CLIP vector.

The projection matrix is persisted in MongoDB ``adapter_state`` collection
so that trained models survive process restarts.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

import numpy as np

from trendlens.config import settings
from trendlens.database import BaseRepository, get_collection
from trendlens.monitoring import structured_log

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Optional imports — graceful fallback
# ---------------------------------------------------------------------------

_sklearn_available = False

try:
    from sklearn.decomposition import PCA  # type: ignore[import-untyped]

    _sklearn_available = True
except ImportError:
    PCA = None  # type: ignore[assignment,misc]


# ---------------------------------------------------------------------------
# Repository for adapter state
# ---------------------------------------------------------------------------

class AdapterStateRepository(BaseRepository):
    """Thin wrapper around MongoDB ``adapter_state`` collection."""

    collection_name = "adapter_state"


# ---------------------------------------------------------------------------
# VisualAdapter
# ---------------------------------------------------------------------------

class VisualAdapter:
    """Transfer-learning adapter that projects high-dimensional CLIP image
    embeddings into a compact, engagement-aligned representation.

    The default projection is a simple truncation of the CLIP vector.  After
    :meth:`train` is called with labelled data the adapter fits a PCA-like
    linear projection that emphasises dimensions correlated with engagement.

    Workflow
    --------
    1. **Construct** — loads saved projection matrix from MongoDB if available.
    2. **Train** — call :meth:`train` with image URLs + binary labels.
    3. **Use** — call :meth:`adapt` to project a CLIP vector.
    """

    _STATE_KEY = "visual_adapter"

    def __init__(self, target_dim: Optional[int] = None) -> None:
        self._clip_dim: int = 512  # Standard CLIP ViT-B/32 output dim
        self._target_dim: int = target_dim or settings.VISUAL_ADAPTER_DIM
        self._projection: Optional[np.ndarray] = None  # shape (clip_dim, target_dim)
        self._mean: Optional[np.ndarray] = None  # shape (clip_dim,)
        self._trained: bool = False

        # Load previously saved state from MongoDB
        self._load_state()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def adapt(self, clip_features: np.ndarray) -> np.ndarray:
        """Project a CLIP embedding to the lower-dimensional adapted space.

        Parameters
        ----------
        clip_features:
            1-D numpy array of shape ``(512,)`` (or whatever the CLIP model
            outputs).

        Returns
        -------
        np.ndarray
            1-D array of shape ``(target_dim,)``.
        """
        clip_features = np.asarray(clip_features, dtype=np.float64).flatten()

        if self._trained and self._projection is not None:
            # Centre and project
            centred = clip_features
            if self._mean is not None:
                centred = clip_features - self._mean
            projected = centred @ self._projection
            return projected.flatten().astype(np.float32)
        else:
            # Fallback: simple truncation
            truncated = clip_features[: self._target_dim]
            # Pad if shorter than target_dim
            if len(truncated) < self._target_dim:
                padded = np.zeros(self._target_dim, dtype=np.float32)
                padded[: len(truncated)] = truncated
                return padded
            return truncated.astype(np.float32)

    def train(
        self,
        image_urls: List[str],
        labels: List[int],
        feature_extractor=None,
    ) -> None:
        """Train the projection matrix from labelled image data.

        The method extracts CLIP features for each image (using the supplied
        *feature_extractor* or a basic fallback), then fits a PCA-like
        projection that reduces dimensionality while preserving variance that
        discriminates between high- and low-engagement images.

        Parameters
        ----------
        image_urls:
            List of image URLs or local paths.
        labels:
            Corresponding binary labels — ``1`` for high engagement,
            ``0`` for low engagement.  Must be the same length as *image_urls*.
        feature_extractor:
            Optional object with an ``extract_clip(path)`` method that returns
            a 512-dim numpy array.  When not provided a zero-vector fallback
            is used.

        Raises
        ------
        ValueError
            If inputs are empty or have mismatched lengths.
        """
        if len(image_urls) != len(labels):
            raise ValueError(
                f"image_urls ({len(image_urls)}) and labels ({len(labels)}) "
                "must have the same length"
            )
        if not image_urls:
            raise ValueError("Cannot train on empty data")

        # Collect CLIP features
        clip_matrix = self._extract_clip_features(image_urls, feature_extractor)

        if clip_matrix is None or clip_matrix.shape[0] < 2:
            logger.warning("Too few valid CLIP features for PCA training")
            return

        # Fit the projection
        self._fit_projection(clip_matrix, np.array(labels))

        # Persist
        self._save_state()

        structured_log.info(
            "VisualAdapter trained",
            n_samples=clip_matrix.shape[0],
            clip_dim=self._clip_dim,
            target_dim=self._target_dim,
            method="pca" if _sklearn_available else "supervised_linear",
        )

    # ------------------------------------------------------------------
    # Internal: feature extraction
    # ------------------------------------------------------------------

    def _extract_clip_features(
        self,
        image_urls: List[str],
        feature_extractor=None,
    ) -> Optional[np.ndarray]:
        """Build a matrix of CLIP features from image URLs.

        Returns shape ``(n_valid, clip_dim)`` or ``None`` on failure.
        """
        rows: List[np.ndarray] = []

        for url in image_urls:
            try:
                if feature_extractor is not None and hasattr(feature_extractor, "extract_clip"):
                    vec = feature_extractor.extract_clip(url)
                else:
                    # No extractor available — skip this image
                    logger.debug("No feature_extractor provided — skipping %s", url[:60])
                    continue

                vec = np.asarray(vec, dtype=np.float64).flatten()
                if vec.shape[0] == self._clip_dim and np.any(vec):
                    rows.append(vec)
            except Exception as exc:
                logger.debug("CLIP extraction failed for %s: %s", url[:60], exc)
                continue

        if not rows:
            return None

        return np.vstack(rows)

    # ------------------------------------------------------------------
    # Internal: projection fitting
    # ------------------------------------------------------------------

    def _fit_projection(self, clip_matrix: np.ndarray, labels: np.ndarray) -> None:
        """Fit the linear projection from the CLIP feature matrix.

        Strategy
        --------
        1. If scikit-learn PCA is available, fit PCA for dimensionality
           reduction and then apply a supervised rotation that aligns the
           top components with the engagement label direction.
        2. Otherwise, compute a simple supervised linear projection using
           the difference between class means (Fisher-like).
        """
        self._mean = clip_matrix.mean(axis=0)

        # Centre the data
        centred = clip_matrix - self._mean

        if _sklearn_available and PCA is not None:
            try:
                self._fit_pca_projection(centred, labels)
                return
            except Exception as exc:
                logger.warning("PCA projection failed (%s) — using supervised linear", exc)

        self._fit_supervised_linear(centred, labels)

    def _fit_pca_projection(self, centred: np.ndarray, labels: np.ndarray) -> None:
        """Fit PCA on centred CLIP features and build a supervised rotation."""
        n_components = min(self._target_dim, centred.shape[1], centred.shape[0])
        pca = PCA(n_components=n_components)
        pca.fit(centred)

        # PCA components: shape (n_components, clip_dim)
        components = pca.components_  # already centred

        # Compute the supervised direction (difference of class means in
        # centred space) and rotate PCA components to partially align with it.
        pos_mask = labels == 1
        neg_mask = labels == 0
        if pos_mask.any() and neg_mask.any():
            pos_mean = centred[pos_mask].mean(axis=0)
            neg_mean = centred[neg_mask].mean(axis=0)
            supervised_dir = pos_mean - neg_mean
            supervised_dir /= np.linalg.norm(supervised_dir) + 1e-8

            # Blend: rotate each component slightly towards the supervised dir
            alpha = 0.3  # blending factor
            for i in range(components.shape[0]):
                comp = components[i]
                comp_norm = np.linalg.norm(comp)
                if comp_norm < 1e-8:
                    continue
                comp_unit = comp / comp_norm
                blended = (1 - alpha) * comp_unit + alpha * supervised_dir
                blended_norm = np.linalg.norm(blended)
                if blended_norm > 1e-8:
                    components[i] = blended / blended_norm * comp_norm

        # The projection matrix maps from clip_dim to n_components
        # Transpose components so that centred @ projection -> (n_samples, n_components)
        self._projection = components.T  # shape (clip_dim, n_components)

        # Adjust target_dim if PCA returned fewer components
        if n_components < self._target_dim:
            self._target_dim = n_components

        self._trained = True

    def _fit_supervised_linear(self, centred: np.ndarray, labels: np.ndarray) -> None:
        """Simple supervised linear projection when PCA is unavailable.

        Uses the class-mean difference as the primary direction and fills
        remaining dimensions with random orthogonal vectors.
        """
        pos_mask = labels == 1
        neg_mask = labels == 0

        directions: List[np.ndarray] = []

        if pos_mask.any() and neg_mask.any():
            pos_mean = centred[pos_mask].mean(axis=0)
            neg_mean = centred[neg_mask].mean(axis=0)
            primary = pos_mean - neg_mean
            primary_norm = np.linalg.norm(primary)
            if primary_norm > 1e-8:
                directions.append(primary / primary_norm)

        # Fill remaining dimensions with random orthonormal vectors
        clip_dim = centred.shape[1]
        n_needed = self._target_dim - len(directions)

        if n_needed > 0:
            rng = np.random.RandomState(42)
            random_basis = rng.randn(n_needed, clip_dim)
            # Gram-Schmidt orthogonalisation against existing directions
            for i in range(n_needed):
                vec = random_basis[i]
                for d in directions:
                    vec = vec - np.dot(vec, d) * d
                norm = np.linalg.norm(vec)
                if norm > 1e-8:
                    directions.append(vec / norm)
                else:
                    # Try another random vector
                    for _ in range(10):
                        vec = rng.randn(clip_dim)
                        for d in directions:
                            vec = vec - np.dot(vec, d) * d
                        norm = np.linalg.norm(vec)
                        if norm > 1e-8:
                            directions.append(vec / norm)
                            break

        if not directions:
            logger.warning("Could not build projection directions — adapter will truncate")
            self._trained = False
            return

        # Stack into projection matrix
        proj = np.vstack(directions[: self._target_dim])  # (target_dim, clip_dim)
        self._projection = proj.T  # (clip_dim, target_dim)
        self._trained = True

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _save_state(self) -> None:
        """Save the projection matrix and metadata to MongoDB."""
        try:
            repo = AdapterStateRepository()
            doc: Dict = {
                "adapter_key": self._STATE_KEY,
                "clip_dim": self._clip_dim,
                "target_dim": self._target_dim,
                "trained": self._trained,
                "mean": self._mean.tolist() if self._mean is not None else None,
                "projection": (
                    self._projection.tolist()
                    if self._projection is not None
                    else None
                ),
                "updated_at": datetime.now(timezone.utc),
            }
            repo.update_one(
                {"adapter_key": self._STATE_KEY},
                {"$set": doc},
                upsert=True,
            )
            structured_log.debug("VisualAdapter state saved to MongoDB")
        except Exception as exc:
            logger.warning("Failed to save VisualAdapter state: %s", exc)

    def _load_state(self) -> None:
        """Load previously saved projection matrix from MongoDB."""
        try:
            repo = AdapterStateRepository()
            doc = repo.find_one({"adapter_key": self._STATE_KEY})
            if doc is None:
                structured_log.debug("No saved VisualAdapter state found")
                return

            saved_clip_dim = doc.get("clip_dim", 0)
            saved_target_dim = doc.get("target_dim", 0)

            if saved_clip_dim != self._clip_dim:
                logger.info(
                    "Saved VisualAdapter clip_dim (%d) differs from current (%d) — skipping load",
                    saved_clip_dim,
                    self._clip_dim,
                )
                return

            if saved_target_dim > 0:
                self._target_dim = saved_target_dim

            if doc.get("mean") is not None:
                self._mean = np.array(doc["mean"], dtype=np.float64)

            if doc.get("projection") is not None:
                self._projection = np.array(doc["projection"], dtype=np.float64)

            self._trained = bool(doc.get("trained", False))

            structured_log.info(
                "VisualAdapter state loaded from MongoDB",
                trained=self._trained,
                target_dim=self._target_dim,
            )
        except Exception as exc:
            logger.warning("Failed to load VisualAdapter state: %s", exc)
