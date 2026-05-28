"""
trendlens/data_transformation_pipeline.py
Transforms raw templates_db and posts_db data into the clustered format
that TrendLens AI expects for evaluation, benchmarking, and retraining.

**Key Design**: The raw collections (templates_db, posts_db) have DIFFERENT
field structures than what TrendLens clustered collections expect. This
pipeline is the parsing/normalization layer that bridges that gap.

Field Mapping Summary:
  templates_db raw fields → clustered_templates fields:
    caption / ocr_text / text_content → caption
    category / niche                 → category
    likes / real_likes                → likes, real_likes
    comments / real_comments          → comments, real_comments
    owner_followers / followers       → owner_followers
    image_url / image                 → image_url
    primary_confidence                → primary_confidence
    is_simulated                      → is_simulated
    hashtags / tags                   → hashtags
    (computed)                        → engagement_rate, label, cluster_id, source_id

  posts_db raw fields → clustered_posts fields:
    caption / text / text_content     → caption
    category / niche                  → category
    likes                             → likes
    comments                          → comments
    shares / retweets                 → shares
    ownerUsername / owner_username    → owner_username
    ownerFollowers / owner_followers  → owner_followers
    timestamp / created_at            → timestamp
    media_url / image_url / image     → image_url
    media_type                        → media_type
    post_id / id                      → post_id
    hashtags / tags                   → hashtags
    (computed)                        → engagement_rate, label, cluster_id, source_id

Pipeline stages:
  1. Ingest raw documents from templates_db / posts_db
  2. Clean & normalize (dedup, fill defaults, parse timestamps, map field names)
  3. Enrich (compute engagement_rate, category, label, cluster_id)
  4. Cluster (KMeans on SBERT/TF-IDF caption embeddings + engagement features)
  5. Write to clustered collections: clustered_templates, clustered_posts
  6. Generate ground_truth_posts from matched template-post pairs
  7. Log transformation metrics to system_activity_log
"""

import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from trendlens.config import settings
from trendlens.database import (
    BaseRepository,
    ActivityLogRepository,
    get_collection,
)
from trendlens.monitoring import structured_log, timing_metric

logger = logging.getLogger(__name__)


# ─── Repositories for raw & clustered collections ────────────────────────────

class RawTemplateRepository(BaseRepository):
    """Reads from the raw templates_db collection."""
    collection_name = "templates_db"

    def get_untransformed(self, limit: int = 0) -> List[Dict[str, Any]]:
        """Get templates that haven't been transformed yet."""
        return self.find_many(
            {"transformed_at": {"$exists": False}},
            sort=[("created_at", -1)],
            limit=limit or 0,
        )

    def get_all(self, limit: int = 0) -> List[Dict[str, Any]]:
        return self.find_many({}, sort=[("created_at", -1)], limit=limit or 0)


class RawPostsRepository(BaseRepository):
    """Reads from the raw posts_db collection."""
    collection_name = "posts_db"

    def get_untransformed(self, limit: int = 0) -> List[Dict[str, Any]]:
        return self.find_many(
            {"transformed_at": {"$exists": False}},
            sort=[("timestamp", -1)],
            limit=limit or 0,
        )

    def get_all(self, limit: int = 0) -> List[Dict[str, Any]]:
        return self.find_many({}, sort=[("timestamp", -1)], limit=limit or 0)


class ClusteredTemplateRepository(BaseRepository):
    """Writes to the clustered_templates collection (what the evaluator reads)."""
    collection_name = "clustered_templates"


class ClusteredPostsRepository(BaseRepository):
    """Writes to the clustered_posts collection."""
    collection_name = "clustered_posts"


class GroundTruthGeneratedRepository(BaseRepository):
    """Writes matched ground-truth records from transformed data."""
    collection_name = "ground_truth_posts"


# ─── Category Inference ────────────────────────────────────────────────────────

CATEGORY_KEYWORDS: Dict[str, List[str]] = {
    "cake": ["cake", "birthday", "wedding", "cupcake", "icing", "fondant",
             "celebration", "anniversary", "bakery", "red velvet", "cream"],
    "bakery": ["bakery", "bread", "pastry", "croissant", "loaf", "dough",
               "bun", "roll", "scone", "mandazi", "chapati", "rolex", "sambo"],
    "restaurant": ["restaurant", "menu", "dish", "meal", "food", "kitchen",
                   "chef", "dining", "lunch", "dinner", "matooke", "luwombo",
                   "tilapia", "gnuts", "rice"],
}

DEFAULT_CATEGORIES = ["cake", "bakery", "restaurant", "general"]


def infer_category(text: str) -> str:
    """Infer a category from caption / text content using keyword scoring."""
    text_lower = (text or "").lower()
    scores: Dict[str, int] = {}
    for cat, keywords in CATEGORY_KEYWORDS.items():
        scores[cat] = sum(1 for kw in keywords if kw in text_lower)
    best = max(scores, key=scores.get)  # type: ignore[arg-type]
    return best if scores[best] >= 2 else "general"


# ─── Safe Type Conversion ─────────────────────────────────────────────────────

def safe_int(val: Any, default: int = 0) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


# ─── Engagement Computation ────────────────────────────────────────────────────

def compute_engagement_rate(likes: int, comments: int, followers: int) -> float:
    """Compute engagement rate as (likes + comments) / max(followers, 1).
    
    For templates with real_likes/real_comments, those should be passed in.
    Falls back to normalizing by a constant for accounts with unknown follower count.
    """
    if followers > 0:
        return (likes + comments) / followers
    # Fallback: normalize by a rough constant for accounts with unknown follower count
    return min(1.0, (likes + comments) / 1000.0)


def compute_engagement_label(engagement_rate: float, threshold: float = 0.04) -> int:
    """Binary label: 1 = high engagement, 0 = low engagement."""
    return 1 if engagement_rate >= threshold else 0


# ─── Field Mapping Helpers ────────────────────────────────────────────────────
# These handle the DIFFERENT field names between raw collections and clustered
# collections. The raw data can have various field name conventions depending
# on the data source (Instagram scraper, manual upload, simulation, etc.)

def _extract_caption(raw: Dict[str, Any]) -> str:
    """Extract caption from raw doc, trying multiple field names."""
    for key in ["caption", "text_content", "ocr_text", "text", "description", "content"]:
        val = raw.get(key)
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _extract_category(raw: Dict[str, Any]) -> str:
    """Extract category from raw doc, trying multiple field names."""
    for key in ["category", "niche", "topic", "label"]:
        val = raw.get(key)
        if val and isinstance(val, str) and val.strip():
            return val.strip().lower()
    return ""


def _extract_image_url(raw: Dict[str, Any]) -> str:
    """Extract image URL from raw doc, trying multiple field names."""
    for key in ["image_url", "image", "media_url", "media", "img_url", "url", "thumbnail_url"]:
        val = raw.get(key)
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _extract_hashtags(raw: Dict[str, Any]) -> List[str]:
    """Extract hashtags from raw doc, trying multiple field names."""
    for key in ["hashtags", "tags", "tags_list"]:
        val = raw.get(key)
        if val:
            if isinstance(val, list):
                return val
            if isinstance(val, str):
                return [t.strip() for t in val.split(",") if t.strip()]
    return []


def _extract_owner_username(raw: Dict[str, Any]) -> str:
    """Extract owner username from raw doc (posts only)."""
    for key in ["ownerUsername", "owner_username", "username", "user", "account"]:
        val = raw.get(key)
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _extract_owner_followers(raw: Dict[str, Any], default: int = 1000) -> int:
    """Extract owner follower count from raw doc."""
    for key in ["ownerFollowers", "owner_followers", "followers", "follower_count"]:
        val = raw.get(key)
        if val is not None:
            return safe_int(val, default)
    return default


def _extract_timestamp(raw: Dict[str, Any]) -> str:
    """Extract timestamp from raw doc, trying multiple field names."""
    for key in ["timestamp", "created_at", "posted_at", "date", "taken_at"]:
        val = raw.get(key)
        if val:
            if isinstance(val, datetime):
                return val.isoformat()
            if isinstance(val, str) and val.strip():
                return val.strip()
    return ""


def _extract_post_id(raw: Dict[str, Any]) -> str:
    """Extract post ID from raw doc, trying multiple field names."""
    for key in ["post_id", "id", "shortcode", "ig_id"]:
        val = raw.get(key)
        if val and isinstance(val, str) and val.strip():
            return val.strip()
    return ""


# ─── SBERT Embedding Cache ────────────────────────────────────────────────────

_sbert_model = None


def _get_sbert_model():
    global _sbert_model
    if _sbert_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _sbert_model = SentenceTransformer(settings.SBERT_MODEL_NAME)
            logger.info("SBERT model loaded for clustering: %s", settings.SBERT_MODEL_NAME)
        except ImportError:
            logger.warning("sentence-transformers not installed — using TF-IDF fallback for clustering")
            _sbert_model = "tfidf"
    return _sbert_model


def encode_captions(captions: List[str]) -> np.ndarray:
    """Encode captions to embeddings. Falls back to TF-IDF if SBERT unavailable."""
    model = _get_sbert_model()

    if model == "tfidf" or model is None:
        from sklearn.feature_extraction.text import TfidfVectorizer
        vectorizer = TfidfVectorizer(max_features=128, stop_words="english")
        if not captions:
            return np.zeros((0, 128), dtype=np.float32)
        return vectorizer.fit_transform(captions).toarray().astype(np.float32)

    try:
        embeddings = model.encode(captions, show_progress_bar=False, batch_size=64)
        return np.array(embeddings, dtype=np.float32)
    except Exception as exc:
        logger.error("SBERT encoding failed: %s", exc)
        from sklearn.feature_extraction.text import TfidfVectorizer
        vectorizer = TfidfVectorizer(max_features=384, stop_words="english")
        return vectorizer.fit_transform(captions).toarray().astype(np.float32)


# ─── Clustering ───────────────────────────────────────────────────────────────

def cluster_documents(
    embeddings: np.ndarray,
    engagement_scores: np.ndarray,
    n_clusters: int = 8,
) -> np.ndarray:
    """Cluster documents using KMeans on combined embedding + engagement features.

    Args:
        embeddings: (N, D) caption embeddings
        engagement_scores: (N,) normalized engagement rates
        n_clusters: number of clusters

    Returns:
        cluster_labels: (N,) integer cluster assignments
    """
    if len(embeddings) == 0:
        return np.array([], dtype=np.int32)

    n_clusters = min(n_clusters, len(embeddings))
    if n_clusters < 2:
        return np.zeros(len(embeddings), dtype=np.int32)

    # Normalize engagement to same scale as embeddings
    from sklearn.preprocessing import StandardScaler
    eng_normalized = engagement_scores.reshape(-1, 1)
    scaler = StandardScaler()
    eng_scaled = scaler.fit_transform(eng_normalized)

    # Concatenate: embedding + engagement feature
    combined = np.hstack([embeddings, eng_scaled])

    # KMeans clustering
    from sklearn.cluster import KMeans
    km = KMeans(n_clusters=n_clusters, random_state=42, n_init=10, max_iter=300)
    labels = km.fit_predict(combined)

    return labels


# ─── Main Pipeline ────────────────────────────────────────────────────────────

class DataTransformationPipeline:
    """Full ETL pipeline: raw → clustered → ground truth.
    
    This is the core parsing/normalization layer that bridges the gap between
    the raw data collections (templates_db, posts_db) which have different
    field structures, and the clustered collections that TrendLens expects.
    """

    def __init__(self) -> None:
        self.raw_templates = RawTemplateRepository()
        self.raw_posts = RawPostsRepository()
        self.clustered_templates = ClusteredTemplateRepository()
        self.clustered_posts = ClusteredPostsRepository()
        self.gt_repo = GroundTruthGeneratedRepository()
        self.activity_log = ActivityLogRepository()

    @timing_metric("transformation_pipeline_run")
    def run(
        self,
        n_clusters: int = 8,
        engagement_threshold: float = 0.04,
        match_threshold: float = 0.25,
        limit: int = 0,
    ) -> Dict[str, Any]:
        """Execute the full transformation pipeline.

        Args:
            n_clusters: Number of KMeans clusters
            engagement_threshold: Threshold for binary label (high/low engagement)
            match_threshold: Jaccard similarity threshold for template-post matching
            limit: Max raw docs to process (0 = all untransformed)

        Returns:
            Summary dict with counts and metrics
        """
        structured_log.info("Starting data transformation pipeline")

        # ── Stage 1: Ingest raw documents ──────────────────────────────
        raw_tmpls = self.raw_templates.get_untransformed(limit=limit or 0)
        raw_posts = self.raw_posts.get_untransformed(limit=limit or 0)

        structured_log.info(
            "Ingested raw data",
            templates=len(raw_tmpls),
            posts=len(raw_posts),
        )

        if not raw_tmpls and not raw_posts:
            return {
                "status": "nothing_to_transform",
                "templates_transformed": 0,
                "posts_transformed": 0,
                "ground_truth_created": 0,
            }

        # ── Stage 2: Clean & Normalize ─────────────────────────────────
        # The _normalize_* methods handle ALL field name variations
        norm_tmpls = [self._normalize_template(t) for t in raw_tmpls]
        norm_posts = [self._normalize_post(p) for p in raw_posts]

        # Remove None results from failed normalizations
        norm_tmpls = [t for t in norm_tmpls if t is not None]
        norm_posts = [p for p in norm_posts if p is not None]

        structured_log.info(
            "Normalized data",
            templates=len(norm_tmpls),
            posts=len(norm_posts),
        )

        # ── Stage 3: Enrich ────────────────────────────────────────────
        for t in norm_tmpls:
            # Use real_likes/real_comments if available, else simulated likes/comments
            effective_likes = t.get("real_likes", 0) or t.get("likes", 0)
            effective_comments = t.get("real_comments", 0) or t.get("comments", 0)
            t["engagement_rate"] = compute_engagement_rate(
                effective_likes,
                effective_comments,
                t.get("owner_followers", 1000),
            )
            t["label"] = compute_engagement_label(t["engagement_rate"], engagement_threshold)
            if not t.get("category") or t["category"] not in DEFAULT_CATEGORIES:
                t["category"] = infer_category(t.get("caption", ""))

        for p in norm_posts:
            p["engagement_rate"] = compute_engagement_rate(
                p.get("likes", 0),
                p.get("comments", 0),
                p.get("owner_followers", 1000),
            )
            p["label"] = compute_engagement_label(p["engagement_rate"], engagement_threshold)
            if not p.get("category") or p["category"] not in DEFAULT_CATEGORIES:
                p["category"] = infer_category(p.get("caption", ""))

        # ── Stage 4: Cluster ───────────────────────────────────────────
        tmpl_clusters = self._cluster_documents(norm_tmpls, n_clusters)
        post_clusters = self._cluster_documents(norm_posts, n_clusters)

        for i, t in enumerate(norm_tmpls):
            t["cluster_id"] = int(tmpl_clusters[i]) if len(tmpl_clusters) > i else 0

        for i, p in enumerate(norm_posts):
            p["cluster_id"] = int(post_clusters[i]) if len(post_clusters) > i else 0

        # ── Stage 5: Write clustered collections ───────────────────────
        tmpl_written = 0
        for t in norm_tmpls:
            try:
                self.clustered_templates.update_one(
                    {"source_id": t["source_id"]},
                    {"$set": t},
                    upsert=True,
                )
                tmpl_written += 1
            except Exception as exc:
                logger.debug("Failed to write clustered template: %s", exc)

        post_written = 0
        for p in norm_posts:
            try:
                self.clustered_posts.update_one(
                    {"source_id": p["source_id"]},
                    {"$set": p},
                    upsert=True,
                )
                post_written += 1
            except Exception as exc:
                logger.debug("Failed to write clustered post: %s", exc)

        # ── Stage 6: Generate ground truth from matches ────────────────
        gt_created = self._generate_ground_truth(norm_tmpls, norm_posts, match_threshold)

        # ── Stage 7: Mark source docs as transformed ───────────────────
        now = datetime.now(timezone.utc).isoformat()
        for t in raw_tmpls:
            try:
                self.raw_templates.update_one(
                    {"_id": t["_id"]},
                    {"$set": {"transformed_at": now}},
                )
            except Exception:
                pass

        for p in raw_posts:
            try:
                self.raw_posts.update_one(
                    {"_id": p["_id"]},
                    {"$set": {"transformed_at": now}},
                )
            except Exception:
                pass

        # ── Log activity ───────────────────────────────────────────────
        summary = {
            "status": "success",
            "templates_transformed": tmpl_written,
            "posts_transformed": post_written,
            "ground_truth_created": gt_created,
            "n_clusters": n_clusters,
            "engagement_threshold": engagement_threshold,
            "transformed_at": now,
        }

        self.activity_log.log_event(
            event_type="data_transformation",
            message=f"Transformed {tmpl_written} templates, {post_written} posts, created {gt_created} ground truth records",
            metadata=summary,
        )

        structured_log.info("Transformation pipeline complete", **summary)
        return summary

    def _normalize_template(self, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Normalize a raw template_db document into clustered format.
        
        Handles the field name differences between raw templates_db and
        the clustered_templates collection that TrendLens expects.
        """
        try:
            # ── Field mapping using robust extraction helpers ──
            caption = _extract_caption(raw)
            category = _extract_category(raw)
            image_url = _extract_image_url(raw)
            hashtags = _extract_hashtags(raw)

            # Engagement fields — templates have both simulated and real
            likes = safe_int(raw.get("likes", 0))
            comments = safe_int(raw.get("comments", 0))
            real_likes = safe_int(raw.get("real_likes", 0))
            real_comments = safe_int(raw.get("real_comments", 0))
            owner_followers = _extract_owner_followers(raw, 1000)

            return {
                "source_id": str(raw.get("_id", "")),
                "caption": caption,
                "category": category,
                "likes": likes,
                "comments": comments,
                "real_likes": real_likes,
                "real_comments": real_comments,
                "is_simulated": raw.get("is_simulated", True),
                "image_url": image_url,
                "primary_confidence": safe_float(raw.get("primary_confidence", 0)),
                "owner_followers": owner_followers,
                "hashtags": hashtags,
                # Preserve original data for debugging/auditing
                "original_data": {k: v for k, v in raw.items() if k != "_id"},
                "transformed_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            logger.debug("Template normalization failed: %s", exc)
            return None

    def _normalize_post(self, raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Normalize a raw posts_db document into clustered format.
        
        Handles the field name differences between raw posts_db and
        the clustered_posts collection that TrendLens expects.
        
        Key field mappings:
          ownerUsername → owner_username
          ownerFollowers → owner_followers
          media_url → image_url
          timestamp stays as timestamp
        """
        try:
            # ── Field mapping using robust extraction helpers ──
            caption = _extract_caption(raw)
            category = _extract_category(raw)
            image_url = _extract_image_url(raw)
            hashtags = _extract_hashtags(raw)
            owner_username = _extract_owner_username(raw)
            owner_followers = _extract_owner_followers(raw, 1000)
            timestamp = _extract_timestamp(raw)
            post_id = _extract_post_id(raw)

            # Engagement fields
            likes = safe_int(raw.get("likes", 0))
            comments = safe_int(raw.get("comments", 0))
            shares = safe_int(raw.get("shares", 0) or raw.get("retweets", 0))
            media_type = raw.get("media_type", "IMAGE")

            return {
                "source_id": str(raw.get("_id", "")),
                "caption": caption,
                "category": category,
                "likes": likes,
                "comments": comments,
                "shares": shares,
                "owner_username": owner_username,
                "owner_followers": owner_followers,
                "timestamp": timestamp,
                "image_url": image_url,
                "post_id": post_id,
                "hashtags": hashtags,
                "media_type": media_type,
                # Preserve original data for debugging/auditing
                "original_data": {k: v for k, v in raw.items() if k != "_id"},
                "transformed_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as exc:
            logger.debug("Post normalization failed: %s", exc)
            return None

    def _cluster_documents(
        self,
        documents: List[Dict[str, Any]],
        n_clusters: int,
    ) -> np.ndarray:
        """Compute clusters for a list of enriched documents."""
        if not documents:
            return np.array([], dtype=np.int32)

        captions = [d.get("caption", "") or "untitled" for d in documents]
        engagement = np.array([safe_float(d.get("engagement_rate", 0)) for d in documents], dtype=np.float32)

        embeddings = encode_captions(captions)
        return cluster_documents(embeddings, engagement, n_clusters)

    def _generate_ground_truth(
        self,
        templates: List[Dict[str, Any]],
        posts: List[Dict[str, Any]],
        match_threshold: float = 0.25,
    ) -> int:
        """Match templates to posts and create ground_truth_posts records.
        
        Uses Jaccard similarity on caption shingles to find template-post pairs.
        Only creates a match when similarity exceeds the threshold.
        """
        if not templates or not posts:
            return 0

        # Build caption lookup for templates
        tmpl_captions = {t["source_id"]: t.get("caption", "") for t in templates}

        created = 0
        for post in posts:
            post_caption = post.get("caption", "")
            if not post_caption:
                continue

            best_match_id = None
            best_score = 0.0

            for tid, tcaption in tmpl_captions.items():
                score = self._jaccard_similarity(post_caption, tcaption)
                if score > best_score and score >= match_threshold:
                    best_score = score
                    best_match_id = tid

            if best_match_id:
                gt_record = {
                    "template_id": best_match_id,
                    "post_id": post.get("post_id", ""),
                    "likes": post.get("likes", 0),
                    "comments": post.get("comments", 0),
                    "shares": post.get("shares", 0),
                    "caption": post_caption,
                    "match_score": best_score,
                    "is_simulated": False,
                    "owner_username": post.get("owner_username", ""),
                    "engagement_rate": post.get("engagement_rate", 0.0),
                    "label": post.get("label", 0),
                    "category": post.get("category", "general"),
                    "collected_at": datetime.now(timezone.utc).isoformat(),
                }
                try:
                    self.gt_repo.update_one(
                        {
                            "template_id": best_match_id,
                            "post_id": post.get("post_id", ""),
                        },
                        {"$set": gt_record},
                        upsert=True,
                    )
                    created += 1
                except Exception as exc:
                    logger.debug("GT write failed: %s", exc)

        return created

    @staticmethod
    def _jaccard_similarity(a: str, b: str, shingle_size: int = 3) -> float:
        """Compute Jaccard similarity between two strings using shingles."""
        def shingles(text: str) -> set:
            text = text.lower()
            return set(text[i:i + shingle_size] for i in range(len(text) - shingle_size + 1))

        s1, s2 = shingles(a), shingles(b)
        if not s1 or not s2:
            return 0.0
        return len(s1 & s2) / len(s1 | s2)


# ─── CLI entry point ──────────────────────────────────────────────────────────

def run_transformation(**kwargs) -> Dict[str, Any]:
    """Convenience function to run the transformation pipeline."""
    pipeline = DataTransformationPipeline()
    return pipeline.run(**kwargs)
