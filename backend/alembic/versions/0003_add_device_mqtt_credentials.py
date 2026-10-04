"""add device mqtt credentials

Revision ID: 0003
Revises: 0002
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("mqtt_username", sa.String(length=128), nullable=True))
    op.add_column("devices", sa.Column("mqtt_password_hash", sa.String(length=255), nullable=True))
    op.create_index("ix_devices_mqtt_username", "devices", ["mqtt_username"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_devices_mqtt_username", table_name="devices")
    op.drop_column("devices", "mqtt_password_hash")
    op.drop_column("devices", "mqtt_username")
