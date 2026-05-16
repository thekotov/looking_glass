"""Per-target trends API (authenticated).

GET /api/targets                        — list distinct targets seen in lookback window
GET /api/targets/summary?target=...     — per-agent rollup over a window
GET /api/targets/series?target=...      — time-bucketed series for charting
"""

import logging

from fastapi import APIRouter, HTTPException, Query

from app.core.deps import CurrentUser, DbSession
from app.schemas.trends import (
    TargetListItem,
    TargetSeries,
    TargetSummary,
)
from app.services.trends import (
    parse_bucket,
    parse_since,
    recent_targets,
    target_series,
    target_summary,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/targets", tags=["targets"])


@router.get("", response_model=list[TargetListItem])
async def list_targets(
    _: CurrentUser,
    db: DbSession,
    since: str = Query(default="7d"),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[TargetListItem]:
    try:
        window = parse_since(since)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    rows = await recent_targets(db, window=window, limit=limit)
    return [TargetListItem(**r) for r in rows]


@router.get("/summary", response_model=TargetSummary)
async def get_target_summary(
    _: CurrentUser,
    db: DbSession,
    target: str = Query(..., min_length=1, max_length=512),
    since: str = Query(default="24h"),
    type: str = Query(default="ping", pattern=r"^(ping|tcp_connect)$"),
) -> TargetSummary:
    try:
        window = parse_since(since)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    data = await target_summary(db, target=target, task_type=type, window=window)
    return TargetSummary(**data)


@router.get("/series", response_model=TargetSeries)
async def get_target_series(
    _: CurrentUser,
    db: DbSession,
    target: str = Query(..., min_length=1, max_length=512),
    since: str = Query(default="24h"),
    type: str = Query(default="ping", pattern=r"^(ping|tcp_connect)$"),
    bucket: str = Query(default="auto"),
) -> TargetSeries:
    try:
        window = parse_since(since)
        bucket_seconds = parse_bucket(bucket, window)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    data = await target_series(
        db, target=target, task_type=type, window=window, bucket_seconds=bucket_seconds
    )
    return TargetSeries(**data)
