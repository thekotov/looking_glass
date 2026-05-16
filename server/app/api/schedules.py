import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from app.core.deps import CurrentUser, DbSession
from app.core.rbac import CurrentOperator
from app.models.audit import AuditAction
from app.models.schedule import Schedule
from app.models.task import TaskType
from app.schemas.schedule import (
    ScheduleCreate,
    ScheduleOut,
    ScheduleRunResponse,
    ScheduleUpdate,
)
from app.services.audit import audit
from app.services.scheduler import fire_schedule
from app.validators.targets import TargetValidationError, validate_target
from app.validators.task_params import TaskParamsError, validate_task_params

log = logging.getLogger(__name__)
router = APIRouter(prefix="/schedules", tags=["schedules"])


@router.get("", response_model=list[ScheduleOut])
async def list_schedules(_: CurrentUser, db: DbSession) -> list[ScheduleOut]:
    rows = await db.execute(select(Schedule).order_by(Schedule.created_at.desc()))
    return [ScheduleOut.model_validate(s) for s in rows.scalars()]


@router.post("", response_model=ScheduleOut, status_code=201)
async def create_schedule(
    payload: ScheduleCreate,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> ScheduleOut:
    if payload.type not in {t.value for t in TaskType}:
        raise HTTPException(status_code=400, detail=f"unknown task type: {payload.type}")
    try:
        validate_target(payload.target)
    except TargetValidationError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        validate_task_params(payload.type, payload.options)
    except TaskParamsError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    sched = Schedule(
        name=payload.name.strip(),
        enabled=payload.enabled,
        type=payload.type,
        target=payload.target.strip(),
        options=payload.options,
        agent_ids=payload.agent_ids,
        tags=[t.strip().lower() for t in payload.tags if t.strip()],
        agents_per_tag=payload.agents_per_tag,
        interval_seconds=payload.interval_seconds,
        next_run_at=datetime.now(UTC),  # fire on the next tick
        created_by=user.id,
    )
    db.add(sched)
    await db.commit()
    await db.refresh(sched)
    await audit(
        db, user=user, action=AuditAction.SCHEDULE_CREATE.value,
        resource_type="schedule", resource_id=str(sched.id),
        request=request,
        details={
            "name": sched.name,
            "type": sched.type,
            "target": sched.target,
            "interval_seconds": sched.interval_seconds,
        },
    )
    return ScheduleOut.model_validate(sched)


@router.patch("/{sched_id}", response_model=ScheduleOut)
async def update_schedule(
    sched_id: uuid.UUID,
    payload: ScheduleUpdate,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> ScheduleOut:
    sched = await db.get(Schedule, sched_id)
    if sched is None:
        raise HTTPException(status_code=404, detail="schedule not found")

    body = payload.model_dump(exclude_unset=True)
    changes: dict[str, dict] = {}

    for key in ("name", "enabled", "interval_seconds", "target", "agents_per_tag"):
        if key in body and body[key] is not None:
            new = body[key]
            if isinstance(new, str):
                new = new.strip()
            if new != getattr(sched, key):
                changes[key] = {"from": getattr(sched, key), "to": new}
                setattr(sched, key, new)

    if "options" in body and body["options"] is not None:
        if body["options"] != sched.options:
            try:
                validate_task_params(sched.type, body["options"])
            except TaskParamsError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e
            changes["options"] = {"from": sched.options, "to": body["options"]}
            sched.options = body["options"]

    if "agent_ids" in body and body["agent_ids"] is not None:
        new = list(body["agent_ids"])
        if new != list(sched.agent_ids):
            changes["agent_ids"] = {"from": list(sched.agent_ids), "to": new}
            sched.agent_ids = new

    if "tags" in body and body["tags"] is not None:
        new = [t.strip().lower() for t in body["tags"] if t.strip()]
        if new != list(sched.tags):
            changes["tags"] = {"from": list(sched.tags), "to": new}
            sched.tags = new

    # Reset error if disabled.
    if not sched.enabled:
        sched.last_run_error = None

    if changes:
        await db.commit()
        await db.refresh(sched)
        await audit(
            db, user=user, action=AuditAction.SCHEDULE_UPDATE.value,
            resource_type="schedule", resource_id=str(sched.id),
            request=request,
            details={"name": sched.name, "changes": changes},
        )
    return ScheduleOut.model_validate(sched)


@router.delete("/{sched_id}", status_code=204)
async def delete_schedule(
    sched_id: uuid.UUID,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> None:
    sched = await db.get(Schedule, sched_id)
    if sched is None:
        raise HTTPException(status_code=404, detail="schedule not found")
    name = sched.name
    await db.delete(sched)
    await db.commit()
    await audit(
        db, user=user, action=AuditAction.SCHEDULE_DELETE.value,
        resource_type="schedule", resource_id=str(sched_id),
        request=request,
        details={"name": name},
    )


@router.post("/{sched_id}/trigger", response_model=ScheduleRunResponse)
async def trigger_schedule(
    sched_id: uuid.UUID,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> ScheduleRunResponse:
    """Run a schedule now without waiting for the scheduler tick.

    Doesn't advance next_run_at — it's a one-shot extra firing.
    """
    sched = await db.get(Schedule, sched_id)
    if sched is None:
        raise HTTPException(status_code=404, detail="schedule not found")
    try:
        group_id, count = await fire_schedule(db, sched)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    await db.commit()
    await audit(
        db, user=user, action=AuditAction.SCHEDULE_TRIGGER.value,
        resource_type="schedule", resource_id=str(sched.id),
        request=request,
        details={"name": sched.name, "agent_count": count, "group_id": str(group_id)},
    )
    if count == 0:
        raise HTTPException(status_code=400, detail="no eligible agents matched")
    return ScheduleRunResponse(triggered=True, group_id=group_id, task_count=count)
