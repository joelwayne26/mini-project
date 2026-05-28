"""
trendlens/models.py
All data models using @dataclass with to_dict() methods.
"""

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


@dataclass
class TrendSignal:
    """A single trend signal from any source."""
    keyword: str
    source: str
    score: float
    volume: int = 0
    growth_rate: float = 0.0
    category: str = "general"
    country: str = "UG"
    fetched_at: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.fetched_at:
            self.fetched_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class EvalScoreWithInterval:
    """Evaluation score with confidence interval."""
    score: float
    lower: float
    upper: float
    confidence: float = 0.95
    model_version: str = ""
    evaluated_at: str = ""

    def __post_init__(self) -> None:
        if not self.evaluated_at:
            self.evaluated_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class UserEvaluation:
    """A complete user poster evaluation record."""
    user_id: str
    image_url: str
    score: float
    score_lower: float
    score_upper: float
    caption: str = ""
    category: str = "general"
    ocr_text: str = ""
    annotations: List[Dict[str, Any]] = field(default_factory=list)
    model_version: str = ""
    created_at: str = ""

    def __post_init__(self) -> None:
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ModelRegistryEntry:
    """Registry entry for a trained model artifact."""
    model_type: str
    version: str
    path: str
    auc: float = 0.0
    samples: int = 0
    features: List[str] = field(default_factory=list)
    trained_at: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.trained_at:
            self.trained_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PlatformVariant:
    """A platform-specific caption variant."""
    platform: str
    caption: str
    hashtags: List[str] = field(default_factory=list)
    score_prediction: float = 0.0
    reasoning: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class BenchmarkResult:
    """Benchmark comparison result."""
    user_score: float
    industry_avg: float
    industry_top10: float
    category: str = ""
    percentile: float = 0.0
    dimensions: Dict[str, float] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PostingHeatmap:
    """Posting time heatmap data."""
    day_of_week: int
    hour: int
    avg_engagement: float
    post_count: int = 0
    confidence: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class UserProgress:
    """User progress tracking over time."""
    user_id: str
    period: str
    avg_score: float
    score_trend: float = 0.0
    posts_evaluated: int = 0
    best_score: float = 0.0
    improvement_areas: List[str] = field(default_factory=list)
    recorded_at: str = ""

    def __post_init__(self) -> None:
        if not self.recorded_at:
            self.recorded_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PosterAnnotation:
    """A numbered annotation on a poster image."""
    number: int
    x: float
    y: float
    title: str
    detail: str
    severity: str = "info"  # "info" | "warning" | "critical"

    VALID_SEVERITIES = ("info", "warning", "critical")

    def __post_init__(self) -> None:
        if self.severity not in self.VALID_SEVERITIES:
            self.severity = "info"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "number": self.number,
            "x": self.x,
            "y": self.y,
            "title": self.title,
            "detail": self.detail,
            "severity": self.severity,
        }
