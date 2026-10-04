"""Add bounded replay protection for OTA download tokens.

Revision ID: 0002
Revises: 0001
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "used_ota_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("jti", sa.String(length=36), nullable=False),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("device_uid", sa.String(length=128), nullable=False),
        sa.Column(
            "used_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_used_ota_tokens_jti", "used_ota_tokens", ["jti"], unique=True)
    op.create_index("ix_used_ota_tokens_expires_at", "used_ota_tokens", ["expires_at"])


def downgrade() -> None:
    op.drop_index("ix_used_ota_tokens_expires_at", table_name="used_ota_tokens")
    op.drop_index("ix_used_ota_tokens_jti", table_name="used_ota_tokens")
    op.drop_table("used_ota_tokens")
