"""
Test 04 — Device Management

Verifies:
  - Admin can create a device (field: device_uid, name)
  - Admin can list devices (response field: device_uid)
  - Device register endpoint is public (requires device_uid + name)
  - Tenant can list assigned devices via /client/devices
  - Tenant can view assigned device detail (path param is device_uid string)
  - MQTT config endpoint returns expected fields
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from utils.auth import admin_client, tenant1_client
from utils.assertions import assert_status, assert_json, assert_fields, assert_list, assert_uuid
from utils.test_data import test_device_uid

admin = admin_client()
t1 = tenant1_client()


def test_admin_create_device():
    uid = test_device_uid()
    resp = admin.post("/api/v1/devices", json={
        "device_uid": uid,
        "name": f"TEST_Device_{uid}",
    })
    assert_status(resp, 201, "POST /api/v1/devices")
    data = assert_json(resp)
    assert_fields(data, "id", "device_uid", "name", "status")
    assert data["device_uid"] == uid
    assert_uuid(data["id"])


def test_admin_list_devices():
    resp = admin.get("/api/v1/devices")
    assert_status(resp, 200, "GET /api/v1/devices")
    data = assert_json(resp)
    assert_list(data, "admin device list")


def test_admin_duplicate_device_uid_returns_409():
    uid = test_device_uid()
    payload = {"device_uid": uid, "name": f"TEST_{uid}"}
    admin.post("/api/v1/devices", json=payload)
    resp = admin.post("/api/v1/devices", json=payload)
    assert resp.status_code == 409, (
        f"Expected 409 on duplicate UID, got {resp.status_code}: {resp.text}"
    )


def test_device_register_public_endpoint():
    """POST /api/v1/devices/register is a public endpoint (no auth required).
    DeviceCreate requires device_uid (str) and name (str).
    """
    from utils.api_client import ApiClient
    uid = test_device_uid()
    resp = ApiClient().post("/api/v1/devices/register", json={
        "device_uid": uid,
        "name": f"TEST_Register_{uid}",
    })
    # 200 = registered OK (or 409 if already exists)
    # 503 = provisioning not configured (DEVICE_PROVISIONING_SECRET is empty)
    assert resp.status_code in (200, 409, 503), (
        f"POST /devices/register expected 200/409/503, got {resp.status_code}: {resp.text}"
    )
    if resp.status_code == 200:
        data = assert_json(resp)
        assert_fields(data, "device_uid", "mqtt_topics")
        assert "telemetry" in data["mqtt_topics"]
        assert "ota_status" in data["mqtt_topics"]


def test_tenant_list_client_devices():
    resp = t1.get("/api/v1/client/devices")
    assert_status(resp, 200, "GET /client/devices (tenant)")
    assert_list(assert_json(resp), "/client/devices")


def test_tenant_get_device_detail():
    devices_resp = t1.get("/api/v1/client/devices")
    devices = devices_resp.json() if devices_resp.status_code == 200 else []
    if not devices:
        pytest.skip("Tenant1 has no assigned devices — run seed_tenant_demo.py")

    device_uid = devices[0]["device_uid"]
    resp = t1.get(f"/api/v1/client/devices/{device_uid}")
    assert_status(resp, 200, f"GET /client/devices/{device_uid}")
    data = assert_json(resp)
    assert data["device_uid"] == device_uid


def test_tenant_get_device_mqtt_config():
    devices_resp = t1.get("/api/v1/client/devices")
    devices = devices_resp.json() if devices_resp.status_code == 200 else []
    if not devices:
        pytest.skip("Tenant1 has no assigned devices")

    device_uid = devices[0]["device_uid"]
    resp = t1.get(f"/api/v1/client/devices/{device_uid}/mqtt-config")
    assert_status(resp, 200, f"GET /client/devices/{device_uid}/mqtt-config")
    data = assert_json(resp)
    assert any(k in data for k in ("host", "broker", "mqtt_host", "topics",
                                    "topic_telemetry", "broker_host")), (
        f"MQTT config response missing expected fields: {list(data.keys())}"
    )
