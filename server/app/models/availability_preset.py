import uuid
from datetime import datetime

from sqlalchemy import ARRAY, Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models import Base


class AvailabilityPreset(Base):
    """A saved availability-check configuration.

    User-named bundle of targets + check params + agent selection that can be
    rerun on demand. Each run creates a fresh task group; we remember the most
    recent group_id so the UI can jump straight to its matrix.

    Distinct from Schedule: a preset is "I want to re-run this configuration
    when I click a button", whereas Schedule is "run this automatically every
    N seconds forever".
    """

    __tablename__ = "availability_presets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)

    # Probe configuration — mirrors AvailabilityCheckCreate.
    targets: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=list
    )
    check_icmp: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    check_tcp: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    tcp_port: Mapped[int] = mapped_column(Integer, nullable=False, default=443)
    timeout_sec: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    ping_count: Mapped[int] = mapped_column(Integer, nullable=False, default=4)

    # Empty array = use all active agents at run time.
    agent_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(UUID(as_uuid=True)), nullable=False, default=list, server_default="{}"
    )

    # Most recent run — UI uses this to render "Open last matrix" without
    # the user having to fish the group ID out of the URL bar.
    last_run_group_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    last_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    runs_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
