"""Add hub and spoke project scoping schema

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-06 19:35:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: Union[str, None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add project_id to devices
    op.add_column(
        "devices",
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenant_projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("idx_devices_project_id", "devices", ["project_id"])

    # 2. Add project_id to ota_campaigns
    op.add_column(
        "ota_campaigns",
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenant_projects.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_index("idx_ota_campaigns_project_id", "ota_campaigns", ["project_id"])

    # 3. Create tenant_firmwares table (Registry Pattern)
    op.create_table(
        "tenant_firmwares",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "tenant_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("version", sa.String(32), nullable=False),
        sa.Column("hardware_model", sa.String(64), nullable=False),
        sa.Column("file_path", sa.String(512), nullable=False),
        sa.Column("checksum", sa.String(64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("tenant_id", "hardware_model", "version", name="uq_tenant_firmware_ver"),
    )

    # 4. Create project_firmware_references table (Reference Pattern)
    op.create_table(
        "project_firmware_references",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenant_projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "firmware_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenant_firmwares.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "approved_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "approved_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint("project_id", "firmware_id", name="uq_project_firmware_ref"),
    )

    # 5. Create project_members table (Matrix RBAC)
    op.create_table(
        "project_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tenant_projects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("role", sa.String(32), nullable=False, server_default="project_viewer"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.UniqueConstraint("project_id", "user_id", name="uq_project_member"),
    )


def downgrade() -> None:
    op.drop_table("project_members")
    op.drop_table("project_firmware_references")
    op.drop_table("tenant_firmwares")
    op.drop_index("idx_ota_campaigns_project_id", table_name="ota_campaigns")
    op.drop_column("ota_campaigns", "project_id")
    op.drop_index("idx_devices_project_id", table_name="devices")
    op.drop_column("devices", "project_id")
