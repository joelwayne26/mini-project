"""
trendlens/trend_sources/rss_source.py
RSSSource — fetches Google Trends RSS for Uganda and news feeds.
"""

import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from xml.etree import ElementTree

import requests

from trendlens.config import settings
from trendlens.trend_sources.base import TrendResult, TrendSource

logger = logging.getLogger(__name__)

# Google Trends RSS endpoints
GOOGLE_TRENDS_RSS = "https://trends.google.com/trending/rss?geo={geo}"
NEWS_RSS_FEEDS = {
    "general": [
        "https://feeds.feedburner.com/ugandan-news",
        "https://www.monitor.co.ug/rss/rss.xml",
    ],
    "cake": [
        "https://www.bakeryandsnacks.com/rss",
    ],
    "bakery": [
        "https://www.bakeryandsnacks.com/rss",
    ],
    "restaurant": [
        "https://www.restaurantbusinessonline.com/rss",
    ],
}


class RSSSource(TrendSource):
    """Fetch trending topics from Google Trends RSS and news feeds for Uganda."""

    name = "rss"

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(config)
        self._geo = config.get("geo", settings.PYTRENDS_GEO) if config else settings.PYTRENDS_GEO
        self._timeout = config.get("timeout", 15) if config else 15

    def fetch(self, category: str = "general", limit: int = 20) -> List[TrendResult]:
        results: List[TrendResult] = []

        # Fetch Google Trends RSS
        gt_results = self._fetch_google_trends(category, limit)
        results.extend(gt_results)

        # Fetch news RSS feeds
        news_results = self._fetch_news_feeds(category, max(0, limit - len(results)))
        results.extend(news_results)

        return results[:limit]

    def _fetch_google_trends(self, category: str, limit: int) -> List[TrendResult]:
        url = GOOGLE_TRENDS_RSS.format(geo=self._geo)
        try:
            resp = requests.get(url, timeout=self._timeout)
            resp.raise_for_status()
            return self._parse_google_trends_rss(resp.text, category, limit)
        except requests.RequestException as exc:
            self._log_error(f"Google Trends RSS fetch failed: {exc}")
            return []

    def _parse_google_trends_rss(
        self, xml_text: str, category: str, limit: int
    ) -> List[TrendResult]:
        results: List[TrendResult] = []
        try:
            root = ElementTree.fromstring(xml_text)
            items = root.findall(".//item")
            for item in items[:limit]:
                title = item.findtext("title", "")
                traffic = item.findtext("ht:approx_traffic", "")
                link = item.findtext("link", "")
                pub_date = item.findtext("pubDate", "")

                # Parse traffic to a numeric volume
                volume = 0
                if traffic:
                    volume = int(re.sub(r"[^\d]", "", traffic) or "0")

                # Normalise score by traffic (cap at 1M)
                score = min(volume / 1_000_000, 1.0) if volume > 0 else 0.1

                if title:
                    results.append(TrendResult(
                        keyword=title.strip(),
                        source=self.name,
                        score=score,
                        volume=volume,
                        category=category,
                        country=self._geo,
                        url=link,
                        metadata={"pub_date": pub_date, "approx_traffic": traffic},
                    ))
        except ElementTree.ParseError as exc:
            self._log_error(f"Google Trends RSS parse error: {exc}")
        return results

    def _fetch_news_feeds(self, category: str, limit: int) -> List[TrendResult]:
        if limit <= 0:
            return []

        feeds = NEWS_RSS_FEEDS.get(category, NEWS_RSS_FEEDS.get("general", []))
        results: List[TrendResult] = []

        for feed_url in feeds:
            try:
                resp = requests.get(feed_url, timeout=self._timeout)
                resp.raise_for_status()
                feed_results = self._parse_generic_rss(resp.text, category, feed_url, limit - len(results))
                results.extend(feed_results)
                if len(results) >= limit:
                    break
            except requests.RequestException as exc:
                logger.debug("[%s] Feed fetch failed for %s: %s", self.name, feed_url, exc)
                continue

        return results[:limit]

    @staticmethod
    def _parse_generic_rss(
        xml_text: str, category: str, feed_url: str, limit: int
    ) -> List[TrendResult]:
        results: List[TrendResult] = []
        try:
            root = ElementTree.fromstring(xml_text)
            items = root.findall(".//item")
            for item in items[:limit]:
                title = item.findtext("title", "")
                link = item.findtext("link", "")
                if title:
                    results.append(TrendResult(
                        keyword=title.strip(),
                        source="rss",
                        score=0.3,  # Default score for news items
                        volume=0,
                        category=category,
                        country="UG",
                        url=link,
                        metadata={"feed_url": feed_url},
                    ))
        except ElementTree.ParseError:
            pass
        return results

    def health_check(self) -> bool:
        try:
            url = GOOGLE_TRENDS_RSS.format(geo=self._geo)
            resp = requests.get(url, timeout=5)
            return resp.status_code == 200
        except Exception:
            return False
