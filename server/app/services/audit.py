"""Audit log helper.

The endpoints call ``audit()`` to record any action that changes server state
or affects auth. The function never raises — audit logging must not break the
request path it instruments.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditEvent
from app.models.user import User

log = logging.getLogger(__name__)


async def audit(
    db: AsyncSession,
    *,
    action: str,
    user: User | None = None,
    username: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    request: Request | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    try:
        ip = None
        if request is not None and request.client is not None:
            ip = request.client.host
        event = AuditEvent(
            user_id=user.id if user is not None else None,
            username=username or (user.username if user is not None else None),
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            ip=ip,
            details=details,
        )
        db.add(event)
        await db.commit()
    except Exception:
        log.exception("audit logging failed for action=%s", action)
        # Swallow — audit must not break the request.
