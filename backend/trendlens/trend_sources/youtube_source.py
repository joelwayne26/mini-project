"""
trendlens/trend_sources/youtube_source.py
YouTubeSource — uses YouTube Data API v3 (free 10k units/day) for Ugandan food searches.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from trendlens.config import settings
from trendlens.trend_sources.base import TrendResult, TrendSource

logger = logging.getLogger(__name__)

YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3"

# Category-specific search queries for Ugandan food/business
QUERIES_BY_CATEGORY: Dict[str, List[str]] = {
    "cake": [
        "birthday cake Uganda", "wedding cake Kampala",
        "cake decorating tutorial Uganda", "Ugandan cake recipes",
    ],
    "bakery": [
        "bakery Uganda", "bread making Uganda",
        "Kampala bakery tour", "Ugandan pastries",
    ],
    "restaurant": [
        "Ugandan food recipes", "Kampala restaurant review",
        "rolex Uganda street food", "Ugandan cooking",
    ],
    "general": [
        "Uganda trending", "Kampala vlog",
        "Ugandan business 2024", "Uganda lifestyle",
    ],
}


class YouTubeSource(TrendSource):
    """Fetch trending YouTube videos using the Data API v3."""

    name = "youtube"

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(config)
        self._api_key = (
            config.get("api_key", settings.YOUTUBE_API_KEY)
            if config
            else settings.YOUTUBE_API_KEY
        )
        self._timeout = config.get("timeout", 15) if config else 15
        self._quota_used = 0
        self._quota_max = 10000  # Free daily limit

    def fetch(self, category: str = "general", limit: int = 20) -> List[TrendResult]:
        if not self._api_key:
            self._log_error("YOUTUBE_API_KEY not configured")
            return []

        if self._quota_used >= self._quota_max:
            self._log_error("YouTube API daily quota exhausted")
            return []

        queries = QUERIES_BY_CATEGORY.get(category, QUERIES_BY_CATEGORY["general"])
        results: List[TrendResult] = []

        for query in queries:
            if len(results) >= limit:
                break
            if self._quota_used >= self._quota_max:
                break

            search_results = self._search(query, category, limit - len(results))
            results.extend(search_results)
            # search.list costs ~100 units per call
            self._quota_used += 100

        # Enrich with video statistics
        if results:
            results = self._enrich_with_stats(results)

        results.sort(key=lambda r: r.score, reverse=True)
        return results[:limit]

    def _search(
        self, query: str, category: str, limit: int
    ) -> List[TrendResult]:
        """Search YouTube for videos matching a query."""
        params = {
            "part": "snippet",
            "q": query,
            "type": "video",
            "maxResults": min(limit, 10),
            "regionCode": settings.PYTRENDS_GEO,
            "relevanceLanguage": "en",
            "order": "viewCount",
            "publishedAfter": self._published_after(),
            "key": self._api_key,
        }

        try:
            resp = requests.get(
                f"{YOUTUBE_API_BASE}/search",
                params=params,
                timeout=self._timeout,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as exc:
            self._log_error(f"YouTube search failed for '{query}': {exc}")
            return []

        results: List[TrendResult] = []
        for item in data.get("items", []):
            video_id = item.get("id", {}).get("videoId", "")
            snippet = item.get("snippet", {})
            title = snippet.get("title", "")

            if not title or not video_id:
                continue

            results.append(TrendResult(
                keyword=title.strip(),
                source=self.name,
                score=0.3,  # Will be updated by stats
                volume=0,
                category=category,
                country=settings.PYTRENDS_GEO,
                url=f"https://youtube.com/watch?v={video_id}",
                metadata={
                    "video_id": video_id,
                    "channel": snippet.get("channelTitle", ""),
                    "published_at": snippet.get("publishedAt", ""),
                    "query": query,
                },
            ))

        return results

    def _enrich_with_stats(self, results: List[TrendResult]) -> List[TrendResult]:
        """Fetch view counts and like counts for videos."""
        video_ids = [
            r.metadata.get("video_id", "")
            for r in results
            if r.metadata.get("video_id")
        ]
        if not video_ids:
            return results

        # Batch request (max 50 IDs)
        for i in range(0, len(video_ids), 50):
            batch = video_ids[i: i + 50]
            params = {
                "part": "statistics",
                "id": ",".join(batch),
                "key": self._api_key,
            }
            try:
                resp = requests.get(
                    f"{YOUTUBE_API_BASE}/videos",
                    params=params,
                    timeout=self._timeout,
                )
                resp.raise_for_status()
                data = resp.json()
                self._quota_used += 1  # videos.list = 1 unit
            except requests.RequestException as exc:
                logger.debug("[%s] Stats fetch failed: %s", self.name, exc)
                continue

            # Build lookup
            stats_by_id: Dict[str, Dict] = {}
            for item in data.get("items", []):
                stats_by_id[item["id"]] = item.get("statistics", {})

            # Update results
            for r in results:
                vid = r.metadata.get("video_id", "")
                stats = stats_by_id.get(vid, {})
                if stats:
                    views = int(stats.get("viewCount", 0) or 0)
                    likes = int(stats.get("likeCount", 0) or 0)
                    r.volume = views
                    r.score = self._views_to_score(views)
                    r.metadata["views"] = views
                    r.metadata["likes"] = likes

        return results

    @staticmethod
    def _views_to_score(views: int) -> float:
        """Convert view count to normalised 0-1 score."""
        if views <= 0:
            return 0.01
        import math
        return min(math.log10(max(views, 1)) / 7.0, 1.0)

    @staticmethod
    def _published_after() -> str:
        """Return ISO 8601 date for 30 days ago."""
        from datetime import timedelta
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        return cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")

    def health_check(self) -> bool:
        if not self._api_key:
            return False
        try:
            params = {
                "part": "snippet",
                "q": "test",
                "maxResults": 1,
                "key": self._api_key,
            }
            resp = requests.get(
                f"{YOUTUBE_API_BASE}/search",
                params=params,
                timeout=10,
            )
            return resp.status_code == 200
        except Exception:
            return False
