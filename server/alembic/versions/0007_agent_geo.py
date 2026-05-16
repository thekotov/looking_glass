"""agent geolocation columns

Revision ID: 0007_agent_geo
Revises: 0006_public_targets
Create Date: 2026-05-14 10:00:00.000000
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_agent_geo"
down_revision: str | None = "0006_public_targets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("agents", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("agents", sa.Column("longitude", sa.Float(), nullable=True))
    op.add_column("agents", sa.Column("city", sa.String(length=128), nullable=True))
    op.add_column("agents", sa.Column("country_code", sa.String(length=8), nullable=True))


def downgrade() -> None:
    op.drop_column("agents", "country_code")
    op.drop_column("agents", "city")
    op.drop_column("agents", "longitude")
    op.drop_column("agents", "latitude")
