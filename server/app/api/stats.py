"""Aggregate stats endpoint backing the UI dashboard."""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import func, literal_column, select, text

from app.core.deps import CurrentUser, DbSession
from app.models.agent import Agent, AgentStatus
from app.models.task import Task, TaskStatus

log = logging.getLogger(__name__)
router = APIRouter(prefix="/stats", tags=["stats"])


class AgentStats(BaseModel):
    total: int
    active: int
    pending: int
    inactive: int  # rejected + disabled
    online: int  # active AND last_seen within 60s


class RecentFailure(BaseModel):
    id: uuid.UUID
    type: str
    target: str
    agent_id: uuid.UUID
    error: str | None
    finished_at: datetime | None
    status: str


class TaskStats(BaseModel):
    last_24h_total: int
    last_24h_by_status: dict[str, int]
    last_24h_by_type: dict[str, int]
    recent_failures: list[RecentFailure]


class StatsOut(BaseModel):
    agents: AgentStats
    tasks: TaskStats


_HEARTBEAT_ONLINE_SEC = 60


@router.get("", response_model=StatsOut)
async def stats(
    _: CurrentUser,
    db: DbSession,
    hours: int = Query(24, ge=1, le=168),
) -> StatsOut:
    now = datetime.now(UTC)
    cutoff_24h = now - timedelta(hours=hours)
    online_cutoff = now - timedelta(seconds=_HEARTBEAT_ONLINE_SEC)

    # Agents grouped by status.
    agent_status_q = await db.execute(
        select(Agent.status, func.count()).group_by(Agent.status)
    )
    by_status = dict(agent_status_q.all())
    online_q = await db.execute(
        select(func.count())
        .select_from(Agent)
        .where(Agent.status == AgentStatus.ACTIVE.value)
        .where(Agent.last_seen >= online_cutoff)
    )
    online_count = online_q.scalar_one()

    agent_stats = AgentStats(
        total=sum(by_status.values()),
        active=by_status.get(AgentStatus.ACTIVE.value, 0),
        pending=by_status.get(AgentStatus.PENDING.value, 0),
        inactive=(
            by_status.get(AgentStatus.REJECTED.value, 0)
            + by_status.get(AgentStatus.DISABLED.value, 0)
        ),
        online=online_count,
    )

    # Tasks in last 24h.
    by_status_q = await db.execute(
        select(Task.status, func.count())
        .where(Task.created_at >= cutoff_24h)
        .group_by(Task.status)
    )
    by_status_tasks = dict(by_status_q.all())

    by_type_q = await db.execute(
        select(Task.type, func.count())
        .where(Task.created_at >= cutoff_24h)
        .group_by(Task.type)
    )
    by_type = dict(by_type_q.all())

    failures_q = await db.execute(
        select(Task)
        .where(Task.status.in_([TaskStatus.FAILED.value, TaskStatus.TIMEOUT.value]))
        .order_by(Task.finished_at.desc().nulls_last())
        .limit(10)
    )
    recent_failures = [
        RecentFailure(
            id=t.id,
            type=t.type,
            target=t.target,
            agent_id=t.agent_id,
            error=t.error,
            finished_at=t.finished_at,
            status=t.status,
        )
        for t in failures_q.scalars()
    ]

    task_stats = TaskStats(
        last_24h_total=sum(by_status_tasks.values()),
        last_24h_by_status=by_status_tasks,
        last_24h_by_type=by_type,
        recent_failures=recent_failures,
    )

    return StatsOut(agents=agent_stats, tasks=task_stats)


class HourBucket(BaseModel):
    hour: datetime
    total: int
    failed: int


@router.get("/tasks-per-hour", response_model=list[HourBucket])
async def tasks_per_hour(
    _: CurrentUser,
    db: DbSession,
    hours: int = Query(24, ge=1, le=168),
) -> list[HourBucket]:
    """Hourly task counts for sparkline charts. Buckets are aligned to the
    floor of each clock hour in UTC. Missing hours are filled with zeros so
    the consumer can plot a fixed-width series without gaps.
    """
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(hours=hours - 1)

    rows = (
        await db.execute(
            select(
                func.date_trunc("hour", Task.created_at).label("h"),
                func.count().label("total"),
                func.count()
                .filter(
                    Task.status.in_([TaskStatus.FAILED.value, TaskStatus.TIMEOUT.value])
                )
                .label("failed"),
            )
            .where(Task.created_at >= start)
            .group_by(literal_column("h"))
        )
    ).all()

    by_hour: dict[datetime, tuple[int, int]] = {}
    for h, total, failed in rows:
        # Postgres returns timezone-aware datetimes already, but be defensive.
        if h.tzinfo is None:
            h = h.replace(tzinfo=UTC)
        by_hour[h] = (int(total), int(failed))

    out: list[HourBucket] = []
    for i in range(hours):
        bucket_time = start + timedelta(hours=i)
        total, failed = by_hour.get(bucket_time, (0, 0))
        out.append(HourBucket(hour=bucket_time, total=total, failed=failed))
    return out


class AgentRecent(BaseModel):
    agent_id: uuid.UUID
    statuses: list[str]  # newest-first, max 20
    # Same length as `statuses`. Null entries are tasks that never started or
    # didn't record a duration (e.g. cancelled before claim).
    durations_ms: list[int | None]


@router.get("/agents-recent", response_model=list[AgentRecent])
async def agents_recent(
    _: CurrentUser,
    db: DbSession,
    per_agent: int = Query(20, ge=1, le=100),
) -> list[AgentRecent]:
    """For each agent: the status + duration of their last `per_agent` tasks,
    newest first. Drives the per-agent status-strip and latency-sparkline
    on the agents page.

    Implemented with a single window-function query joined to task_results
    so the cost scales with `len(agents) * per_agent`, not with the full
    task history.
    """
    # ROW_NUMBER() partition over agent. Joined to task_results for duration.
    sql = text(
        """
        SELECT t.agent_id, t.status, r.duration_ms, t.finished_at, t.created_at
        FROM (
            SELECT
                id,
                agent_id,
                status,
                finished_at,
                created_at,
                ROW_NUMBER() OVER (
                    PARTITION BY agent_id
                    ORDER BY COALESCE(finished_at, created_at) DESC
                ) AS rn
            FROM tasks
        ) t
        LEFT JOIN results r ON r.task_id = t.id
        WHERE t.rn <= :n
        ORDER BY t.agent_id, t.rn
        """
    )
    rows = (await db.execute(sql, {"n": per_agent})).all()

    by_agent: dict[uuid.UUID, tuple[list[str], list[int | None]]] = {}
    for agent_id, status, duration_ms, _f, _c in rows:
        bucket = by_agent.setdefault(agent_id, ([], []))
        bucket[0].append(status)
        bucket[1].append(int(duration_ms) if duration_ms is not None else None)

    return [
        AgentRecent(agent_id=aid, statuses=lst[0], durations_ms=lst[1])
        for aid, lst in by_agent.items()
    ]
