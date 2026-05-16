"""availability_presets table

Revision ID: 0009_avail_presets
Revises: 0008_schedules
Create Date: 2026-05-14 13:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0009_avail_presets"
down_revision: str | None = "0008_schedules"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "availability_presets",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column(
            "targets", postgresql.ARRAY(sa.String()),
            nullable=False, server_default="{}",
        ),
        sa.Column("check_icmp", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("check_tcp", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("tcp_port", sa.Integer(), nullable=False, server_default="443"),
        sa.Column("timeout_sec", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("ping_count", sa.Integer(), nullable=False, server_default="4"),
        sa.Column(
            "agent_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False, server_default="{}",
        ),
        sa.Column(
            "last_run_group_id", postgresql.UUID(as_uuid=True), nullable=True
        ),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("runs_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_by", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_table("availability_presets")
