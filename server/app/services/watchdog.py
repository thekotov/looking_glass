"""Background watchdog that releases tasks stuck in non-terminal states.

If an agent crashes between claim and submit_result, the task row stays
``claimed`` (or ``running``) forever — the queue depth metric grows without
bound and the user sees a spinner that never resolves. This worker scans for
such rows on a tick and re-queues anything older than ``CLAIM_GRACE`` while
the agent is still online; if the agent has gone offline (no heartbeat for
``AGENT_OFFLINE_GRACE``) the task is marked ``timeout`` instead so it stops
blocking the user's view.

Design notes
------------
- One asyncio task per process, started from FastAPI lifespan alongside the
  scheduler. Tick interval is intentionally long (30s) — task reclaim is a
  recovery path, not a hot loop.
- Eligibility: ``status IN ('claimed','running')`` AND
  ``COALESCE(started_at, claimed_at) < now() - CLAIM_GRACE``. Newly-claimed
  long-runners (mtr cycles=100) must not be reclaimed prematurely, so the
  grace window is generous.
- Agent online check uses ``agents.last_seen`` — the same field heartbeat
  updates. An agent that is online but slow gets its task re-queued for
  another poll cycle; an offline agent's task is failed.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text

from app.core.db import SessionLocal as async_session_factory
from app.models.agent import Agent
from app.models.task import Task, TaskStatus

log = logging.getLogger(__name__)

TICK_SECONDS = 30
# Tasks may legitimately run for minutes (mtr cycles, hping3). The watchdog
# should only intervene when the agent has gone silent — measured against
# heartbeat staleness — or when the task has clearly exceeded any reasonable
# wall-clock for a single run.
CLAIM_GRACE = timedelta(minutes=10)
AGENT_OFFLINE_GRACE = timedelta(minutes=2)


async def watchdog_loop() -> None:
    """Forever loop. Cancelled by FastAPI lifespan on shutdown."""
    log.info("watchdog started (tick=%ss, claim_grace=%s)", TICK_SECONDS, CLAIM_GRACE)
    while True:
        try:
            await _tick()
        except asyncio.CancelledError:
            log.info("watchdog cancelled")
            raise
        except Exception:
            log.exception("watchdog tick failed")
        await asyncio.sleep(TICK_SECONDS)


async def _tick() -> None:
    now = datetime.now(UTC)
    claim_cutoff = now - CLAIM_GRACE
    offline_cutoff = now - AGENT_OFFLINE_GRACE

    async with async_session_factory() as session:
        rows = await session.execute(
            text(
                """
                SELECT id, agent_id, status, claimed_at, started_at
                FROM tasks
                WHERE status IN ('claimed', 'running')
                  AND COALESCE(started_at, claimed_at) < :cutoff
                ORDER BY COALESCE(started_at, claimed_at) ASC
                LIMIT 200
                FOR UPDATE SKIP LOCKED
                """
            ),
            {"cutoff": claim_cutoff},
        )
        candidates = [
            (r[0], r[1], r[2], r[3], r[4]) for r in rows.fetchall()
        ]
        if not candidates:
            await session.commit()
            return

        # Bulk-fetch agents so we don't issue N+1 queries.
        agent_ids = list({c[1] for c in candidates})
        agents_q = await session.execute(
            select(Agent.id, Agent.last_seen).where(Agent.id.in_(agent_ids))
        )
        last_seen = {row.id: row.last_seen for row in agents_q}

        requeued = 0
        timed_out = 0
        for task_id, agent_id, _status, _claimed, _started in candidates:
            seen = last_seen.get(agent_id)
            agent_online = seen is not None and seen >= offline_cutoff
            task = await session.get(Task, task_id)
            if task is None:
                continue
            # Re-check the status inside the lock — another worker may have
            # finished this task between the SELECT and the UPDATE.
            if task.status not in (TaskStatus.CLAIMED.value, TaskStatus.RUNNING.value):
                continue
            if agent_online:
                # Agent might still complete it — give it back to the queue so
                # another poll picks it up. The original agent will see a 404
                # on submit if the task got reclaimed by a sibling.
                task.status = TaskStatus.QUEUED.value
                task.claimed_at = None
                task.started_at = None
                requeued += 1
            else:
                task.status = TaskStatus.TIMEOUT.value
                task.finished_at = now
                task.error = "agent offline; task abandoned by watchdog"
                timed_out += 1

        await session.commit()
        if requeued or timed_out:
            log.warning(
                "watchdog reclaimed tasks: requeued=%d timed_out=%d",
                requeued, timed_out,
            )
