import asyncio
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.db.session import SessionLocal, postgres_rls_bypass
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
from app.bounded_contexts.tenant_management.infrastructure.persistence.models import Tenant
from app.bounded_contexts.identity.presentation.mqtt_webhook_router import compute_sha256
import uuid

def fix_device():
    db = SessionLocal()
    with postgres_rls_bypass(db):
        uid = "fffff"
        token = "lxZi6whwOyTHEz1hb6CW8f6Os1PfaWAGLOHuHt4U-Ks"
        token_hash = compute_sha256(token)
        device = db.query(Device).filter(Device.device_uid == uid).first()
        if not device:
            device = Device(id=uuid.uuid4(), device_uid=uid, auth_token_hash=token_hash, status="active")
            db.add(device)
            db.commit()
            print("Created device fffff")
        else:
            device.auth_token_hash = token_hash
            db.commit()
            print("Updated device fffff")

if __name__ == "__main__":
    fix_device()
