"""
trendlens/trend_sources/__init__.py
Export all trend sources and base classes.
"""

from trendlens.trend_sources.base import TrendResult, TrendSource
from trendlens.trend_sources.rss_source import RSSSource
from trendlens.trend_sources.apify_source import ApifySource
from trendlens.trend_sources.pytrends_source import PyTrendsSource
from trendlens.trend_sources.reddit_source import RedditSource
from trendlens.trend_sources.youtube_source import YouTubeSource
from trendlens.trend_sources.twitter_rss_source import TwitterRSSSource

__all__ = [
    "TrendSource",
    "TrendResult",
    "RSSSource",
    "ApifySource",
    "PyTrendsSource",
    "RedditSource",
    "YouTubeSource",
    "TwitterRSSSource",
]
