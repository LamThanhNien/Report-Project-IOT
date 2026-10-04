import asyncio
import sys
from fastapi.testclient import TestClient

def test_offline_timeout():
    from app.main import app
    from app.db.session import SessionLocal
    from app.modules.auth.model import User
    from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
    from app.modules.tenants.model import Tenant, TenantDeviceMapping
    import uuid
    
    db = SessionLocal()
    tenant = db.query(Tenant).first()
    if not tenant:
        tenant = Tenant(name="Test Tenant", slug="test-tenant")
        db.add(tenant)
        db.commit()
        db.refresh(tenant)
        
    device = db.query(Device).filter(Device.device_uid=="fffff").first()
    if not device:
        device = Device(device_uid="fffff", name="Test Device", status="online")
        db.add(device)
        db.commit()
        db.refresh(device)
        
    mapping = db.query(TenantDeviceMapping).filter_by(tenant_id=tenant.id, device_id=device.id).first()
    if not mapping:
        mapping = TenantDeviceMapping(tenant_id=tenant.id, device_id=device.id)
        db.add(mapping)
        db.commit()
        
    user = db.query(User).filter_by(tenant_id=tenant.id).first()
    if not user:
        user = User(email="test@test.com", password_hash="hash", tenant_id=tenant.id)
        db.add(user)
        db.commit()
        db.refresh(user)

    from app.modules.auth.service import create_access_token
    token = create_access_token(user.id)
    
    client = TestClient(app)
    response = client.patch(
        "/api/v1/client/devices/fffff/offline-timeout",
        json={"offline_timeout_seconds": 120},
        headers={"Authorization": f"Bearer {token}"}
    )
    print("STATUS CODE:", response.status_code)
    print("RESPONSE:", response.text)

if __name__ == "__main__":
    test_offline_timeout()
