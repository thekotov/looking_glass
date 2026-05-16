"""Background worker that fires due schedules.

Design notes
------------
- One asyncio task per process, started from FastAPI lifespan.
- Every TICK_SECONDS it picks up rows where next_run_at <= now AND enabled.
- For each due row it routes/inserts tasks via the same path as manual
  creation (resolve_agents + Task rows). That keeps validation centralised.
- next_run_at is advanced by interval_seconds — if the worker fell behind,
  we DON'T spam catch-up runs (one fire per tick, not per missed interval).
- A row that crashes during fire is marked with last_run_error and skipped
  until the next tick.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import SessionLocal as async_session_factory
from app.models.agent import Agent, AgentStatus
from app.models.schedule import Schedule
from app.models.task import Task, TaskStatus, TaskType
from app.validators.targets import TargetValidationError, validate_target
from app.validators.task_params import TaskParamsError, validate_task_params

log = logging.getLogger(__name__)

TICK_SECONDS = 5


async def scheduler_loop() -> None:
    """Forever loop. Cancelled by FastAPI lifespan on shutdown."""
    log.info("scheduler started (tick=%ss)", TICK_SECONDS)
    while True:
        try:
            await _tick()
        except asyncio.CancelledError:
            log.info("scheduler cancelled")
            raise
        except Exception:
            log.exception("scheduler tick failed")
        await asyncio.sleep(TICK_SECONDS)


async def _tick() -> None:
    """Find every schedule due to run and fire it.

    We open one session per due row so a row that errors doesn't poison the
    rest. Within a single tick we serialise — small N (dozens, maybe hundreds
    of schedules), no benefit from parallel fan-out yet.
    """
    now = datetime.now(UTC)
    async with async_session_factory() as session:
        rows = await session.execute(
            select(Schedule)
            .where(Schedule.enabled.is_(True))
            .where(Schedule.next_run_at <= now)
            .order_by(Schedule.next_run_at)
            .limit(50)
        )
        due_ids = [r.id for r in rows.scalars()]

    for sched_id in due_ids:
        async with async_session_factory() as session:
            try:
                await _fire_one(session, sched_id)
            except Exception as e:
                log.exception("schedule %s fire failed", sched_id)
                # Persist the error on the row so admins can see it.
                async with async_session_factory() as s2:
                    sched = await s2.get(Schedule, sched_id)
                    if sched is not None:
                        sched.last_run_error = (str(e) or repr(e))[:512]
                        sched.runs_failed += 1
                        sched.runs_total += 1
                        sched.last_run_at = datetime.now(UTC)
                        sched.next_run_at = datetime.now(UTC) + timedelta(
                            seconds=sched.interval_seconds
                        )
                        await s2.commit()


async def _fire_one(session: AsyncSession, sched_id: uuid.UUID) -> None:
    sched = await session.get(Schedule, sched_id)
    if sched is None or not sched.enabled:
        return
    # Re-check the timestamp: another worker (or a manual trigger) might have
    # already advanced it.
    now = datetime.now(UTC)
    if sched.next_run_at > now:
        return

    group_id, count = await fire_schedule(session, sched)
    sched.last_run_at = now
    sched.last_run_group_id = group_id
    sched.last_run_error = None if count > 0 else "no eligible agents"
    sched.runs_total += 1
    if count == 0:
        sched.runs_failed += 1
    sched.next_run_at = now + timedelta(seconds=sched.interval_seconds)
    await session.commit()
    log.info(
        "schedule fired: id=%s name=%r type=%s target=%s agents=%d next=%s",
        sched.id, sched.name, sched.type, sched.target, count, sched.next_run_at,
    )


async def fire_schedule(
    session: AsyncSession, sched: Schedule
) -> tuple[uuid.UUID, int]:
    """Create tasks for the given schedule. Returns (group_id, count).

    Validation mirrors POST /api/tasks — invalid task params still get
    persisted *as a row*, but a bad target raises and the loop catches it.
    Routing skips inactive/incompatible agents silently (no crash for a
    schedule whose tags now match nothing).
    """
    if sched.type not in {t.value for t in TaskType}:
        raise ValueError(f"unknown task type: {sched.type}")

    try:
        normalized_target = validate_target(sched.target)
    except TargetValidationError as e:
        raise ValueError(f"invalid target: {e}") from e

    try:
        normalized_options = validate_task_params(sched.type, sched.options)
    except TaskParamsError as e:
        raise ValueError(f"invalid options: {e}") from e

    agents = await _resolve_for_schedule(session, sched)

    group_id = uuid.uuid4()
    created = 0
    for agent in agents:
        if agent.capabilities and sched.type not in agent.capabilities:
            continue
        t = Task(
            type=sched.type,
            target=normalized_target,
            options=normalized_options,
            agent_id=agent.id,
            created_by=sched.created_by,
            priority=0,
            status=TaskStatus.QUEUED.value,
            group_id=group_id,
        )
        session.add(t)
        created += 1
    if created > 0:
        await session.flush()
    return group_id, created


async def _resolve_for_schedule(
    session: AsyncSession, sched: Schedule
) -> list[Agent]:
    """Like task_router.resolve_agents but tolerant: inactive agents and
    missing tags are silently dropped rather than raising. A schedule whose
    fleet shrinks shouldn't go red — it should just run on fewer agents."""
    if sched.agent_ids:
        rows = await session.execute(
            select(Agent)
            .where(Agent.id.in_(sched.agent_ids))
            .where(Agent.status == AgentStatus.ACTIVE.value)
        )
        return list(rows.scalars())
    if sched.tags:
        chosen: dict[uuid.UUID, Agent] = {}
        for tag in sched.tags:
            rows = await session.execute(
                select(Agent)
                .where(Agent.tags.any(tag))
                .where(Agent.status == AgentStatus.ACTIVE.value)
                .order_by(Agent.last_seen.desc().nulls_last())
                .limit(sched.agents_per_tag)
            )
            for a in rows.scalars():
                chosen[a.id] = a
        return list(chosen.values())
    return []
