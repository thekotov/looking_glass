"""add group_id to tasks

Revision ID: 0003_task_group_id
Revises: 0002_tasks_results
Create Date: 2026-05-13 12:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_task_group_id"
down_revision: str | None = "0002_tasks_results"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Add nullable column.
    op.add_column(
        "tasks",
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    # 2. Backfill: existing rows form singleton groups where group_id = id.
    op.execute("UPDATE tasks SET group_id = id WHERE group_id IS NULL")
    # 3. Enforce NOT NULL + add index.
    op.alter_column("tasks", "group_id", nullable=False)
    op.create_index("ix_tasks_group_id", "tasks", ["group_id"])


def downgrade() -> None:
    op.drop_index("ix_tasks_group_id", table_name="tasks")
    op.drop_column("tasks", "group_id")
