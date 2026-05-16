import csv
import io
import json
import logging
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select, text

from app.core.deps import CurrentAgent, CurrentUser, DbSession
from app.core.pubsub import get_pubsub
from app.core.rbac import CurrentOperator
from app.core.rate_limit import check_task_create_rate_limit
from app.models.agent import AgentStatus
from app.models.audit import AuditAction
from app.models.result import Result
from app.models.task import TERMINAL_STATUSES, Task, TaskStatus, TaskType
from app.schemas.task import (
    AgentTaskOut,
    ResultOut,
    TaskChunkSubmit,
    TaskCreateRequest,
    TaskCreateResponse,
    TaskDetailOut,
    TaskGroupOut,
    TaskGroupTaskOut,
    TaskOut,
    TaskResultSubmit,
)
from app.services.audit import audit
from app.services.task_router import RouterError, resolve_agents
from app.validators.targets import TargetValidationError, validate_target
from app.validators.task_params import TaskParamsError, validate_task_params

log = logging.getLogger(__name__)
router = APIRouter(prefix="/tasks", tags=["tasks"])


# ---------- Agent-facing endpoints (declared first so /poll wins over /{task_id}) ----------


@router.get("/poll", response_model=AgentTaskOut | None)
async def poll_next(agent: CurrentAgent, db: DbSession) -> AgentTaskOut | None:
    """Atomically claim the next queued task for this agent.

    Uses SELECT ... FOR UPDATE SKIP LOCKED so concurrent pollers (won't happen
    for M2 single-agent but forward-compatible with M5 fan-out) don't collide.
    """
    if agent.status != AgentStatus.ACTIVE.value:
        return None

    row = await db.execute(
        text(
            """
            SELECT id FROM tasks
            WHERE agent_id = :agent_id AND status = 'queued'
            ORDER BY priority DESC, created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """
        ),
        {"agent_id": agent.id},
    )
    task_row = row.first()
    if task_row is None:
        return None

    task = await db.get(Task, task_row[0])
    if task is None:
        return None
    task.status = TaskStatus.CLAIMED.value
    task.claimed_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(task)
    log.info("task %s claimed by agent %s", task.id, agent.hostname)
    return AgentTaskOut(
        id=task.id, type=task.type, target=task.target, options=task.options
    )


@router.post("/{task_id}/start", response_model=TaskOut)
async def start_task(
    task_id: uuid.UUID, agent: CurrentAgent, db: DbSession
) -> TaskOut:
    """Optional intermediate step — agent notifies it has begun executing."""
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    if task.agent_id != agent.id:
        raise HTTPException(status_code=403, detail="task not assigned to this agent")
    if task.status not in {TaskStatus.CLAIMED.value, TaskStatus.RUNNING.value}:
        raise HTTPException(status_code=400, detail=f"task is {task.status}")
    task.status = TaskStatus.RUNNING.value
    task.started_at = task.started_at or datetime.now(UTC)
    await db.commit()
    await db.refresh(task)
    return TaskOut.model_validate(task)


@router.post("/{task_id}/chunk", status_code=204)
async def submit_chunk(
    task_id: uuid.UUID,
    payload: TaskChunkSubmit,
    agent: CurrentAgent,
    db: DbSession,
) -> None:
    """Agent streams incremental stdout/stderr lines while a task runs."""
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    if task.agent_id != agent.id:
        raise HTTPException(status_code=403, detail="task not assigned to this agent")
    if task.status in TERMINAL_STATUSES:
        # Late chunk after task completion — drop silently (agent may retry).
        return
    # Transition claimed → running on the first chunk.
    if task.status == TaskStatus.CLAIMED.value:
        task.status = TaskStatus.RUNNING.value
        task.started_at = task.started_at or datetime.now(UTC)
        await db.commit()

    await get_pubsub().publish_chunk(
        str(task_id),
        {
            "event": "chunk",
            "seq": payload.seq,
            "stream": payload.stream,
            "text": payload.text,
        },
    )


@router.post("/{task_id}/result", response_model=TaskOut)
async def submit_result(
    task_id: uuid.UUID, payload: TaskResultSubmit, agent: CurrentAgent, db: DbSession
) -> TaskOut:
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    if task.agent_id != agent.id:
        raise HTTPException(status_code=403, detail="task not assigned to this agent")
    if task.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=400, detail=f"task already {task.status}")

    if payload.status not in {
        TaskStatus.COMPLETED.value,
        TaskStatus.FAILED.value,
        TaskStatus.TIMEOUT.value,
    }:
        raise HTTPException(
            status_code=400, detail="status must be one of completed/failed/timeout"
        )

    now = datetime.now(UTC)
    task.status = payload.status
    task.finished_at = now
    if task.started_at is None:
        task.started_at = task.claimed_at or now
    task.error = payload.error

    result = Result(
        task_id=task.id,
        agent_id=agent.id,
        stdout=payload.stdout,
        stderr=payload.stderr,
        exit_code=payload.exit_code,
        duration_ms=payload.duration_ms,
        parsed_json=payload.parsed_json,
    )
    db.add(result)
    await db.commit()
    await db.refresh(task)
    log.info(
        "task %s finished status=%s duration_ms=%s",
        task.id, payload.status, payload.duration_ms,
    )
    # Notify any live viewers that the task is done.
    await get_pubsub().publish_chunk(
        str(task.id),
        {"event": "done", "status": payload.status},
    )
    return TaskOut.model_validate(task)


# ---------- User-facing endpoints ----------


@router.post("", response_model=TaskCreateResponse, status_code=201)
async def create_task(
    payload: TaskCreateRequest, user: CurrentOperator, db: DbSession, request: Request,
) -> TaskCreateResponse:
    await check_task_create_rate_limit(str(user.id))
    if payload.type not in {t.value for t in TaskType}:
        raise HTTPException(status_code=400, detail=f"unknown task type: {payload.type}")

    try:
        normalized_target = validate_target(payload.target)
    except TargetValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        normalized_options = validate_task_params(payload.type, payload.options)
    except TaskParamsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        agents = await resolve_agents(db, payload, task_type=payload.type)
    except RouterError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    group_id = uuid.uuid4()
    tasks: list[Task] = []
    for agent in agents:
        t = Task(
            type=payload.type,
            target=normalized_target,
            options=normalized_options,
            agent_id=agent.id,
            created_by=user.id,
            priority=payload.priority,
            status=TaskStatus.QUEUED.value,
            group_id=group_id,
        )
        db.add(t)
        tasks.append(t)
    await db.commit()
    for t in tasks:
        await db.refresh(t)

    log.info(
        "task group created group=%s type=%s target=%s agents=%d",
        group_id, payload.type, normalized_target, len(agents),
    )
    await audit(
        db, user=user, action=AuditAction.TASK_CREATE.value,
        resource_type="task_group", resource_id=str(group_id),
        request=request,
        details={
            "type": payload.type,
            "target": normalized_target,
            "agent_count": len(agents),
        },
    )
    return TaskCreateResponse(
        group_id=group_id,
        tasks=[TaskOut.model_validate(t) for t in tasks],
    )


@router.get("", response_model=list[TaskOut])
async def list_tasks(
    _: CurrentUser,
    db: DbSession,
    status: str | None = Query(default=None),
    agent_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[TaskOut]:
    stmt = select(Task).order_by(Task.created_at.desc()).limit(limit)
    if status is not None:
        stmt = stmt.where(Task.status == status)
    if agent_id is not None:
        stmt = stmt.where(Task.agent_id == agent_id)
    result = await db.execute(stmt)
    return [TaskOut.model_validate(t) for t in result.scalars()]


_CSV_COLUMNS = [
    "task_id", "group_id", "type", "target", "agent_id", "status",
    "priority", "created_at", "started_at", "finished_at", "duration_ms",
    "exit_code", "error", "stdout",
]


def _task_to_csv_row(task: Task, result: Result | None) -> list[str]:
    return [
        str(task.id), str(task.group_id), task.type, task.target,
        str(task.agent_id), task.status, str(task.priority),
        task.created_at.isoformat() if task.created_at else "",
        task.started_at.isoformat() if task.started_at else "",
        task.finished_at.isoformat() if task.finished_at else "",
        str(result.duration_ms) if result and result.duration_ms is not None else "",
        str(result.exit_code) if result and result.exit_code is not None else "",
        task.error or "",
        result.stdout if result else "",
    ]


def _csv_response(rows: list[list[str]], filename: str) -> Response:
    buf = io.StringIO()
    writer = csv.writer(buf, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(_CSV_COLUMNS)
    writer.writerows(rows)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _json_response(payload: dict, filename: str) -> Response:
    return Response(
        content=json.dumps(payload, default=str, indent=2),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


async def _latest_result(db, task_id: uuid.UUID) -> Result | None:
    """Fetch the most recent result row for a task (de-duped query used in
    several places that previously inlined the same SELECT)."""
    q = await db.execute(
        select(Result)
        .where(Result.task_id == task_id)
        .order_by(Result.created_at.desc())
        .limit(1)
    )
    return q.scalar_one_or_none()


async def _task_export_payload(db, task: Task) -> dict:
    result = await _latest_result(db, task.id)
    payload = TaskDetailOut.model_validate(task).model_dump(mode="json")
    if result is not None:
        payload["result"] = ResultOut.model_validate(result).model_dump(mode="json")
    return payload


@router.get("/{task_id}/export.json")
async def export_task_json(
    task_id: uuid.UUID,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> Response:
    """Export one task as JSON. Operator+ — exporting is data exfiltration and
    we audit who did it."""
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    payload = await _task_export_payload(db, task)
    await audit(
        db, user=user, action=AuditAction.TASK_EXPORT.value,
        resource_type="task", resource_id=str(task_id),
        request=request, details={"format": "json", "type": task.type, "target": task.target},
    )
    return _json_response(payload, f"task-{task_id}.json")


@router.get("/{task_id}/export.csv")
async def export_task_csv(
    task_id: uuid.UUID,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> Response:
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    result = await _latest_result(db, task.id)
    await audit(
        db, user=user, action=AuditAction.TASK_EXPORT.value,
        resource_type="task", resource_id=str(task_id),
        request=request, details={"format": "csv", "type": task.type, "target": task.target},
    )
    return _csv_response([_task_to_csv_row(task, result)], f"task-{task_id}.csv")


@router.get("/groups/{group_id}/export.json")
async def export_group_json(
    group_id: uuid.UUID,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> Response:
    tasks_q = await db.execute(
        select(Task).where(Task.group_id == group_id).order_by(Task.created_at.asc())
    )
    tasks_list = list(tasks_q.scalars())
    if not tasks_list:
        raise HTTPException(status_code=404, detail="task group not found")
    payload = {
        "group_id": str(group_id),
        "tasks": [await _task_export_payload(db, t) for t in tasks_list],
    }
    await audit(
        db, user=user, action=AuditAction.TASK_GROUP_EXPORT.value,
        resource_type="task_group", resource_id=str(group_id),
        request=request, details={"format": "json", "task_count": len(tasks_list)},
    )
    return _json_response(payload, f"group-{group_id}.json")


@router.get("/groups/{group_id}/export.csv")
async def export_group_csv(
    group_id: uuid.UUID,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> Response:
    tasks_q = await db.execute(
        select(Task).where(Task.group_id == group_id).order_by(Task.created_at.asc())
    )
    tasks_list = list(tasks_q.scalars())
    if not tasks_list:
        raise HTTPException(status_code=404, detail="task group not found")
    task_ids = [t.id for t in tasks_list]
    results_q = await db.execute(select(Result).where(Result.task_id.in_(task_ids)))
    by_task = {r.task_id: r for r in results_q.scalars()}
    rows = [_task_to_csv_row(t, by_task.get(t.id)) for t in tasks_list]
    await audit(
        db, user=user, action=AuditAction.TASK_GROUP_EXPORT.value,
        resource_type="task_group", resource_id=str(group_id),
        request=request, details={"format": "csv", "task_count": len(tasks_list)},
    )
    return _csv_response(rows, f"group-{group_id}.csv")


@router.get("/groups/{group_id}", response_model=TaskGroupOut)
async def get_task_group(
    group_id: uuid.UUID, _: CurrentUser, db: DbSession
) -> TaskGroupOut:
    tasks_q = await db.execute(
        select(Task).where(Task.group_id == group_id).order_by(Task.created_at.asc())
    )
    tasks = list(tasks_q.scalars())
    if not tasks:
        raise HTTPException(status_code=404, detail="task group not found")
    first = tasks[0]
    task_ids = [t.id for t in tasks]
    results_q = await db.execute(
        select(Result).where(Result.task_id.in_(task_ids))
    )
    by_task = {r.task_id: r for r in results_q.scalars()}
    children: list[TaskGroupTaskOut] = []
    for t in tasks:
        out = TaskGroupTaskOut.model_validate(t)
        r = by_task.get(t.id)
        if r is not None:
            out.result = ResultOut.model_validate(r)
        children.append(out)
    return TaskGroupOut(
        group_id=group_id,
        type=first.type,
        target=first.target,
        options=first.options,
        created_at=first.created_at,
        created_by=first.created_by,
        tasks=children,
    )


@router.get("/{task_id}", response_model=TaskDetailOut)
async def get_task(task_id: uuid.UUID, _: CurrentUser, db: DbSession) -> TaskDetailOut:
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    result_q = await db.execute(
        select(Result).where(Result.task_id == task_id).order_by(Result.created_at.desc()).limit(1)
    )
    result = result_q.scalar_one_or_none()
    siblings_q = await db.execute(
        select(Task.id)
        .where(Task.group_id == task.group_id)
        .where(Task.id != task.id)
    )
    detail = TaskDetailOut.model_validate(task)
    detail.siblings = [row[0] for row in siblings_q.all()]
    if result is not None:
        detail.result = ResultOut.model_validate(result)
    return detail


@router.post("/{task_id}/cancel", response_model=TaskOut)
async def cancel_task(
    task_id: uuid.UUID, user: CurrentOperator, db: DbSession, request: Request,
) -> TaskOut:
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    if task.status in TERMINAL_STATUSES:
        raise HTTPException(status_code=400, detail=f"task already {task.status}")
    task.status = TaskStatus.CANCELLED.value
    task.finished_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(task)
    await audit(
        db, user=user, action=AuditAction.TASK_CANCEL.value,
        resource_type="task", resource_id=str(task_id),
        request=request,
    )
    return TaskOut.model_validate(task)


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: uuid.UUID,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> None:
    """Hard-delete a task and its result row. Refuses to nuke live tasks —
    cancel them first. The agent's view of the task disappears on next poll;
    any in-flight chunk submission from the agent will 404 cleanly."""
    task = await db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    if task.status not in TERMINAL_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"task is {task.status} — cancel it before deleting",
        )
    # Result + audit metadata before the row goes away.
    target, ttype, group_id = task.target, task.type, task.group_id
    await db.delete(task)  # cascade drops the result row
    await db.commit()
    await audit(
        db, user=user, action=AuditAction.TASK_DELETE.value,
        resource_type="task", resource_id=str(task_id),
        request=request,
        details={"type": ttype, "target": target, "group_id": str(group_id)},
    )


@router.delete("/groups/{group_id}", status_code=204)
async def delete_task_group(
    group_id: uuid.UUID,
    user: CurrentOperator,
    db: DbSession,
    request: Request,
) -> None:
    """Delete every task in a group. All members must be in a terminal state."""
    rows = await db.execute(select(Task).where(Task.group_id == group_id))
    tasks_list = list(rows.scalars())
    if not tasks_list:
        raise HTTPException(status_code=404, detail="task group not found")
    live = [t for t in tasks_list if t.status not in TERMINAL_STATUSES]
    if live:
        raise HTTPException(
            status_code=409,
            detail=f"{len(live)} tasks in this group are still running — cancel them first",
        )
    for t in tasks_list:
        await db.delete(t)
    await db.commit()
    await audit(
        db, user=user, action=AuditAction.TASK_GROUP_DELETE.value,
        resource_type="task_group", resource_id=str(group_id),
        request=request,
        details={"task_count": len(tasks_list)},
    )
