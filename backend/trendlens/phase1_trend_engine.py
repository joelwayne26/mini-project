"""
trendlens/phase1_trend_engine.py
Enhanced trend engine with all new sources, velocity watching, and advanced scoring.
"""

import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from trendlens.config import settings
from trendlens.database import TrendSnapshotRepository, APIHealthRepository
from trendlens.models import TrendSignal
from trendlens.monitoring import prometheus, structured_log, timing_metric
from trendlens.trend_sources.base import TrendResult, TrendSource
from trendlens.trend_sources.rss_source import RSSSource
from trendlens.trend_sources.apify_source import ApifySource
from trendlens.trend_sources.pytrends_source import PyTrendsSource
from trendlens.trend_sources.reddit_source import RedditSource
from trendlens.trend_sources.youtube_source import YouTubeSource
from trendlens.trend_sources.twitter_rss_source import TwitterRSSSource

logger = logging.getLogger(__name__)


# ─── Trend Velocity Watcher ─────────────────────────────────────────────────

class TrendVelocityWatcher:
    """Tracks how quickly a keyword is gaining momentum."""

    def __init__(self, snapshot_repo: Optional[TrendSnapshotRepository] = None) -> None:
        self._repo = snapshot_repo or TrendSnapshotRepository()

    def compute_velocity(self, keyword: str, source: str, hours: int = 48) -> float:
        """Compute velocity (growth rate) for a keyword over the given time window."""
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        records = self._repo.find_many(
            {"keyword": keyword, "source": source, "fetched_at": {"$gte": cutoff}},
            sort=[("fetched_at", 1)],
        )
        if len(records) < 2:
            return 0.0

        # Simple linear regression on scores
        scores = [float(r.get("score", 0)) for r in records]
        n = len(scores)
        if n < 2:
            return 0.0

        x_mean = (n - 1) / 2.0
        y_mean = sum(scores) / n
        numerator = 0.0
        denominator = 0.0
        for i, y in enumerate(scores):
            numerator += (i - x_mean) * (y - y_mean)
            denominator += (i - x_mean) ** 2

        if denominator == 0:
            return 0.0

        slope = numerator / denominator
        # Normalise to -1..1 range
        return max(-1.0, min(1.0, slope * 10))

    def get_accelerating(self, source: str, top_n: int = 10) -> List[TrendSignal]:
        """Return keywords with positive velocity for a given source."""
        pipeline = [
            {"$match": {"source": source}},
            {"$group": {"_id": "$keyword", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
            {"$limit": top_n * 3},
        ]
        groups = self._repo.aggregate(pipeline)
        signals: List[TrendSignal] = []
        for g in groups:
            kw = g["_id"]
            vel = self.compute_velocity(kw, source)
            if vel > 0.05:
                signals.append(TrendSignal(
                    keyword=kw,
                    source=source,
                    score=vel,
                    growth_rate=vel,
                ))
        signals.sort(key=lambda s: s.score, reverse=True)
        return signals[:top_n]


# ─── Trend Source Manager ────────────────────────────────────────────────────

class TrendSourceManager:
    """Manages all trend sources and fetches data with health tracking."""

    def __init__(
        self,
        health_repo: Optional[APIHealthRepository] = None,
        snapshot_repo: Optional[TrendSnapshotRepository] = None,
    ) -> None:
        self._health_repo = health_repo or APIHealthRepository()
        self._snapshot_repo = snapshot_repo or TrendSnapshotRepository()
        self._sources: List[TrendSource] = []
        self._init_sources()

    def _init_sources(self) -> None:
        """Initialise all trend sources in priority order."""
        source_classes = [
            ApifySource,
            PyTrendsSource,
            RedditSource,
            YouTubeSource,
            TwitterRSSSource,
            RSSSource,
        ]
        for cls in source_classes:
            try:
                source = cls()
                if source.health_check():
                    self._sources.append(source)
                    logger.info("Trend source '%s' is healthy", source.name)
                else:
                    logger.warning("Trend source '%s' health check failed — skipping", source.name)
            except Exception as exc:
                logger.warning("Failed to init source %s: %s", cls.__name__, exc)

        if not self._sources:
            logger.warning("No trend sources available — adding RSS as fallback")
            self._sources.append(RSSSource())

    def get_sources(self) -> List[TrendSource]:
        return self._sources

    def fetch_from_source(
        self, source: TrendSource, category: str, limit: int
    ) -> List[TrendResult]:
        """Fetch from a single source with health logging."""
        start_time = datetime.now(timezone.utc)
        try:
            results = source.fetch(category=category, limit=limit)
            elapsed = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000

            self._health_repo.log_attempt(
                source=source.name,
                success=True,
                latency_ms=elapsed,
            )
            prometheus.inc_counter("trend_fetch_success", labels={"source": source.name})

            # Store snapshots
            for r in results:
                self._snapshot_repo.insert_one(r.to_dict())

            return results
        except Exception as exc:
            elapsed = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
            self._health_repo.log_attempt(
                source=source.name,
                success=False,
                latency_ms=elapsed,
                error_message=str(exc),
            )
            prometheus.inc_counter("trend_fetch_failure", labels={"source": source.name})
            logger.error("Fetch from %s failed: %s", source.name, exc)
            return []

    def fetch_all(self, category: str = "general", limit_per_source: int = 10) -> List[TrendResult]:
        """Fetch from all available sources and merge results."""
        all_results: List[TrendResult] = []
        for source in self._sources:
            results = self.fetch_from_source(source, category, limit_per_source)
            all_results.extend(results)
        return all_results


# ─── Advanced Trend Scorer ───────────────────────────────────────────────────

class AdvancedTrendScorer:
    """Scores and ranks trends using multiple signals."""

    WEIGHTS = {
        "recency": 0.25,
        "velocity": 0.25,
        "source_diversity": 0.20,
        "volume": 0.15,
        "category_relevance": 0.15,
    }

    def __init__(self, velocity_watcher: Optional[TrendVelocityWatcher] = None) -> None:
        self._velocity = velocity_watcher or TrendVelocityWatcher()

    def score_trends(
        self,
        results: List[TrendResult],
        category: str = "general",
    ) -> List[TrendSignal]:
        """Score and rank a list of raw trend results."""
        if not results:
            return []

        # Group by keyword (case-insensitive)
        grouped: Dict[str, List[TrendResult]] = defaultdict(list)
        for r in results:
            key = r.keyword.lower().strip()
            grouped[key].append(r)

        signals: List[TrendSignal] = []
        now = datetime.now(timezone.utc)

        for keyword, items in grouped.items():
            # Use the best-scoring item as the representative
            best = max(items, key=lambda r: r.score)

            # Recency: how recent is the freshest result?
            recency_score = self._recency_score(items, now)

            # Velocity
            velocity_score = abs(self._velocity.compute_velocity(keyword, best.source))

            # Source diversity: how many different sources reported this?
            unique_sources = len(set(r.source for r in items))
            diversity_score = min(unique_sources / 4.0, 1.0)

            # Volume
            max_volume = max(r.volume for r in items)
            volume_score = min(max_volume / 100_000, 1.0) if max_volume > 0 else 0.0

            # Category relevance
            relevance = 1.0 if best.category == category else 0.5

            # Weighted composite
            composite = (
                self.WEIGHTS["recency"] * recency_score
                + self.WEIGHTS["velocity"] * velocity_score
                + self.WEIGHTS["source_diversity"] * diversity_score
                + self.WEIGHTS["volume"] * volume_score
                + self.WEIGHTS["category_relevance"] * relevance
            )

            signals.append(TrendSignal(
                keyword=keyword,
                source="+".join(set(r.source for r in items)),
                score=composite,
                volume=max_volume,
                growth_rate=velocity_score,
                category=category,
                country=best.country,
                metadata={
                    "recency": recency_score,
                    "velocity": velocity_score,
                    "diversity": diversity_score,
                    "volume_score": volume_score,
                    "relevance": relevance,
                    "source_count": unique_sources,
                },
            ))

        signals.sort(key=lambda s: s.score, reverse=True)
        return signals

    @staticmethod
    def _recency_score(items: List[TrendResult], now: datetime) -> float:
        """Score based on how recent the data is (1.0 = just now, 0.0 = >48h)."""
        best_recency = 0.0
        for item in items:
            try:
                fetched = datetime.fromisoformat(item.fetched_at)
                if fetched.tzinfo is None:
                    fetched = fetched.replace(tzinfo=timezone.utc)
                age_hours = (now - fetched).total_seconds() / 3600
                recency = max(0.0, 1.0 - age_hours / 48.0)
                best_recency = max(best_recency, recency)
            except (ValueError, TypeError):
                continue
        return best_recency if best_recency > 0 else 0.5


# ─── Main Entry Point ────────────────────────────────────────────────────────

@timing_metric("trend_engine_fetch_trends")
def fetch_trends(
    category: str = "general",
    limit: int = 20,
) -> List[TrendSignal]:
    """Main entry point: fetch, deduplicate, and score trends across all sources."""
    structured_log.info("Fetching trends", category=category, limit=limit)

    manager = TrendSourceManager()
    raw_results = manager.fetch_all(category=category, limit_per_source=15)

    if not raw_results:
        structured_log.warning("No trend results fetched from any source")
        return []

    scorer = AdvancedTrendScorer()
    signals = scorer.score_trends(raw_results, category=category)

    structured_log.info(
        "Trend fetch complete",
        raw_count=len(raw_results),
        scored_count=len(signals),
        top_keyword=signals[0].keyword if signals else "",
    )

    return signals[:limit]
