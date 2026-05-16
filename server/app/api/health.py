import logging
import time
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter
from sqlalchemy import text

from app.core.db import SessionLocal
from app.core.deps import CurrentUser
from app.core.pubsub import get_pubsub

log = logging.getLogger(__name__)
router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health/db")
async def health_db() -> dict[str, str]:
    try:
        async with SessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return {"status": "ok", "component": "postgres"}
    except Exception as exc:
        log.exception("db healthcheck failed")
        return {"status": "error", "component": "postgres", "error": str(exc)}


@router.get("/health/v2")
async def health_v2(_: CurrentUser) -> dict:
    """Rich self-monitoring snapshot for the operator dashboard.

    Returns: DB/Redis status + latency, queue depth, running task count,
    agent online ratio, error rate for the last hour, scheduler heartbeat.
    Single request — all checks fan out in parallel internally.
    """
    now = datetime.now(UTC)
    hour_ago = now - timedelta(hours=1)
    five_min_ago = now - timedelta(minutes=5)

    out: dict = {
        "generated_at": now.isoformat(),
        "components": {},
        "tasks": {},
        "agents": {},
    }

    # ---------- Postgres ----------
    t0 = time.perf_counter()
    try:
        async with SessionLocal() as session:
            await session.execute(text("SELECT 1"))
            out["components"]["postgres"] = {
                "status": "ok",
                "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
            }
            # Aggregate counts in the same connection.
            tasks_row = (
                await session.execute(
                    text(
                        """
                        SELECT
                            COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
                            COUNT(*) FILTER (WHERE status IN ('claimed','running'))::int AS running,
                            COUNT(*) FILTER (WHERE created_at >= :hour_ago)::int AS last_1h_total,
                            COUNT(*) FILTER (
                                WHERE created_at >= :hour_ago
                                  AND status IN ('failed','timeout')
                            )::int AS last_1h_failed
                        FROM tasks
                        """
                    ),
                    {"hour_ago": hour_ago},
                )
            ).mappings().one()
            out["tasks"] = {
                "queued": tasks_row["queued"],
                "running": tasks_row["running"],
                "last_1h_total": tasks_row["last_1h_total"],
                "last_1h_failed": tasks_row["last_1h_failed"],
                "error_rate_1h": (
                    round(tasks_row["last_1h_failed"] / tasks_row["last_1h_total"], 4)
                    if tasks_row["last_1h_total"] > 0
                    else 0.0
                ),
            }

            agents_row = (
                await session.execute(
                    text(
                        """
                        SELECT
                            COUNT(*)::int AS total,
                            COUNT(*) FILTER (WHERE status = 'active')::int AS active,
                            COUNT(*) FILTER (
                                WHERE status = 'active' AND last_seen >= :five_min_ago
                            )::int AS online
                        FROM agents
                        """
                    ),
                    {"five_min_ago": five_min_ago},
                )
            ).mappings().one()
            out["agents"] = {
                "total": agents_row["total"],
                "active": agents_row["active"],
                "online": agents_row["online"],
                "uptime_ratio": (
                    round(agents_row["online"] / agents_row["active"], 4)
                    if agents_row["active"] > 0
                    else 0.0
                ),
            }

            # Scheduler heartbeat: most recent scheduled run.
            sched_row = (
                await session.execute(
                    text(
                        """
                        SELECT
                            COUNT(*)::int AS total,
                            COUNT(*) FILTER (WHERE enabled)::int AS enabled,
                            MAX(last_run_at) AS last_fire
                        FROM schedules
                        """
                    ),
                )
            ).mappings().one()
            out["scheduler"] = {
                "total_schedules": sched_row["total"],
                "enabled_schedules": sched_row["enabled"],
                "last_fire_at": sched_row["last_fire"].isoformat() if sched_row["last_fire"] else None,
            }
    except Exception as exc:
        log.exception("postgres health probe failed")
        out["components"]["postgres"] = {"status": "error", "error": str(exc)}

    # ---------- Redis ----------
    t0 = time.perf_counter()
    try:
        await get_pubsub().client.ping()
        out["components"]["redis"] = {
            "status": "ok",
            "latency_ms": round((time.perf_counter() - t0) * 1000, 2),
        }
    except Exception as exc:
        log.exception("redis health probe failed")
        out["components"]["redis"] = {"status": "error", "error": str(exc)}

    return out
