"""
trendlens/monitoring.py
Complete monitoring module: structured logging, Sentry integration, Prometheus metrics.
"""

import functools
import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


# ─── Structured Logger ───────────────────────────────────────────────────────

class StructuredLogger:
    """JSON-friendly structured logger for TrendLens."""

    def __init__(self, name: str = "trendlens") -> None:
        self._logger = logging.getLogger(name)

    def _format(self, message: str, **kwargs: Any) -> Dict[str, Any]:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "message": message,
        }
        entry.update(kwargs)
        return entry

    def info(self, message: str, **kwargs: Any) -> None:
        data = self._format(message, **kwargs)
        self._logger.info("%s", data)

    def warning(self, message: str, **kwargs: Any) -> None:
        data = self._format(message, **kwargs)
        self._logger.warning("%s", data)

    def error(self, message: str, **kwargs: Any) -> None:
        data = self._format(message, **kwargs)
        self._logger.error("%s", data)

    def debug(self, message: str, **kwargs: Any) -> None:
        data = self._format(message, **kwargs)
        self._logger.debug("%s", data)

    def critical(self, message: str, **kwargs: Any) -> None:
        data = self._format(message, **kwargs)
        self._logger.critical("%s", data)


# ─── Sentry Integration ─────────────────────────────────────────────────────

class SentryIntegration:
    """Lightweight Sentry wrapper — no-op when DSN is not configured."""

    def __init__(self, dsn: Optional[str] = None) -> None:
        self._dsn = dsn
        self._client = None
        self._initialized = False

    def init(self) -> None:
        if not self._dsn:
            logger.info("Sentry DSN not configured — skipping init")
            return
        try:
            import sentry_sdk
            sentry_sdk.init(dsn=self._dsn, traces_sample_rate=0.1)
            self._client = sentry_sdk
            self._initialized = True
            logger.info("Sentry initialised")
        except ImportError:
            logger.warning("sentry_sdk not installed — Sentry integration disabled")
        except Exception as exc:
            logger.error("Sentry init failed: %s", exc)

    def capture_exception(self, exc: Exception) -> None:
        if self._initialized and self._client:
            try:
                self._client.capture_exception(exc)
            except Exception:
                pass

    def capture_message(self, message: str, level: str = "info") -> None:
        if self._initialized and self._client:
            try:
                self._client.capture_message(message, level=level)
            except Exception:
                pass

    def add_breadcrumb(self, category: str, message: str, data: Optional[Dict] = None) -> None:
        if self._initialized and self._client:
            try:
                self._client.add_breadcrumb(
                    category=category, message=message, data=data or {}
                )
            except Exception:
                pass


# ─── Prometheus Metrics ──────────────────────────────────────────────────────

class PrometheusMetrics:
    """In-process Prometheus metrics collector (no external server)."""

    def __init__(self) -> None:
        self._counters: Dict[str, float] = {}
        self._gauges: Dict[str, float] = {}
        self._histograms: Dict[str, list] = {}
        self._registry: Dict[str, str] = {}  # name -> type

    def inc_counter(self, name: str, value: float = 1.0, labels: Optional[Dict] = None) -> None:
        key = self._labelled_key(name, labels)
        self._counters[key] = self._counters.get(key, 0.0) + value
        self._registry[key] = "counter"

    def set_gauge(self, name: str, value: float, labels: Optional[Dict] = None) -> None:
        key = self._labelled_key(name, labels)
        self._gauges[key] = value
        self._registry[key] = "gauge"

    def observe_histogram(self, name: str, value: float, labels: Optional[Dict] = None) -> None:
        key = self._labelled_key(name, labels)
        if key not in self._histograms:
            self._histograms[key] = []
        self._histograms[key].append(value)
        self._registry[key] = "histogram"

    def get_counter(self, name: str, labels: Optional[Dict] = None) -> float:
        key = self._labelled_key(name, labels)
        return self._counters.get(key, 0.0)

    def get_gauge(self, name: str, labels: Optional[Dict] = None) -> float:
        key = self._labelled_key(name, labels)
        return self._gauges.get(key, 0.0)

    def get_all_metrics(self) -> Dict[str, Any]:
        return {
            "counters": dict(self._counters),
            "gauges": dict(self._gauges),
            "histograms": {k: {"count": len(v), "sum": sum(v), "avg": sum(v) / len(v) if v else 0}
                           for k, v in self._histograms.items()},
        }

    def export_text(self) -> str:
        """Export metrics in Prometheus exposition format."""
        lines: list = []
        for key, mtype in self._registry.items():
            name, labels_str = self._parse_key(key)
            if mtype == "counter":
                lines.append(f"# TYPE {name} counter")
                lines.append(f"{name}{labels_str} {self._counters.get(key, 0)}")
            elif mtype == "gauge":
                lines.append(f"# TYPE {name} gauge")
                lines.append(f"{name}{labels_str} {self._gauges.get(key, 0)}")
            elif mtype == "histogram":
                h = self._histograms.get(key, [])
                lines.append(f"# TYPE {name} summary")
                lines.append(f'{name}_count{labels_str} {len(h)}')
                lines.append(f'{name}_sum{labels_str} {sum(h)}')
        return "\n".join(lines) + "\n"

    @staticmethod
    def _labelled_key(name: str, labels: Optional[Dict]) -> str:
        if not labels:
            return name
        parts = ",".join(f'{k}="{v}"' for k, v in sorted(labels.items()))
        return f"{name}{{{parts}}}"

    @staticmethod
    def _parse_key(key: str):
        if "{" in key:
            name = key[: key.index("{")]
            labels_str = key[key.index("{"):]
        else:
            name = key
            labels_str = ""
        return name, labels_str


# ─── Decorator ───────────────────────────────────────────────────────────────

def timing_metric(metric_name: str, labels: Optional[Dict] = None) -> Callable:
    """Decorator that records execution time as a Prometheus histogram observation."""

    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            start = time.monotonic()
            try:
                result = func(*args, **kwargs)
                return result
            finally:
                elapsed_ms = (time.monotonic() - start) * 1000
                prometheus.observe_histogram(metric_name, elapsed_ms, labels)

        return wrapper

    return decorator


# ─── Global Instances ────────────────────────────────────────────────────────

structured_log = StructuredLogger("trendlens")
sentry = SentryIntegration(dsn=None)  # DSN set later from config
prometheus = PrometheusMetrics()
