"""
trendlens/trend_sources/pytrends_source.py
PyTrendsSource — uses pytrends library (free, no API key) for Google Trends data.
"""

import logging
import time
from typing import Any, Dict, List, Optional

from trendlens.config import settings
from trendlens.trend_sources.base import TrendResult, TrendSource

logger = logging.getLogger(__name__)

# Category-specific keyword lists for Uganda
KEYWORDS_BY_CATEGORY: Dict[str, List[str]] = {
    "cake": [
        "birthday cake Uganda", "wedding cake Kampala", "cake delivery Uganda",
        "custom cakes Kampala", "cupcakes Uganda", "cake shop Kampala",
        "engagement cake Uganda", "baby shower cake Uganda",
    ],
    "bakery": [
        "bakery Uganda", "bread Kampala", "pastries Uganda",
        "fresh bread delivery", "artisan bakery Uganda", "pastry shop Kampala",
        "Ugandan baked goods", "local bakery near me",
    ],
    "restaurant": [
        "restaurant Kampala", "Ugandan food", "local restaurant Uganda",
        "fine dining Kampala", "street food Uganda", "rolex Uganda",
        "matooke restaurant", "luwombo Kampala",
    ],
    "general": [
        "Uganda trending", "Kampala events", "Ugandan business",
        "Uganda social media", "Kampala lifestyle", "Uganda food",
        "Ugandan fashion", "Kampala nightlife",
    ],
}


class PyTrendsSource(TrendSource):
    """Free Google Trends data via pytrends library — no API key needed."""

    name = "pytrends"

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(config)
        self._geo = config.get("geo", settings.PYTRENDS_GEO) if config else settings.PYTRENDS_GEO
        self._timeframe = config.get("timeframe", "today 3-m") if config else "today 3-m"

    def fetch(self, category: str = "general", limit: int = 20) -> List[TrendResult]:
        results: List[TrendResult] = []

        # 1) Interest over time for category keywords
        iot_results = self._fetch_interest_over_time(category)
        results.extend(iot_results)

        # 2) Trending searches
        ts_results = self._fetch_trending_searches(category)
        results.extend(ts_results)

        # Deduplicate by keyword
        seen = set()
        unique: List[TrendResult] = []
        for r in results:
            key = r.keyword.lower().strip()
            if key not in seen:
                seen.add(key)
                unique.append(r)

        return unique[:limit]

    def _fetch_interest_over_time(self, category: str) -> List[TrendResult]:
        """Fetch interest_over_time for category keywords."""
        try:
            from pytrends.request import TrendReq
        except ImportError:
            self._log_error("pytrends not installed — install with: pip install pytrends")
            return []

        keywords = KEYWORDS_BY_CATEGORY.get(category, KEYWORDS_BY_CATEGORY["general"])
        results: List[TrendResult] = []

        # pytrends supports max 5 keywords per request
        for i in range(0, len(keywords), 5):
            batch = keywords[i: i + 5]
            try:
                pytrend = TrendReq(hl="en-US", tz=0)
                pytrend.build_payload(
                    kw_list=batch,
                    cat=0,
                    timeframe=self._timeframe,
                    geo=self._geo,
                    gprop="",
                )
                df = pytrend.interest_over_time()
                if df is None or df.empty:
                    continue

                # Take the most recent values
                latest = df.iloc[-1]
                for kw in batch:
                    if kw in latest:
                        val = float(latest[kw])
                        if val > 0:
                            results.append(TrendResult(
                                keyword=kw,
                                source=self.name,
                                score=val / 100.0,
                                volume=int(val * 1000),
                                growth_rate=self._compute_growth(df, kw),
                                category=category,
                                country=self._geo,
                            ))

                time.sleep(1)  # Rate limit courtesy

            except Exception as exc:
                logger.debug(
                    "[%s] interest_over_time batch %d failed: %s",
                    self.name, i, exc,
                )
                continue

        return results

    def _fetch_trending_searches(self, category: str) -> List[TrendResult]:
        """Fetch currently trending searches for the geo region."""
        try:
            from pytrends.request import TrendReq
        except ImportError:
            return []

        results: List[TrendResult] = []
        try:
            pytrend = TrendReq(hl="en-US", tz=0)
            # trending_searches returns a DataFrame
            df = pytrend.trending_searches(pn=self._geo.lower() if len(self._geo) == 2 else "uganda")
            if df is not None and not df.empty:
                for idx, row in df.head(20).iterrows():
                    title = str(row.iloc[0]) if len(row) > 0 else ""
                    if title:
                        results.append(TrendResult(
                            keyword=title.strip(),
                            source=self.name,
                            score=0.5,
                            volume=0,
                            category=category,
                            country=self._geo,
                        ))
        except Exception as exc:
            logger.debug("[%s] trending_searches failed: %s", self.name, exc)

        return results

    @staticmethod
    def _compute_growth(df, keyword: str) -> float:
        """Compute growth rate from interest_over_time DataFrame."""
        try:
            series = df[keyword].dropna()
            if len(series) < 2:
                return 0.0
            recent = float(series.iloc[-1])
            earlier = float(series.iloc[0])
            if earlier == 0:
                return 1.0 if recent > 0 else 0.0
            return (recent - earlier) / earlier
        except Exception:
            return 0.0

    def health_check(self) -> bool:
        try:
            from pytrends.request import TrendReq
            pytrend = TrendReq(hl="en-US", tz=0)
            pytrend.build_payload(kw_list=["test"], geo=self._geo, timeframe="today 1-m")
            df = pytrend.interest_over_time()
            return True  # If no exception, it's healthy
        except ImportError:
            return False
        except Exception as exc:
            logger.debug("[%s] health_check failed: %s", self.name, exc)
            return False
