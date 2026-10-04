import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

# Add project root to sys.path
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
    """Mock identity overrides for specific tenant users."""

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
        # Override all user dependencies to mock the specified tenant user
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
    """Sets up a clean database session for each test function, resolving database dependencies cleanly."""
    session = SessionLocal()
    # Bypass RLS to clean up tables in proper order
    with tenant_context(bypass_rls=True):
        session.execute(text("DELETE FROM anomaly_events"))
        session.execute(text("DELETE FROM telemetry"))
        session.execute(text("DELETE FROM alerts"))
        session.execute(text("DELETE FROM audit_logs"))
        session.execute(text("DELETE FROM ota_job_events"))
        session.execute(text("DELETE FROM ota_campaign_targets"))
        session.execute(text("DELETE FROM ota_jobs"))
        session.execute(text("DELETE FROM ota_campaigns"))
        session.execute(text("DELETE FROM firmware_versions"))
        session.execute(text("DELETE FROM model_deployments"))
        session.execute(text("DELETE FROM ml_model_versions"))
        session.execute(text("DELETE FROM ml_models"))
        session.execute(text("DELETE FROM command_dispatches"))
        session.execute(text("DELETE FROM command_templates"))
        session.execute(text("DELETE FROM automation_rule_executions"))
        session.execute(text("DELETE FROM automation_rules"))
        session.execute(text("DELETE FROM project_widgets"))
        session.execute(text("DELETE FROM project_pages"))
        session.execute(text("DELETE FROM tenant_projects"))
        session.execute(text("DELETE FROM device_group_members"))
        session.execute(text("DELETE FROM device_groups"))
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
            session.execute(text("DELETE FROM anomaly_events"))
            session.execute(text("DELETE FROM telemetry"))
            session.execute(text("DELETE FROM alerts"))
            session.execute(text("DELETE FROM audit_logs"))
            session.execute(text("DELETE FROM ota_job_events"))
            session.execute(text("DELETE FROM ota_campaign_targets"))
            session.execute(text("DELETE FROM ota_jobs"))
            session.execute(text("DELETE FROM ota_campaigns"))
            session.execute(text("DELETE FROM firmware_versions"))
            session.execute(text("DELETE FROM model_deployments"))
            session.execute(text("DELETE FROM ml_model_versions"))
            session.execute(text("DELETE FROM ml_models"))
            session.execute(text("DELETE FROM command_dispatches"))
            session.execute(text("DELETE FROM command_templates"))
            session.execute(text("DELETE FROM automation_rule_executions"))
            session.execute(text("DELETE FROM automation_rules"))
            session.execute(text("DELETE FROM project_widgets"))
            session.execute(text("DELETE FROM project_pages"))
            session.execute(text("DELETE FROM tenant_projects"))
            session.execute(text("DELETE FROM device_group_members"))
            session.execute(text("DELETE FROM device_groups"))
            session.execute(text("DELETE FROM tenant_device_mappings"))
            session.execute(text("DELETE FROM devices"))
            session.execute(text("DELETE FROM users WHERE email NOT LIKE 'admin%'"))
            session.execute(text("DELETE FROM tenant_feature_overrides"))
            session.execute(text("DELETE FROM tenants"))
            session.commit()
        session.close()


def seed_test_data(db_session: Session):
    """Seed data for Tenant A and Tenant B under bypass_rls mode."""
    tenant_a_id = uuid.uuid4()
    tenant_b_id = uuid.uuid4()
    user_a_id = uuid.uuid4()
    user_b_id = uuid.uuid4()
    device_a_id = uuid.uuid4()
    device_b_id = uuid.uuid4()
    group_a_id = uuid.uuid4()
    group_b_id = uuid.uuid4()
    project_a_id = uuid.uuid4()
    project_b_id = uuid.uuid4()
    page_a_id = uuid.uuid4()
    page_b_id = uuid.uuid4()
    widget_a_id = uuid.uuid4()
    widget_b_id = uuid.uuid4()
    template_a_id = uuid.uuid4()
    template_b_id = uuid.uuid4()
    firmware_a_id = uuid.uuid4()
    firmware_b_id = uuid.uuid4()
    rule_a_id = uuid.uuid4()
    rule_b_id = uuid.uuid4()
    alert_a_id = uuid.uuid4()
    alert_b_id = uuid.uuid4()
    anomaly_a_id = uuid.uuid4()
    anomaly_b_id = uuid.uuid4()

    with tenant_context(bypass_rls=True):
        # System Settings (disable signed stable firmware requirement for campaign test)
        db_session.execute(
            text(
                "INSERT INTO system_settings (id, require_signed_stable_firmware) "
                "VALUES (1, False) "
                "ON CONFLICT (id) DO UPDATE SET require_signed_stable_firmware = False"
            )
        )

        # 1. Tenants
        db_session.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant A', 'tenant-a')"),
            {"id": tenant_a_id},
        )
        db_session.execute(
            text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Tenant B', 'tenant-b')"),
            {"id": tenant_b_id},
        )

        # Feature Overrides
        features = [
            "device_management",
            "ota_update",
            "firmware_history",
            "telemetry_view",
            "advanced_monitoring",
            "alert_management",
            "ai_anomaly_detection",
            "report_export",
            "api_access",
            "user_management",
            "billing_view",
            "audit_log",
        ]
        for t_id in (tenant_a_id, tenant_b_id):
            for feat in features:
                db_session.execute(
                    text(
                        "INSERT INTO tenant_feature_overrides (id, tenant_id, feature_name, is_enabled) VALUES (:id, :t_id, :feat, True)"
                    ),
                    {"id": uuid.uuid4(), "t_id": t_id, "feat": feat},
                )

        # 2. Users
        db_session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, role, tenant_id, is_active, full_name) "
                "VALUES (:id, :email, 'test', 'tenant_owner', :tenant_id, True, 'User A')"
            ),
            {"id": user_a_id, "email": "user-a@test.local", "tenant_id": tenant_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO users (id, email, hashed_password, role, tenant_id, is_active, full_name) "
                "VALUES (:id, :email, 'test', 'tenant_owner', :tenant_id, True, 'User B')"
            ),
            {"id": user_b_id, "email": "user-b@test.local", "tenant_id": tenant_b_id},
        )

        # 3. Devices
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

        # Tenant-Device Mappings
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

        # 4. Groups
        db_session.execute(
            text(
                "INSERT INTO device_groups (id, name, tenant_id) VALUES (:id, 'Group A', :tenant_id)"
            ),
            {"id": group_a_id, "tenant_id": tenant_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO device_groups (id, name, tenant_id) VALUES (:id, 'Group B', :tenant_id)"
            ),
            {"id": group_b_id, "tenant_id": tenant_b_id},
        )
        db_session.execute(
            text(
                "INSERT INTO device_group_members (id, group_id, device_id) VALUES (:id, :group_id, :device_id)"
            ),
            {"id": uuid.uuid4(), "group_id": group_a_id, "device_id": device_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO device_group_members (id, group_id, device_id) VALUES (:id, :group_id, :device_id)"
            ),
            {"id": uuid.uuid4(), "group_id": group_b_id, "device_id": device_b_id},
        )

        # 5. Projects & UI Widgets
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
                "INSERT INTO project_pages (id, project_id, title, slug) VALUES (:id, :project_id, 'Page A', 'main')"
            ),
            {"id": page_a_id, "project_id": project_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO project_pages (id, project_id, title, slug) VALUES (:id, :project_id, 'Page B', 'main')"
            ),
            {"id": page_b_id, "project_id": project_b_id},
        )

        db_session.execute(
            text(
                "INSERT INTO project_widgets (id, page_id, widget_type, title, layout, config, binding) "
                "VALUES (:id, :page_id, 'toggle', 'Widget A', '{}', '{}', '{}')"
            ),
            {"id": widget_a_id, "page_id": page_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO project_widgets (id, page_id, widget_type, title, layout, config, binding) "
                "VALUES (:id, :page_id, 'toggle', 'Widget B', '{}', '{}', '{}')"
            ),
            {"id": widget_b_id, "page_id": page_b_id},
        )

        # 6. Telemetry & Anomalies
        db_session.execute(
            text(
                "INSERT INTO telemetry (id, device_id, metric_name, metric_value, raw_payload, timestamp) "
                "VALUES (:id, :device_id, 'temperature', 22.1, '{}', now())"
            ),
            {"id": uuid.uuid4(), "device_id": device_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO telemetry (id, device_id, metric_name, metric_value, raw_payload, timestamp) "
                "VALUES (:id, :device_id, 'temperature', 23.5, '{}', now())"
            ),
            {"id": uuid.uuid4(), "device_id": device_b_id},
        )

        db_session.execute(
            text(
                "INSERT INTO anomaly_events (id, device_id, metric_name, metric_value, anomaly_score, is_anomaly, model_version, timestamp) "
                "VALUES (:id, :device_id, 'temperature', 35.5, 0.95, True, 'v1', now())"
            ),
            {"id": anomaly_a_id, "device_id": device_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO anomaly_events (id, device_id, metric_name, metric_value, anomaly_score, is_anomaly, model_version, timestamp) "
                "VALUES (:id, :device_id, 'temperature', 36.5, 0.97, True, 'v1', now())"
            ),
            {"id": anomaly_b_id, "device_id": device_b_id},
        )

        # 7. Alerts
        db_session.execute(
            text(
                "INSERT INTO alerts (id, tenant_id, device_id, severity, status, source, code, title, message, details) "
                "VALUES (:id, :tenant_id, :device_id, 'warning', 'open', 'manual', 'TEST', 'Alert A', 'msg', '{}')"
            ),
            {"id": alert_a_id, "tenant_id": tenant_a_id, "device_id": device_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO alerts (id, tenant_id, device_id, severity, status, source, code, title, message, details) "
                "VALUES (:id, :tenant_id, :device_id, 'warning', 'open', 'manual', 'TEST', 'Alert B', 'msg', '{}')"
            ),
            {"id": alert_b_id, "tenant_id": tenant_b_id, "device_id": device_b_id},
        )

        # 8. Command Templates
        db_session.execute(
            text(
                "INSERT INTO command_templates (id, tenant_id, name, command_type, payload_template, is_system) "
                "VALUES (:id, :tenant_id, 'Template A', 'reboot', '{}', False)"
            ),
            {"id": template_a_id, "tenant_id": tenant_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO command_templates (id, tenant_id, name, command_type, payload_template, is_system) "
                "VALUES (:id, :tenant_id, 'Template B', 'reboot', '{}', False)"
            ),
            {"id": template_b_id, "tenant_id": tenant_b_id},
        )

        # 9. Firmware Versions
        db_session.execute(
            text(
                "INSERT INTO firmware_versions (id, version, target_device_type, uploaded_by_tenant_id, is_active, source_type, status, release_channel) "
                "VALUES (:id, '1.0.0', 'esp32', :tenant_id, True, 'binary', 'uploaded', 'stable')"
            ),
            {"id": firmware_a_id, "tenant_id": tenant_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO firmware_versions (id, version, target_device_type, uploaded_by_tenant_id, is_active, source_type, status, release_channel) "
                "VALUES (:id, '1.0.0', 'esp32', :tenant_id, True, 'binary', 'uploaded', 'stable')"
            ),
            {"id": firmware_b_id, "tenant_id": tenant_b_id},
        )

        # 10. Automation Rules
        db_session.execute(
            text(
                "INSERT INTO automation_rules (id, tenant_id, project_id, name, enabled, severity, cooldown_seconds, trigger_type, target_scope, condition_logic, conditions, condition_config, actions) "
                "VALUES (:id, :tenant_id, :project_id, 'Rule A', True, 'warning', 300, 'telemetry', '{\"scope_type\": \"all_devices\"}', 'and', '[]', '{}', '[]')"
            ),
            {"id": rule_a_id, "tenant_id": tenant_a_id, "project_id": project_a_id},
        )
        db_session.execute(
            text(
                "INSERT INTO automation_rules (id, tenant_id, project_id, name, enabled, severity, cooldown_seconds, trigger_type, target_scope, condition_logic, conditions, condition_config, actions) "
                "VALUES (:id, :tenant_id, :project_id, 'Rule B', True, 'warning', 300, 'telemetry', '{\"scope_type\": \"all_devices\"}', 'and', '[]', '{}', '[]')"
            ),
            {"id": rule_b_id, "tenant_id": tenant_b_id, "project_id": project_b_id},
        )

        db_session.commit()

    return SimpleNamespace(
        tenant_a_id=tenant_a_id,
        tenant_b_id=tenant_b_id,
        user_a_id=user_a_id,
        user_b_id=user_b_id,
        device_a_id=device_a_id,
        device_b_id=device_b_id,
        group_a_id=group_a_id,
        group_b_id=group_b_id,
        project_a_id=project_a_id,
        project_b_id=project_b_id,
        page_a_id=page_a_id,
        page_b_id=page_b_id,
        widget_a_id=widget_a_id,
        widget_b_id=widget_b_id,
        template_a_id=template_a_id,
        template_b_id=template_b_id,
        firmware_a_id=firmware_a_id,
        firmware_b_id=firmware_b_id,
        rule_a_id=rule_a_id,
        rule_b_id=rule_b_id,
        alert_a_id=alert_a_id,
        alert_b_id=alert_b_id,
        anomaly_a_id=anomaly_a_id,
        anomaly_b_id=anomaly_b_id,
    )


# ── Devices Isolation ────────────────────────────────────────────────────────


def test_devices_isolation(db_session: Session):
    data = seed_test_data(db_session)

    # Tenant A attempts to view resources
    with TenantOverride(data.tenant_a_id, data.user_a_id):
        # 1. List devices (must only return dev-a)
        res = client.get("/api/v1/client/devices")
        assert res.status_code == 200
        uids = [item["device_uid"] for item in res.json()]
        assert "dev-a" in uids
        assert "dev-b" not in uids

        # 2. Get details for Tenant B device (must return 404)
        res = client.get("/api/v1/client/devices/dev-b")
        assert res.status_code == 404

        # 3. Update details for Tenant B device (must return 404)
        res = client.put("/api/v1/client/devices/dev-b", json={"name": "Hacked"})
        assert res.status_code == 404

        # 4. Delete Tenant B device (must return 404)
        res = client.delete("/api/v1/client/devices/dev-b")
        assert res.status_code == 404


# ── Telemetry Isolation ──────────────────────────────────────────────────────


def test_telemetry_isolation(db_session: Session):
    data = seed_test_data(db_session)

    with TenantOverride(data.tenant_a_id, data.user_a_id):
        # Tenant A attempts to read Tenant B's telemetry
        res = client.get("/api/v1/client/devices/dev-b/telemetry")
        assert res.status_code == 404


# ── Commands Isolation ───────────────────────────────────────────────────────


def test_commands_isolation(db_session: Session):
    data = seed_test_data(db_session)

    with TenantOverride(data.tenant_a_id, data.user_a_id):
        # 1. Get other template
        res = client.get(f"/api/v1/client/commands/templates/{data.template_b_id}")
        assert res.status_code == 404

        # 2. Update other template
        res = client.put(
            f"/api/v1/client/commands/templates/{data.template_b_id}", json={"name": "Hacked"}
        )
        assert res.status_code == 404

        # 3. Delete other template
        res = client.delete(f"/api/v1/client/commands/templates/{data.template_b_id}")
        assert res.status_code == 404

        # 4. Dispatch targeting Tenant B device
        dispatch_payload = {
            "target_type": "device",
            "target_device_id": str(data.device_b_id),
            "command_type": "reboot",
            "payload": {},
        }
        res = client.post("/api/v1/client/commands/dispatch", json=dispatch_payload)
        assert res.status_code == 400
        assert "Device not found or not accessible" in res.json()["detail"]

        # 5. Dispatch targeting Tenant B command template
        dispatch_payload_tpl = {
            "target_type": "device",
            "target_device_id": str(data.device_a_id),
            "template_id": str(data.template_b_id),
            "command_type": "reboot",
            "payload": {},
        }
        res = client.post("/api/v1/client/commands/dispatch", json=dispatch_payload_tpl)
        assert res.status_code == 400
        assert "Command template not found" in res.json()["detail"]


# ── Firmware Isolation ───────────────────────────────────────────────────────


def test_firmware_isolation(db_session: Session):
    data = seed_test_data(db_session)

    with TenantOverride(data.tenant_a_id, data.user_a_id):
        # 1. Tenant A should see firmware A but not firmware B
        res = client.get("/api/v1/client/firmware")
        assert res.status_code == 200
        ids = [item["id"] for item in res.json()]
        assert str(data.firmware_a_id) in ids
        assert str(data.firmware_b_id) not in ids

        # 2. Get Tenant B firmware details (must return 403 Forbidden or 404 Not Found)
        res = client.get(f"/api/v1/client/firmware/{data.firmware_b_id}")
        assert res.status_code in (403, 404)


# ── OTA Campaign Scoping & Isolation ─────────────────────────────────────────


def test_ota_campaign_isolation(db_session: Session):
    data = seed_test_data(db_session)

    with TenantOverride(data.tenant_a_id, data.user_a_id):
        # 1. Create campaign with Tenant B's firmware version (must fail)
        # Campaign API router maps campaign endpoints. Notice router campaigns prefix: /admin/ota/campaigns.
        # Wait, since router_campaigns prefix is /admin/ota/campaigns, it expects admin or platform engineer.
        # But wait, does it still enforce the tenant check?
        # Yes, CampaignService check is general. Let's invoke CampaignService directly or test the endpoint.
        # Let's test the endpoint, but note that the endpoint requires require_admin, so let's call the service directly
        # or mock admin role but with tenant context.
        # Let's check both ways. Direct use case call is extremely reliable.
        from app.bounded_contexts.firmware_ota.application.campaign_service import CampaignService
        from app.bounded_contexts.firmware_ota.presentation.ota_campaign_schemas import (
            OtaCampaignCreate,
        )

        service = CampaignService(db_session)

        # Cross-tenant firmware creation check
        with pytest.raises(ValueError) as exc:
            service.create(
                OtaCampaignCreate(
                    name="Test Cross",
                    firmware_id=data.firmware_b_id,
                    tenant_id=data.tenant_a_id,
                    target_scope="all",
                    target_ids=[],
                    rollout_strategy="all_at_once",
                ),
                user_id=data.user_a_id,
            )
        assert "Firmware not found or not accessible" in str(exc.value)

        # Cross-tenant device target check
        with pytest.raises(ValueError) as exc:
            service.create(
                OtaCampaignCreate(
                    name="Test Cross Device",
                    firmware_id=data.firmware_a_id,
                    tenant_id=data.tenant_a_id,
                    target_scope="selected_devices",
                    target_ids=[str(data.device_b_id)],
                    rollout_strategy="all_at_once",
                ),
                user_id=data.user_a_id,
            )
        assert "Device not found or not accessible" in str(exc.value)

        # Cross-tenant group target check
        with pytest.raises(ValueError) as exc:
            service.create(
                OtaCampaignCreate(
                    name="Test Cross Group",
                    firmware_id=data.firmware_a_id,
                    tenant_id=data.tenant_a_id,
                    target_scope="device_group",
                    target_ids=[str(data.group_b_id)],
                    rollout_strategy="all_at_once",
                ),
                user_id=data.user_a_id,
            )
        assert "Device group not found or not accessible" in str(exc.value)


# ── Operational Alerts Isolation ─────────────────────────────────────────────


def test_alerts_isolation(db_session: Session):
    data = seed_test_data(db_session)

    with TenantOverride(data.tenant_a_id, data.user_a_id):
        # 1. Alerts: Tenant A lists alerts (should see alert A but not B)
        res = client.get("/api/v1/client/alerts")
        assert res.status_code == 200
        titles = [item["title"] for item in res.json()]
        assert "Alert A" in titles
        assert "Alert B" not in titles



# ── Projects Isolation ───────────────────────────────────────────────────────


def test_projects_isolation(db_session: Session):
    data = seed_test_data(db_session)

    with TenantOverride(data.tenant_a_id, data.user_a_id):
        # 1. Get other project
        res = client.get(f"/api/v1/client/projects/{data.project_b_id}")
        assert res.status_code == 404

        # 2. Update other project
        res = client.put(f"/api/v1/client/projects/{data.project_b_id}", json={"name": "Hacked"})
        assert res.status_code == 404

        # 3. Delete other project
        res = client.delete(f"/api/v1/client/projects/{data.project_b_id}")
        assert res.status_code == 404


# ── Users Isolation ─────────────────────────────────────────────────────────


def test_users_isolation(db_session: Session):
    data = seed_test_data(db_session)

    with TenantOverride(data.tenant_a_id, data.user_a_id):
        # 1. List users (only user A, not user B)
        res = client.get("/api/v1/client/users")
        assert res.status_code == 200
        emails = [item["email"] for item in res.json()]
        assert "user-a@test.local" in emails
        assert "user-b@test.local" not in emails

        # 2. Update other user
        res = client.patch(f"/api/v1/client/users/{data.user_b_id}", json={"full_name": "Hacked"})
        assert res.status_code == 404

        # 3. Delete other user
        res = client.delete(f"/api/v1/client/users/{data.user_b_id}")
        assert res.status_code == 404


# ── Claim Code Device Scoping ────────────────────────────────────────────────


def test_claim_code_scoping(db_session: Session):
    data = seed_test_data(db_session)

    with TenantOverride(data.tenant_a_id, data.user_a_id):
        # Tenant A attempts to generate a claim code session for Tenant B's device (must fail)
        claim_payload = {"device_id": str(data.device_b_id), "expires_in_hours": 24}
        res = client.post("/api/v1/client/provisioning/claim-code", json=claim_payload)
        assert res.status_code == 409
        assert "Device not found or not accessible" in res.json()["detail"]


# ── Rule Engine Scoping & Foreign-Key Injection ──────────────────────────────


def test_rule_engine_scoping_and_fk_injection(db_session: Session):
    data = seed_test_data(db_session)

    with TenantOverride(data.tenant_a_id, data.user_a_id):
        # 1. Create rule with Tenant B's project_id
        rule_payload = {
            "name": "Cross Project Rule",
            "project_id": str(data.project_b_id),
            "trigger_type": "telemetry",
            "target_scope": {"scope_type": "all_devices", "project_id": str(data.project_b_id)},
            "conditions": [],
            "actions": [],
        }
        res = client.post("/api/v1/client/automation/rules", json=rule_payload)
        assert res.status_code == 400
        assert "Project not found or not accessible" in res.json()["detail"]

        # 2. Create rule targeting Tenant B's device
        rule_payload_dev = {
            "name": "Cross Device Rule",
            "project_id": str(data.project_a_id),
            "trigger_type": "telemetry",
            "target_scope": {"scope_type": "device", "device_id": str(data.device_b_id)},
            "conditions": [],
            "actions": [],
        }
        res = client.post("/api/v1/client/automation/rules", json=rule_payload_dev)
        assert res.status_code == 400
        assert "Device not found or not accessible" in res.json()["detail"]

        # 3. Create rule targeting Tenant B's group
        rule_payload_grp = {
            "name": "Cross Group Rule",
            "project_id": str(data.project_a_id),
            "trigger_type": "telemetry",
            "target_scope": {"scope_type": "group", "group_id": str(data.group_b_id)},
            "conditions": [],
            "actions": [],
        }
        res = client.post("/api/v1/client/automation/rules", json=rule_payload_grp)
        assert res.status_code == 400
        assert "Device group not found or not accessible" in res.json()["detail"]

        # 4. Create rule with send_command action targeting Tenant B's device
        rule_payload_cmd = {
            "name": "Cross Command Rule",
            "project_id": str(data.project_a_id),
            "trigger_type": "telemetry",
            "target_scope": {"scope_type": "all_devices"},
            "conditions": [],
            "actions": [
                {
                    "type": "send_command",
                    "config": {"target_device_id": str(data.device_b_id), "command_type": "reboot"},
                }
            ],
        }
        res = client.post("/api/v1/client/automation/rules", json=rule_payload_cmd)
        assert res.status_code == 400
        assert "Target device not found or not accessible" in res.json()["detail"]
