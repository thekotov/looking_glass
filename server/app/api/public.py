"""Public, no-auth status page + admin curation of public targets.

Public endpoints:
  GET  /api/public/status           — current rollup of all public targets
  GET  /api/public/targets          — minimal list (no metrics)

Admin endpoints (admin role required):
  GET    /api/public-targets        — list curated targets
  POST   /api/public-targets        — add a target to the public list
  PATCH  /api/public-targets/{id}   — update label / sort order
  DELETE /api/public-targets/{id}   — remove from public list
"""

import json
import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select

from app.core.deps import DbSession
from app.core.pubsub import get_pubsub
from app.core.rate_limit import check_public_lookup_rate_limit
from app.core.rbac import CurrentAdmin
from app.models.agent import Agent, AgentStatus
from app.models.audit import AuditAction
from app.models.public_target import PublicTarget
from app.models.result import Result
from app.models.task import Task, TaskStatus
from app.schemas.public_lookup import (
    PublicLookupAgent,
    PublicLookupAgentsResponse,
    PublicLookupCreate,
    PublicLookupTask,
)
from app.schemas.public_target import (
    PublicAgentRollup,
    PublicStatusResponse,
    PublicTargetCreate,
    PublicTargetOut,
    PublicTargetStatus,
    PublicTargetUpdate,
)
from app.services.audit import audit
from app.services.trends import (
    multi_target_daily_uptime,
    multi_target_summary,
    target_summary,
)
from app.validators.targets import TargetValidationError, validate_target

# Redis cache for the public status/uptime payloads — these are hot endpoints
# on an unauthenticated route, so any anonymous visitor would otherwise hit
# the DB on every refresh.
_STATUS_CACHE_TTL = 30  # seconds
_UPTIME_CACHE_TTL = 5 * 60  # uptime data only changes day-over-day


async def _cache_get(key: str) -> dict | None:
    try:
        raw = await get_pubsub().client.get(key)
    except Exception:
        log.exception("redis cache GET failed")
        return None
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


async def _cache_set(key: str, value: dict, ttl: int) -> None:
    try:
        await get_pubsub().client.set(key, json.dumps(value, default=str), ex=ttl)
    except Exception:
        log.exception("redis cache SET failed")


async def _invalidate_status_cache() -> None:
    """Drop every cached `/api/public/status*` payload after a public target
    list change. We scan rather than tracking individual keys because the
    window/days variants live under different keys but they're all stale."""
    try:
        client = get_pubsub().client
        async for key in client.scan_iter(match="lg:cache:public_status:*", count=50):
            await client.delete(key)
        async for key in client.scan_iter(match="lg:cache:public_uptime:*", count=50):
            await client.delete(key)
    except Exception:
        log.exception("redis cache invalidate failed")

log = logging.getLogger(__name__)
public_router = APIRouter(prefix="/public", tags=["public"])
admin_router = APIRouter(prefix="/public-targets", tags=["public-targets"])


# ---------- public, no auth ----------


@public_router.get("/status", response_model=PublicStatusResponse)
async def public_status(
    db: DbSession,
    window_seconds: int = Query(default=24 * 3600, ge=300, le=7 * 86400),
) -> PublicStatusResponse:
    """Render aggregated state for every curated public target.

    Cached in Redis for 30s — anonymous endpoint, has to survive refresh
    storms. One batched SQL query covers every public target (was N queries
    before — the page is hot enough that the difference matters).
    """
    cache_key = f"lg:cache:public_status:{window_seconds}"
    cached = await _cache_get(cache_key)
    if cached is not None:
        return PublicStatusResponse(**cached)

    rows = await db.execute(
        select(PublicTarget).order_by(PublicTarget.sort_order, PublicTarget.created_at)
    )
    targets = list(rows.scalars())
    window = timedelta(seconds=window_seconds)
    target_strs = [pt.target for pt in targets]
    # We only summarise ping for the status page — that's what "is this
    # reachable from the world" actually means. TCP is admin-only data.
    summaries = await multi_target_summary(
        db, targets=target_strs, task_type="ping", window=window
    )
    out: list[PublicTargetStatus] = []
    for pt in targets:
        summary = summaries.get(pt.target, {"overall_availability_percent": 0.0, "per_agent": []})
        per_agent = [
            PublicAgentRollup(
                agent_id=a["agent_id"],
                agent_label=a["agent_label"],
                agent_tags=a["agent_tags"],
                samples=a["samples"],
                availability_percent=a["availability_percent"],
                rtt_avg_ms=a["rtt_avg_ms"],
                loss_percent=a["loss_percent"],
                last_sample_at=a["last_sample_at"],
            )
            for a in summary["per_agent"]
        ]
        out.append(
            PublicTargetStatus(
                target=pt.target,
                label=pt.label,
                sort_order=pt.sort_order,
                window_seconds=window_seconds,
                overall_availability_percent=summary["overall_availability_percent"],
                per_agent=per_agent,
            )
        )
    payload = PublicStatusResponse(
        generated_at=datetime.now(UTC),
        window_seconds=window_seconds,
        targets=out,
    )
    await _cache_set(cache_key, payload.model_dump(mode="json"), _STATUS_CACHE_TTL)
    return payload


@public_router.get("/status/uptime")
async def public_status_uptime(
    db: DbSession,
    days: int = Query(default=90, ge=1, le=365),
) -> dict:
    """Per-target daily availability for the last N days. Used by /status to
    render the 90-day uptime strip. Single batched query + 5min Redis cache."""
    cache_key = f"lg:cache:public_uptime:{days}"
    cached = await _cache_get(cache_key)
    if cached is not None:
        return cached

    rows = await db.execute(
        select(PublicTarget).order_by(PublicTarget.sort_order, PublicTarget.created_at)
    )
    targets = list(rows.scalars())
    target_strs = [pt.target for pt in targets]
    daily = await multi_target_daily_uptime(
        db, targets=target_strs, task_type="ping", days=days
    )
    out = [
        {
            "target": pt.target,
            "label": pt.label,
            "sort_order": pt.sort_order,
            "days": daily.get(pt.target, []),
        }
        for pt in targets
    ]
    payload = {
        "generated_at": datetime.now(UTC).isoformat(),
        "days": days,
        "targets": out,
    }
    await _cache_set(cache_key, payload, _UPTIME_CACHE_TTL)
    return payload


# ---------- status badge SVG ----------


def _render_badge_svg(label: str, value: str, value_color: str) -> str:
    """Shields.io-style two-tone SVG badge.

    Widths are estimated from character count — close enough for short labels.
    Embedded font (sans-serif 11px) is platform-default; renders well on all
    browsers and is fine for README/site embedding.
    """
    # Heuristic char widths: average ~6.5px at 11px sans-serif.
    def _w(text: str) -> int:
        return max(40, int(round(len(text) * 6.5)) + 16)

    lw = _w(label)
    vw = _w(value)
    total = lw + vw
    # Escape XML special chars defensively.
    label_safe = (label.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    value_safe = (value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{total}" height="20" role="img" aria-label="{label_safe}: {value_safe}">
  <title>{label_safe}: {value_safe}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="{total}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="{lw}" height="20" fill="#555"/>
    <rect x="{lw}" width="{vw}" height="20" fill="{value_color}"/>
    <rect width="{total}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="{lw / 2}" y="15" fill="#010101" fill-opacity=".3">{label_safe}</text>
    <text x="{lw / 2}" y="14">{label_safe}</text>
    <text x="{lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">{value_safe}</text>
    <text x="{lw + vw / 2}" y="14">{value_safe}</text>
  </g>
</svg>"""


def _badge_color(pct: float) -> str:
    """Shields.io-ish palette: green ≥99, yellow-green ≥95, yellow ≥90, orange ≥75, red <75."""
    if pct >= 99:
        return "#4c1"      # bright green
    if pct >= 95:
        return "#97ca00"   # yellow-green
    if pct >= 90:
        return "#dfb317"   # yellow
    if pct >= 75:
        return "#fe7d37"   # orange
    return "#e05d44"        # red


@public_router.get("/badge.svg")
async def public_badge(
    db: DbSession,
    target: str = Query(..., min_length=1, max_length=512),
    style: str = Query(default="availability", pattern=r"^(availability|latency|combined)$"),
    window_seconds: int = Query(default=24 * 3600, ge=300, le=7 * 86400),
) -> Response:
    """SVG status badge for a curated public target. Designed to be embedded in
    READMEs / external sites with `<img src="...">`. Only public targets are
    exposed — unauthenticated callers can't request an arbitrary target.
    """
    row = await db.execute(select(PublicTarget).where(PublicTarget.target == target))
    pt = row.scalar_one_or_none()
    if pt is None:
        # Refuse rather than render something — caller's target isn't public.
        svg = _render_badge_svg("looking glass", "not public", "#999")
        return Response(content=svg, media_type="image/svg+xml", status_code=404)

    summary = await target_summary(
        db, target=pt.target, task_type="ping", window=timedelta(seconds=window_seconds)
    )
    pct = summary["overall_availability_percent"]
    # Best per-agent avg RTT as a representative latency number.
    avg_rtts = [
        a["rtt_avg_ms"] for a in summary["per_agent"]
        if isinstance(a["rtt_avg_ms"], (int, float))
    ]
    best_rtt = min(avg_rtts) if avg_rtts else None

    label = pt.label or pt.target
    if style == "availability":
        value = f"{pct:.2f}%"
    elif style == "latency":
        value = f"{best_rtt:.1f} ms" if best_rtt is not None else "no data"
    else:  # combined
        if best_rtt is not None:
            value = f"{pct:.1f}% · {best_rtt:.0f} ms"
        else:
            value = f"{pct:.1f}%"

    color = _badge_color(pct) if summary["total_samples"] > 0 else "#999"
    svg = _render_badge_svg(label, value, color)
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={
            "Cache-Control": "public, max-age=60",
        },
    )


# ---------- public looking glass (anonymous task creation) ----------


_PUBLIC_LOOKUP_TYPES = {"ping", "traceroute", "tcp_connect"}
_PUBLIC_LOOKUP_CAPABILITIES_REQUIRED = {
    "ping": "ping",
    "traceroute": "traceroute",
    "tcp_connect": "tcp_connect",
}


def _client_ip(request: Request) -> str | None:
    """Best-effort source IP. Trusts the client peer (nginx is in front and
    rewrites X-Forwarded-For to the original IP; behind nginx the peer is the
    proxy)."""
    # If you put nginx in front, configure `real_ip` so request.client.host
    # already reflects the real caller. We don't trust XFF directly here —
    # spoofable by anyone unless explicitly chained through a known proxy.
    return request.client.host if request.client else None


def _build_public_options(payload: PublicLookupCreate) -> dict:
    """Build the strict, capped options dict for a public-lookup task.

    Hard caps (regardless of what the user sent):
      ping: count<=10, interval=1000ms, timeout=5s
      traceroute: max_hops<=20, queries=1, timeout=3s
      tcp_connect: timeout=5s, port required
    """
    if payload.type == "ping":
        count = payload.count if payload.count is not None else 5
        count = max(1, min(10, count))
        return {
            "count": count,
            "interval_ms": 1000,
            "timeout_sec": 5,
            "ipv6": False,
        }
    if payload.type == "traceroute":
        return {
            "max_hops": 20,
            "queries_per_hop": 1,
            "timeout_sec": 3,
            "ipv6": False,
        }
    if payload.type == "tcp_connect":
        if payload.port is None:
            raise HTTPException(status_code=400, detail="port required for tcp_connect")
        return {
            "port": payload.port,
            "timeout_sec": 5,
            "ipv6": False,
            "banner_grab": False,
        }
    raise HTTPException(status_code=400, detail=f"unsupported type: {payload.type}")


def _public_agent_view(a: Agent) -> PublicLookupAgent:
    """Strip sensitive fields. Anonymous viewers see a label + tags + coarse location only."""
    return PublicLookupAgent(
        id=a.id,
        label=a.display_name or a.hostname or str(a.id)[:8],
        tags=list(a.tags or []),
        city=a.city,
        country_code=a.country_code,
    )


@public_router.get("/lookup/agents", response_model=PublicLookupAgentsResponse)
async def public_lookup_agents(db: DbSession) -> PublicLookupAgentsResponse:
    """List the agents available for anonymous lookups. Active only."""
    result = await db.execute(
        select(Agent)
        .where(Agent.status == AgentStatus.ACTIVE.value)
        .order_by(Agent.hostname)
    )
    return PublicLookupAgentsResponse(
        agents=[_public_agent_view(a) for a in result.scalars()],
    )


@public_router.post("/lookup", response_model=PublicLookupTask, status_code=201)
async def public_lookup_create(
    payload: PublicLookupCreate,
    db: DbSession,
    request: Request,
) -> PublicLookupTask:
    """Anonymous task creation for the public looking-glass form.

    Strict: only ping/traceroute/tcp_connect, options force-clamped, target
    validated by the same rules as the authed path. Rate-limited per source IP.
    """
    if payload.type not in _PUBLIC_LOOKUP_TYPES:
        raise HTTPException(status_code=400, detail=f"unsupported type: {payload.type}")

    await check_public_lookup_rate_limit(_client_ip(request))

    try:
        normalized_target = validate_target(payload.target)
    except TargetValidationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    agent = await db.get(Agent, payload.agent_id)
    if agent is None or agent.status != AgentStatus.ACTIVE.value:
        raise HTTPException(status_code=400, detail="agent not available")
    needed_cap = _PUBLIC_LOOKUP_CAPABILITIES_REQUIRED[payload.type]
    if agent.capabilities and needed_cap not in agent.capabilities:
        raise HTTPException(
            status_code=400,
            detail=f"agent does not support {payload.type}",
        )

    options = _build_public_options(payload)
    task = Task(
        type=payload.type,
        target=normalized_target,
        options=options,
        agent_id=agent.id,
        created_by=None,
        priority=0,
        status=TaskStatus.QUEUED.value,
        group_id=uuid.uuid4(),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    log.info(
        "public lookup created: type=%s target=%s agent=%s ip=%s",
        payload.type, normalized_target, agent.hostname, _client_ip(request),
    )
    return PublicLookupTask(
        task_id=task.id,
        status=task.status,
        type=task.type,
        target=task.target,
        created_at=task.created_at,
        agent=_public_agent_view(agent),
    )


@public_router.get("/lookup/{task_id}", response_model=PublicLookupTask)
async def public_lookup_get(task_id: uuid.UUID, db: DbSession) -> PublicLookupTask:
    """Polled by the public form until the task is terminal.

    We only return tasks that were created anonymously (created_by IS NULL).
    Otherwise this would be an unauthenticated read of any task by UUID.
    """
    task = await db.get(Task, task_id)
    if task is None or task.created_by is not None:
        raise HTTPException(status_code=404, detail="lookup not found")
    if task.type not in _PUBLIC_LOOKUP_TYPES:
        raise HTTPException(status_code=404, detail="lookup not found")

    agent = await db.get(Agent, task.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="agent gone")

    result_row = None
    if task.status in {
        TaskStatus.COMPLETED.value,
        TaskStatus.FAILED.value,
        TaskStatus.TIMEOUT.value,
    }:
        r = await db.execute(select(Result).where(Result.task_id == task.id))
        result_row = r.scalar_one_or_none()

    return PublicLookupTask(
        task_id=task.id,
        status=task.status,
        type=task.type,
        target=task.target,
        created_at=task.created_at,
        finished_at=task.finished_at,
        duration_ms=result_row.duration_ms if result_row else None,
        error=task.error,
        stdout=result_row.stdout if result_row else None,
        parsed_json=result_row.parsed_json if result_row else None,
        agent=_public_agent_view(agent),
    )


# ---------- admin CRUD ----------


@admin_router.get("", response_model=list[PublicTargetOut])
async def list_public_targets(_: CurrentAdmin, db: DbSession) -> list[PublicTargetOut]:
    rows = await db.execute(
        select(PublicTarget).order_by(PublicTarget.sort_order, PublicTarget.created_at)
    )
    return [PublicTargetOut.model_validate(p) for p in rows.scalars()]


@admin_router.post("", response_model=PublicTargetOut, status_code=201)
async def add_public_target(
    payload: PublicTargetCreate,
    user: CurrentAdmin,
    db: DbSession,
    request: Request,
) -> PublicTargetOut:
    # Reject duplicates explicitly (unique constraint would 500 otherwise).
    existing = await db.execute(
        select(PublicTarget).where(PublicTarget.target == payload.target)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="target already public")

    pt = PublicTarget(
        target=payload.target.strip(),
        label=(payload.label or None) and payload.label.strip() or None,
        sort_order=payload.sort_order,
    )
    db.add(pt)
    await db.commit()
    await db.refresh(pt)
    await audit(
        db, user=user, action=AuditAction.PUBLIC_TARGET_ADD.value,
        resource_type="public_target", resource_id=str(pt.id),
        request=request,
        details={"target": pt.target, "label": pt.label},
    )
    await _invalidate_status_cache()
    return PublicTargetOut.model_validate(pt)


@admin_router.patch("/{pt_id}", response_model=PublicTargetOut)
async def update_public_target(
    pt_id: uuid.UUID,
    payload: PublicTargetUpdate,
    user: CurrentAdmin,
    db: DbSession,
    request: Request,
) -> PublicTargetOut:
    pt = await db.get(PublicTarget, pt_id)
    if pt is None:
        raise HTTPException(status_code=404, detail="public target not found")
    body = payload.model_dump(exclude_unset=True)
    changes: dict[str, dict] = {}
    if "label" in body:
        new = body["label"]
        new = new.strip() if new else None
        new = new or None
        if new != pt.label:
            changes["label"] = {"from": pt.label, "to": new}
            pt.label = new
    if "sort_order" in body and body["sort_order"] is not None:
        if body["sort_order"] != pt.sort_order:
            changes["sort_order"] = {"from": pt.sort_order, "to": body["sort_order"]}
            pt.sort_order = body["sort_order"]
    if changes:
        await db.commit()
        await db.refresh(pt)
        await audit(
            db, user=user, action=AuditAction.PUBLIC_TARGET_UPDATE.value,
            resource_type="public_target", resource_id=str(pt.id),
            request=request,
            details={"target": pt.target, "changes": changes},
        )
        await _invalidate_status_cache()
    return PublicTargetOut.model_validate(pt)


@admin_router.delete("/{pt_id}", status_code=204)
async def remove_public_target(
    pt_id: uuid.UUID,
    user: CurrentAdmin,
    db: DbSession,
    request: Request,
) -> None:
    pt = await db.get(PublicTarget, pt_id)
    if pt is None:
        raise HTTPException(status_code=404, detail="public target not found")
    target = pt.target
    await db.delete(pt)
    await db.commit()
    await audit(
        db, user=user, action=AuditAction.PUBLIC_TARGET_REMOVE.value,
        resource_type="public_target", resource_id=str(pt_id),
        request=request,
        details={"target": target},
    )
    await _invalidate_status_cache()
