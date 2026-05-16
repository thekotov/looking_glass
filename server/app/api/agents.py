import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select

from app.core.deps import CurrentAgent, CurrentUser, DbSession
from app.core.rbac import CurrentAdmin
from app.core.security import generate_agent_token, hash_agent_token
from app.models.agent import Agent, AgentStatus
from app.models.audit import AuditAction
from app.schemas.agent import (
    AgentApproveRequest,
    AgentHeartbeatRequest,
    AgentHeartbeatResponse,
    AgentOut,
    AgentRegisterRequest,
    AgentRegisterResponse,
    AgentUpdateRequest,
)
from app.services.audit import audit
from app.services.geoip import GeoLookupError, lookup_ip

log = logging.getLogger(__name__)
router = APIRouter(prefix="/agents", tags=["agents"])

POLL_INTERVAL_SECONDS = 5


# ---------- Agent-facing endpoints (no user auth) ----------


@router.post("/register", response_model=AgentRegisterResponse)
async def register(
    payload: AgentRegisterRequest, db: DbSession, request: Request
) -> AgentRegisterResponse:
    token = generate_agent_token()
    public_ip = request.client.host if request.client else None
    agent = Agent(
        hostname=payload.hostname,
        token_hash=hash_agent_token(token),
        version=payload.version,
        capabilities=payload.capabilities,
        public_ip=public_ip,
        status=AgentStatus.PENDING.value,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    log.info("agent registered (pending): id=%s hostname=%s", agent.id, agent.hostname)
    return AgentRegisterResponse(
        agent_id=agent.id, token=token, poll_interval=POLL_INTERVAL_SECONDS
    )


@router.post("/heartbeat", response_model=AgentHeartbeatResponse)
async def heartbeat(
    payload: AgentHeartbeatRequest, agent: CurrentAgent, db: DbSession
) -> AgentHeartbeatResponse:
    agent.last_seen = datetime.now(UTC)
    if payload.version is not None:
        agent.version = payload.version
    if payload.capabilities is not None:
        agent.capabilities = payload.capabilities
    await db.commit()
    return AgentHeartbeatResponse(status=agent.status, poll_interval=POLL_INTERVAL_SECONDS)


# ---------- User-facing endpoints (admin UI) ----------


@router.get("", response_model=list[AgentOut])
async def list_agents(_: CurrentUser, db: DbSession) -> list[AgentOut]:
    result = await db.execute(select(Agent).order_by(Agent.created_at.desc()))
    return [AgentOut.model_validate(a) for a in result.scalars()]


@router.post("/{agent_id}/approve", response_model=AgentOut)
async def approve_agent(
    agent_id: uuid.UUID,
    payload: AgentApproveRequest,
    user: CurrentAdmin,
    db: DbSession,
    request: Request,
) -> AgentOut:
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="agent not found")
    agent.status = AgentStatus.ACTIVE.value
    agent.tags = payload.tags
    await db.commit()
    await db.refresh(agent)
    await audit(
        db, user=user, action=AuditAction.AGENT_APPROVE.value,
        resource_type="agent", resource_id=str(agent.id),
        request=request, details={"hostname": agent.hostname, "tags": payload.tags},
    )
    return AgentOut.model_validate(agent)


@router.patch("/{agent_id}", response_model=AgentOut)
async def update_agent(
    agent_id: uuid.UUID,
    payload: AgentUpdateRequest,
    user: CurrentAdmin,
    db: DbSession,
    request: Request,
) -> AgentOut:
    """Update mutable agent metadata: display name, description, tags, active/disabled.

    Body fields omitted from the payload are not touched. Empty strings for
    display_name/description clear the override.
    """
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="agent not found")

    body = payload.model_dump(exclude_unset=True)
    changes: dict[str, dict[str, Any]] = {}

    if "display_name" in body:
        new = body["display_name"]
        new = new.strip() if new else None
        new = new or None  # collapse "" → None
        if new != agent.display_name:
            changes["display_name"] = {"from": agent.display_name, "to": new}
            agent.display_name = new

    if "description" in body:
        new = body["description"]
        new = new.strip() if new else None
        new = new or None
        if new != agent.description:
            changes["description"] = {"from": agent.description, "to": new}
            agent.description = new

    if "tags" in body and body["tags"] is not None:
        if body["tags"] != agent.tags:
            changes["tags"] = {"from": list(agent.tags), "to": body["tags"]}
            agent.tags = body["tags"]

    if "status" in body and body["status"] is not None:
        # Only active ↔ disabled transitions allowed here. Approve/reject are
        # separate endpoints with their own audit actions.
        if agent.status not in (AgentStatus.ACTIVE.value, AgentStatus.DISABLED.value):
            raise HTTPException(
                status_code=409,
                detail=f"cannot change status from {agent.status} here",
            )
        if body["status"] != agent.status:
            changes["status"] = {"from": agent.status, "to": body["status"]}
            agent.status = body["status"]

    # Geolocation fields. Each is independent; missing key = leave as-is.
    for geo_key in ("latitude", "longitude", "city", "country_code"):
        if geo_key not in body:
            continue
        new_val = body[geo_key]
        if isinstance(new_val, str):
            new_val = new_val.strip() or None
        if new_val != getattr(agent, geo_key):
            changes[geo_key] = {"from": getattr(agent, geo_key), "to": new_val}
            setattr(agent, geo_key, new_val)

    if not changes:
        return AgentOut.model_validate(agent)

    await db.commit()
    await db.refresh(agent)
    await audit(
        db, user=user, action=AuditAction.AGENT_UPDATE.value,
        resource_type="agent", resource_id=str(agent.id),
        request=request,
        details={"hostname": agent.hostname, "changes": changes},
    )
    return AgentOut.model_validate(agent)


@router.post("/{agent_id}/geo-detect", response_model=AgentOut)
async def geo_detect_agent(
    agent_id: uuid.UUID,
    user: CurrentAdmin,
    db: DbSession,
    request: Request,
) -> AgentOut:
    """Look up the agent's public_ip via ip-api.com and persist coordinates.

    No-op for agents without a public_ip. Failures bubble up as 400/502; the
    admin can always fall back to filling lat/lon by hand.
    """
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="agent not found")
    if not agent.public_ip:
        raise HTTPException(status_code=400, detail="agent has no public_ip")
    try:
        geo = await lookup_ip(str(agent.public_ip))
    except GeoLookupError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    agent.latitude = geo.latitude
    agent.longitude = geo.longitude
    agent.city = geo.city
    agent.country_code = geo.country_code
    await db.commit()
    await db.refresh(agent)
    await audit(
        db, user=user, action=AuditAction.AGENT_UPDATE.value,
        resource_type="agent", resource_id=str(agent.id),
        request=request,
        details={
            "hostname": agent.hostname,
            "geo_detect": {
                "ip": str(agent.public_ip),
                "lat": geo.latitude,
                "lon": geo.longitude,
                "city": geo.city,
                "country": geo.country_code,
            },
        },
    )
    return AgentOut.model_validate(agent)


@router.post("/{agent_id}/reject", response_model=AgentOut)
async def reject_agent(
    agent_id: uuid.UUID, user: CurrentAdmin, db: DbSession, request: Request,
) -> AgentOut:
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="agent not found")
    agent.status = AgentStatus.REJECTED.value
    await db.commit()
    await db.refresh(agent)
    await audit(
        db, user=user, action=AuditAction.AGENT_REJECT.value,
        resource_type="agent", resource_id=str(agent.id),
        request=request, details={"hostname": agent.hostname},
    )
    return AgentOut.model_validate(agent)


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: uuid.UUID, user: CurrentAdmin, db: DbSession, request: Request,
) -> None:
    agent = await db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="agent not found")
    hostname = agent.hostname
    await db.delete(agent)
    await db.commit()
    await audit(
        db, user=user, action=AuditAction.AGENT_DELETE.value,
        resource_type="agent", resource_id=str(agent_id),
        request=request, details={"hostname": hostname},
    )
