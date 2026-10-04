import uuid
from unittest.mock import MagicMock
from sqlalchemy.exc import IntegrityError

from app.bounded_contexts.tenant_management.infrastructure.repositories import assign_device
from app.modules.devices.model import Device
from app.modules.tenants.model import TenantDeviceMapping


def test_assign_device_race_condition():
    tenant_id = uuid.uuid4()
    device_id = uuid.uuid4()

    mock_db = MagicMock()

    # 1. First get(Device) returns a device with no tenant
    mock_device = Device(id=device_id, tenant_id=None)
    mock_db.get.return_value = mock_device

    # 2. scalar() calls:
    # First: check other tenant mapping -> return None
    # Second: check this tenant mapping -> return None (first thread)
    # Third: in IntegrityError catch block, it retries and finds it -> return mapping
    scalar_calls = []

    def fake_scalar(stmt):
        scalar_calls.append(stmt)
        if len(scalar_calls) == 1:
            return None
        if len(scalar_calls) == 2:
            return None
        if len(scalar_calls) == 3 and mock_db.rollback.called:
            return TenantDeviceMapping(tenant_id=tenant_id, device_id=device_id)

        # When pg_insert executes and does returning(), mock it to return a device capability
        mock_cap = MagicMock()
        mock_cap.capability_key = "test"
        return mock_cap

    mock_db.scalar.side_effect = fake_scalar

    # 3. commit() calls:
    # First commit() fails with IntegrityError (Unique constraint on tenant_device_mapping)
    # Second commit() in _ensure_small_project_capabilities succeeds
    mock_db.commit.side_effect = [
        IntegrityError("duplicate key", "params", "orig"),
        None,
    ]

    result = assign_device(mock_db, tenant_id=tenant_id, device_id=device_id)

    # Verify rollback was called after IntegrityError
    assert mock_db.rollback.called

    # Verify mapping is returned properly despite IntegrityError
    assert result.tenant_id == tenant_id
    assert result.device_id == device_id

    # Verify _ensure_small_project_capabilities was executed (which calls db.commit again at the end)
    assert mock_db.commit.call_count == 2
