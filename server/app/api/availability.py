"""Availability check — fan out N targets × K check types × M agents under one group.

Reuses existing `ping` and `tcp_connect` task types. The matrix is built on the
frontend from `GET /api/tasks/groups/{group_id}` — there is no separate
aggregation endpoint, since the group response already contains everything.
"""
from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from app.core.deps import DbSession
from app.core.rate_limit import check_task_create_rate_limit
from app.core.rbac import CurrentOperator
from app.models.agent import Agent, AgentStatus
from app.models.audit import AuditAction
from app.models.task import Task, TaskStatus
from app.schemas.availability import (
    AvailabilityCheckCreate,
    AvailabilityCheckResponse,
    CheckType,
    SkippedPair,
)
from app.services.audit import audit
from app.validators.targets import TargetValidationError, validate_target

log = logging.getLogger(__name__)
router = APIRouter(prefix="/availability-checks", tags=["availability"])


# Fixed mapping: user-facing protocol → existing task type.
_TYPE_MAP: dict[CheckType, str] = {"icmp": "ping", "tcp": "tcp_connect"}
# Hard ceiling on total tasks created in one batch — bounds blast radius.
_MAX_BATCH_TASKS = 400


def _normalize_targets(raw: list[str]) -> list[str]:
    """Trim, lowercase via validator, dedupe preserving order. Raises on bad input."""
    out: list[str] = []
    seen: set[str] = set()
    for idx, t in enumerate(raw):
        if not t or not t.strip():
            raise HTTPException(status_code=400, detail=f"target #{idx + 1} is empty")
        try:
            normalized = validate_target(t.strip())
        except TargetValidationError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"target #{idx + 1} ({t!r}): {exc}",
            ) from exc
        if normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out


async def _resolve_agents(
    db, agent_ids: list[uuid.UUID] | None
) -> list[Agent]:
    if agent_ids:
        rows = await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
        by_id = {a.id: a for a in rows.scalars()}
        ordered: list[Agent] = []
        for aid in agent_ids:
            if aid not in by_id:
                raise HTTPException(status_code=400, detail=f"agent {aid} not found")
            ordered.append(by_id[aid])
        for a in ordered:
            if a.status != AgentStatus.ACTIVE.value:
                raise HTTPException(
                    status_code=400,
                    detail=f"agent {a.hostname} is {a.status}, not active",
                )
        return ordered

    rows = await db.execute(
        select(Agent)
        .where(Agent.status == AgentStatus.ACTIVE.value)
        .order_by(Agent.hostname.asc())
    )
    agents = list(rows.scalars())
    if not agents:
        raise HTTPException(status_code=400, detail="no active agents available")
    return agents


def _build_options(check_type: CheckType, body: AvailabilityCheckCreate) -> dict:
    if check_type == "icmp":
        return {
            "count": body.ping_count,
            "timeout_sec": body.timeout_sec,
            "interval_ms": 1000,
            "size_bytes": 56,
            "ipv6": False,
        }
    # TCP
    return {
        "port": body.tcp_port,
        "timeout_sec": body.timeout_sec,
        "ipv6": False,
        "banner_grab": False,
    }


async def execute_availability_check(
    body: AvailabilityCheckCreate,
    user,
    db,
) -> tuple[AvailabilityCheckResponse, list[str], int]:
    """Core fan-out: targets × check_types × agents → tasks.

    Pure fan-out — no audit, no rate-limit. The caller wires those because
    the rate-limit bucket and audit fields differ between "direct one-shot"
    and "preset re-run".

    Returns (response, normalised_targets, agent_count) so the caller can
    populate its audit details without re-doing the work.
    """
    targets = _normalize_targets(body.targets)
    agents = await _resolve_agents(db, body.agent_ids)

    if len(targets) * len(body.check_types) * len(agents) > _MAX_BATCH_TASKS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"batch too large: {len(targets)}×{len(body.check_types)}×{len(agents)} "
                f"> {_MAX_BATCH_TASKS} max tasks"
            ),
        )

    skipped: list[SkippedPair] = []
    eligible: dict[CheckType, list[Agent]] = {}
    for ct in body.check_types:
        task_type = _TYPE_MAP[ct]
        eligible[ct] = []
        for a in agents:
            if a.capabilities and task_type not in a.capabilities:
                skipped.append(
                    SkippedPair(
                        agent_id=a.id,
                        hostname=a.hostname,
                        check_type=ct,
                        reason=f"agent does not advertise {task_type}",
                    )
                )
                continue
            eligible[ct].append(a)
        if not eligible[ct]:
            raise HTTPException(
                status_code=400,
                detail=f"no active agents support {ct} ({task_type})",
            )

    group_id = uuid.uuid4()
    created: list[Task] = []
    for target in targets:
        for ct in body.check_types:
            task_type = _TYPE_MAP[ct]
            options = _build_options(ct, body)
            for a in eligible[ct]:
                t = Task(
                    type=task_type,
                    target=target,
                    options=options,
                    agent_id=a.id,
                    created_by=user.id,
                    priority=0,
                    status=TaskStatus.QUEUED.value,
                    group_id=group_id,
                )
                db.add(t)
                created.append(t)
    await db.commit()
    return (
        AvailabilityCheckResponse(
            group_id=group_id,
            task_count=len(created),
            skipped=skipped,
        ),
        targets,
        len(agents),
    )


@router.post("", response_model=AvailabilityCheckResponse, status_code=201)
async def create_availability_check(
    body: AvailabilityCheckCreate,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> AvailabilityCheckResponse:
    await check_task_create_rate_limit(str(user.id))
    resp, targets, agent_count = await execute_availability_check(body, user, db)
    log.info(
        "availability check created group=%s targets=%d types=%s agents=%d tasks=%d",
        resp.group_id, len(targets), list(body.check_types), agent_count, resp.task_count,
    )
    await audit(
        db,
        user=user,
        action=AuditAction.AVAILABILITY_CHECK_CREATE.value,
        resource_type="task_group",
        resource_id=str(resp.group_id),
        request=request,
        details={
            "targets": targets,
            "check_types": list(body.check_types),
            "tcp_port": body.tcp_port if "tcp" in body.check_types else None,
            "agent_count": agent_count,
            "task_count": resp.task_count,
            "skipped_count": len(resp.skipped),
        },
    )
    return resp
