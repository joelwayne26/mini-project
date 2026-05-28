"""
trendlens/trend_sources/apify_source.py
ApifySource — premium data source with retry logic.
"""

import logging
import time
from typing import Any, Dict, List, Optional

import requests

from trendlens.config import settings
from trendlens.trend_sources.base import TrendResult, TrendSource

logger = logging.getLogger(__name__)

APIFY_API_BASE = "https://api.apify.com/v2"
MAX_RETRIES = 3
RETRY_BACKOFF = 2  # seconds (doubled each retry)


class ApifySource(TrendSource):
    """Premium data source using Apify actors with retry logic."""

    name = "apify"

    # Apify actor IDs for social media scraping
    INSTAGRAM_SCRAPER = "apify/instagram-scraper"
    TWITTER_SCRAPER = "apidojo/twitter-scraper"
    GOOGLE_TRENDS_SCRAPER = "apify/google-trends-scraper"

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(config)
        self._token = (
            config.get("api_token", settings.APIFY_API_TOKEN)
            if config
            else settings.APIFY_API_TOKEN
        )
        self._timeout = config.get("timeout", 30) if config else 30

    def fetch(self, category: str = "general", limit: int = 20) -> List[TrendResult]:
        if not self._token:
            self._log_error("APIFY_API_TOKEN not configured")
            return []

        # Try Google Trends actor first
        results = self._run_actor(
            self.GOOGLE_TRENDS_SCRAPER,
            run_input={
                "searchTerms": [category],
                "geo": settings.PYTRENDS_GEO,
                "timeRange": "past 7 days",
            },
            category=category,
            limit=limit,
        )
        if results:
            return results[:limit]

        # Fallback: try Instagram scraper for hashtags
        results = self._run_actor(
            self.INSTAGRAM_SCRAPER,
            run_input={
                "hashtags": [category],
                "resultsLimit": limit,
            },
            category=category,
            limit=limit,
        )
        return results[:limit]

    def _run_actor(
        self,
        actor_id: str,
        run_input: Dict[str, Any],
        category: str,
        limit: int,
    ) -> List[TrendResult]:
        """Run an Apify actor with retry logic and return parsed results."""
        url = f"{APIFY_API_BASE}/acts/{actor_id}/runs?token={self._token}"

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                # Start actor run
                resp = requests.post(
                    url,
                    json=run_input,
                    timeout=self._timeout,
                )
                resp.raise_for_status()
                run_data = resp.json().get("data", {})
                run_id = run_data.get("id")

                if not run_id:
                    self._log_error("Apify run started but no run ID returned")
                    continue

                # Poll for completion
                result = self._poll_run(run_id, max_wait=120)
                if result is None:
                    continue

                # Fetch dataset items
                items = self._fetch_dataset(run_data.get("defaultDatasetId", ""), limit)
                return self._parse_items(items, category)

            except requests.RequestException as exc:
                self._log_error(
                    f"Apify actor {actor_id} attempt {attempt}/{MAX_RETRIES} failed: {exc}"
                )
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_BACKOFF * attempt)

        return []

    def _poll_run(self, run_id: str, max_wait: int = 120) -> Optional[Dict]:
        """Poll an Apify run until it finishes or times out."""
        status_url = f"{APIFY_API_BASE}/actor-runs/{run_id}?token={self._token}"
        deadline = time.time() + max_wait

        while time.time() < deadline:
            try:
                resp = requests.get(status_url, timeout=10)
                resp.raise_for_status()
                data = resp.json().get("data", {})
                status = data.get("status", "")

                if status == "SUCCEEDED":
                    return data
                elif status in ("FAILED", "ABORTED", "TIMED-OUT"):
                    self._log_error(f"Apify run {run_id} ended with status: {status}")
                    return None

                time.sleep(5)
            except requests.RequestException as exc:
                logger.debug("[%s] Poll request failed: %s", self.name, exc)
                time.sleep(5)

        self._log_error(f"Apify run {run_id} timed out after {max_wait}s")
        return None

    def _fetch_dataset(self, dataset_id: str, limit: int) -> List[Dict]:
        """Fetch items from an Apify dataset."""
        if not dataset_id:
            return []
        url = f"{APIFY_API_BASE}/datasets/{dataset_id}/items?token={self._token}&limit={limit}&clean=true"
        try:
            resp = requests.get(url, timeout=self._timeout)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            self._log_error(f"Failed to fetch dataset {dataset_id}: {exc}")
            return []

    @staticmethod
    def _parse_items(items: List[Dict], category: str) -> List[TrendResult]:
        """Parse Apify dataset items into TrendResult objects."""
        results: List[TrendResult] = []
        for item in items:
            keyword = (
                item.get("title")
                or item.get("text", "")[:80]
                or item.get("query", "")
                or item.get("hashtag", "")
            )
            if not keyword:
                continue

            volume = int(item.get("volume", 0) or 0)
            score = min(volume / 100_000, 1.0) if volume > 0 else 0.2

            results.append(TrendResult(
                keyword=str(keyword).strip(),
                source="apify",
                score=score,
                volume=volume,
                category=category,
                country="UG",
                url=item.get("url", ""),
                metadata=item,
            ))
        return results

    def health_check(self) -> bool:
        if not self._token:
            return False
        try:
            url = f"{APIFY_API_BASE}/users/me?token={self._token}"
            resp = requests.get(url, timeout=10)
            return resp.status_code == 200
        except Exception:
            return False
