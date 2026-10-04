"""
Test 07 — Telemetry

Verifies:
  - Admin can create telemetry for a device
  - Admin can list telemetry (global + by device)
  - Tenant can view telemetry for their assigned device
  - Tenant cannot view telemetry for another tenant's device

TelemetryCreate requires: device_uid, timestamp (ISO8601), metric_name, metric_value.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from datetime import datetime, timezone
from utils.auth import admin_client, tenant1_client, tenant2_client
from utils.assertions import assert_status, assert_json, assert_list, assert_forbidden
from utils.test_data import test_device_uid

admin = admin_client()
t1 = tenant1_client()
t2 = tenant2_client()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _get_or_create_admin_device() -> str | None:
    uid = test_device_uid()
    resp = admin.post("/api/v1/devices", json={"device_uid": uid, "name": f"TEST_{uid}"})
    if resp.status_code == 201:
        return uid
    # 409 = already exists - fall back to listing
    devices = admin.get("/api/v1/devices").json()
    return devices[0]["device_uid"] if devices else None


def test_admin_create_telemetry():
    uid = _get_or_create_admin_device()
    if not uid:
        pytest.skip("No devices available for telemetry test")

    resp = admin.post("/api/v1/telemetry", json={
        "device_uid": uid,
        "timestamp": _now_iso(),
        "metric_name": "temperature",
        "metric_value": 25.5,
    })
    assert_status(resp, 201, "POST /api/v1/telemetry")
    data = assert_json(resp)
    assert "id" in data or "device_uid" in data, f"Unexpected telemetry response: {data}"


def test_admin_list_telemetry():
    resp = admin.get("/api/v1/telemetry")
    assert_status(resp, 200, "GET /api/v1/telemetry (admin)")
    assert_list(assert_json(resp), "admin telemetry list")


def test_admin_list_telemetry_by_device():
    uid = _get_or_create_admin_device()
    if not uid:
        pytest.skip("No devices available")
    resp = admin.get("/api/v1/telemetry", params={"device_uid": uid, "limit": 10})
    assert_status(resp, 200, f"GET /telemetry?device_uid={uid}")
    assert_list(assert_json(resp), "filtered telemetry list")


def test_admin_get_device_telemetry():
    uid = _get_or_create_admin_device()
    if not uid:
        pytest.skip("No devices available")
    resp = admin.get(f"/api/v1/devices/{uid}/telemetry", params={"limit": 10})
    assert_status(resp, 200, f"GET /devices/{uid}/telemetry")
    assert_list(assert_json(resp))


def test_tenant_view_assigned_device_telemetry():
    resp = t1.get("/api/v1/client/devices")
    devices = resp.json() if resp.status_code == 200 else []
    if not devices:
        pytest.skip("Tenant1 has no assigned devices — run seed_tenant_demo.py")

    device_uid = devices[0]["device_uid"]
    resp = t1.get(f"/api/v1/client/devices/{device_uid}/telemetry", params={"limit": 10})
    assert_status(resp, 200, f"Tenant GET /client/devices/{device_uid}/telemetry")
    assert_list(assert_json(resp))


def test_tenant_cannot_view_other_tenant_device_telemetry():
    t2_devices_resp = t2.get("/api/v1/client/devices")
    t2_devices = t2_devices_resp.json() if t2_devices_resp.status_code == 200 else []
    if not t2_devices:
        pytest.skip("Tenant2 has no devices — run seed_tenant_demo.py + seed_demo.py")

    t2_uid = t2_devices[0]["device_uid"]
    resp = t1.get(f"/api/v1/client/devices/{t2_uid}/telemetry")
    assert_forbidden(resp, f"Tenant1 reading Tenant2 device telemetry for {t2_uid}")
