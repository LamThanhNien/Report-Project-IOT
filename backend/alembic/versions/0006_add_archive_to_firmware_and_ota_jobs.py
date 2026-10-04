"""add archive to firmware and ota jobs

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-02 15:20:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column('firmware_versions', sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('firmware_versions', sa.Column('archived_by', postgresql.UUID(as_uuid=True), nullable=True))
    
    op.add_column('ota_jobs', sa.Column('archived_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('ota_jobs', sa.Column('archived_by', postgresql.UUID(as_uuid=True), nullable=True))

def downgrade() -> None:
    op.drop_column('ota_jobs', 'archived_by')
    op.drop_column('ota_jobs', 'archived_at')
    
    op.drop_column('firmware_versions', 'archived_by')
    op.drop_column('firmware_versions', 'archived_at')
