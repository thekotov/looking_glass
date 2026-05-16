"""public_targets table

Revision ID: 0006_public_targets
Revises: 0005_agent_meta
Create Date: 2026-05-13 15:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006_public_targets"
down_revision: str | None = "0005_agent_meta"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "public_targets",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True, nullable=False
        ),
        sa.Column("target", sa.String(512), nullable=False, unique=True),
        sa.Column("label", sa.String(128), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_public_targets_sort", "public_targets", ["sort_order"])


def downgrade() -> None:
    op.drop_index("ix_public_targets_sort", table_name="public_targets")
    op.drop_table("public_targets")
