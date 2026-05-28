"""
trendlens/trend_sources/twitter_rss_source.py
TwitterRSSSource — uses Nitter RSS feeds (no API key needed).
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

# Nitter instances (public mirrors of Twitter that provide RSS)
NITTER_INSTANCES: List[str] = [
    "https://nitter.net",
    "https://nitter.poast.org",
    "https://nitter.privacydev.net",
    "https://nitter.1d4.us",
    "https://nitter.kavin.rocks",
]

# Ugandan accounts to follow, organised by category
UGANDAN_ACCOUNTS: Dict[str, List[str]] = {
    "cake": [
        "cakecityug", "bakeshopug", "ug_cakes",
    ],
    "bakery": [
        "ugandabakery", "hotloafug", "breadtalkug",
    ],
    "restaurant": [
        "javahouseug", "cafesserie", "thepearlafrica",
    ],
    "general": [
        "newvisionwire", "DailyMonitor", "KCCAUG",
        "ugandainvest", "tourismuganda",
    ],
}


class TwitterRSSSource(TrendSource):
    """Fetch tweets via Nitter RSS feeds — no API key required."""

    name = "twitter_rss"

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(config)
        self._timeout = config.get("timeout", 15) if config else 15
        self._working_instance: Optional[str] = None

    def fetch(self, category: str = "general", limit: int = 20) -> List[TrendResult]:
        accounts = UGANDAN_ACCOUNTS.get(category, UGANDAN_ACCOUNTS["general"])
        results: List[TrendResult] = []

        for account in accounts:
            if len(results) >= limit:
                break
            account_results = self._fetch_account(account, category, limit - len(results))
            results.extend(account_results)

        # Deduplicate by keyword
        seen: set = set()
        unique: List[TrendResult] = []
        for r in results:
            key = r.keyword.lower().strip()[:60]
            if key not in seen:
                seen.add(key)
                unique.append(r)

        unique.sort(key=lambda r: r.score, reverse=True)
        return unique[:limit]

    def _fetch_account(
        self, account: str, category: str, limit: int
    ) -> List[TrendResult]:
        """Fetch RSS feed for a single account, trying multiple Nitter instances."""
        # Try the working instance first
        instances = NITTER_INSTANCES.copy()
        if self._working_instance:
            instances.insert(0, self._working_instance)

        for instance in instances:
            rss_url = f"{instance}/{account}/rss"
            try:
                resp = requests.get(rss_url, timeout=self._timeout)
                if resp.status_code == 200:
                    self._working_instance = instance
                    return self._parse_rss(resp.text, account, category, limit)
            except requests.RequestException:
                continue

        logger.debug(
            "[%s] All Nitter instances failed for @%s",
            self.name, account,
        )
        return []

    @staticmethod
    def _parse_rss(
        xml_text: str, account: str, category: str, limit: int
    ) -> List[TrendResult]:
        """Parse Nitter RSS feed into TrendResult objects."""
        results: List[TrendResult] = []
        try:
            root = ElementTree.fromstring(xml_text)
            items = root.findall(".//item")
            for item in items[:limit]:
                title = item.findtext("title", "")
                link = item.findtext("link", "")
                pub_date = item.findtext("pubDate", "")

                # Clean title (remove account name prefix)
                clean_title = re.sub(r"^\@\w+\s*:\s*", "", title).strip()
                if not clean_title:
                    continue

                # Score based on recency and content length
                score = 0.3
                if pub_date:
                    try:
                        from email.utils import parsedate_to_datetime
                        dt = parsedate_to_datetime(pub_date)
                        age_hours = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
                        if age_hours < 6:
                            score = 0.8
                        elif age_hours < 24:
                            score = 0.6
                        elif age_hours < 72:
                            score = 0.4
                    except Exception:
                        pass

                results.append(TrendResult(
                    keyword=clean_title[:120],
                    source="twitter_rss",
                    score=score,
                    volume=0,
                    category=category,
                    country="UG",
                    url=link,
                    metadata={
                        "account": f"@{account}",
                        "pub_date": pub_date,
                    },
                ))
        except ElementTree.ParseError as exc:
            logger.debug("RSS parse error for @%s: %s", account, exc)
        return results

    def health_check(self) -> bool:
        """Check if at least one Nitter instance is reachable."""
        for instance in NITTER_INSTANCES:
            try:
                resp = requests.get(instance, timeout=5)
                if resp.status_code == 200:
                    self._working_instance = instance
                    return True
            except requests.RequestException:
                continue
        return False
