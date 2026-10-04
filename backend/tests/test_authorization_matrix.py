import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import main as app_main
from app.core import security as security_module
from app.core import tenant as tenant_module
from app.bounded_contexts.identity.presentation import dependencies as identity_dependencies
from app.bounded_contexts.tenant_management.presentation import dependencies as tenant_dependencies
from app.db.session import SessionLocal

# Re-use permissions for test setup
from app.core.permissions import VIEWER_PERMISSIONS, OWNER_PERMISSIONS


class _AuthOverride:
    def __init__(self, user=None):
        self.user = user
        self._saved = None

    def __enter__(self):
        self._saved = dict(app_main.app.dependency_overrides)
        if self.user is None:
            # Unauthenticated: remove mock overrides to let real auth run (which returns 401/403)
            for dep in [
                security_module.get_current_user,
                tenant_module.get_current_tenant_user,
                identity_dependencies.get_current_user,
                identity_dependencies.get_current_tenant_user,
                tenant_dependencies.get_current_tenant_user,
            ]:
                app_main.app.dependency_overrides.pop(dep, None)
        else:
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


@pytest.fixture(scope="module")
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _create_user(*, tenant_id, role, permissions=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        email=f"user-{role}@test.local",
        role=role,
        tenant_id=tenant_id,
        is_active=True,
        permissions=permissions,
    )


# 1. Unauthenticated Requests
def test_unauthenticated_requests_are_rejected():
    with _AuthOverride(None) as client:
        # Client endpoints
        assert client.get("/api/v1/client/projects").status_code in (401, 403)
        assert client.post("/api/v1/client/projects", json={"name": "P1"}).status_code in (401, 403)
        assert client.get("/api/v1/client/device-groups").status_code in (401, 403)
        assert client.get("/api/v1/client/automation/rules").status_code in (401, 403)
        assert client.get("/api/v1/client/users").status_code in (401, 403)

        # Admin endpoints
        assert client.get("/api/v1/admin/users/admins").status_code in (401, 403)
        assert client.get("/api/v1/admin/audit-logs").status_code in (401, 403)


# 2. Viewer/Read-Only Writes Prevention
def test_viewer_cannot_execute_writes():
    tenant_id = uuid.uuid4()
    viewer = _create_user(tenant_id=tenant_id, role="viewer", permissions=list(VIEWER_PERMISSIONS))

    with _AuthOverride(viewer) as client:
        # Projects write
        assert client.post("/api/v1/client/projects", json={"name": "Fail"}).status_code == 403
        assert (
            client.put(f"/api/v1/client/projects/{uuid.uuid4()}", json={"name": "Fail"}).status_code
            == 403
        )
        assert client.delete(f"/api/v1/client/projects/{uuid.uuid4()}").status_code == 403

        # Device Groups write
        assert (
            client.post(
                "/api/v1/client/device-groups", json={"name": "Fail", "group_type": "manual"}
            ).status_code
            == 403
        )
        assert client.delete(f"/api/v1/client/device-groups/{uuid.uuid4()}").status_code == 403

        # Automation Rules write
        assert (
            client.post("/api/v1/client/automation/rules", json={"name": "Fail"}).status_code == 403
        )


# 3. Cross-Tenant Isolation: returns 404 to prevent enumeration
def test_cross_tenant_resource_returns_404(db):
    # Setup two tenants in database
    tenant_a_id = uuid.uuid4()
    tenant_b_id = uuid.uuid4()

    db.execute(text("DELETE FROM audit_logs"))
    db.execute(text("DELETE FROM tenant_projects"))
    db.execute(text("DELETE FROM device_groups"))
    db.execute(text("DELETE FROM users WHERE email NOT LIKE 'admin%'"))
    db.execute(text("DELETE FROM tenants"))
    db.commit()

    db.execute(
        text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant A', 'tenant-a')"),
        {"id": tenant_a_id},
    )
    db.execute(
        text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant B', 'tenant-b')"),
        {"id": tenant_b_id},
    )
    db.commit()

    # Create a project for Tenant B
    project_b_id = uuid.uuid4()
    db.execute(
        text(
            "INSERT INTO tenant_projects (id, tenant_id, name, description) VALUES (:id, :tenant_id, 'Project B', 'desc')"
        ),
        {"id": project_b_id, "tenant_id": tenant_b_id},
    )
    db.commit()

    # Create a device group for Tenant B
    group_b_id = uuid.uuid4()
    db.execute(
        text(
            "INSERT INTO device_groups (id, tenant_id, name, group_type, status) VALUES (:id, :tenant_id, 'Group B', 'manual', 'active')"
        ),
        {"id": group_b_id, "tenant_id": tenant_b_id},
    )
    db.commit()

    # Authenticate as Tenant A Owner
    owner_a = _create_user(
        tenant_id=tenant_a_id, role="tenant_owner", permissions=list(OWNER_PERMISSIONS)
    )

    with _AuthOverride(owner_a) as client:
        # Query Tenant B's project as Tenant A -> should return 404
        response_project = client.get(f"/api/v1/client/projects/{project_b_id}")
        assert response_project.status_code == 404

        # Query Tenant B's device group as Tenant A -> should return 404
        response_group = client.get(f"/api/v1/client/device-groups/{group_b_id}")
        assert response_group.status_code == 404

    # Clean up
    db.execute(text("DELETE FROM audit_logs"))
    db.execute(text("DELETE FROM tenant_projects"))
    db.execute(text("DELETE FROM device_groups"))
    db.execute(text("DELETE FROM users WHERE email NOT LIKE 'admin%'"))
    db.execute(text("DELETE FROM tenants"))
    db.commit()


# 4. Only Admin can access platform user management
def test_admin_user_management_rejects_retired_role():
    admin = SimpleNamespace(id=uuid.uuid4(), email="admin@test.local", role="admin", is_active=True)
    platform_eng = SimpleNamespace(
        id=uuid.uuid4(), email="pe@test.local", role="platform_engineer", is_active=True
    )

    # Platform engineer should not access admin user list
    with _AuthOverride(platform_eng) as client:
        assert client.get("/api/v1/admin/users/admins").status_code == 403

    # Admin should access admin user list
    with _AuthOverride(admin) as client:
        assert client.get("/api/v1/admin/users/admins").status_code != 403
