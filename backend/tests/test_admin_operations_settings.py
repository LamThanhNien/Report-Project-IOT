from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.router import api_router
from app.bounded_contexts.device_registry.presentation import admin_operations_router
from app.bounded_contexts.identity.presentation import admin_users_router
from app.bounded_contexts.identity.presentation import router as auth_router
from app.bounded_contexts.identity.presentation.schemas import ChangePasswordRequest
from app.shared.presentation import settings_router


class FakeDb:
    def __init__(self, value=None):
        self.value = value
        self.commits = 0

    def get(self, _model, _key):
        return self.value

    def add(self, value):
        self.value = value

    def commit(self):
        self.commits += 1

    def refresh(self, _value):
        return None


def test_admin_operation_routes_are_registered() -> None:
    paths = {route.path for route in api_router.routes}
    assert "/admin/devices/{device_uid}/commands/reboot" in paths
    assert "/admin/devices/{device_uid}/maintenance/enable" in paths
    assert "/admin/devices/{device_uid}/maintenance/disable" in paths
    assert "/admin/settings" in paths
    assert "/admin/settings/ota-policy" in paths
    assert "/admin/users/admins" in paths


def test_reboot_uses_tracked_dispatch_and_audit(monkeypatch) -> None:
    device = SimpleNamespace(id=uuid4(), device_uid="esp32-1")
    admin = SimpleNamespace(id=uuid4())
    dispatch = SimpleNamespace(id=uuid4(), status="sent")
    audit_calls = []
    monkeypatch.setattr(admin_operations_router, "_device_or_404", lambda *_: device)
    monkeypatch.setattr(admin_operations_router, "_dispatch", lambda *_: dispatch)
    monkeypatch.setattr(
        admin_operations_router.device_repo,
        "get_tenant_for_device",
        lambda **_: None,  # platform-owned device (no tenant)
    )
    monkeypatch.setattr(
        admin_operations_router.audit_service,
        "log_event_best_effort",
        lambda *args, **kwargs: audit_calls.append(kwargs),
    )

    assert admin_operations_router.reboot_device("esp32-1", FakeDb(), admin) is dispatch
    assert audit_calls[0]["action"] == "admin_reboot_device"


def test_maintenance_state_only_changes_after_dispatch(monkeypatch) -> None:
    device = SimpleNamespace(id=uuid4(), device_uid="esp32-1", status="online")
    dispatch = SimpleNamespace(id=uuid4(), status="sent")
    db = FakeDb()
    admin = SimpleNamespace(id=uuid4())
    monkeypatch.setattr(admin_operations_router, "_device_or_404", lambda *_: device)
    monkeypatch.setattr(admin_operations_router, "_dispatch", lambda *_: dispatch)
    monkeypatch.setattr(
        admin_operations_router.device_repo,
        "get_tenant_for_device",
        lambda **_: None,  # platform-owned device
    )
    monkeypatch.setattr(
        admin_operations_router.audit_service, "log_event_best_effort", lambda *a, **k: None
    )

    admin_operations_router._set_maintenance(db, "esp32-1", admin, True)

    assert device.status == "maintenance"
    assert db.commits == 1


def test_system_and_ota_settings_update_persist_and_audit(monkeypatch) -> None:
    stored = SimpleNamespace(
        id=1,
        organization_name="AIFOM Lab",
        timezone="UTC",
        default_locale="vi",
        email_notifications_enabled=True,
        auto_update_enabled=False,
        maintenance_window_start="02:00",
        maintenance_window_end="05:00",
        rollback_threshold=30,
        max_concurrent_updates=10,
    )
    db = FakeDb(stored)
    admin = SimpleNamespace(id=uuid4())
    audits = []
    monkeypatch.setattr(
        settings_router.audit_service, "log_event_best_effort", lambda *a, **k: audits.append(k)
    )

    settings_router.update_system_settings(
        settings_router.SystemSettingsUpdate(
            organization_name="New Org", timezone="Asia/Ho_Chi_Minh"
        ),
        db,
        admin,
    )
    settings_router.update_ota_policy(
        settings_router.OtaPolicyUpdate(auto_update_enabled=True, max_concurrent_updates=25),
        db,
        admin,
    )

    assert stored.organization_name == "New Org"
    assert stored.auto_update_enabled is True
    assert stored.max_concurrent_updates == 25
    assert [entry["action"] for entry in audits] == ["update_system_settings", "update_ota_policy"]


def test_settings_validation_rejects_invalid_values() -> None:
    with pytest.raises(ValidationError):
        settings_router.SystemSettingsUpdate(timezone="Not/AZone")
    with pytest.raises(ValidationError):
        settings_router.OtaPolicyUpdate(rollback_threshold=101)


def test_change_password_success_and_wrong_current_password(monkeypatch) -> None:
    class PasswordService:
        def verify_password(self, plain, hashed):
            return plain == "Current1" and hashed == "old-hash"

        def hash_password(self, value):
            return f"hashed:{value}"

    monkeypatch.setattr(auth_router, "BcryptPasswordService", PasswordService)
    monkeypatch.setattr(auth_router.audit_service, "log_event_best_effort", lambda *a, **k: None)
    user = SimpleNamespace(id=uuid4(), tenant_id=None, hashed_password="old-hash")
    db = FakeDb()

    result = auth_router.change_password(
        ChangePasswordRequest(current_password="Current1", new_password="Different2"), db, user
    )
    assert result["detail"] == "Password changed successfully"
    assert user.hashed_password == "hashed:Different2"

    user.hashed_password = "old-hash"
    with pytest.raises(HTTPException) as exc:
        auth_router.change_password(
            ChangePasswordRequest(current_password="Wrong1", new_password="Different2"), db, user
        )
    assert exc.value.status_code == 400


def test_admin_cannot_deactivate_self() -> None:
    admin = SimpleNamespace(id=uuid4(), is_active=True)
    with pytest.raises(HTTPException) as exc:
        admin_users_router._set_active(FakeDb(), admin, admin, False)
    assert exc.value.status_code == 409
