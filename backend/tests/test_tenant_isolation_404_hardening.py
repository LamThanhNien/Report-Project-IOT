import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app import main as app_main
from app.core import security as security_module
from app.core import tenant as tenant_module
from app.core.tenant_context import tenant_context
from app.db.session import SessionLocal
from app.bounded_contexts.identity.presentation import dependencies as identity_dependencies
from app.bounded_contexts.tenant_management.presentation import dependencies as tenant_dependencies

client = TestClient(app_main.app)


class TenantOverride:
    def __init__(self, tenant_id: uuid.UUID, user_id: uuid.UUID, role: str = "tenant_owner"):
        self.user = SimpleNamespace(
            id=user_id,
            email=f"user-{tenant_id}@test.local",
            role=role,
            tenant_id=tenant_id,
            is_active=True,
            permissions=None,
        )

    def __enter__(self):
        self._saved = dict(app_main.app.dependency_overrides)
        app_main.app.dependency_overrides = {
            security_module.get_current_user: lambda: self.user,
            tenant_module.get_current_tenant_user: lambda: self.user,
            identity_dependencies.get_current_user: lambda: self.user,
            identity_dependencies.get_current_tenant_user: lambda: self.user,
            tenant_dependencies.get_current_tenant_user: lambda: self.user,
        }
        return self

    def __exit__(self, *_):
        app_main.app.dependency_overrides = self._saved


@pytest.fixture(scope="function")
def db_session():
    session = SessionLocal()
    with tenant_context(bypass_rls=True):
        session.execute(text("DELETE FROM audit_logs"))
        session.execute(text("DELETE FROM project_widgets"))
        session.execute(text("DELETE FROM project_pages"))
        session.execute(text("DELETE FROM tenant_projects"))
        session.execute(text("DELETE FROM firmware_versions"))
        session.execute(text("DELETE FROM model_deployments"))
        session.execute(text("DELETE FROM ml_model_versions"))
        session.execute(text("DELETE FROM ml_models"))
        session.execute(text("DELETE FROM tenant_device_mappings"))
        session.execute(text("DELETE FROM devices"))
        session.execute(text("DELETE FROM users WHERE email NOT LIKE 'admin%'"))
        session.execute(text("DELETE FROM tenant_feature_overrides"))
        session.execute(text("DELETE FROM tenants"))
        session.commit()
    try:
        yield session
    finally:
        with tenant_context(bypass_rls=True):
            session.execute(text("DELETE FROM audit_logs"))
            session.execute(text("DELETE FROM project_widgets"))
            session.execute(text("DELETE FROM project_pages"))
            session.execute(text("DELETE FROM tenant_projects"))
            session.execute(text("DELETE FROM firmware_versions"))
            session.execute(text("DELETE FROM model_deployments"))
            session.execute(text("DELETE FROM ml_model_versions"))
            session.execute(text("DELETE FROM ml_models"))
            session.execute(text("DELETE FROM tenant_device_mappings"))
            session.execute(text("DELETE FROM devices"))
            session.execute(text("DELETE FROM users WHERE email NOT LIKE 'admin%'"))
            session.execute(text("DELETE FROM tenant_feature_overrides"))
            session.execute(text("DELETE FROM tenants"))
            session.commit()
        session.close()


def seed_isolation_data(db_session: Session):
    tenant_a_id = uuid.uuid4()
    tenant_b_id = uuid.uuid4()
    user_a_id = uuid.uuid4()
    user_b_id = uuid.uuid4()
    device_a_id = uuid.uuid4()
    device_b_id = uuid.uuid4()
    project_a_id = uuid.uuid4()
    project_b_id = uuid.uuid4()
    firmware_b_id = uuid.uuid4()

    with tenant_context(bypass_rls=True):
        db_session.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant A', 'tenant-a')"),
            {"id": tenant_a_id},
        )
        db_session.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant B', 'tenant-b')"),
            {"id": tenant_b_id},
        )

        for t_id in (tenant_a_id, tenant_b_id):
            for feat in (
                "device_management",
                "ota_update",
                "firmware_history",
                "projects.view",
                "commands.send",
            ):
                db_session.execute(
                    text(
                        "INSERT INTO tenant_feature_overrides (id, tenant_id, feature_name, is_enabled) VALUES (:id, :t_id, :feat, True)"
                    ),
                    {"id": uuid.uuid4(), "t_id": t_id, "feat": feat},
                )

        db_session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, role, tenant_id, is_active, full_name) "
                "VALUES (:id, 'user-a@test.local', 'test', 'tenant_owner', :tenant_id, True, 'User A')"
            ),
            {"id": user_a_id, "tenant_id": tenant_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, role, tenant_id, is_active, full_name) "
                "VALUES (:id, 'user-b@test.local', 'test', 'tenant_owner', :tenant_id, True, 'User B')"
            ),
            {"id": user_b_id, "tenant_id": tenant_b_id},
        )

        db_session.execute(
            text(
                "INSERT INTO devices (id, device_uid, name, status, tenant_id, hardware_model) "
                "VALUES (:id, 'dev-a', 'Device A', 'online', :tenant_id, 'esp32')"
            ),
            {"id": device_a_id, "tenant_id": tenant_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO devices (id, device_uid, name, status, tenant_id, hardware_model) "
                "VALUES (:id, 'dev-b', 'Device B', 'online', :tenant_id, 'esp32')"
            ),
            {"id": device_b_id, "tenant_id": tenant_b_id},
        )

        db_session.execute(
            text(
                "INSERT INTO tenant_device_mappings (tenant_id, device_id) VALUES (:tenant_id, :device_id) "
                "ON CONFLICT (device_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id"
            ),
            {"tenant_id": tenant_a_id, "device_id": device_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO tenant_device_mappings (tenant_id, device_id) VALUES (:tenant_id, :device_id) "
                "ON CONFLICT (device_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id"
            ),
            {"tenant_id": tenant_b_id, "device_id": device_b_id},
        )

        db_session.execute(
            text(
                "INSERT INTO tenant_projects (id, tenant_id, name) VALUES (:id, :tenant_id, 'Project A')"
            ),
            {"id": project_a_id, "tenant_id": tenant_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO tenant_projects (id, tenant_id, name) VALUES (:id, :tenant_id, 'Project B')"
            ),
            {"id": project_b_id, "tenant_id": tenant_b_id},
        )

        db_session.execute(
            text(
                "INSERT INTO firmware_versions (id, version, target_device_type, uploaded_by_tenant_id, is_active, source_type, status, release_channel) "
                "VALUES (:id, '1.0.0', 'esp32', :tenant_id, True, 'binary', 'uploaded', 'stable')"
            ),
            {"id": firmware_b_id, "tenant_id": tenant_b_id},
        )

        db_session.commit()

    return SimpleNamespace(
        tenant_a_id=tenant_a_id,
        tenant_b_id=tenant_b_id,
        user_a_id=user_a_id,
        user_b_id=user_b_id,
        device_a_id=device_a_id,
        device_b_id=device_b_id,
        project_a_id=project_a_id,
        project_b_id=project_b_id,
        firmware_b_id=firmware_b_id,
    )


def test_cross_tenant_resources_return_404_not_found(db_session: Session):
    """Verify cross-tenant resource queries return HTTP 404 Not Found without leaking existence."""
    data = seed_isolation_data(db_session)

    with TenantOverride(data.tenant_a_id, data.user_a_id):
        # 1. Device capabilities cross-tenant access -> HTTP 404
        res = client.get(f"/api/v1/client/devices/{data.device_b_id}/capabilities")
        assert res.status_code == 404
        assert res.json()["detail"] == "Device not found"

        # 3. Send command cross-tenant device -> HTTP 404
        cmd_payload = {"command": "reboot", "params": {}}
        res = client.post(f"/api/v1/client/devices/{data.device_b_id}/commands", json=cmd_payload)
        assert res.status_code == 404
        assert res.json()["detail"] == "Device not found"

        # 4. Cross-tenant firmware access -> HTTP 404
        res = client.get(f"/api/v1/client/firmware/{data.firmware_b_id}")
        assert res.status_code == 404
        assert res.json()["detail"] == "Firmware not found"

        # 5. Cross-tenant project access -> HTTP 404
        res = client.get(f"/api/v1/client/projects/{data.project_b_id}")
        assert res.status_code == 404
        assert res.json()["detail"] == "Project not found"
