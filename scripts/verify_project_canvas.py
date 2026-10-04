"""Run canvas API regressions against an isolated SQLite database.

Run with: .venv/Scripts/python.exe scripts/verify_project_canvas.py
No backend pytest fixtures, application lifespan, or external services are used.
"""

import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

# Force a test database before any application/configuration import. Never read
# connection settings from the developer's .env or contact the live database.
os.environ.update(
    APP_ENV="test",
    DATABASE_URL="sqlite://",
    APP_DATABASE_URL="sqlite://",
    JWT_SECRET="0123456789abcdef" * 4,
    JWT_REFRESH_SECRET="fedcba9876543210" * 4,
    OTA_TOKEN_SECRET="00112233445566778899aabbccddeeff" * 2,
    MQTT_USERNAME="canvas-test-api",
    MQTT_PASSWORD="canvas-test-password",
)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, select  # noqa: E402
from sqlalchemy.dialects.postgresql import JSONB  # noqa: E402
from sqlalchemy.ext.compiler import compiles  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

# Import registers the complete existing ORM relationship targets and verifies
# production route construction; its lifespan is deliberately never entered.
from app import main as _application  # noqa: E402, F401
from app.bounded_contexts.project_dashboard.infrastructure import repositories as repo  # noqa: E402
from app.bounded_contexts.project_dashboard.infrastructure.persistence.models import (  # noqa: E402
    DeviceCapability, ProjectWidget, TenantDatastream,
)
from app.bounded_contexts.project_dashboard.presentation.router import router  # noqa: E402
from app.bounded_contexts.project_dashboard.presentation.schemas import ProjectCreate  # noqa: E402
from app.bounded_contexts.tenant_management.presentation.router_client import router as tenant_router  # noqa: E402
from app.core.tenant import get_current_tenant_user  # noqa: E402
from app.core.security import get_current_user  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import get_db  # noqa: E402
from app.db import session as database_module  # noqa: E402
from app.modules.devices.model import Device  # noqa: E402
from app.modules.telemetry.model import Telemetry  # noqa: E402
from app.modules.tenants.model import Tenant, TenantDeviceMapping, TenantFeatureOverride  # noqa: E402


@compiles(JSONB, "sqlite")
def _sqlite_jsonb(_type, _compiler, **_kwargs):
    return "JSON"


class CanvasApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        tables = [Base.metadata.tables[name] for name in (
            "tenants", "users", "tenant_feature_overrides", "tenant_projects", "project_pages", "project_widgets",
            "devices", "tenant_device_mappings", "device_capabilities", "telemetry",
            "tenant_datastreams", "datastream_template_compatibilities", "audit_logs",
        )]
        Base.metadata.create_all(self.engine, tables=tables)
        self.db = Session(self.engine)
        database_module.SessionLocal.configure(bind=self.engine)
        self.tenant = Tenant(name="Canvas", slug="canvas")
        self.other_tenant = Tenant(name="Other", slug="other")
        self.db.add_all([self.tenant, self.other_tenant])
        self.db.commit()
        self.project = repo.create_project(self.db, self.tenant.id, ProjectCreate(name="Canvas"))
        self.other_project = repo.create_project(
            self.db, self.other_tenant.id, ProjectCreate(name="Private")
        )
        self.same_tenant_project = repo.create_project(
            self.db, self.tenant.id, ProjectCreate(name="Different project")
        )
        self.page = self.project.pages[0]
        self.other_page = self.other_project.pages[0]
        self.device = Device(
            name="Device", device_uid="canvas-device", tenant_id=self.tenant.id,
            project_id=self.project.id,
        )
        self.foreign_device = Device(
            name="Other", device_uid="other-device", tenant_id=self.other_tenant.id,
            project_id=self.other_project.id,
        )
        self.db.add_all([self.device, self.foreign_device])
        self.db.flush()
        self.db.add_all([
            TenantDeviceMapping(tenant_id=self.tenant.id, device_id=self.device.id),
            TenantDeviceMapping(tenant_id=self.other_tenant.id, device_id=self.foreign_device.id),
            DeviceCapability(
                device_id=self.device.id, tenant_id=self.tenant.id, capability_key="relay_1",
                capability_type="relay", label="Relay", gpio_pin=2, channel="relay_1",
                command_name="set_output", telemetry_state_key="relay_1", is_bindable=True,
                config_json={},
            ),
        ])
        self.db.commit()
        self.user = SimpleNamespace(
            id=uuid.uuid4(), tenant_id=self.tenant.id, role="tenant_owner", permissions=[], is_active=True,
        )
        app = FastAPI()
        app.include_router(router, prefix="/api/v1/client")
        app.include_router(tenant_router, prefix="/api/v1/client")
        app.dependency_overrides[get_current_tenant_user] = lambda: self.user
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.db.close()
        database_module.SessionLocal.configure(bind=database_module.engine)
        self.engine.dispose()

    def request(self, method, path, **kwargs):
        return self.client.request(method, "/api/v1/client" + path, **kwargs)

    def create_widget(self, binding=None, widget_type="switch", page=None, config=None):
        return self.request("POST", f"/pages/{(page or self.page).id}/widgets", json={
            "widget_type": widget_type, "title": "Relay", "layout": {"x": 2, "w": 4},
            "config": config or {}, "binding": binding or {},
        })

    def test_project_creation_and_canvas_crud_runtime(self):
        created_project = self.request("POST", "/projects", json={"name": "New canvas"})
        self.assertEqual(created_project.status_code, 201, created_project.text)
        project_id = created_project.json()["id"]
        detail = self.request("GET", f"/projects/{project_id}").json()
        self.assertEqual(detail["pages"][0]["slug"], "main")
        self.assertEqual(detail["latest_state"], {})

        page = self.request("POST", f"/projects/{self.project.id}/pages", json={
            "title": "Second", "slug": "second", "sort_order": 1,
        })
        self.assertEqual(page.status_code, 201, page.text)
        created = self.create_widget({
            "device_id": str(self.device.id), "capability_key": "relay_1",
        })
        self.assertEqual(created.status_code, 201, created.text)
        widget = created.json()
        self.assertEqual(widget["widget_type"], "toggle_switch")
        self.assertEqual(widget["binding"]["device_uid"], "canvas-device")
        self.assertEqual(widget["binding"]["params"]["target"], "relay_1")
        self.db.add(Telemetry(
            device_id=self.device.id, timestamp=datetime.now(timezone.utc),
            metric_name="temperature", metric_value=24.5,
            raw_payload={"relay_1": True, "ch_v3": 31.0},
        ))
        self.db.commit()
        detail = self.request("GET", f"/projects/{self.project.id}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["pages"][0]["widgets"][0]["layout"], {"x": 2, "w": 4})
        runtime = self.request("GET", f"/projects/{self.project.id}/runtime-state")
        self.assertEqual(runtime.status_code, 200, runtime.text)
        self.assertEqual(runtime.json()["latest_state"], detail.json()["latest_state"])
        self.assertTrue(runtime.json()["latest_state"][str(self.device.id)]["relay_1"])
        self.assertEqual(runtime.json()["latest_state"][str(self.device.id)]["temperature"], 24.5)
        update = self.request("PUT", f"/widgets/{widget['id']}", json={
            "title": "Moved relay", "layout": {"x": 6, "w": 2},
        })
        self.assertEqual(update.status_code, 200, update.text)
        self.assertEqual(update.json()["title"], "Moved relay")
        self.assertEqual(update.json()["binding"], widget["binding"])
        deleted = self.request("DELETE", f"/widgets/{widget['id']}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(deleted.content, b"")
        self.assertIsNone(self.db.scalar(select(ProjectWidget).where(ProjectWidget.id == uuid.UUID(widget["id"]))))

    def test_cross_tenant_resources_are_hidden(self):
        foreign_widget = ProjectWidget(
            page_id=self.other_page.id, widget_type="text_value", title="Private",
            layout={}, config={}, binding={}, sort_order=0,
        )
        self.db.add(foreign_widget)
        self.db.commit()
        requests = [
            ("GET", f"/projects/{self.other_project.id}", {}),
            ("GET", f"/projects/{self.other_project.id}/runtime-state", {}),
            ("POST", f"/projects/{self.other_project.id}/pages", {"json": {"title": "X"}}),
            ("PUT", f"/widgets/{foreign_widget.id}", {"json": {"title": "X"}}),
            ("DELETE", f"/widgets/{foreign_widget.id}", {}),
        ]
        for method, path, kwargs in requests:
            with self.subTest(path=path, method=method):
                response = self.request(method, path, **kwargs)
                self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(self.create_widget(page=self.other_page).status_code, 404)
        self.assertEqual(self.create_widget({"device_id": str(self.foreign_device.id)}).status_code, 404)

    def test_viewer_can_read_but_cannot_mutate(self):
        widget = self.create_widget().json()
        self.user.role = "viewer"
        self.assertEqual(self.request("GET", f"/projects/{self.project.id}").status_code, 200)
        self.assertEqual(self.request("GET", f"/projects/{self.project.id}/runtime-state").status_code, 200)
        for method, path, kwargs in [
            ("POST", f"/projects/{self.project.id}/pages", {"json": {"title": "X"}}),
            ("PUT", f"/widgets/{widget['id']}", {"json": {"title": "X"}}),
            ("DELETE", f"/widgets/{widget['id']}", {}),
        ]:
            with self.subTest(method=method):
                self.assertEqual(self.request(method, path, **kwargs).status_code, 403)
        self.assertEqual(self.create_widget().status_code, 403)
        self.user.permissions = ["devices.view"]
        self.assertEqual(self.request("GET", f"/projects/{self.project.id}").status_code, 403)
        self.assertEqual(self.request("GET", f"/projects/{self.project.id}/runtime-state").status_code, 403)

    def test_binding_rejects_wrong_project_unassigned_device_and_unsafe_gpio(self):
        for project_id in (self.same_tenant_project.id, None):
            with self.subTest(project_id=project_id):
                self.device.project_id = project_id
                self.db.commit()
                response = self.create_widget({
                    "device_id": str(self.device.id), "capability_key": "relay_1",
                })
                self.assertEqual(response.status_code, 400, response.text)
        self.device.project_id = self.project.id
        self.db.commit()
        for binding in (
            {"capability_key": "relay_1", "gpio_pin": 4},
            {"capability_key": "custom_gpio_output", "gpio_pin": 6},
            {"capability_key": "missing"},
            {"capability_key": "relay_1", "command": "reboot"},
        ):
            with self.subTest(binding=binding):
                binding["device_id"] = str(self.device.id)
                response = self.create_widget(binding)
                self.assertEqual(response.status_code, 400, response.text)
        toggle = self.create_widget({
            "device_id": str(self.device.id), "capability_key": "relay_1", "command": "toggle_output",
        })
        self.assertEqual(toggle.status_code, 201, toggle.text)
        self.assertEqual(toggle.json()["binding"]["params"]["target"], "relay_1")

    def test_virtual_bindings_validate_project_direction_value_type_and_manifest(self):
        stream = TenantDatastream(
            tenant_id=self.tenant.id, project_id=self.project.id, name="Relay", alias="relay",
            pin=3, data_type="boolean", direction="bidirectional", status="active",
        )
        self.db.add(stream)
        self.db.commit()
        binding = {"device_id": str(self.device.id), "datastream_id": str(stream.id), "binding_type": "virtual"}
        created = self.create_widget(binding)
        self.assertEqual(created.status_code, 201, created.text)
        self.assertEqual(created.json()["binding"]["state_key"], "ch_v3")
        self.assertEqual(created.json()["binding"]["params"]["channel"], "v3")
        for key, value, original in (
            ("project_id", self.same_tenant_project.id, self.project.id),
            ("direction", "telemetry", "bidirectional"),
            ("data_type", "double", "boolean"),
            ("status", "disabled", "active"),
        ):
            with self.subTest(field=key):
                setattr(stream, key, value)
                self.db.commit()
                self.assertEqual(self.create_widget(binding).status_code, 400)
                setattr(stream, key, original)
                self.db.commit()
        self.device.last_status_payload = {"capability_manifest": {"channels": ["v4"]}}
        self.db.commit()
        self.assertEqual(self.create_widget(binding).status_code, 403)

    def test_invalid_config_and_removed_ai_widgets(self):
        self.assertEqual(self.create_widget(widget_type="telemetry_chart", config={"timeRange": "bad"}).status_code, 400)
        self.assertEqual(self.create_widget(widget_type="tinyml_prediction_card").status_code, 422)
        self.assertEqual(self.create_widget(widget_type="anomaly_detection_card").status_code, 422)

    def test_chart_telemetry_time_bounds_filter_actual_records(self):
        self.db.add(TenantFeatureOverride(
            tenant_id=self.tenant.id, feature_name="telemetry_view", is_enabled=True,
        ))
        start = datetime.now(timezone.utc) - timedelta(hours=1)
        end = start + timedelta(minutes=30)
        for timestamp, value in (
            (start - timedelta(seconds=1), 1.0),
            (start, 2.0),
            (start + timedelta(minutes=15), 3.0),
            (end, 4.0),
            (end + timedelta(hours=2), 5.0),
        ):
            self.db.add(Telemetry(
                device_id=self.device.id, timestamp=timestamp,
                metric_name="temperature", metric_value=value,
            ))
        self.db.commit()
        path = f"/devices/{self.device.device_uid}/telemetry"
        unbounded = self.request("GET", path)
        self.assertEqual(unbounded.status_code, 200, unbounded.text)
        self.assertEqual([r["metric_value"] for r in unbounded.json()], [1, 2, 3, 4, 5])
        bounded = self.request("GET", path, params={
            "from_time": start.isoformat(), "to_time": end.isoformat(),
            "metric_name": "temperature", "aggregate": "max",
        })
        self.assertEqual(bounded.status_code, 200, bounded.text)
        self.assertEqual([r["metric_value"] for r in bounded.json()], [2, 3, 4])
        ranged = self.request("GET", path, params={"time_range": "6h", "aggregate": "min"})
        self.assertEqual(ranged.status_code, 200, ranged.text)
        self.assertIsInstance(ranged.json()["data"], list)
        self.assertIn("aggregated", ranged.json())
        self.assertIn("grouping", ranged.json())
        self.assertEqual(self.request("GET", path, params={"from_time": "invalid"}).status_code, 422)
        self.assertEqual(self.request("GET", path, params={"aggregate": "median"}).status_code, 422)
        self.assertEqual(self.request("GET", f"/devices/{self.foreign_device.device_uid}/telemetry").status_code, 404)


if __name__ == "__main__":
    unittest.main(verbosity=2)
