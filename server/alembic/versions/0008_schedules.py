"""schedules table

Revision ID: 0008_schedules
Revises: 0007_agent_geo
Create Date: 2026-05-14 11:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008_schedules"
down_revision: str | None = "0007_agent_geo"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "schedules",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("target", sa.String(512), nullable=False),
        sa.Column(
            "options", postgresql.JSONB(astext_type=sa.Text()),
            nullable=False, server_default="{}",
        ),
        sa.Column(
            "agent_ids", postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False, server_default="{}",
        ),
        sa.Column(
            "tags", postgresql.ARRAY(sa.String()),
            nullable=False, server_default="{}",
        ),
        sa.Column("agents_per_tag", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("interval_seconds", sa.Integer(), nullable=False),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_group_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_run_error", sa.String(512), nullable=True),
        sa.Column("runs_total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("runs_failed", sa.Integer(), nullable=False, server_default="0"),
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
    op.create_index("ix_schedules_next_run_at", "schedules", ["next_run_at"])


def downgrade() -> None:
    op.drop_index("ix_schedules_next_run_at", table_name="schedules")
    op.drop_table("schedules")
