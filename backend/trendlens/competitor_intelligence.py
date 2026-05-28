"""
trendlens/competitor_intelligence.py
Competitor pattern learning module for TrendLens AI.

Learns and compares competitor posting patterns from MongoDB to identify
content gaps for Ugandan food businesses. Produces a 10-dimensional gap
feature vector that feeds into the XGBoost scoring model.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import numpy as np

try:
    from trendlens.config import settings
except ImportError:
    settings = None  # type: ignore[assignment]

try:
    from trendlens.database import BaseRepository, get_collection
except ImportError:
    BaseRepository = None  # type: ignore[assignment,misc]
    get_collection = None  # type: ignore[assignment]

try:
    from trendlens.monitoring import structured_log
except ImportError:
    structured_log = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)


# ─── Category Defaults ────────────────────────────────────────────────────────
# Sensible defaults used when no competitor data exists in MongoDB yet.

CATEGORY_DEFAULTS: Dict[str, Dict[str, Any]] = {
    "cake": {
        "avg_hashtag_count": 8.0,
        "cta_presence_rate": 0.72,
        "price_presence_rate": 0.65,
        "ideal_caption_length": 140.0,
        "avg_emoji_count": 3.0,
        "avg_trend_alignment": 0.35,
        "optimal_posting_hour": 11,
        "avg_engagement_rate": 0.042,
        "avg_follower_engagement": 0.038,
        "content_freshness_days": 3.0,
    },
    "bakery": {
        "avg_hashtag_count": 7.0,
        "cta_presence_rate": 0.68,
        "price_presence_rate": 0.60,
        "ideal_caption_length": 120.0,
        "avg_emoji_count": 2.5,
        "avg_trend_alignment": 0.30,
        "optimal_posting_hour": 10,
        "avg_engagement_rate": 0.038,
        "avg_follower_engagement": 0.032,
        "content_freshness_days": 3.5,
    },
    "restaurant": {
        "avg_hashtag_count": 8.0,
        "cta_presence_rate": 0.75,
        "price_presence_rate": 0.45,
        "ideal_caption_length": 150.0,
        "avg_emoji_count": 3.5,
        "avg_trend_alignment": 0.32,
        "optimal_posting_hour": 12,
        "avg_engagement_rate": 0.045,
        "avg_follower_engagement": 0.035,
        "content_freshness_days": 2.5,
    },
    "general": {
        "avg_hashtag_count": 6.0,
        "cta_presence_rate": 0.55,
        "price_presence_rate": 0.40,
        "ideal_caption_length": 125.0,
        "avg_emoji_count": 2.0,
        "avg_trend_alignment": 0.25,
        "optimal_posting_hour": 11,
        "avg_engagement_rate": 0.030,
        "avg_follower_engagement": 0.025,
        "content_freshness_days": 4.0,
    },
}


# ─── Repository ───────────────────────────────────────────────────────────────

class CompetitorPatternRepository:
    """Repository for the ``competitor_patterns`` MongoDB collection."""

    COLLECTION_NAME = "competitor_patterns"

    def __init__(self) -> None:
        self._coll = None

    @property
    def coll(self):
        """Lazily resolve the MongoDB collection."""
        if self._coll is None:
            if get_collection is not None:
                try:
                    self._coll = get_collection(self.COLLECTION_NAME)
                except Exception as exc:
                    logger.error("Failed to get competitor_patterns collection: %s", exc)
                    return None
            else:
                return None
        return self._coll

    def get_patterns(self, category: str) -> Optional[Dict[str, Any]]:
        """Retrieve cached pattern document for *category*."""
        if self.coll is None:
            return None
        try:
            return self.coll.find_one({"category": category})
        except Exception as exc:
            logger.error("Error fetching patterns for '%s': %s", category, exc)
            return None

    def upsert_patterns(self, category: str, patterns: Dict[str, Any]) -> bool:
        """Insert or update the pattern document for *category*."""
        if self.coll is None:
            return False
        try:
            self.coll.update_one(
                {"category": category},
                {
                    "$set": {
                        **patterns,
                        "category": category,
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
                upsert=True,
            )
            return True
        except Exception as exc:
            logger.error("Error upserting patterns for '%s': %s", category, exc)
            return False

    def aggregate(self, pipeline: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Run an aggregation pipeline against the collection."""
        if self.coll is None:
            return []
        try:
            return list(self.coll.aggregate(pipeline))
        except Exception as exc:
            logger.error("Aggregation error: %s", exc)
            return []


# ─── Main Class ───────────────────────────────────────────────────────────────

class CompetitorPatternLearner:
    """Learn and compare competitor posting patterns.

    Reads competitor data from the ``competitor_patterns`` MongoDB collection,
    computes aggregate statistics, and produces a 10-dimensional gap feature
    vector that highlights where a user's content falls short of (or exceeds)
    top-performing competitors.

    Gap feature dimensions (index → meaning):
        0. Hashtag count vs competitor average
        1. CTA presence vs competitor average
        2. Price presence vs competitor average
        3. Caption length vs competitor ideal
        4. Emoji usage vs competitor average
        5. Trend alignment vs competitor average
        6. Posting time optimization
        7. Engagement rate gap
        8. Follower-adjusted engagement gap
        9. Content freshness score
    """

    def __init__(self) -> None:
        self._repo = CompetitorPatternRepository()
        self._patterns: Dict[str, Dict[str, Any]] = {}
        self._defaults = CATEGORY_DEFAULTS

    # ── Public API ────────────────────────────────────────────────────

    def load_patterns(self, category: str) -> Dict[str, Any]:
        """Load competitor patterns for *category* from MongoDB.

        If no stored patterns exist, category defaults are used and a
        document is seeded so that future aggregation can enrich it.

        Returns the resolved pattern dict.
        """
        if structured_log is not None:
            structured_log.info("Loading competitor patterns", category=category)
        else:
            logger.info("Loading competitor patterns for category='%s'", category)

        # Try loading from DB first
        stored = self._repo.get_patterns(category)
        if stored is not None:
            # Remove MongoDB internal fields
            stored.pop("_id", None)
            self._patterns[category] = stored
            return stored

        # Fall back to defaults
        defaults = self._defaults.get(category, self._defaults["general"])
        self._patterns[category] = dict(defaults)

        # Seed the collection so aggregation pipelines can find it later
        self._repo.upsert_patterns(category, dict(defaults))
        return dict(defaults)

    def extract_gap_features(
        self,
        caption_features: Dict[str, Any],
        category: str,
    ) -> np.ndarray:
        """Extract a 10-dimensional gap feature vector.

        Each dimension compares the user's content against the competitor
        average for *category*.  Positive values indicate the user is
        *ahead* of competitors; negative values indicate a gap.

        Args:
            caption_features: Feature dict produced by
                :class:`~trendlens.text_processor.TextProcessor` /
                :class:`~trendlens.phase5_caption_intelligence.CaptionIntelligence`.
            category: Business category (``cake``, ``bakery``,
                ``restaurant``, ``general``).

        Returns:
            ``np.ndarray`` of shape ``(10,)`` with ``float32`` values.
        """
        # Ensure patterns are loaded
        if category not in self._patterns:
            self.load_patterns(category)

        patterns = self._patterns.get(category, self._defaults.get(category, self._defaults["general"]))

        # ── Dimension 0: Hashtag count gap ────────────────────────────
        user_hashtags = float(caption_features.get("hashtag_count", 0))
        comp_avg_hashtags = float(patterns.get("avg_hashtag_count", 6.0))
        hashtag_gap = (user_hashtags - comp_avg_hashtags) / max(comp_avg_hashtags, 1.0)

        # ── Dimension 1: CTA presence gap ─────────────────────────────
        user_cta = 1.0 if caption_features.get("cta", {}).get("has_cta", False) else 0.0
        comp_cta_rate = float(patterns.get("cta_presence_rate", 0.55))
        cta_gap = user_cta - comp_cta_rate

        # ── Dimension 2: Price presence gap ───────────────────────────
        user_price = 1.0 if caption_features.get("has_price", False) else 0.0
        comp_price_rate = float(patterns.get("price_presence_rate", 0.40))
        price_gap = user_price - comp_price_rate

        # ── Dimension 3: Caption length vs ideal ──────────────────────
        user_word_count = float(caption_features.get("word_count", 0))
        comp_ideal_length = float(patterns.get("ideal_caption_length", 125.0))
        # Normalise: 1.0 when at ideal, drops symmetrically
        if comp_ideal_length > 0:
            length_ratio = user_word_count / comp_ideal_length
            # Bell-curve-like scoring centred on 1.0
            length_gap = 1.0 - min(abs(length_ratio - 1.0), 1.0)
        else:
            length_gap = 0.0

        # ── Dimension 4: Emoji usage gap ──────────────────────────────
        user_emoji = float(caption_features.get("emoji_count", 0))
        comp_avg_emoji = float(patterns.get("avg_emoji_count", 2.0))
        emoji_gap = (user_emoji - comp_avg_emoji) / max(comp_avg_emoji, 1.0)

        # ── Dimension 5: Trend alignment gap ──────────────────────────
        user_alignment = float(
            caption_features.get("trend_alignment", {}).get("score", 0.0)
        )
        comp_avg_alignment = float(patterns.get("avg_trend_alignment", 0.25))
        alignment_gap = user_alignment - comp_avg_alignment

        # ── Dimension 6: Posting time optimization ────────────────────
        # Heuristic: how close is the current hour to the optimal posting hour?
        comp_optimal_hour = int(patterns.get("optimal_posting_hour", 11))
        current_hour = datetime.now(timezone.utc).hour
        hour_diff = abs(current_hour - comp_optimal_hour)
        # Wrap around midnight
        hour_diff = min(hour_diff, 24 - hour_diff)
        time_optimization = 1.0 - (hour_diff / 12.0)  # 1.0 = perfect, 0.0 = worst

        # ── Dimension 7: Engagement rate gap ──────────────────────────
        # Not available at prediction time for new content; use category
        # checks as a proxy (caption_score approximates expected engagement)
        user_caption_score = float(caption_features.get("caption_score", 50.0))
        comp_engagement = float(patterns.get("avg_engagement_rate", 0.03))
        # Scale caption score to comparable range
        engagement_proxy = (user_caption_score / 100.0) * 0.1  # rough scaling
        engagement_gap = engagement_proxy - comp_engagement

        # ── Dimension 8: Follower-adjusted engagement gap ─────────────
        comp_follower_eng = float(patterns.get("avg_follower_engagement", 0.025))
        follower_engagement_gap = engagement_proxy - comp_follower_eng

        # ── Dimension 9: Content freshness score ──────────────────────
        # Higher = content is fresher / more recent
        comp_freshness_days = float(patterns.get("content_freshness_days", 4.0))
        # Default to fresh for new content
        freshness_score = min(1.0, comp_freshness_days / 7.0)

        gap_vector = np.array(
            [
                hashtag_gap,
                cta_gap,
                price_gap,
                length_gap,
                emoji_gap,
                alignment_gap,
                time_optimization,
                engagement_gap,
                follower_engagement_gap,
                freshness_score,
            ],
            dtype=np.float32,
        )

        if structured_log is not None:
            structured_log.debug(
                "Computed gap features",
                category=category,
                gap_vector=gap_vector.tolist(),
            )

        return gap_vector

    def analyze_competitors(
        self,
        category: str,
        limit: int = 50,
    ) -> Dict[str, Any]:
        """Analyze top competitor patterns for *category*.

        Uses MongoDB aggregation pipelines on the ``competitor_patterns``
        collection to compute average posting behaviours, top hashtags,
        and engagement benchmarks.

        Args:
            category: Business category to analyse.
            limit: Maximum number of competitor records to consider.

        Returns:
            Dict with keys ``averages``, ``top_hashtags``,
            ``engagement_benchmarks``, ``sample_size``.
        """
        if structured_log is not None:
            structured_log.info(
                "Analyzing competitors",
                category=category,
                limit=limit,
            )

        # Ensure patterns are loaded / seeded
        self.load_patterns(category)

        result: Dict[str, Any] = {
            "averages": {},
            "top_hashtags": [],
            "engagement_benchmarks": {},
            "sample_size": 0,
        }

        if self._repo.coll is None:
            # Return defaults when DB is unavailable
            defaults = self._defaults.get(category, self._defaults["general"])
            result["averages"] = dict(defaults)
            result["sample_size"] = 0
            return result

        # ── Pipeline 1: Averages ──────────────────────────────────────
        avg_pipeline: List[Dict[str, Any]] = [
            {"$match": {"category": category}},
            {"$limit": limit},
            {"$group": {
                "_id": "$category",
                "avg_hashtag_count": {"$avg": "$avg_hashtag_count"},
                "cta_presence_rate": {"$avg": "$cta_presence_rate"},
                "price_presence_rate": {"$avg": "$price_presence_rate"},
                "ideal_caption_length": {"$avg": "$ideal_caption_length"},
                "avg_emoji_count": {"$avg": "$avg_emoji_count"},
                "avg_trend_alignment": {"$avg": "$avg_trend_alignment"},
                "optimal_posting_hour": {"$avg": "$optimal_posting_hour"},
                "avg_engagement_rate": {"$avg": "$avg_engagement_rate"},
                "avg_follower_engagement": {"$avg": "$avg_follower_engagement"},
                "content_freshness_days": {"$avg": "$content_freshness_days"},
                "sample_size": {"$sum": 1},
            }},
        ]

        avg_results = self._repo.aggregate(avg_pipeline)
        if avg_results:
            doc = avg_results[0]
            doc.pop("_id", None)
            result["averages"] = doc
            result["sample_size"] = doc.get("sample_size", 0)
        else:
            defaults = self._defaults.get(category, self._defaults["general"])
            result["averages"] = dict(defaults)

        # ── Pipeline 2: Top hashtags ──────────────────────────────────
        hashtag_pipeline: List[Dict[str, Any]] = [
            {"$match": {"category": category}},
            {"$unwind": "$top_hashtags"},
            {"$group": {
                "_id": "$top_hashtags",
                "count": {"$sum": 1},
            }},
            {"$sort": {"count": -1}},
            {"$limit": 20},
        ]

        ht_results = self._repo.aggregate(hashtag_pipeline)
        result["top_hashtags"] = [r["_id"] for r in ht_results if r.get("_id")]

        # ── Pipeline 3: Engagement benchmarks ─────────────────────────
        eng_pipeline: List[Dict[str, Any]] = [
            {"$match": {"category": category}},
            {"$group": {
                "_id": "$category",
                "avg_engagement": {"$avg": "$avg_engagement_rate"},
                "max_engagement": {"$max": "$avg_engagement_rate"},
                "min_engagement": {"$min": "$avg_engagement_rate"},
                "p75_engagement": {
                    "$percentile": {
                        "input": "$avg_engagement_rate",
                        "p": 0.75,
                    }
                },
                "p25_engagement": {
                    "$percentile": {
                        "input": "$avg_engagement_rate",
                        "p": 0.25,
                    }
                },
            }},
        ]

        eng_results = self._repo.aggregate(eng_pipeline)
        if eng_results:
            doc = eng_results[0]
            doc.pop("_id", None)
            result["engagement_benchmarks"] = doc

        # Cache results
        self._patterns[category] = result.get("averages", {})

        return result

    def get_top_hashtags(
        self,
        category: str,
        limit: int = 10,
    ) -> List[str]:
        """Get the most effective competitor hashtags for *category*.

        Returns hashtags ordered by observed frequency in competitor
        content, limited to *limit* entries.
        """
        if structured_log is not None:
            structured_log.info(
                "Getting top hashtags",
                category=category,
                limit=limit,
            )

        if self._repo.coll is None:
            # Return category-specific defaults
            default_hashtags: Dict[str, List[str]] = {
                "cake": [
                    "cake", "ugandancakes", "kampala", "birthdaycake",
                    "cakelover", "bakery", "ordercake", "weddingcake",
                    "cakelife", "ugx",
                ],
                "bakery": [
                    "bakery", "freshbread", "kampala", "pastry",
                    "ugandanfood", "bakerylife", "freshlybaked",
                    "artisanbread", "order", "ugx",
                ],
                "restaurant": [
                    "restaurant", "ugandanfood", "kampalafood", "foodie",
                    "menu", "dining", "chef", "locallysourced",
                    "order", "ugx",
                ],
                "general": [
                    "ugandanbusiness", "kampala", "ugx", "order",
                    "delivery", "localfood", "smallbusiness", "fresh",
                    "foodie", "uganda",
                ],
            }
            return default_hashtags.get(category, default_hashtags["general"])[:limit]

        pipeline: List[Dict[str, Any]] = [
            {"$match": {"category": category}},
            {"$unwind": "$top_hashtags"},
            {"$group": {
                "_id": "$top_hashtags",
                "count": {"$sum": 1},
                "avg_engagement": {"$avg": "$avg_engagement_rate"},
            }},
            {"$sort": {"count": -1, "avg_engagement": -1}},
            {"$limit": limit},
        ]

        results = self._repo.aggregate(pipeline)
        return [r["_id"] for r in results if r.get("_id")]

    def get_engagement_benchmarks(self, category: str) -> Dict[str, Any]:
        """Get engagement benchmarks from competitor data for *category*.

        Returns a dict with keys like ``avg_engagement``,
        ``top_10_pct``, ``median``, and ``bottom_25_pct``.
        """
        if structured_log is not None:
            structured_log.info("Getting engagement benchmarks", category=category)

        # Ensure patterns loaded
        if category not in self._patterns:
            self.load_patterns(category)

        defaults = self._defaults.get(category, self._defaults["general"])
        avg_eng = float(defaults.get("avg_engagement_rate", 0.03))

        # Default benchmarks derived from the category average
        benchmarks: Dict[str, Any] = {
            "avg_engagement": avg_eng,
            "top_10_pct": avg_eng * 2.0,
            "median": avg_eng * 0.9,
            "bottom_25_pct": avg_eng * 0.5,
            "follower_adjusted_avg": float(
                defaults.get("avg_follower_engagement", avg_eng * 0.8)
            ),
            "category": category,
        }

        if self._repo.coll is None:
            return benchmarks

        # Try to compute from DB
        pipeline: List[Dict[str, Any]] = [
            {"$match": {"category": category}},
            {"$group": {
                "_id": "$category",
                "avg_engagement": {"$avg": "$avg_engagement_rate"},
                "max_engagement": {"$max": "$avg_engagement_rate"},
                "min_engagement": {"$min": "$avg_engagement_rate"},
                "follower_adjusted_avg": {"$avg": "$avg_follower_engagement"},
                "count": {"$sum": 1},
            }},
        ]

        results = self._repo.aggregate(pipeline)
        if results:
            doc = results[0]
            avg_e = float(doc.get("avg_engagement", avg_eng))
            max_e = float(doc.get("max_engagement", avg_eng * 2.5))
            min_e = float(doc.get("min_engagement", avg_eng * 0.3))
            follower_avg = float(doc.get("follower_adjusted_avg", avg_eng * 0.8))
            count = int(doc.get("count", 0))

            benchmarks = {
                "avg_engagement": avg_e,
                "top_10_pct": max_e,
                "median": (avg_e + max_e) / 2.0,
                "bottom_25_pct": min_e,
                "follower_adjusted_avg": follower_avg,
                "category": category,
                "sample_size": count,
            }

        return benchmarks
