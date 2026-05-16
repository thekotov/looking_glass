"""Saved availability-check presets.

Lets the user name a (targets + check_types + agents) configuration and
re-run it on demand. Each run produces a fresh task group; we remember the
latest group_id so the UI can open "the matrix for this preset" in one click.

Distinct from /api/schedules — schedules tick on a cron-like interval,
presets fire only when the user clicks Run.
"""

import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from app.api.availability import execute_availability_check
from app.core.deps import CurrentUser, DbSession
from app.core.rate_limit import check_task_create_rate_limit
from app.core.rbac import CurrentOperator
from app.models.audit import AuditAction
from app.models.availability_preset import AvailabilityPreset
from app.schemas.availability import AvailabilityCheckCreate, AvailabilityCheckResponse
from app.schemas.availability_preset import (
    AvailabilityPresetCreate,
    AvailabilityPresetOut,
    AvailabilityPresetUpdate,
)
from app.services.audit import audit

log = logging.getLogger(__name__)
router = APIRouter(prefix="/availability-presets", tags=["availability-presets"])


def _build_check_create(preset: AvailabilityPreset) -> AvailabilityCheckCreate:
    """Reassemble the AvailabilityCheckCreate payload from a stored preset."""
    check_types: list[str] = []
    if preset.check_icmp:
        check_types.append("icmp")
    if preset.check_tcp:
        check_types.append("tcp")
    return AvailabilityCheckCreate(
        targets=list(preset.targets),
        check_types=check_types,  # type: ignore[arg-type]
        tcp_port=preset.tcp_port,
        timeout_sec=preset.timeout_sec,
        ping_count=preset.ping_count,
        agent_ids=list(preset.agent_ids) if preset.agent_ids else None,
    )


@router.get("", response_model=list[AvailabilityPresetOut])
async def list_presets(_: CurrentUser, db: DbSession) -> list[AvailabilityPresetOut]:
    """Newest-run-first, then alpha. Frontends can apply their own sort."""
    rows = await db.execute(
        select(AvailabilityPreset).order_by(
            AvailabilityPreset.last_run_at.desc().nulls_last(),
            AvailabilityPreset.name.asc(),
        )
    )
    return [AvailabilityPresetOut.model_validate(p) for p in rows.scalars()]


@router.post("", response_model=AvailabilityPresetOut, status_code=201)
async def create_preset(
    payload: AvailabilityPresetCreate,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> AvailabilityPresetOut:
    if not (payload.check_icmp or payload.check_tcp):
        raise HTTPException(
            status_code=400,
            detail="at least one of check_icmp/check_tcp must be true",
        )
    preset = AvailabilityPreset(
        name=payload.name.strip(),
        targets=list(payload.targets),
        check_icmp=payload.check_icmp,
        check_tcp=payload.check_tcp,
        tcp_port=payload.tcp_port,
        timeout_sec=payload.timeout_sec,
        ping_count=payload.ping_count,
        agent_ids=list(payload.agent_ids),
        created_by=user.id,
    )
    db.add(preset)
    await db.commit()
    await db.refresh(preset)
    await audit(
        db, user=user, action=AuditAction.AVAIL_PRESET_CREATE.value,
        resource_type="availability_preset", resource_id=str(preset.id),
        request=request,
        details={"name": preset.name, "targets": len(preset.targets)},
    )
    return AvailabilityPresetOut.model_validate(preset)


@router.patch("/{preset_id}", response_model=AvailabilityPresetOut)
async def update_preset(
    preset_id: uuid.UUID,
    payload: AvailabilityPresetUpdate,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> AvailabilityPresetOut:
    preset = await db.get(AvailabilityPreset, preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail="preset not found")
    body = payload.model_dump(exclude_unset=True)
    changes: dict[str, dict] = {}
    for key in (
        "name", "targets", "check_icmp", "check_tcp",
        "tcp_port", "timeout_sec", "ping_count", "agent_ids",
    ):
        if key not in body or body[key] is None:
            continue
        new = body[key]
        if isinstance(new, str):
            new = new.strip()
        if isinstance(new, list):
            new = list(new)
        if new != getattr(preset, key):
            changes[key] = {"from": _as_audit(getattr(preset, key)), "to": _as_audit(new)}
            setattr(preset, key, new)
    if changes:
        if not (preset.check_icmp or preset.check_tcp):
            raise HTTPException(
                status_code=400,
                detail="at least one of check_icmp/check_tcp must be true",
            )
        await db.commit()
        await db.refresh(preset)
        await audit(
            db, user=user, action=AuditAction.AVAIL_PRESET_UPDATE.value,
            resource_type="availability_preset", resource_id=str(preset.id),
            request=request,
            details={"name": preset.name, "changes": changes},
        )
    return AvailabilityPresetOut.model_validate(preset)


@router.delete("/{preset_id}", status_code=204)
async def delete_preset(
    preset_id: uuid.UUID,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> None:
    preset = await db.get(AvailabilityPreset, preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail="preset not found")
    name = preset.name
    await db.delete(preset)
    await db.commit()
    await audit(
        db, user=user, action=AuditAction.AVAIL_PRESET_DELETE.value,
        resource_type="availability_preset", resource_id=str(preset_id),
        request=request,
        details={"name": name},
    )


@router.post("/{preset_id}/run", response_model=AvailabilityCheckResponse)
async def run_preset(
    preset_id: uuid.UUID,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> AvailabilityCheckResponse:
    """Re-run the saved config. Same rate-limit and validation path as the
    manual POST /availability-checks endpoint."""
    preset = await db.get(AvailabilityPreset, preset_id)
    if preset is None:
        raise HTTPException(status_code=404, detail="preset not found")

    await check_task_create_rate_limit(str(user.id))

    body = _build_check_create(preset)
    resp, targets, agent_count = await execute_availability_check(body, user, db)

    preset.last_run_group_id = resp.group_id
    preset.last_run_at = datetime.now(UTC)
    preset.runs_total = preset.runs_total + 1
    await db.commit()

    log.info(
        "preset run: id=%s name=%r group=%s tasks=%d",
        preset.id, preset.name, resp.group_id, resp.task_count,
    )
    await audit(
        db, user=user, action=AuditAction.AVAIL_PRESET_RUN.value,
        resource_type="availability_preset", resource_id=str(preset.id),
        request=request,
        details={
            "name": preset.name,
            "group_id": str(resp.group_id),
            "task_count": resp.task_count,
            "targets": targets,
            "agent_count": agent_count,
        },
    )
    return resp


def _as_audit(v):
    """Make audit-detail values JSON-friendly. UUIDs → str, lists kept."""
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, list):
        return [_as_audit(x) for x in v]
    return v
