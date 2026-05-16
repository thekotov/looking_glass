"""Admin-only audit log query endpoint."""
from __future__ import annotations

import ipaddress
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import select

from app.core.deps import DbSession
from app.core.rbac import CurrentAdmin
from app.models.audit import AuditEvent

router = APIRouter(prefix="/audit", tags=["audit"])


class AuditEventOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    username: str | None
    action: str
    resource_type: str | None
    resource_id: str | None
    ip: str | None
    details: dict[str, Any] | None
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("ip", mode="before")
    @classmethod
    def _ip_to_str(cls, v: Any) -> Any:
        if isinstance(v, ipaddress.IPv4Address | ipaddress.IPv6Address):
            return str(v)
        return v


@router.get("", response_model=list[AuditEventOut])
async def list_audit_events(
    _: CurrentAdmin,
    db: DbSession,
    action: str | None = Query(default=None),
    username: str | None = Query(default=None),
    user_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
) -> list[AuditEventOut]:
    stmt = select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(limit)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    if username:
        stmt = stmt.where(AuditEvent.username == username)
    if user_id:
        stmt = stmt.where(AuditEvent.user_id == user_id)
    result = await db.execute(stmt)
    return [AuditEventOut.model_validate(e) for e in result.scalars()]
