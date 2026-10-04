from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import main as app_main
from app.bounded_contexts.telemetry.infrastructure.persistence.alert_models import Alert
from app.core import security
from app.db.session import get_db
from app.modules.devices.model import Device


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _Db:
    def __init__(self, alert=None):
        self.alert = alert
        self.commits = 0

    def scalars(self, _statement):
        return _Result([] if self.alert is None else [self.alert])

    def execute(self, _statement):
        return _Result([])

    def get(self, model, _identifier):
        if model is Alert:
            return self.alert
        if model is Device and self.alert is not None:
            return SimpleNamespace(id=self.alert.device_id, device_uid="esp32-alert-1")
        return None

    def commit(self):
        self.commits += 1

    def refresh(self, _item):
        return None


@pytest.fixture
def route_client():
    saved = dict(app_main.app.dependency_overrides)
    admin = SimpleNamespace(id=uuid4(), role="admin", tenant_id=None, is_active=True)
    db = _Db()
    # Some legacy test modules install a process-global require_admin override.
    # Remove it so these tests exercise the real role check via get_current_user.
    app_main.app.dependency_overrides.pop(security.require_admin, None)
    app_main.app.dependency_overrides[security.get_current_user] = lambda: admin
    app_main.app.dependency_overrides[get_db] = lambda: db
    try:
        yield TestClient(app_main.app), db, admin
    finally:
        app_main.app.dependency_overrides = saved


def test_admin_alert_routes_are_registered():
    routes = {
        (route.path, method) for route in app_main.app.routes for method in route.methods or []
    }
    assert ("/api/v1/admin/alerts", "GET") in routes
    assert ("/api/v1/admin/alerts/summary", "GET") in routes
    assert ("/api/v1/admin/alerts/{alert_id}/ack", "POST") in routes
    assert ("/api/v1/admin/alerts/{alert_id}/resolve", "POST") in routes


def test_admin_can_read_tenant_alerts_without_support_grant(route_client):
    client, _db, _admin = route_client
    response = client.get(f"/api/v1/admin/alerts?tenant_id={uuid4()}")
    assert response.status_code == 200


def test_get_admin_alerts_rejects_non_admin(route_client):
    client, _db, _admin = route_client
    app_main.app.dependency_overrides[security.get_current_user] = lambda: SimpleNamespace(
        id=uuid4(), role="tenant_owner", tenant_id=uuid4(), is_active=True
    )
    response = client.get("/api/v1/admin/alerts")
    assert response.status_code == 403


def test_admin_can_read_tenant_alert_summary_without_support_grant(route_client):
    client, _db, _admin = route_client
    response = client.get(f"/api/v1/admin/alerts/summary?tenant_id={uuid4()}")
    assert response.status_code == 200


def test_admin_can_read_alerts_platform_wide(route_client):
    client, _db, _admin = route_client
    response = client.get("/api/v1/admin/alerts")
    assert response.status_code == 200

    response_summary = client.get("/api/v1/admin/alerts/summary")
    assert response_summary.status_code == 200


def test_admin_cannot_acknowledge_or_resolve_tenant_alert(route_client, monkeypatch):
    client, db, _admin = route_client
    now = datetime.now(timezone.utc)
    alert = Alert(
        tenant_id=uuid4(),
        device_id=uuid4(),
        severity="warning",
        status="open",
        source="anomaly",
        code="anomaly:temperature",
        title="Temperature anomaly",
        message="Temperature is outside the expected range",
        details={"anomaly_score": 0.91},
        first_seen_at=now,
        last_seen_at=now,
    )
    alert.id = uuid4()
    db.alert = alert
    monkeypatch.setattr(
        "app.bounded_contexts.telemetry.presentation.admin_alerts_router.tenant_repository.get_tenant",
        lambda *_: None,
    )

    ack = client.post(f"/api/v1/admin/alerts/{alert.id}/ack")
    resolved = client.post(f"/api/v1/admin/alerts/{alert.id}/resolve")

    assert ack.status_code == 403
    assert resolved.status_code == 403
    assert db.commits == 0
