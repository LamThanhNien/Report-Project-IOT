from pathlib import Path
import sys
from types import SimpleNamespace
from uuid import uuid4
from datetime import datetime, timezone

from fastapi import HTTPException
from fastapi.testclient import TestClient
import pytest

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app import main as app_main
from app.bounded_contexts.device_groups.application import use_cases as device_group_use_cases
from app.bounded_contexts.device_groups.presentation import router as device_group_router
from app.bounded_contexts.identity.presentation import dependencies as identity_dependencies
from app.bounded_contexts.tenant_management.presentation import router_client
from app.bounded_contexts.tenant_management.presentation import dependencies as tenant_dependencies
from app.bounded_contexts.tenant_management.presentation.schemas import (
    TenantUserCreate,
    TenantUserUpdate,
)
from app.core import security as security_module
from app.core import tenant as tenant_module
from app.core.permissions import (
    ALLOWED_PERMISSION_SET,
    OWNER_PERMISSIONS,
    VIEWER_PERMISSIONS,
    get_effective_permissions,
    validate_permissions,
)


def _tenant_user(*, role: str = "viewer", permissions: list[str] | None = None):
    return SimpleNamespace(
        id=uuid4(),
        email="tenant-user@test.local",
        role=role,
        tenant_id=uuid4(),
        is_active=True,
        permissions=permissions,
    )


def _tenant_user_record(
    *,
    tenant_id,
    role: str = "viewer",
    permissions: list[str] | None = None,
    email: str = "member@test.local",
):
    return SimpleNamespace(
        id=uuid4(),
        email=email,
        full_name="Test User",
        role=role,
        tenant_id=tenant_id,
        is_active=True,
        permissions=permissions,
        created_at=datetime.now(timezone.utc),
    )


class _TenantOverride:
    def __init__(self, user):
        self.user = user
        self._saved = None

    def __enter__(self):
        self._saved = dict(app_main.app.dependency_overrides)
        app_main.app.dependency_overrides = {
            security_module.get_current_user: lambda: self.user,
            tenant_module.get_current_tenant_user: lambda: self.user,
            identity_dependencies.get_current_user: lambda: self.user,
            identity_dependencies.get_current_tenant_user: lambda: self.user,
            tenant_dependencies.get_current_tenant_user: lambda: self.user,
        }
        return TestClient(app_main.app)

    def __exit__(self, *_):
        app_main.app.dependency_overrides = self._saved


def test_device_group_list_requires_device_group_view_permission() -> None:
    user = _tenant_user(permissions=["dashboard.view"])

    with _TenantOverride(user) as client:
        response = client.get("/api/v1/client/device-groups")

    assert response.status_code == 403
    assert response.json()["detail"] == "You do not have permission to perform this action."


def test_command_templates_require_command_template_view_permission() -> None:
    user = _tenant_user(permissions=["dashboard.view"])

    with _TenantOverride(user) as client:
        response = client.get("/api/v1/client/commands/templates")

    assert response.status_code == 403
    assert response.json()["detail"] == "You do not have permission to perform this action."


def test_project_delete_requires_project_manage_permission() -> None:
    user = _tenant_user(permissions=["projects.view"])

    with _TenantOverride(user) as client:
        response = client.delete(f"/api/v1/client/projects/{uuid4()}")

    assert response.status_code == 403
    assert response.json()["detail"] == "You do not have permission to perform this action."


def test_automation_rule_delete_requires_automation_manage_permission() -> None:
    user = _tenant_user(permissions=["automation.view"])

    with _TenantOverride(user) as client:
        response = client.delete(f"/api/v1/client/automation/rules/{uuid4()}")

    assert response.status_code == 403
    assert response.json()["detail"] == "You do not have permission to perform this action."


def test_tenant_owner_bypasses_device_group_permission_gate(monkeypatch) -> None:
    owner = _tenant_user(role="tenant_owner", permissions=[])

    monkeypatch.setattr(
        device_group_use_cases.DeviceGroupUseCases,
        "list_groups",
        lambda self, tenant_id, group_type, status, search, skip, limit: ([], 0),
    )

    with _TenantOverride(owner) as client:
        app_main.app.dependency_overrides[device_group_router.get_db] = lambda: object()
        response = client.get("/api/v1/client/device-groups")

    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "skip": 0, "limit": 50}


def test_role_permission_presets_only_contain_valid_permissions() -> None:
    assert set(OWNER_PERMISSIONS) == ALLOWED_PERMISSION_SET
    assert set(VIEWER_PERMISSIONS) <= ALLOWED_PERMISSION_SET


def test_stored_legacy_permissions_are_normalized_for_effective_permissions() -> None:
    user = _tenant_user(
        role="viewer",
        permissions=["devices:read", "telemetry:read", "alerts:acknowledge", "commands:create"],
    )

    assert get_effective_permissions(user) == [
        "devices.view",
        "monitoring.view",
        "commands.view",
    ]


def test_new_user_payloads_reject_legacy_permission_aliases() -> None:
    with pytest.raises(HTTPException):
        TenantUserCreate(
            email="legacy@example.com",
            password="Validpass1",
            permissions=["devices:read"],
        )

    with pytest.raises(HTTPException):
        TenantUserUpdate(permissions=["commands:create"])

    with pytest.raises(HTTPException):
        validate_permissions(["telemetry:read"])


def test_client_users_returns_normalized_permissions_and_preserves_tenant_isolation(
    monkeypatch,
) -> None:
    tenant_id = uuid4()
    other_tenant_id = uuid4()
    owner = _tenant_user(role="tenant_owner", permissions=[])
    owner.tenant_id = tenant_id
    users = [
        _tenant_user_record(
            tenant_id=tenant_id,
            role="tenant_owner",
            permissions=None,
            email="owner@test.local",
        ),
        _tenant_user_record(
            tenant_id=tenant_id,
            permissions=["devices:read", "telemetry:read", "alerts:acknowledge", "commands:create"],
            email="custom@test.local",
        ),
        _tenant_user_record(
            tenant_id=other_tenant_id,
            permissions=["members.view"],
            email="other@test.local",
        ),
    ]

    monkeypatch.setattr(
        tenant_module.tenant_service,
        "get_effective_features",
        lambda db, tid: {"user_management": True},
    )
    monkeypatch.setattr(
        router_client.repository,
        "list_tenant_users",
        lambda db, tid: [user for user in users if user.tenant_id == tid],
    )

    with _TenantOverride(owner) as client:
        app_main.app.dependency_overrides[tenant_module.get_db] = lambda: object()
        app_main.app.dependency_overrides[router_client.get_db] = lambda: object()
        response = client.get("/api/v1/client/users")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert [user["email"] for user in payload] == ["owner@test.local", "custom@test.local"]
    assert payload[1]["permissions"] == [
        "devices.view",
        "monitoring.view",
        "commands.view",
    ]
