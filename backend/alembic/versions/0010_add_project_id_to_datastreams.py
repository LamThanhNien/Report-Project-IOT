"""Add project_id to tenant_datastreams

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-11 10:00:00.000000
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0010"
down_revision: Union[str, None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Truncate existing datastreams
    op.execute('TRUNCATE TABLE tenant_datastreams CASCADE')

    # 2. Add project_id column
    op.add_column('tenant_datastreams', sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False))
    
    # 3. Create Foreign Key constraint
    op.create_foreign_key(
        'fk_tenant_datastreams_project_id',
        'tenant_datastreams',
        'tenant_projects',
        ['project_id'],
        ['id'],
        ondelete='CASCADE'
    )

    # 4. Drop old unique constraint
    op.drop_constraint('uq_tenant_datastream_pin', 'tenant_datastreams', type_='unique')

    # 5. Create new unique constraint
    op.create_unique_constraint('uq_project_datastream_pin', 'tenant_datastreams', ['project_id', 'pin'])

    # 6. Update indexes
    op.drop_index('idx_tenant_datastreams_pin', table_name='tenant_datastreams')
    op.create_index('idx_tenant_datastreams_project_id', 'tenant_datastreams', ['project_id'])
    op.create_index('idx_project_datastreams_pin', 'tenant_datastreams', ['project_id', 'pin'])


def downgrade() -> None:
    # 1. Truncate existing datastreams
    op.execute('TRUNCATE TABLE tenant_datastreams CASCADE')

    # 2. Drop new indexes
    op.drop_index('idx_project_datastreams_pin', table_name='tenant_datastreams')
    op.drop_index('idx_tenant_datastreams_project_id', table_name='tenant_datastreams')

    # 3. Recreate old indexes
    op.create_index('idx_tenant_datastreams_pin', 'tenant_datastreams', ['tenant_id', 'pin'])

    # 4. Drop new unique constraint
    op.drop_constraint('uq_project_datastream_pin', 'tenant_datastreams', type_='unique')

    # 5. Recreate old unique constraint
    op.create_unique_constraint('uq_tenant_datastream_pin', 'tenant_datastreams', ['tenant_id', 'pin'])

    # 6. Drop Foreign Key constraint
    op.drop_constraint('fk_tenant_datastreams_project_id', 'tenant_datastreams', type_='foreignkey')

    # 7. Drop project_id column
    op.drop_column('tenant_datastreams', 'project_id')
