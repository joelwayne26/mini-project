"""
trendlens/auth.py
API key authentication for TrendLens AI v5.
"""

import os
import logging
from fastapi import Security, HTTPException, status
from fastapi.security import APIKeyHeader

logger = logging.getLogger(__name__)

API_KEY = os.getenv("TRENDLENS_API_KEY", "")
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

if not API_KEY:
    logger.warning(
        "TRENDLENS_API_KEY is not set — all endpoints are publicly accessible"
    )


def require_api_key(key: str = Security(api_key_header)):
    """Validate the API key on protected endpoints.

    If TRENDLENS_API_KEY is not set, guard is disabled (dev mode).
    If set, caller must supply a matching X-API-Key header.
    """
    if not API_KEY:
        return
    if key != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing API key",
        )