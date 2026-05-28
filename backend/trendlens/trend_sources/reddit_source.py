"""
trendlens/trend_sources/reddit_source.py
RedditSource — uses praw library to fetch trending Reddit posts.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from trendlens.config import settings
from trendlens.trend_sources.base import TrendResult, TrendSource

logger = logging.getLogger(__name__)

# Subreddits per category relevant to Uganda and food/business
SUBREDDITS_BY_CATEGORY: Dict[str, List[str]] = {
    "cake": [
        "Baking", "baking", "CakeDecorating", "cakedecorating",
        "Uganda", "Kampala",
    ],
    "bakery": [
        "Baking", "breadit", "Uganda", "Kampala",
    ],
    "restaurant": [
        "restaurants", "food", "Uganda", "Kampala", "AfricanFood",
    ],
    "general": [
        "Uganda", "Kampala", "africa", "Entrepreneur", "smallbusiness",
    ],
}


class RedditSource(TrendSource):
    """Fetch trending posts from Reddit using PRAW."""

    name = "reddit"

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        super().__init__(config)
        self._client_id = (
            config.get("client_id", settings.REDDIT_CLIENT_ID)
            if config
            else settings.REDDIT_CLIENT_ID
        )
        self._client_secret = (
            config.get("client_secret", settings.REDDIT_CLIENT_SECRET)
            if config
            else settings.REDDIT_CLIENT_SECRET
        )
        self._user_agent = (
            config.get("user_agent", settings.REDDIT_USER_AGENT)
            if config
            else settings.REDDIT_USER_AGENT
        )

    def _get_reddit(self):
        """Lazy-initialise PRAW Reddit instance."""
        try:
            import praw
            return praw.Reddit(
                client_id=self._client_id,
                client_secret=self._client_secret,
                user_agent=self._user_agent,
            )
        except ImportError:
            self._log_error("praw not installed — install with: pip install praw")
            return None
        except Exception as exc:
            self._log_error(f"Reddit client init failed: {exc}")
            return None

    def fetch(self, category: str = "general", limit: int = 20) -> List[TrendResult]:
        reddit = self._get_reddit()
        if reddit is None:
            return []

        subreddits = SUBREDDITS_BY_CATEGORY.get(category, SUBREDDITS_BY_CATEGORY["general"])
        results: List[TrendResult] = []

        for sub_name in subreddits:
            try:
                subreddit = reddit.subreddit(sub_name)
                # Fetch hot posts
                for post in subreddit.hot(limit=min(limit, 25)):
                    # Normalize upvotes to 0-1 score
                    # Typical hot post upvotes range: 0-10000+
                    score = self._normalize_upvotes(post.score)
                    keyword = post.title[:120] if post.title else ""

                    if keyword:
                        results.append(TrendResult(
                            keyword=keyword,
                            source=self.name,
                            score=score,
                            volume=post.score,
                            growth_rate=0.0,
                            category=category,
                            country="UG",
                            url=f"https://reddit.com{post.permalink}",
                            metadata={
                                "subreddit": sub_name,
                                "upvotes": post.score,
                                "num_comments": post.num_comments,
                                "created_utc": datetime.fromtimestamp(
                                    post.created_utc, tz=timezone.utc
                                ).isoformat(),
                            },
                        ))
            except Exception as exc:
                logger.debug(
                    "[%s] Failed to fetch from r/%s: %s",
                    self.name, sub_name, exc,
                )
                continue

        # Sort by score descending
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:limit]

    @staticmethod
    def _normalize_upvotes(upvotes: int) -> float:
        """Normalize upvotes to 0-1 range using log scale."""
        if upvotes <= 0:
            return 0.01
        import math
        # Use log scale: 1 upvote → 0.05, 10 → 0.23, 100 → 0.46, 1000 → 0.69, 10000 → 0.92
        normalized = min(math.log10(max(upvotes, 1)) / 5.0, 1.0)
        return round(normalized, 3)

    def health_check(self) -> bool:
        if not self._client_id or not self._client_secret:
            return False
        try:
            reddit = self._get_reddit()
            if reddit is None:
                return False
            # Try to read a public subreddit
            reddit.subreddit("test").id
            return True
        except Exception as exc:
            logger.debug("[%s] health_check failed: %s", self.name, exc)
            return False
