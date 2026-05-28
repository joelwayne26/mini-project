"""
trendlens/transfer/caption_adapter.py

Transfer-learning adapter for caption embeddings.

Uses SBERT (sentence-transformers) to encode captions into dense embeddings,
then computes positive / negative centroids from high- and low-engagement
examples.  Falls back to TF-IDF (sklearn) when SBERT is unavailable.

State (centroids + encoder metadata) is persisted in MongoDB
``adapter_state`` collection so that trained models survive process restarts.
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
# Optional heavy imports — graceful fallback
# ---------------------------------------------------------------------------

_sbert_available = False
_sbert_model = None

try:
    from sentence_transformers import SentenceTransformer  # type: ignore[import-untyped]

    _sbert_available = True
except ImportError:
    SentenceTransformer = None  # type: ignore[assignment,misc]

_tfidf_available = False

try:
    from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore[import-untyped]

    _tfidf_available = True
except ImportError:
    TfidfVectorizer = None  # type: ignore[assignment,misc]


# ---------------------------------------------------------------------------
# Repository for adapter state
# ---------------------------------------------------------------------------

class AdapterStateRepository(BaseRepository):
    """Thin wrapper around MongoDB ``adapter_state`` collection."""

    collection_name = "adapter_state"


# ---------------------------------------------------------------------------
# CaptionAdapter
# ---------------------------------------------------------------------------

class CaptionAdapter:
    """Transfer-learning adapter that maps captions to engagement-aligned
    embeddings and scores them against trained centroids.

    Workflow
    --------
    1. **Construct** — loads saved centroids from MongoDB if available.
    2. **Train** — call :meth:`train` with labelled captions to fit centroids.
    3. **Use** — call :meth:`encode` to get embeddings and
       :meth:`alignment_score` to measure similarity to a reference.

    When SBERT is not installed the adapter automatically falls back to
    a TF-IDF vectoriser from scikit-learn.  If neither is available a
    deterministic hash-based encoding is used as a last resort.
    """

    # Collection key used to store / retrieve this adapter's state in MongoDB
    _STATE_KEY = "caption_adapter"

    def __init__(self) -> None:
        self._positive_centroid: Optional[np.ndarray] = None
        self._negative_centroid: Optional[np.ndarray] = None
        self._encoder_mode: str = "none"  # "sbert" | "tfidf" | "hash"
        self._sbert_model: Optional[object] = None
        self._tfidf_vectorizer: Optional[object] = None
        self._embedding_dim: int = 0

        # Attempt to initialise the best available encoder
        self._init_encoder()

        # Load previously saved state from MongoDB
        self._load_state()

    # ------------------------------------------------------------------
    # Encoder initialisation
    # ------------------------------------------------------------------

    def _init_encoder(self) -> None:
        """Pick the best available text encoder (SBERT > TF-IDF > hash)."""
        if _sbert_available and SentenceTransformer is not None:
            try:
                self._sbert_model = SentenceTransformer(settings.SBERT_MODEL_NAME)
                # Determine embedding dimension from a dummy encode
                test_emb = self._sbert_model.encode(["test"], show_progress_bar=False)
                self._embedding_dim = test_emb.shape[1]
                self._encoder_mode = "sbert"
                structured_log.info(
                    "CaptionAdapter: SBERT encoder initialised",
                    model=settings.SBERT_MODEL_NAME,
                    dim=self._embedding_dim,
                )
                return
            except Exception as exc:
                logger.warning("SBERT init failed (%s) — falling back", exc)

        if _tfidf_available and TfidfVectorizer is not None:
            try:
                self._tfidf_vectorizer = TfidfVectorizer(
                    max_features=settings.ADAPTER_DIM,
                    stop_words="english",
                )
                self._embedding_dim = settings.ADAPTER_DIM
                self._encoder_mode = "tfidf"
                structured_log.info(
                    "CaptionAdapter: TF-IDF fallback encoder initialised",
                    dim=self._embedding_dim,
                )
                return
            except Exception as exc:
                logger.warning("TF-IDF init failed (%s) — falling back to hash", exc)

        # Last resort: deterministic hash-based encoding
        self._embedding_dim = settings.ADAPTER_DIM
        self._encoder_mode = "hash"
        structured_log.warning(
            "CaptionAdapter: no SBERT or TF-IDF — using hash encoding",
            dim=self._embedding_dim,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def positive_centroid(self) -> Optional[np.ndarray]:
        """The centroid of high-engagement caption embeddings (read-only)."""
        return self._positive_centroid

    @property
    def negative_centroid(self) -> Optional[np.ndarray]:
        """The centroid of low-engagement caption embeddings (read-only)."""
        return self._negative_centroid

    def encode(self, caption: str) -> np.ndarray:
        """Encode a single caption into a fixed-size embedding vector.

        Parameters
        ----------
        caption:
            The caption text to encode.

        Returns
        -------
        np.ndarray
            1-D embedding array of shape ``(embedding_dim,)``.
        """
        return self._encode_batch([caption])[0]

    def alignment_score(self, caption: str, reference: str) -> float:
        """Compute cosine similarity between a caption and a reference string.

        Both texts are encoded into the same embedding space and their cosine
        similarity is returned.

        Parameters
        ----------
        caption:
            The caption to score.
        reference:
            The reference text (e.g. a high-engagement caption or keyword).

        Returns
        -------
        float
            Cosine similarity in ``[-1, 1]``.  Returns ``0.0`` on error.
        """
        try:
            vec_a = self.encode(caption)
            vec_b = self.encode(reference)
            norm_a = np.linalg.norm(vec_a)
            norm_b = np.linalg.norm(vec_b)
            if norm_a < 1e-8 or norm_b < 1e-8:
                return 0.0
            return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))
        except Exception as exc:
            logger.debug("alignment_score failed: %s", exc)
            return 0.0

    def train(self, captions: List[str], labels: List[int]) -> None:
        """Fit centroids from labelled caption data.

        Parameters
        ----------
        captions:
            List of caption strings.
        labels:
            Corresponding binary labels — ``1`` for high engagement,
            ``0`` for low engagement.  Must be the same length as *captions*.

        Raises
        ------
        ValueError
            If *captions* and *labels* have different lengths or are empty.
        """
        if len(captions) != len(labels):
            raise ValueError(
                f"captions ({len(captions)}) and labels ({len(labels)}) must have the same length"
            )
        if not captions:
            raise ValueError("Cannot train on empty data")

        # Encode all captions
        embeddings = self._encode_batch(captions)

        # For TF-IDF mode the vectorizer must be fitted first
        # (already done inside _encode_batch for tfidf mode)

        # Split into positive / negative groups
        pos_embs = [emb for emb, lbl in zip(embeddings, labels) if lbl == 1]
        neg_embs = [emb for emb, lbl in zip(embeddings, labels) if lbl == 0]

        if not pos_embs:
            logger.warning("No positive samples — using zero centroid")
            self._positive_centroid = np.zeros(self._embedding_dim, dtype=np.float64)
        else:
            self._positive_centroid = np.mean(pos_embs, axis=0)

        if not neg_embs:
            logger.warning("No negative samples — using zero centroid")
            self._negative_centroid = np.zeros(self._embedding_dim, dtype=np.float64)
        else:
            self._negative_centroid = np.mean(neg_embs, axis=0)

        # Normalise centroids for cosine-based scoring
        self._positive_centroid = self._normalise(self._positive_centroid)
        self._negative_centroid = self._normalise(self._negative_centroid)

        # Persist to MongoDB
        self._save_state()

        structured_log.info(
            "CaptionAdapter trained",
            n_pos=len(pos_embs),
            n_neg=len(neg_embs),
            encoder=self._encoder_mode,
            dim=self._embedding_dim,
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _encode_batch(self, texts: List[str]) -> List[np.ndarray]:
        """Encode a batch of texts using the active encoder."""
        if self._encoder_mode == "sbert" and self._sbert_model is not None:
            arr = self._sbert_model.encode(texts, show_progress_bar=False)
            if isinstance(arr, np.ndarray):
                return [row.astype(np.float64) for row in arr]
            # sentence-transformers may return list of lists
            return [np.array(row, dtype=np.float64) for row in arr]

        if self._encoder_mode == "tfidf" and self._tfidf_vectorizer is not None:
            try:
                # Ensure vectorizer is fitted
                if not hasattr(self._tfidf_vectorizer, "vocabulary_") or not self._tfidf_vectorizer.vocabulary_:
                    self._tfidf_vectorizer.fit(texts)
                tfidf_matrix = self._tfidf_vectorizer.transform(texts).toarray()
                # Pad / truncate to embedding_dim
                result = []
                for row in tfidf_matrix:
                    vec = np.zeros(self._embedding_dim, dtype=np.float64)
                    length = min(len(row), self._embedding_dim)
                    vec[:length] = row[:length]
                    result.append(vec)
                return result
            except Exception as exc:
                logger.debug("TF-IDF encoding failed: %s — using hash", exc)
                return self._hash_encode_batch(texts)

        return self._hash_encode_batch(texts)

    def _hash_encode_batch(self, texts: List[str]) -> List[np.ndarray]:
        """Deterministic hash-based encoding (last-resort fallback)."""
        result: List[np.ndarray] = []
        for text in texts:
            vec = np.zeros(self._embedding_dim, dtype=np.float64)
            # Simple but deterministic: split text into chunks and hash each
            words = text.lower().split()
            for i, word in enumerate(words):
                idx = hash(word) % self._embedding_dim
                vec[idx] += 1.0
            # Normalise
            norm = np.linalg.norm(vec)
            if norm > 1e-8:
                vec /= norm
            result.append(vec)
        return result

    @staticmethod
    def _normalise(vec: np.ndarray) -> np.ndarray:
        """L2-normalise a vector; return zero vector if norm is negligible."""
        norm = np.linalg.norm(vec)
        if norm < 1e-8:
            return vec
        return vec / norm

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _save_state(self) -> None:
        """Save trained centroids and encoder config to MongoDB."""
        try:
            repo = AdapterStateRepository()
            doc: Dict = {
                "adapter_key": self._STATE_KEY,
                "encoder_mode": self._encoder_mode,
                "embedding_dim": self._embedding_dim,
                "positive_centroid": (
                    self._positive_centroid.tolist()
                    if self._positive_centroid is not None
                    else None
                ),
                "negative_centroid": (
                    self._negative_centroid.tolist()
                    if self._negative_centroid is not None
                    else None
                ),
                "updated_at": datetime.now(timezone.utc),
            }

            # For TF-IDF mode, also persist the vocabulary
            if (
                self._encoder_mode == "tfidf"
                and self._tfidf_vectorizer is not None
                and hasattr(self._tfidf_vectorizer, "vocabulary_")
            ):
                doc["tfidf_vocabulary"] = self._tfidf_vectorizer.vocabulary_

            repo.update_one(
                {"adapter_key": self._STATE_KEY},
                {"$set": doc},
                upsert=True,
            )
            structured_log.debug("CaptionAdapter state saved to MongoDB")
        except Exception as exc:
            logger.warning("Failed to save CaptionAdapter state: %s", exc)

    def _load_state(self) -> None:
        """Load previously saved centroids from MongoDB."""
        try:
            repo = AdapterStateRepository()
            doc = repo.find_one({"adapter_key": self._STATE_KEY})
            if doc is None:
                structured_log.debug("No saved CaptionAdapter state found")
                return

            saved_mode = doc.get("encoder_mode", "none")
            saved_dim = doc.get("embedding_dim", 0)

            # Only restore if dimensions match current encoder
            if saved_dim > 0 and saved_dim == self._embedding_dim:
                if doc.get("positive_centroid") is not None:
                    self._positive_centroid = np.array(
                        doc["positive_centroid"], dtype=np.float64
                    )
                if doc.get("negative_centroid") is not None:
                    self._negative_centroid = np.array(
                        doc["negative_centroid"], dtype=np.float64
                    )

            # Restore TF-IDF vocabulary if applicable
            if (
                self._encoder_mode == "tfidf"
                and saved_mode == "tfidf"
                and self._tfidf_vectorizer is not None
                and doc.get("tfidf_vocabulary")
            ):
                self._tfidf_vectorizer.vocabulary_ = doc["tfidf_vocabulary"]

            structured_log.info(
                "CaptionAdapter state loaded from MongoDB",
                pos_centroid_loaded=self._positive_centroid is not None,
                neg_centroid_loaded=self._negative_centroid is not None,
            )
        except Exception as exc:
            logger.warning("Failed to load CaptionAdapter state: %s", exc)
