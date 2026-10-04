"""
Test 03 — Tenant Isolation

Verifies:
  - Tenant A sees only Tenant A devices via /api/v1/client/devices
  - Tenant A cannot view Tenant B device detail (device_uid in path)
  - Tenant A cannot view Tenant B device telemetry
  - Tenant A cannot see Tenant B firmware in its own firmware list
  - Tenant A cannot create an OTA job using Tenant B firmware (403)
  - Tenant users get 403/404 when calling admin-only routes:
      GET /api/v1/devices
      GET /api/v1/telemetry
      GET /api/v1/firmware
      GET /api/v1/ota/jobs

Requires seed_tenant_demo.py AND seed_demo.py to have been run.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from utils.auth import tenant1_client, tenant2_client
from utils.assertions import assert_status, assert_json, assert_list, assert_forbidden
from utils.test_data import fake_firmware_bytes, unique_suffix

t1 = tenant1_client()
t2 = tenant2_client()


# --- Admin routes must be blocked for tenants --------------------------------

def test_tenant_cannot_call_admin_devices():
    resp = t1.get("/api/v1/devices")
    assert_forbidden(resp, "Tenant calling GET /api/v1/devices")


def test_tenant_cannot_call_admin_telemetry():
    resp = t1.get("/api/v1/telemetry")
    assert_forbidden(resp, "Tenant calling GET /api/v1/telemetry")


def test_tenant_cannot_call_admin_firmware():
    resp = t1.get("/api/v1/firmware")
    assert_forbidden(resp, "Tenant calling GET /api/v1/firmware")


def test_tenant_cannot_call_admin_ota_jobs():
    resp = t1.get("/api/v1/ota/jobs")
    assert_forbidden(resp, "Tenant calling GET /api/v1/ota/jobs")


# --- Tenant sees own devices only --------------------------------------------

def _get_tenant_device_uids(client) -> list[str]:
    resp = client.get("/api/v1/client/devices")
    assert_status(resp, 200, "GET /client/devices")
    devices = assert_json(resp)
    assert_list(devices, "/client/devices")
    return [d["device_uid"] for d in devices]


def test_tenant1_and_tenant2_have_different_devices():
    t1_uids = set(_get_tenant_device_uids(t1))
    t2_uids = set(_get_tenant_device_uids(t2))
    if not t1_uids or not t2_uids:
        pytest.skip(
            "One or both tenants have no devices assigned. "
            "Run scripts/seed_demo.py then scripts/seed_tenant_demo.py."
        )
    overlap = t1_uids & t2_uids
    assert not overlap, (
        f"Tenants share device UIDs — isolation is BROKEN: {overlap}\n"
        "The same device is visible in both tenant contexts."
    )


def test_tenant1_cannot_access_tenant2_device_detail():
    t2_devices_resp = t2.get("/api/v1/client/devices")
    t2_devices = t2_devices_resp.json() if t2_devices_resp.status_code == 200 else []
    if not t2_devices:
        pytest.skip("Tenant2 has no devices — run seed_demo.py + seed_tenant_demo.py")

    t2_uid = t2_devices[0]["device_uid"]
    resp = t1.get(f"/api/v1/client/devices/{t2_uid}")
    assert_forbidden(resp, f"Tenant1 accessing Tenant2 device {t2_uid}")


def test_tenant1_cannot_access_tenant2_device_telemetry():
    t2_devices_resp = t2.get("/api/v1/client/devices")
    t2_devices = t2_devices_resp.json() if t2_devices_resp.status_code == 200 else []
    if not t2_devices:
        pytest.skip("Tenant2 has no devices — run seed_demo.py + seed_tenant_demo.py")

    t2_uid = t2_devices[0]["device_uid"]
    resp = t1.get(f"/api/v1/client/devices/{t2_uid}/telemetry")
    assert_forbidden(resp, f"Tenant1 reading Tenant2 device telemetry for {t2_uid}")


def test_tenant1_cannot_command_tenant2_device():
    t2_devices_resp = t2.get("/api/v1/client/devices")
    t2_devices = t2_devices_resp.json() if t2_devices_resp.status_code == 200 else []
    if not t2_devices:
        pytest.skip("Tenant2 has no devices — run seed_demo.py + seed_tenant_demo.py")

    t2_uid = t2_devices[0]["device_uid"]
    resp = t1.post(
        f"/api/v1/client/devices/{t2_uid}/commands",
        json={"command": "request_status", "params": {}},
    )
    assert_forbidden(resp, f"Tenant1 sending command to Tenant2 device {t2_uid}")


def test_tenant1_cannot_create_ota_for_tenant2_device():
    fw_id = _upload_firmware(t1)
    if fw_id is None:
        pytest.skip("Tenant1 could not upload firmware — check feature flags / plan")

    t2_devices_resp = t2.get("/api/v1/client/devices")
    t2_devices = t2_devices_resp.json() if t2_devices_resp.status_code == 200 else []
    if not t2_devices:
        pytest.skip("Tenant2 has no devices — run seed_demo.py + seed_tenant_demo.py")

    t2_uid = t2_devices[0]["device_uid"]
    resp = t1.post("/api/v1/client/ota-jobs", json={
        "device_uid": t2_uid,
        "firmware_version_id": fw_id,
    })
    assert_forbidden(resp, f"Tenant1 creating OTA for Tenant2 device {t2_uid}")


# --- Firmware isolation -------------------------------------------------------

def _upload_firmware(client) -> str | None:
    """Upload a small firmware blob and return its UUID, or None on failure."""
    data = fake_firmware_bytes(256)
    version = f"iso-{unique_suffix()}"
    resp = client.upload_file(
        "/api/v1/client/firmware",
        file_field="file",
        file_bytes=data,
        filename=f"iso_{version}.bin",
        extra_fields={"version": version, "target_device_type": "esp32"},
    )
    if resp.status_code != 201:
        return None
    return str(resp.json()["id"])


def test_tenant2_firmware_not_visible_to_tenant1():
    """Firmware uploaded by Tenant2 must not appear in Tenant1's firmware list."""
    fw_id = _upload_firmware(t2)
    if fw_id is None:
        pytest.skip("Tenant2 could not upload firmware — check feature flags / plan")

    resp = t1.get("/api/v1/client/firmware")
    assert_status(resp, 200, "GET /client/firmware for Tenant1")
    t1_firmware_ids = {f["id"] for f in resp.json()}

    assert fw_id not in t1_firmware_ids, (
        f"Firmware {fw_id} uploaded by Tenant2 is visible to Tenant1 — isolation BROKEN"
    )


def test_tenant1_cannot_create_ota_with_tenant2_firmware():
    """Tenant1 using Tenant2's firmware UUID in an OTA job must be rejected (403)."""
    fw_id = _upload_firmware(t2)
    if fw_id is None:
        pytest.skip("Tenant2 could not upload firmware — check feature flags / plan")

    # Get a device that belongs to Tenant1
    t1_devices_resp = t1.get("/api/v1/client/devices")
    t1_devices = t1_devices_resp.json() if t1_devices_resp.status_code == 200 else []
    if not t1_devices:
        pytest.skip("Tenant1 has no assigned devices — run seed_demo.py + seed_tenant_demo.py")

    device_uid = t1_devices[0]["device_uid"]
    resp = t1.post("/api/v1/client/ota-jobs", json={
        "device_uid": device_uid,
        "firmware_version_id": fw_id,
    })
    assert resp.status_code == 403, (
        f"Tenant1 using Tenant2 firmware should get 403, got {resp.status_code}: {resp.text}"
    )
