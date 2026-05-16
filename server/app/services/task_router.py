"""Routes a TaskCreateRequest to a concrete set of target agents.

Centralizes the "which agents will run this?" decision so the API endpoint
stays small. Three input modes:

- ``agent_id``: M2-style, returns [agent]
- ``agent_ids``: explicit list, returns those agents in order
- ``tags`` + ``agents_per_tag``: picks N agents per tag, distinct agents only,
   most recently active first
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent, AgentStatus
from app.schemas.task import TaskCreateRequest


class RouterError(ValueError):
    """User-safe message about why routing failed."""


async def resolve_agents(
    db: AsyncSession, req: TaskCreateRequest, *, task_type: str
) -> list[Agent]:
    if req.agent_id is not None:
        agents = await _by_ids(db, [req.agent_id])
    elif req.agent_ids:
        agents = await _by_ids(db, req.agent_ids)
    elif req.tags:
        agents = await _by_tags(db, req.tags, req.agents_per_tag)
    else:
        raise RouterError("no agents specified")

    if not agents:
        raise RouterError("no agents matched the request")

    for a in agents:
        if a.status != AgentStatus.ACTIVE.value:
            raise RouterError(f"agent {a.hostname} is {a.status}, not active")
        if a.capabilities and task_type not in a.capabilities:
            raise RouterError(
                f"agent {a.hostname} does not support {task_type} "
                f"(caps: {a.capabilities})"
            )
    return agents


async def _by_ids(db: AsyncSession, ids: list[uuid.UUID]) -> list[Agent]:
    if not ids:
        return []
    # Preserve caller's order so the UI sees rows in their submission order.
    result = await db.execute(select(Agent).where(Agent.id.in_(ids)))
    by_id = {a.id: a for a in result.scalars()}
    out: list[Agent] = []
    seen: set[uuid.UUID] = set()
    for aid in ids:
        if aid in seen:
            continue
        seen.add(aid)
        if aid not in by_id:
            raise RouterError(f"agent {aid} not found")
        out.append(by_id[aid])
    return out


async def _by_tags(db: AsyncSession, tags: list[str], per_tag: int) -> list[Agent]:
    # For each tag, pick the N most-recently-seen active agents.
    chosen: dict[uuid.UUID, Agent] = {}
    for tag in tags:
        result = await db.execute(
            select(Agent)
            .where(Agent.tags.any(tag))
            .where(Agent.status == AgentStatus.ACTIVE.value)
            .order_by(Agent.last_seen.desc().nulls_last())
            .limit(per_tag)
        )
        matches = list(result.scalars())
        if not matches:
            raise RouterError(f"no active agent has tag {tag!r}")
        for a in matches:
            chosen[a.id] = a  # dedupe across overlapping tag sets
    return list(chosen.values())
