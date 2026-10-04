"""add_device_auth_token_hash

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-27 15:38:55.068065
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("devices", sa.Column("auth_token_hash", sa.String(length=64), nullable=True))
    op.create_index(op.f("ix_devices_auth_token_hash"), "devices", ["auth_token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_devices_auth_token_hash"), table_name="devices")
    op.drop_column("devices", "auth_token_hash")
