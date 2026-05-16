"""Aggregation queries for target trends.

Reads `tasks JOIN results` and produces:
  * per-agent rollup for a target/period (`target_summary`)
  * time-bucketed series for a target/period (`target_series`)
  * list of recently-seen targets (`recent_targets`)

These queries scan the tasks table directly. For the volumes we expect
(a few thousand tasks/day), aggregating on read is fine. If this becomes
a hotspot, the next step is a continuously-updated materialised view or
a `target_stats_hourly` rollup table.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

# ---------- parsing helpers ----------

_DURATION_RE = re.compile(r"^(\d+)\s*([smhdw])?$")


def parse_since(s: str | None, default_seconds: int = 24 * 3600) -> timedelta:
    """Accept "24h" / "7d" / "30m" / "3600" (raw seconds). Returns a timedelta.

    Capped at 90 days to keep aggregation queries bounded.
    """
    if s is None or not s.strip():
        return timedelta(seconds=default_seconds)
    m = _DURATION_RE.match(s.strip())
    if not m:
        raise ValueError(f"invalid duration: {s!r}")
    n = int(m.group(1))
    unit = m.group(2) or "s"
    mult = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 7 * 86400}[unit]
    seconds = n * mult
    # Cap at 90 days.
    seconds = min(seconds, 90 * 86400)
    seconds = max(seconds, 60)  # at least 1 minute
    return timedelta(seconds=seconds)


def auto_bucket_seconds(window: timedelta) -> int:
    """Pick a sensible bucket size: keep ~50-300 points on the chart."""
    total = int(window.total_seconds())
    if total <= 3 * 3600:  # ≤ 3h → 1 min
        return 60
    if total <= 12 * 3600:  # ≤ 12h → 5 min
        return 5 * 60
    if total <= 36 * 3600:  # ≤ 36h → 15 min
        return 15 * 60
    if total <= 8 * 86400:  # ≤ 8d → 1 hour
        return 3600
    if total <= 32 * 86400:  # ≤ 32d → 6 hours
        return 6 * 3600
    return 24 * 3600


def parse_bucket(s: str | None, window: timedelta) -> int:
    """Accept "auto" / "5m" / "1h" / explicit "300" seconds."""
    if s is None or s.lower() == "auto":
        return auto_bucket_seconds(window)
    m = _DURATION_RE.match(s.strip())
    if not m:
        raise ValueError(f"invalid bucket: {s!r}")
    n = int(m.group(1))
    unit = m.group(2) or "s"
    mult = {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
    seconds = max(60, n * mult)
    # Sanity cap so a tiny bucket on a huge window can't blow up.
    max_buckets = 5000
    if window.total_seconds() / seconds > max_buckets:
        seconds = max(seconds, int(window.total_seconds() / max_buckets))
    return seconds


# ---------- aggregation ----------


@dataclass
class TargetTotals:
    total: int
    success: int


SUPPORTED_TYPES = {"ping", "tcp_connect"}


def _success_expr(task_type: str) -> str:
    """SQL boolean expression for "this task is a successful sample"."""
    if task_type == "ping":
        # received > 0 means at least one echo reply.
        return (
            "(tasks.status = 'completed' "
            "AND results.parsed_json IS NOT NULL "
            "AND COALESCE((results.parsed_json->>'received')::int, 0) > 0)"
        )
    if task_type == "tcp_connect":
        return (
            "(tasks.status = 'completed' "
            "AND results.parsed_json IS NOT NULL "
            "AND COALESCE((results.parsed_json->>'open')::boolean, false))"
        )
    raise ValueError(f"unsupported type: {task_type}")


def _rtt_expr(task_type: str) -> str:
    """SQL expression returning the latency (ms) of a single sample, NULL if unavailable."""
    if task_type == "ping":
        return "(results.parsed_json->>'rtt_avg_ms')::float"
    if task_type == "tcp_connect":
        return "(results.parsed_json->>'rtt_ms')::float"
    raise ValueError(f"unsupported type: {task_type}")


def _loss_expr(task_type: str) -> str:
    if task_type == "ping":
        return "(results.parsed_json->>'loss_percent')::float"
    # tcp_connect: per-sample loss isn't a thing — synthesise from open/closed.
    return "CASE WHEN COALESCE((results.parsed_json->>'open')::boolean, false) THEN 0.0 ELSE 100.0 END"


async def recent_targets(
    db: AsyncSession,
    window: timedelta,
    limit: int = 100,
    targets_filter: list[str] | None = None,
) -> list[dict]:
    """Return distinct targets seen in the lookback window with simple counters.

    Optional `targets_filter` limits results to a curated set (used by the
    public status endpoint).
    """
    since_dt = datetime.now(UTC) - window
    stmt = text(
        """
        SELECT
            target,
            COUNT(*) AS task_count,
            MAX(created_at) AS last_seen,
            ARRAY_AGG(DISTINCT type) AS types,
            COUNT(DISTINCT agent_id) AS distinct_agents
        FROM tasks
        WHERE created_at >= :since
          AND (:filter_active = false OR target = ANY(:filter_list))
        GROUP BY target
        ORDER BY last_seen DESC
        LIMIT :limit
        """
    ).bindparams(bindparam("filter_list", expanding=False))
    result = await db.execute(
        stmt,
        {
            "since": since_dt,
            "limit": limit,
            "filter_active": bool(targets_filter),
            "filter_list": list(targets_filter) if targets_filter else [],
        },
    )
    return [dict(row._mapping) for row in result]


async def target_summary(
    db: AsyncSession,
    target: str,
    task_type: str,
    window: timedelta,
) -> dict:
    """Per-agent rollup for one target over the requested window."""
    if task_type not in SUPPORTED_TYPES:
        raise ValueError(f"unsupported type: {task_type}")
    now = datetime.now(UTC)
    since_dt = now - window
    rtt = _rtt_expr(task_type)
    success = _success_expr(task_type)
    loss = _loss_expr(task_type)

    rows = await db.execute(
        text(
            f"""
            SELECT
                tasks.agent_id,
                agents.hostname,
                agents.display_name,
                agents.tags,
                COUNT(*)::int AS samples,
                SUM(CASE WHEN {success} THEN 1 ELSE 0 END)::int AS success_count,
                AVG({rtt}) FILTER (WHERE {success}) AS rtt_avg_ms,
                MIN({rtt}) FILTER (WHERE {success}) AS rtt_min_ms,
                MAX({rtt}) FILTER (WHERE {success}) AS rtt_max_ms,
                AVG({loss}) AS loss_percent,
                MAX(tasks.created_at) AS last_sample_at
            FROM tasks
            LEFT JOIN results ON results.task_id = tasks.id
            LEFT JOIN agents ON agents.id = tasks.agent_id
            WHERE tasks.target = :target
              AND tasks.type = :ttype
              AND tasks.created_at >= :since
            GROUP BY tasks.agent_id, agents.hostname, agents.display_name, agents.tags
            ORDER BY agents.hostname
            """
        ),
        {"target": target, "ttype": task_type, "since": since_dt},
    )
    per_agent = []
    total_samples = 0
    total_success = 0
    for r in rows.mappings():
        samples = r["samples"]
        success_count = r["success_count"]
        total_samples += samples
        total_success += success_count
        avail = (success_count / samples * 100.0) if samples > 0 else 0.0
        per_agent.append(
            {
                "agent_id": r["agent_id"],
                "agent_label": (r["display_name"] or r["hostname"] or str(r["agent_id"])[:8]),
                "agent_tags": list(r["tags"] or []),
                "samples": samples,
                "success_count": success_count,
                "failure_count": samples - success_count,
                "availability_percent": round(avail, 2),
                "rtt_avg_ms": r["rtt_avg_ms"],
                "rtt_min_ms": r["rtt_min_ms"],
                "rtt_max_ms": r["rtt_max_ms"],
                "loss_percent": r["loss_percent"],
                "last_sample_at": r["last_sample_at"],
            }
        )
    overall_avail = (
        (total_success / total_samples * 100.0) if total_samples > 0 else 0.0
    )
    return {
        "target": target,
        "type": task_type,
        "since": since_dt,
        "until": now,
        "total_samples": total_samples,
        "overall_availability_percent": round(overall_avail, 2),
        "per_agent": per_agent,
    }


async def daily_uptime(
    db: AsyncSession,
    target: str,
    task_type: str,
    days: int,
) -> list[dict]:
    """Per-day availability rollup for the last N days.

    Returns a row per day that had at least one sample, of the shape:
        {
            "date": "2026-05-14",
            "samples": 12,
            "success_count": 12,
            "availability_percent": 100.0,
        }

    The frontend renders the strip relative to "today minus N+1" — days
    without samples appear as gaps.
    """
    if task_type not in SUPPORTED_TYPES:
        raise ValueError(f"unsupported type: {task_type}")
    now = datetime.now(UTC)
    since_dt = now - timedelta(days=days)
    success = _success_expr(task_type)

    rows = await db.execute(
        text(
            f"""
            SELECT
                date_trunc('day', tasks.created_at) AS day,
                COUNT(*)::int AS samples,
                SUM(CASE WHEN {success} THEN 1 ELSE 0 END)::int AS success_count
            FROM tasks
            LEFT JOIN results ON results.task_id = tasks.id
            WHERE tasks.target = :target
              AND tasks.type = :ttype
              AND tasks.created_at >= :since
            GROUP BY day
            ORDER BY day ASC
            """
        ),
        {"target": target, "ttype": task_type, "since": since_dt},
    )
    out: list[dict] = []
    for r in rows.mappings():
        day = r["day"]
        samples = r["samples"]
        success_count = r["success_count"]
        avail = (success_count / samples * 100.0) if samples > 0 else 0.0
        out.append(
            {
                "date": day.date().isoformat() if day else None,
                "samples": samples,
                "success_count": success_count,
                "availability_percent": round(avail, 2),
            }
        )
    return out


async def multi_target_summary(
    db: AsyncSession,
    targets: list[str],
    task_type: str,
    window: timedelta,
) -> dict[str, dict]:
    """Per-(target, agent) rollup for many targets in one query.

    Used by /api/public/status to avoid N+1 — instead of one summary query per
    public target, we issue a single grouped query covering all of them.
    Returns: { target_string: { same shape as target_summary } }.
    Targets with zero samples in the window get an empty summary row.
    """
    if task_type not in SUPPORTED_TYPES:
        raise ValueError(f"unsupported type: {task_type}")
    now = datetime.now(UTC)
    since_dt = now - window
    rtt = _rtt_expr(task_type)
    success = _success_expr(task_type)
    loss = _loss_expr(task_type)

    out: dict[str, dict] = {
        t: {
            "target": t,
            "type": task_type,
            "since": since_dt,
            "until": now,
            "total_samples": 0,
            "overall_availability_percent": 0.0,
            "per_agent": [],
        }
        for t in targets
    }
    if not targets:
        return out

    rows = await db.execute(
        text(
            f"""
            SELECT
                tasks.target,
                tasks.agent_id,
                agents.hostname,
                agents.display_name,
                agents.tags,
                COUNT(*)::int AS samples,
                SUM(CASE WHEN {success} THEN 1 ELSE 0 END)::int AS success_count,
                AVG({rtt}) FILTER (WHERE {success}) AS rtt_avg_ms,
                MIN({rtt}) FILTER (WHERE {success}) AS rtt_min_ms,
                MAX({rtt}) FILTER (WHERE {success}) AS rtt_max_ms,
                AVG({loss}) AS loss_percent,
                MAX(tasks.created_at) AS last_sample_at
            FROM tasks
            LEFT JOIN results ON results.task_id = tasks.id
            LEFT JOIN agents ON agents.id = tasks.agent_id
            WHERE tasks.target = ANY(:targets)
              AND tasks.type = :ttype
              AND tasks.created_at >= :since
            GROUP BY tasks.target, tasks.agent_id, agents.hostname, agents.display_name, agents.tags
            ORDER BY tasks.target, agents.hostname
            """
        ),
        {"targets": list(targets), "ttype": task_type, "since": since_dt},
    )
    totals: dict[str, tuple[int, int]] = {t: (0, 0) for t in targets}
    for r in rows.mappings():
        tgt = r["target"]
        samples = r["samples"]
        success_count = r["success_count"]
        bucket = out.get(tgt)
        if bucket is None:
            continue
        bucket["per_agent"].append(
            {
                "agent_id": r["agent_id"],
                "agent_label": (r["display_name"] or r["hostname"] or str(r["agent_id"])[:8]),
                "agent_tags": list(r["tags"] or []),
                "samples": samples,
                "success_count": success_count,
                "failure_count": samples - success_count,
                "availability_percent": round((success_count / samples * 100.0) if samples else 0.0, 2),
                "rtt_avg_ms": r["rtt_avg_ms"],
                "rtt_min_ms": r["rtt_min_ms"],
                "rtt_max_ms": r["rtt_max_ms"],
                "loss_percent": r["loss_percent"],
                "last_sample_at": r["last_sample_at"],
            }
        )
        t_samp, t_succ = totals[tgt]
        totals[tgt] = (t_samp + samples, t_succ + success_count)
    for tgt, (samp, succ) in totals.items():
        out[tgt]["total_samples"] = samp
        out[tgt]["overall_availability_percent"] = round(
            (succ / samp * 100.0) if samp else 0.0, 2
        )
    return out


async def multi_target_daily_uptime(
    db: AsyncSession,
    targets: list[str],
    task_type: str,
    days: int,
) -> dict[str, list[dict]]:
    """Daily availability for many targets in one query (replaces N daily_uptime calls)."""
    if task_type not in SUPPORTED_TYPES:
        raise ValueError(f"unsupported type: {task_type}")
    out: dict[str, list[dict]] = {t: [] for t in targets}
    if not targets:
        return out
    now = datetime.now(UTC)
    since_dt = now - timedelta(days=days)
    success = _success_expr(task_type)

    rows = await db.execute(
        text(
            f"""
            SELECT
                tasks.target,
                date_trunc('day', tasks.created_at) AS day,
                COUNT(*)::int AS samples,
                SUM(CASE WHEN {success} THEN 1 ELSE 0 END)::int AS success_count
            FROM tasks
            LEFT JOIN results ON results.task_id = tasks.id
            WHERE tasks.target = ANY(:targets)
              AND tasks.type = :ttype
              AND tasks.created_at >= :since
            GROUP BY tasks.target, day
            ORDER BY tasks.target, day ASC
            """
        ),
        {"targets": list(targets), "ttype": task_type, "since": since_dt},
    )
    for r in rows.mappings():
        tgt = r["target"]
        samples = r["samples"]
        success_count = r["success_count"]
        avail = (success_count / samples * 100.0) if samples > 0 else 0.0
        out.setdefault(tgt, []).append(
            {
                "date": r["day"].date().isoformat() if r["day"] else None,
                "samples": samples,
                "success_count": success_count,
                "availability_percent": round(avail, 2),
            }
        )
    return out


async def target_series(
    db: AsyncSession,
    target: str,
    task_type: str,
    window: timedelta,
    bucket_seconds: int,
) -> dict:
    """Time-bucketed series per agent.

    Each row in the output corresponds to one (bucket, agent) pair that
    actually had at least one sample. Missing buckets are left implicit —
    the UI either treats them as gaps or interpolates.
    """
    if task_type not in SUPPORTED_TYPES:
        raise ValueError(f"unsupported type: {task_type}")
    now = datetime.now(UTC)
    since_dt = now - window
    rtt = _rtt_expr(task_type)
    success = _success_expr(task_type)
    loss = _loss_expr(task_type)

    # date_bin (Postgres 14+) bins timestamps to fixed-size buckets aligned
    # to an arbitrary origin. We anchor at 2000-01-01 so buckets are stable
    # across deploys. The interval is inlined as a literal because asyncpg
    # gets confused by the `:bucket::interval` cast operator next to a bind
    # parameter — and `bucket_seconds` is a server-side int we computed, so
    # there's no injection surface.
    bucket_seconds_int = int(bucket_seconds)
    bucket_literal = f"INTERVAL '{bucket_seconds_int} seconds'"

    rows = await db.execute(
        text(
            f"""
            SELECT
                date_bin({bucket_literal}, tasks.created_at, TIMESTAMP '2000-01-01 00:00:00') AS bucket_start,
                tasks.agent_id,
                COUNT(*)::int AS samples,
                AVG({rtt}) FILTER (WHERE {success}) AS rtt_avg_ms,
                MIN({rtt}) FILTER (WHERE {success}) AS rtt_min_ms,
                MAX({rtt}) FILTER (WHERE {success}) AS rtt_max_ms,
                AVG({loss}) AS loss_percent,
                SUM(CASE WHEN {success} THEN 1 ELSE 0 END)::int AS success_count
            FROM tasks
            LEFT JOIN results ON results.task_id = tasks.id
            WHERE tasks.target = :target
              AND tasks.type = :ttype
              AND tasks.created_at >= :since
            GROUP BY bucket_start, tasks.agent_id
            ORDER BY bucket_start ASC, tasks.agent_id
            """
        ),
        {
            "target": target,
            "ttype": task_type,
            "since": since_dt,
        },
    )
    points = []
    agents_seen: dict[uuid.UUID, None] = {}
    for r in rows.mappings():
        samples = r["samples"]
        success_count = r["success_count"]
        points.append(
            {
                "bucket_start": r["bucket_start"],
                "agent_id": r["agent_id"],
                "samples": samples,
                "rtt_avg_ms": r["rtt_avg_ms"],
                "rtt_min_ms": r["rtt_min_ms"],
                "rtt_max_ms": r["rtt_max_ms"],
                "loss_percent": r["loss_percent"],
                "success_count": success_count,
                "failure_count": samples - success_count,
            }
        )
        agents_seen[r["agent_id"]] = None

    agents_meta: list[dict] = []
    if agents_seen:
        meta_rows = await db.execute(
            text(
                """
                SELECT id, hostname, display_name, tags
                FROM agents
                WHERE id = ANY(:ids)
                """
            ),
            {"ids": list(agents_seen.keys())},
        )
        for m in meta_rows.mappings():
            agents_meta.append(
                {
                    "agent_id": m["id"],
                    "agent_label": (m["display_name"] or m["hostname"] or str(m["id"])[:8]),
                    "agent_tags": list(m["tags"] or []),
                }
            )

    return {
        "target": target,
        "type": task_type,
        "since": since_dt,
        "until": now,
        "bucket_seconds": bucket_seconds,
        "agents": agents_meta,
        "points": points,
    }
