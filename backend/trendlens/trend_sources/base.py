"""
trendlens/trend_sources/base.py
TrendResult dataclass and TrendSource abstract base class.
"""

import logging
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class TrendResult:
    """Normalised result from any trend source."""
    keyword: str
    source: str
    score: float  # 0-1 normalised
    volume: int = 0
    growth_rate: float = 0.0
    category: str = "general"
    country: str = "UG"
    url: str = ""
    fetched_at: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.fetched_at:
            self.fetched_at = datetime.now(timezone.utc).isoformat()
        # Clamp score to 0-1
        self.score = max(0.0, min(1.0, self.score))

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class TrendSource(ABC):
    """Abstract base class for all trend data sources."""

    name: str = "base"

    def __init__(self, config: Optional[Dict[str, Any]] = None) -> None:
        self.config = config or {}
        self._last_error: Optional[str] = None

    @abstractmethod
    def fetch(self, category: str = "general", limit: int = 20) -> List[TrendResult]:
        """Fetch trending data for a given category."""
        ...

    @abstractmethod
    def health_check(self) -> bool:
        """Check if this source is available and properly configured."""
        ...

    @property
    def last_error(self) -> Optional[str]:
        return self._last_error

    def _log_error(self, message: str) -> None:
        self._last_error = message
        logger.error("[%s] %s", self.name, message)

    def _log_info(self, message: str) -> None:
        logger.info("[%s] %s", self.name, message)
