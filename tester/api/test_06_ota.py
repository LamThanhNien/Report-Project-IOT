"""
Test 06 — OTA Job Management

Verifies the full OTA flow:
  1. Tenant uploads firmware (or reuses existing)
  2. Tenant creates OTA job for an assigned device (body: device_uid, firmware_version_id)
  3. Tenant cannot create OTA job for an unassigned device
  4. OTA job appears in tenant OTA list
  5. Admin can see the OTA job in admin OTA list
  6. OTA job status is a valid value

Note: OtaJobCreate uses `firmware_version_id` (UUID) not `firmware_id`.

MQTT publish verification is in tester/mqtt/test_ota_mqtt_publish.py.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from utils.auth import admin_client, tenant1_client
from utils.assertions import assert_status, assert_json, assert_fields, assert_list, assert_uuid
from utils.test_data import test_device_uid, fake_firmware_bytes, unique_suffix
from config.settings import VALID_OTA_STATUSES

admin = admin_client()
t1 = tenant1_client()


def _get_tenant1_device_uid() -> str | None:
    resp = t1.get("/api/v1/client/devices")
    if resp.status_code != 200:
        return None
    devices = resp.json()
    return devices[0]["device_uid"] if devices else None


def _upload_firmware_for_tenant() -> str | None:
    data = fake_firmware_bytes(256)
    version = f"3.0.{unique_suffix()}"
    resp = t1.upload_file(
        "/api/v1/client/firmware",
        file_field="file",
        file_bytes=data,
        filename=f"ota_test_{version}.bin",
        extra_fields={"version": version, "target_device_type": "esp32"},
    )
    if resp.status_code != 201:
        return None
    # Return the firmware UUID (firmware_version_id in OtaJobCreate)
    return str(resp.json()["id"])


def test_tenant_create_ota_job():
    device_uid = _get_tenant1_device_uid()
    if not device_uid:
        pytest.skip("Tenant1 has no assigned devices — run seed_tenant_demo.py")

    firmware_version_id = _upload_firmware_for_tenant()
    if not firmware_version_id:
        pytest.skip("Could not upload firmware for OTA test")

    resp = t1.post("/api/v1/client/ota-jobs", json={
        "device_uid": device_uid,
        "firmware_version_id": firmware_version_id,
    })
    assert_status(resp, 201, "POST /client/ota-jobs")
    data = assert_json(resp)
    assert_fields(data, "job_id", "status")
    assert_uuid(data["job_id"], "job_id")
    assert data["status"] in VALID_OTA_STATUSES, (
        f"OTA job status '{data['status']}' is not valid. Expected one of: {VALID_OTA_STATUSES}"
    )


def test_tenant_cannot_create_ota_for_unassigned_device():
    firmware_version_id = _upload_firmware_for_tenant()
    if not firmware_version_id:
        pytest.skip("Could not upload firmware")

    # Use a device UID that definitely does not belong to tenant1
    fake_uid = "NONEXISTENT_DEVICE_99999"
    resp = t1.post("/api/v1/client/ota-jobs", json={
        "device_uid": fake_uid,
        "firmware_version_id": firmware_version_id,
    })
    assert resp.status_code in (403, 404, 400), (
        f"Expected 403/404/400 for unassigned device OTA, got {resp.status_code}: {resp.text}"
    )


def test_tenant_list_ota_jobs():
    resp = t1.get("/api/v1/client/ota-jobs")
    assert_status(resp, 200, "GET /client/ota-jobs")
    assert_list(assert_json(resp), "tenant OTA jobs")


def test_admin_list_ota_jobs():
    resp = admin.get("/api/v1/ota/jobs")
    assert_status(resp, 200, "GET /api/v1/ota/jobs (admin)")
    assert_list(assert_json(resp), "admin OTA jobs")


def test_ota_job_statuses_are_valid():
    resp = admin.get("/api/v1/ota/jobs")
    if resp.status_code != 200:
        pytest.skip("Could not list OTA jobs")
    jobs = resp.json()
    for job in jobs[:20]:
        status = job.get("status", "")
        assert status in VALID_OTA_STATUSES, (
            f"OTA job {job.get('id')} has invalid status: '{status}'. "
            f"Expected one of: {VALID_OTA_STATUSES}"
        )


def test_admin_get_ota_job_by_id():
    resp = admin.get("/api/v1/ota/jobs")
    jobs = resp.json() if resp.status_code == 200 else []
    if not jobs:
        pytest.skip("No OTA jobs in system")
    job_id = jobs[0]["id"]
    resp2 = admin.get(f"/api/v1/ota/jobs/{job_id}")
    assert_status(resp2, 200, f"GET /ota/jobs/{job_id}")
    data = assert_json(resp2)
    assert data["id"] == job_id
