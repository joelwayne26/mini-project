"""
trendlens/transfer/trend_encoder.py

Trend alignment encoder for TrendLens AI.

Encodes captions and trend keywords into the same embedding space using
SBERT (or a TF-IDF fallback) and computes alignment scores between them.
Keywords are weighted by their historical engagement performance so that
trends with stronger business impact contribute more to the final score.

Trained keyword weights are persisted in MongoDB ``adapter_state``
collection so they survive process restarts.
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

try:
    from sentence_transformers import SentenceTransformer  # type: ignore[import-untyped]

    _sbert_available = True
except ImportError:
    SentenceTransformer = None  # type: ignore[assignment,misc]

_tfidf_available = False

try:
    from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore[import-untyped]
    from sklearn.metrics.pairwise import cosine_similarity as sklearn_cosine  # type: ignore[import-untyped]

    _tfidf_available = True
except ImportError:
    TfidfVectorizer = None  # type: ignore[assignment,misc]
    sklearn_cosine = None  # type: ignore[assignment,misc]


# ---------------------------------------------------------------------------
# Repository for adapter state
# ---------------------------------------------------------------------------

class AdapterStateRepository(BaseRepository):
    """Thin wrapper around MongoDB ``adapter_state`` collection."""

    collection_name = "adapter_state"


# ---------------------------------------------------------------------------
# TrendAlignmentEncoder
# ---------------------------------------------------------------------------

class TrendAlignmentEncoder:
    """Encode captions and trend keywords into a shared embedding space and
    compute alignment scores weighted by historical engagement.

    Workflow
    --------
    1. **Construct** — loads saved keyword weights from MongoDB if available.
    2. **Train** — call :meth:`train` with captions and their engagement
       rates to learn keyword weights.
    3. **Use** — call :meth:`alignment_score` to measure how well a caption
       aligns with a trend keyword.

    When SBERT is not installed the encoder automatically falls back to
    TF-IDF cosine similarity.  If neither is available a simple token
    overlap heuristic is used.
    """

    _STATE_KEY = "trend_encoder"

    def __init__(self) -> None:
        self._encoder_mode: str = "none"  # "sbert" | "tfidf" | "overlap"
        self._sbert_model: Optional[object] = None
        self._tfidf_vectorizer: Optional[object] = None
        self._embedding_dim: int = 0

        # Keyword engagement weights: keyword -> weight (float)
        self._keyword_weights: Dict[str, float] = {}

        # Cache for embeddings (avoid re-encoding the same keyword repeatedly)
        self._embedding_cache: Dict[str, np.ndarray] = {}

        self._init_encoder()
        self._load_state()

    # ------------------------------------------------------------------
    # Encoder initialisation
    # ------------------------------------------------------------------

    def _init_encoder(self) -> None:
        """Pick the best available text encoder."""
        if _sbert_available and SentenceTransformer is not None:
            try:
                self._sbert_model = SentenceTransformer(settings.SBERT_MODEL_NAME)
                test_emb = self._sbert_model.encode(["test"], show_progress_bar=False)
                self._embedding_dim = test_emb.shape[1]
                self._encoder_mode = "sbert"
                structured_log.info(
                    "TrendAlignmentEncoder: SBERT initialised",
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
                    "TrendAlignmentEncoder: TF-IDF fallback initialised",
                    dim=self._embedding_dim,
                )
                return
            except Exception as exc:
                logger.warning("TF-IDF init failed (%s) — falling back to overlap", exc)

        self._embedding_dim = settings.ADAPTER_DIM
        self._encoder_mode = "overlap"
        structured_log.warning(
            "TrendAlignmentEncoder: no SBERT or TF-IDF — using token overlap",
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def alignment_score(self, caption: str, keyword: str) -> float:
        """Compute the alignment score between a caption and a trend keyword.

        The score is the cosine similarity between the caption and keyword
        embeddings, optionally weighted by the keyword's historical
        engagement weight.

        Parameters
        ----------
        caption:
            The post caption text.
        keyword:
            A trend keyword or phrase.

        Returns
        -------
        float
            Alignment score in ``[0, 1]``.  Returns ``0.0`` on error.
        """
        try:
            # Compute base similarity
            sim = self._cosine_similarity(caption, keyword)

            # Apply keyword weight if available
            weight = self._keyword_weights.get(keyword.lower(), 1.0)

            # Weighted score: boost if keyword has historically high engagement
            weighted_score = sim * min(weight, 2.0)  # cap multiplier at 2×

            # Normalise to [0, 1]
            return float(max(0.0, min(1.0, weighted_score)))
        except Exception as exc:
            logger.debug("alignment_score failed: %s", exc)
            return 0.0

    def train(self, captions: List[str], engagement_rates: List[float]) -> None:
        """Train keyword engagement weights from caption–engagement pairs.

        The method extracts candidate keywords from the captions, then
        computes average engagement rates per keyword.  Keywords whose
        associated captions have above-average engagement receive a weight
        > 1.0; below-average keywords receive a weight < 1.0.

        Parameters
        ----------
        captions:
            List of caption strings.
        engagement_rates:
            Corresponding engagement rates (float, typically 0–1).
            Must be the same length as *captions*.

        Raises
        ------
        ValueError
            If inputs are empty or have mismatched lengths.
        """
        if len(captions) != len(engagement_rates):
            raise ValueError(
                f"captions ({len(captions)}) and engagement_rates "
                f"({len(engagement_rates)}) must have the same length"
            )
        if not captions:
            raise ValueError("Cannot train on empty data")

        # For TF-IDF mode, fit the vectorizer on all captions first
        if self._encoder_mode == "tfidf" and self._tfidf_vectorizer is not None:
            try:
                self._tfidf_vectorizer.fit(captions)
            except Exception as exc:
                logger.debug("TF-IDF fitting during train failed: %s", exc)

        # Extract keywords and compute per-keyword average engagement
        keyword_engagement: Dict[str, List[float]] = {}
        mean_engagement = float(np.mean(engagement_rates))

        for caption, rate in zip(captions, engagement_rates):
            keywords = self._extract_keywords(caption)
            for kw in keywords:
                kw_lower = kw.lower()
                if kw_lower not in keyword_engagement:
                    keyword_engagement[kw_lower] = []
                keyword_engagement[kw_lower].append(rate)

        # Compute weights: ratio of keyword's avg engagement to overall mean
        self._keyword_weights = {}
        for kw, rates in keyword_engagement.items():
            avg_rate = sum(rates) / len(rates)
            if mean_engagement > 1e-8:
                weight = avg_rate / mean_engagement
            else:
                weight = 1.0
            # Smooth weights towards 1.0 to avoid extreme values
            smoothed = 0.5 * weight + 0.5 * 1.0
            self._keyword_weights[kw] = round(smoothed, 4)

        # Clear embedding cache (vocabulary may have changed)
        self._embedding_cache.clear()

        # Persist
        self._save_state()

        structured_log.info(
            "TrendAlignmentEncoder trained",
            n_keywords=len(self._keyword_weights),
            encoder=self._encoder_mode,
        )

    # ------------------------------------------------------------------
    # Internal: encoding & similarity
    # ------------------------------------------------------------------

    def _encode(self, text: str) -> np.ndarray:
        """Encode a single text string into an embedding vector."""
        # Check cache
        if text in self._embedding_cache:
            return self._embedding_cache[text]

        vec = self._encode_uncached(text)
        self._embedding_cache[text] = vec
        return vec

    def _encode_uncached(self, text: str) -> np.ndarray:
        """Encode text without using the cache."""
        if self._encoder_mode == "sbert" and self._sbert_model is not None:
            try:
                arr = self._sbert_model.encode([text], show_progress_bar=False)
                if isinstance(arr, np.ndarray):
                    return arr[0].astype(np.float64)
                return np.array(arr[0], dtype=np.float64)
            except Exception as exc:
                logger.debug("SBERT encode failed: %s", exc)

        if self._encoder_mode == "tfidf" and self._tfidf_vectorizer is not None:
            try:
                if not hasattr(self._tfidf_vectorizer, "vocabulary_") or not self._tfidf_vectorizer.vocabulary_:
                    self._tfidf_vectorizer.fit([text])
                tfidf_vec = self._tfidf_vectorizer.transform([text]).toarray().flatten()
                # Pad / truncate
                vec = np.zeros(self._embedding_dim, dtype=np.float64)
                length = min(len(tfidf_vec), self._embedding_dim)
                vec[:length] = tfidf_vec[:length]
                return vec
            except Exception as exc:
                logger.debug("TF-IDF encode failed: %s", exc)

        # Last resort: hash-based encoding
        return self._hash_encode(text)

    def _hash_encode(self, text: str) -> np.ndarray:
        """Deterministic hash-based encoding."""
        vec = np.zeros(self._embedding_dim, dtype=np.float64)
        words = text.lower().split()
        for word in words:
            idx = hash(word) % self._embedding_dim
            vec[idx] += 1.0
        norm = np.linalg.norm(vec)
        if norm > 1e-8:
            vec /= norm
        return vec

    def _cosine_similarity(self, text_a: str, text_b: str) -> float:
        """Compute cosine similarity between two texts."""
        # For TF-IDF mode with sklearn, we can use the optimised path
        if (
            self._encoder_mode == "tfidf"
            and self._tfidf_vectorizer is not None
            and sklearn_cosine is not None
        ):
            try:
                if hasattr(self._tfidf_vectorizer, "vocabulary_") and self._tfidf_vectorizer.vocabulary_:
                    tfidf_matrix = self._tfidf_vectorizer.transform([text_a, text_b])
                    sim = sklearn_cosine(tfidf_matrix[0:1], tfidf_matrix[1:2])[0, 0]
                    return float(sim)
            except Exception as exc:
                logger.debug("sklearn cosine failed: %s", exc)

        # General path: encode both and compute cosine
        vec_a = self._encode(text_a)
        vec_b = self._encode(text_b)

        # If using overlap mode, use token overlap directly
        if self._encoder_mode == "overlap":
            return self._token_overlap(text_a, text_b)

        norm_a = np.linalg.norm(vec_a)
        norm_b = np.linalg.norm(vec_b)
        if norm_a < 1e-8 or norm_b < 1e-8:
            return 0.0
        return float(np.dot(vec_a, vec_b) / (norm_a * norm_b))

    @staticmethod
    def _token_overlap(text_a: str, text_b: str) -> float:
        """Simple token-overlap similarity (Jaccard-like)."""
        tokens_a = set(text_a.lower().split())
        tokens_b = set(text_b.lower().split())
        if not tokens_a or not tokens_b:
            return 0.0
        intersection = tokens_a & tokens_b
        union = tokens_a | tokens_b
        return len(intersection) / len(union)

    # ------------------------------------------------------------------
    # Internal: keyword extraction
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_keywords(caption: str) -> List[str]:
        """Extract candidate keywords from a caption.

        Uses a simple heuristic: split on whitespace, strip punctuation,
        and filter out very short tokens.  This is intentionally lightweight
        to avoid depending on NLP libraries.
        """
        # Simple cleanup
        words = caption.lower().split()
        keywords: List[str] = []

        for word in words:
            # Strip common punctuation
            cleaned = word.strip("#@.,!?;:'\"()-[]{}")
            if len(cleaned) >= 3:
                keywords.append(cleaned)

        # Also add bigrams for multi-word trends
        for i in range(len(words) - 1):
            w1 = words[i].strip("#@.,!?;:'\"()-[]{}")
            w2 = words[i + 1].strip("#@.,!?;:'\"()-[]{}")
            if len(w1) >= 2 and len(w2) >= 2:
                keywords.append(f"{w1} {w2}")

        return keywords

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _save_state(self) -> None:
        """Save keyword weights and encoder config to MongoDB."""
        try:
            repo = AdapterStateRepository()
            doc: Dict = {
                "adapter_key": self._STATE_KEY,
                "encoder_mode": self._encoder_mode,
                "embedding_dim": self._embedding_dim,
                "keyword_weights": self._keyword_weights,
                "updated_at": datetime.now(timezone.utc),
            }

            # For TF-IDF mode, persist vocabulary
            if (
                self._encoder_mode == "tfidf"
                and self._tfidf_vectorizer is not None
                and hasattr(self._tfidf_vectorizer, "vocabulary_")
                and self._tfidf_vectorizer.vocabulary_
            ):
                doc["tfidf_vocabulary"] = self._tfidf_vectorizer.vocabulary_

            repo.update_one(
                {"adapter_key": self._STATE_KEY},
                {"$set": doc},
                upsert=True,
            )
            structured_log.debug("TrendAlignmentEncoder state saved to MongoDB")
        except Exception as exc:
            logger.warning("Failed to save TrendAlignmentEncoder state: %s", exc)

    def _load_state(self) -> None:
        """Load previously saved keyword weights from MongoDB."""
        try:
            repo = AdapterStateRepository()
            doc = repo.find_one({"adapter_key": self._STATE_KEY})
            if doc is None:
                structured_log.debug("No saved TrendAlignmentEncoder state found")
                return

            saved_weights = doc.get("keyword_weights")
            if saved_weights and isinstance(saved_weights, dict):
                self._keyword_weights = {str(k): float(v) for k, v in saved_weights.items()}

            # Restore TF-IDF vocabulary if applicable
            saved_mode = doc.get("encoder_mode", "none")
            if (
                self._encoder_mode == "tfidf"
                and saved_mode == "tfidf"
                and self._tfidf_vectorizer is not None
                and doc.get("tfidf_vocabulary")
            ):
                self._tfidf_vectorizer.vocabulary_ = doc["tfidf_vocabulary"]

            structured_log.info(
                "TrendAlignmentEncoder state loaded from MongoDB",
                n_keywords=len(self._keyword_weights),
            )
        except Exception as exc:
            logger.warning("Failed to load TrendAlignmentEncoder state: %s", exc)
