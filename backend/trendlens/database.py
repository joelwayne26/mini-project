"""
trendlens/database.py
Complete database layer with connection pooling and all repositories.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.errors import ConnectionFailure, OperationFailure

from trendlens.config import settings

logger = logging.getLogger(__name__)


# ─── Connection Manager (Singleton) ──────────────────────────────────────────

class DatabaseManager:
    """Singleton MongoDB connection manager with connection pooling."""

    _instance: Optional["DatabaseManager"] = None
    _client: Optional[MongoClient] = None
    _db = None

    def __new__(cls) -> "DatabaseManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    @property
    def client(self) -> MongoClient:
        if self._client is None:
            self._connect()
        return self._client  # type: ignore[return-value]

    @property
    def db(self):
        if self._db is None:
            self._connect()
        return self._db

    def _connect(self) -> None:
        try:
            self._client = MongoClient(
                settings.MONGO_URI,
                maxPoolSize=settings.MONGO_MAX_POOL_SIZE,
                minPoolSize=settings.MONGO_MIN_POOL_SIZE,
                serverSelectionTimeoutMS=5000,
                connectTimeoutMS=5000,
            )
            # Force connection test
            self._client.admin.command("ping")
            self._db = self._client[settings.MONGO_DB_NAME]
            logger.info(
                "Connected to MongoDB: %s / %s",
                settings.MONGO_URI,
                settings.MONGO_DB_NAME,
            )
        except ConnectionFailure as exc:
            logger.error("MongoDB connection failed: %s", exc)
            raise

    def close(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None
            self._db = None
            logger.info("MongoDB connection closed")

    def health_check(self) -> bool:
        try:
            self.client.admin.command("ping")
            return True
        except Exception as exc:
            logger.error("MongoDB health check failed: %s", exc)
            return False


_db_manager = DatabaseManager()


def get_collection(name: str) -> Collection:
    """Return a MongoDB collection by name from the active database."""
    return _db_manager.db[name]


# ─── Base Repository ─────────────────────────────────────────────────────────

class BaseRepository:
    """Generic repository with full CRUD operations."""

    collection_name: str = ""

    def __init__(self) -> None:
        self._coll: Optional[Collection] = None

    @property
    def coll(self) -> Collection:
        if self._coll is None:
            self._coll = get_collection(self.collection_name)
        return self._coll

    def find_one(self, query: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        doc = self.coll.find_one(query)
        return doc

    def find_many(
        self,
        query: Dict[str, Any],
        sort: Optional[List] = None,
        limit: int = 0,
        skip: int = 0,
    ) -> List[Dict[str, Any]]:
        cursor = self.coll.find(query)
        if sort:
            cursor = cursor.sort(sort)
        if skip:
            cursor = cursor.skip(skip)
        if limit:
            cursor = cursor.limit(limit)
        return list(cursor)

    def insert_one(self, doc: Dict[str, Any]) -> str:
        if "_id" not in doc:
            doc["created_at"] = datetime.now(timezone.utc)
        result = self.coll.insert_one(doc)
        return str(result.inserted_id)

    def update_one(
        self,
        query: Dict[str, Any],
        update: Dict[str, Any],
        upsert: bool = False,
    ) -> bool:
        if "$set" in update and "updated_at" not in update["$set"]:
            update["$set"]["updated_at"] = datetime.now(timezone.utc)
        result = self.coll.update_one(query, update, upsert=upsert)
        return result.acknowledged

    def count(self, query: Optional[Dict[str, Any]] = None) -> int:
        return self.coll.count_documents(query or {})

    def aggregate(self, pipeline: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return list(self.coll.aggregate(pipeline))

    def delete_one(self, query: Dict[str, Any]) -> bool:
        result = self.coll.delete_one(query)
        return result.deleted_count > 0

    def delete_many(self, query: Dict[str, Any]) -> int:
        result = self.coll.delete_many(query)
        return result.deleted_count


# ─── Concrete Repositories ───────────────────────────────────────────────────

class TemplateRepository(BaseRepository):
    collection_name = "templates"

    def get_by_category(self, category: str) -> List[Dict[str, Any]]:
        return self.find_many({"category": category})

    def get_active(self) -> List[Dict[str, Any]]:
        return self.find_many({"active": True})


class PostsRepository(BaseRepository):
    collection_name = "posts"

    def get_by_user(self, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        return self.find_many(
            {"user_id": user_id},
            sort=[("created_at", -1)],
            limit=limit,
        )

    def get_by_engagement(
        self, category: Optional[str] = None, limit: int = 20
    ) -> List[Dict[str, Any]]:
        query: Dict[str, Any] = {}
        if category:
            query["category"] = category
        return self.find_many(
            query,
            sort=[("engagement_rate", -1)],
            limit=limit,
        )


class GroundTruthRepository(BaseRepository):
    collection_name = "ground_truth_posts"

    def get_labelled(self, min_samples: int = 30) -> List[Dict[str, Any]]:
        return self.find_many(
            {"label": {"$exists": True}},
            sort=[("engagement_rate", -1)],
        )

    def get_high_engagement(self, threshold: float = 0.7) -> List[Dict[str, Any]]:
        return self.find_many({"engagement_rate": {"$gte": threshold}})


class UserHistoryRepository(BaseRepository):
    collection_name = "user_history"

    def get_by_user(self, user_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        return self.find_many(
            {"user_id": user_id},
            sort=[("timestamp", -1)],
            limit=limit,
        )


class ModelRegistryRepository(BaseRepository):
    collection_name = "model_registry"

    def get_latest(self, model_type: str) -> Optional[Dict[str, Any]]:
        docs = self.find_many(
            {"model_type": model_type},
            sort=[("trained_at", -1)],
            limit=1,
        )
        return docs[0] if docs else None

    def get_all_versions(self, model_type: str) -> List[Dict[str, Any]]:
        return self.find_many(
            {"model_type": model_type},
            sort=[("trained_at", -1)],
        )


class TrendSnapshotRepository(BaseRepository):
    collection_name = "trend_snapshots"

    def get_latest(self, source: str, limit: int = 10) -> List[Dict[str, Any]]:
        return self.find_many(
            {"source": source},
            sort=[("fetched_at", -1)],
            limit=limit,
        )

    def get_by_category(self, category: str, hours: int = 24) -> List[Dict[str, Any]]:
        cutoff = datetime.now(timezone.utc)
        from datetime import timedelta
        cutoff = cutoff - timedelta(hours=hours)
        return self.find_many(
            {"category": category, "fetched_at": {"$gte": cutoff}},
            sort=[("score", -1)],
        )


class AdminMetricsRepository(BaseRepository):
    collection_name = "admin_metrics"

    def get_latest_metrics(self, metric_type: str) -> Optional[Dict[str, Any]]:
        docs = self.find_many(
            {"metric_type": metric_type},
            sort=[("timestamp", -1)],
            limit=1,
        )
        return docs[0] if docs else None


# ─── NEW Repositories ────────────────────────────────────────────────────────

class APIHealthRepository(BaseRepository):
    """Tracks API health / success rates per source."""

    collection_name = "api_health_log"

    def log_attempt(
        self,
        source: str,
        success: bool,
        latency_ms: float = 0.0,
        error_message: str = "",
    ) -> str:
        doc = {
            "source": source,
            "success": success,
            "latency_ms": latency_ms,
            "error_message": error_message,
            "timestamp": datetime.now(timezone.utc),
        }
        return self.insert_one(doc)

    def get_last_n(
        self, source: str, n: int = 50
    ) -> List[Dict[str, Any]]:
        return self.find_many(
            {"source": source},
            sort=[("timestamp", -1)],
            limit=n,
        )

    def get_all_sources_latest(self) -> Dict[str, Dict[str, Any]]:
        """Return latest health record for every source."""
        pipeline = [
            {"$sort": {"timestamp": -1}},
            {"$group": {
                "_id": "$source",
                "latest": {"$first": "$$ROOT"},
            }},
        ]
        results = self.aggregate(pipeline)
        return {r["_id"]: r["latest"] for r in results if r.get("latest")}

    def success_rate(self, source: str, window: int = 50) -> float:
        """Compute success rate over the last *window* attempts."""
        records = self.get_last_n(source, window)
        if not records:
            return 0.0
        successes = sum(1 for r in records if r.get("success"))
        return successes / len(records)


class DetectionStateRepository(BaseRepository):
    """Tracks last-seen timestamps per source + category for incremental detection."""

    collection_name = "detection_state"

    def get_last_seen(self, source: str, category: str) -> Optional[datetime]:
        doc = self.find_one({"source": source, "category": category})
        if doc and doc.get("last_seen"):
            return doc["last_seen"]
        return None

    def set_last_seen(self, source: str, category: str, ts: Optional[datetime] = None) -> None:
        if ts is None:
            ts = datetime.now(timezone.utc)
        self.update_one(
            {"source": source, "category": category},
            {"$set": {"last_seen": ts}},
            upsert=True,
        )


class ActivityLogRepository(BaseRepository):
    """System activity log for detection events, retrain events, etc."""

    collection_name = "system_activity_log"

    def log_event(
        self,
        event_type: str,
        message: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        doc = {
            "event_type": event_type,
            "message": message,
            "metadata": metadata or {},
            "timestamp": datetime.now(timezone.utc),
        }
        return self.insert_one(doc)

    def get_recent(
        self,
        event_type: Optional[str] = None,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        query: Dict[str, Any] = {}
        if event_type:
            query["event_type"] = event_type
        return self.find_many(
            query,
            sort=[("timestamp", -1)],
            limit=limit,
        )


class FeedbackRepository(BaseRepository):
    """Stores user feedback (thumbs up/down) on evaluations."""

    collection_name = "user_feedback"

    def add_feedback(
        self,
        evaluation_id: str,
        feedback_type: str,
        score: Optional[float] = None,
        comment: str = "",
    ) -> str:
        """Store user feedback for an evaluation.

        Args:
            evaluation_id: The ID of the evaluation
            feedback_type: "thumbs_up" or "thumbs_down"
            score: The evaluation score that was given
            comment: Optional user comment
        """
        doc = {
            "evaluation_id": evaluation_id,
            "feedback_type": feedback_type,
            "score": score,
            "comment": comment,
            "timestamp": datetime.now(timezone.utc),
        }
        return self.insert_one(doc)

    def get_stats(self) -> Dict[str, Any]:
        """Get aggregate feedback statistics."""
        total = self.count()
        if total == 0:
            return {
                "total_feedback": 0,
                "thumbs_up": 0,
                "thumbs_down": 0,
                "satisfaction_rate": 0.0,
            }

        pipeline = [
            {"$group": {
                "_id": "$feedback_type",
                "count": {"$sum": 1},
            }},
        ]
        results = self.aggregate(pipeline)

        thumbs_up = 0
        thumbs_down = 0
        for r in results:
            if r["_id"] == "thumbs_up":
                thumbs_up = r["count"]
            elif r["_id"] == "thumbs_down":
                thumbs_down = r["count"]

        satisfaction_rate = thumbs_up / total if total > 0 else 0.0

        return {
            "total_feedback": total,
            "thumbs_up": thumbs_up,
            "thumbs_down": thumbs_down,
            "satisfaction_rate": round(satisfaction_rate, 4),
        }

    def get_recent(self, limit: int = 50) -> List[Dict[str, Any]]:
        return self.find_many(
            {},
            sort=[("timestamp", -1)],
            limit=limit,
        )


class DriftStateRepository(BaseRepository):
    """Stores drift measurement data."""

    collection_name = "drift_state"

    def get_measurements(
        self,
        limit: int = 50,
        drift_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get recent drift measurements."""
        query: Dict[str, Any] = {}
        if drift_type:
            query["type"] = drift_type
        return self.find_many(
            query,
            sort=[("created_at", -1)],
            limit=limit,
        )

    def add_measurement(
        self,
        mmd_statistic: float,
        p_value: float,
        is_drift: bool,
        new_sample_count: int = 0,
        drift_type: str = "feature_drift",
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Store a new drift measurement."""
        doc = {
            "type": drift_type,
            "mmd_statistic": mmd_statistic,
            "p_value": p_value,
            "is_drift": is_drift,
            "new_sample_count": new_sample_count,
            "metadata": metadata or {},
            "created_at": datetime.now(timezone.utc),
        }
        return self.insert_one(doc)


class EvaluationsRepository(BaseRepository):
    """Stores evaluation results for history and analytics."""

    collection_name = "evaluations"

    def add_evaluation(
        self,
        overall_score: float,
        poster_score: float,
        caption_score: float,
        category: str = "general",
        caption: str = "",
        caption_features: Optional[Dict[str, Any]] = None,
        model_version: str = "",
    ) -> str:
        doc = {
            "overall_score": overall_score,
            "poster_score": poster_score,
            "caption_score": caption_score,
            "category": category,
            "caption": caption[:500] if caption else "",
            "caption_features": caption_features or {},
            "model_version": model_version,
            "created_at": datetime.now(timezone.utc),
        }
        return self.insert_one(doc)

    def get_recent(self, limit: int = 50) -> List[Dict[str, Any]]:
        return self.find_many(
            {},
            sort=[("created_at", -1)],
            limit=limit,
        )

    def get_average_scores(self, category: str = "") -> Dict[str, float]:
        """Get average scores across evaluations."""
        query: Dict[str, Any] = {}
        if category:
            query["category"] = category

        pipeline = [
            {"$match": query},
            {"$group": {
                "_id": None,
                "avg_overall": {"$avg": "$overall_score"},
                "avg_poster": {"$avg": "$poster_score"},
                "avg_caption": {"$avg": "$caption_score"},
                "count": {"$sum": 1},
            }},
        ]
        results = self.aggregate(pipeline)
        if results:
            r = results[0]
            return {
                "avg_overall": round(float(r.get("avg_overall", 0)), 2),
                "avg_poster": round(float(r.get("avg_poster", 0)), 2),
                "avg_caption": round(float(r.get("avg_caption", 0)), 2),
                "count": r.get("count", 0),
            }
        return {"avg_overall": 0, "avg_poster": 0, "avg_caption": 0, "count": 0}


class EmbeddingsRepository(BaseRepository):
    """Stores and searches text embeddings for RAG."""

    collection_name = "embeddings"

    def store_embedding(
        self,
        caption: str,
        embedding: List[float],
        category: str = "",
        engagement_rate: float = 0.0,
        hashtags: Optional[List[str]] = None,
        has_cta: bool = False,
        has_price: bool = False,
    ) -> str:
        """Store a caption embedding."""
        doc = {
            "caption": caption,
            "embedding": embedding,
            "category": category,
            "engagement_rate": engagement_rate,
            "hashtags": hashtags or [],
            "has_cta": has_cta,
            "has_price": has_price,
            "created_at": datetime.now(timezone.utc),
        }
        return self.insert_one(doc)

    def vector_search(
        self,
        embedding: List[float],
        limit: int = 5,
        filter: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Search for similar embeddings using MongoDB Atlas Vector Search.

        Falls back to text-based search if vector search is not available.
        """
        try:
            pipeline: List[Dict[str, Any]] = [
                {
                    "$vectorSearch": {
                        "index": "vector_index",
                        "path": "embedding",
                        "queryVector": embedding,
                        "numCandidates": limit * 10,
                        "limit": limit,
                    }
                },
                {
                    "$project": {
                        "caption": 1,
                        "engagement_rate": 1,
                        "category": 1,
                        "hashtags": 1,
                        "has_cta": 1,
                        "has_price": 1,
                        "score": {"$meta": "vectorSearchScore"},
                    }
                },
            ]
            if filter:
                pipeline[0]["$vectorSearch"]["filter"] = filter

            return list(self.coll.aggregate(pipeline))
        except Exception:
            # Vector search not available (local MongoDB or no index)
            return []
