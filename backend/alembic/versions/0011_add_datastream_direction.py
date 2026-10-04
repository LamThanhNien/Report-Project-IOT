"""Add direction to tenant datastreams without modifying existing rows.

Revision ID: 0011
Revises: 0010
Create Date: 2026-07-11 12:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0011"
down_revision: Union[str, None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # A server default backfills existing records safely; no data is deleted.
    op.add_column(
        "tenant_datastreams",
        sa.Column("direction", sa.String(length=16), nullable=False, server_default="bidirectional"),
    )
    op.create_check_constraint(
        "ck_datastream_direction",
        "tenant_datastreams",
        "direction IN ('telemetry', 'command', 'bidirectional')",
    )
    op.drop_constraint("ck_datastream_data_type", "tenant_datastreams", type_="check")
    op.create_check_constraint(
        "ck_datastream_data_type",
        "tenant_datastreams",
        "data_type IN ('integer', 'double', 'string', 'boolean')",
    )
    op.alter_column("tenant_datastreams", "direction", server_default=None)


def downgrade() -> None:
    op.drop_constraint("ck_datastream_data_type", "tenant_datastreams", type_="check")
    op.create_check_constraint(
        "ck_datastream_data_type",
        "tenant_datastreams",
        "data_type IN ('integer', 'double', 'string')",
    )
    op.drop_constraint("ck_datastream_direction", "tenant_datastreams", type_="check")
    op.drop_column("tenant_datastreams", "direction")
