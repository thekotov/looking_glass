import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class AuditAction(StrEnum):
    LOGIN = "login"
    LOGIN_FAILED = "login_failed"
    USER_CREATE = "user_create"
    USER_UPDATE = "user_update"
    USER_DELETE = "user_delete"
    PASSWORD_CHANGE = "password_change"
    AGENT_APPROVE = "agent_approve"
    AGENT_REJECT = "agent_reject"
    AGENT_UPDATE = "agent_update"
    AGENT_DELETE = "agent_delete"
    TASK_CREATE = "task_create"
    TASK_CANCEL = "task_cancel"
    TASK_DELETE = "task_delete"
    TASK_GROUP_DELETE = "task_group_delete"
    TASK_EXPORT = "task_export"
    TASK_GROUP_EXPORT = "task_group_export"
    AVAILABILITY_CHECK_CREATE = "availability_check_create"
    AVAIL_PRESET_CREATE = "avail_preset_create"
    AVAIL_PRESET_UPDATE = "avail_preset_update"
    AVAIL_PRESET_DELETE = "avail_preset_delete"
    AVAIL_PRESET_RUN = "avail_preset_run"
    PUBLIC_TARGET_ADD = "public_target_add"
    PUBLIC_TARGET_UPDATE = "public_target_update"
    PUBLIC_TARGET_REMOVE = "public_target_remove"
    SCHEDULE_CREATE = "schedule_create"
    SCHEDULE_UPDATE = "schedule_update"
    SCHEDULE_DELETE = "schedule_delete"
    SCHEDULE_TRIGGER = "schedule_trigger"


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # NULL when the action precedes auth (failed login) or after user deletion.
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    username: Mapped[str | None] = mapped_column(String(64), nullable=True)
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip: Mapped[str | None] = mapped_column(INET, nullable=True)
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
