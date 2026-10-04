"""Add tenant_datastreams table for Virtual Pin (Datastreams) feature

Revision ID: 0009
Revises: 0008
Create Date: 2026-07-10 22:00:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0009"
down_revision: Union[str, None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "tenant_datastreams",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("alias", sa.String(255), nullable=False),
        sa.Column("pin", sa.Integer(), nullable=False),  # 0-255, biểu thị V0-V255
        sa.Column("data_type", sa.String(64), nullable=False),  # integer, double, string
        sa.Column("unit", sa.String(64), nullable=True),
        sa.Column("min_value", sa.Double(), nullable=True),
        sa.Column("max_value", sa.Double(), nullable=True),
        sa.Column("default_value", sa.String(255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("tenant_id", "pin", name="uq_tenant_datastream_pin"),
        sa.CheckConstraint("pin >= 0 AND pin <= 255", name="ck_datastream_pin_range"),
        sa.CheckConstraint(
            "data_type IN ('integer', 'double', 'string')",
            name="ck_datastream_data_type",
        ),
    )
    op.create_index("idx_tenant_datastreams_tenant_id", "tenant_datastreams", ["tenant_id"])
    op.create_index("idx_tenant_datastreams_pin", "tenant_datastreams", ["tenant_id", "pin"])


def downgrade() -> None:
    op.drop_index("idx_tenant_datastreams_pin", table_name="tenant_datastreams")
    op.drop_index("idx_tenant_datastreams_tenant_id", table_name="tenant_datastreams")
    op.drop_table("tenant_datastreams")
