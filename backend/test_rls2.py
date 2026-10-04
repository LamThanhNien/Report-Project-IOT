import logging
logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)

from app.db.session import SessionLocal, sync_tenant_context_in_pg
from sqlalchemy import text
from app.modules.ota.model import UsedOtaToken
from app.core.tenant_context import tenant_context
import uuid

# Load all models to avoid mapping error
from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_models import OtaJob
from app.modules.devices.model import Device
from app.modules.tenancy.model import Tenant

db = SessionLocal()
db.execute(text("SELECT 1"))

try:
    tenant = uuid.uuid4()
    with tenant_context(tenant):
        sync_tenant_context_in_pg(db)
        used_token = UsedOtaToken(
            jti="test-jti-12345",
            job_id=uuid.uuid4(),
            tenant_id=tenant, # Must match tenant_context
            device_uid="test",
            expires_at="2026-06-30"
        )
        db.add(used_token)
        db.commit()
        print("SUCCESS")
except Exception as e:
    print("ERROR:", e)
    db.rollback()
