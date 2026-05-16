"""agent display_name and description

Revision ID: 0005_agent_meta
Revises: 0004_audit_events
Create Date: 2026-05-13 14:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_agent_meta"
down_revision: str | None = "0004_audit_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("display_name", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "agents",
        sa.Column("description", sa.String(length=1024), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("agents", "description")
    op.drop_column("agents", "display_name")
