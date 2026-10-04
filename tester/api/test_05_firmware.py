"""
Test 05 — Firmware Management

Verifies:
  - Tenant can upload a .bin firmware file
  - Tenant can list firmware
  - Admin can list firmware via /api/v1/firmware
  - Firmware download works (binary response + checksum header)
  - Empty upload is rejected
  - Oversized upload is rejected (if limit configured)
  - SHA-256 checksum header is present on download
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
import hashlib
from utils.auth import admin_client, tenant1_client
from utils.assertions import assert_status, assert_json, assert_fields, assert_list
from utils.test_data import fake_firmware_bytes, unique_suffix
from config.settings import VALID_OTA_STATUSES

admin = admin_client()
t1 = tenant1_client()


def upload_firmware(client, size: int = 512) -> dict:
    data = fake_firmware_bytes(size)
    version = f"2.0.{unique_suffix()}"
    resp = client.upload_file(
        "/api/v1/client/firmware",
        file_field="file",
        file_bytes=data,
        filename=f"test_{version}.bin",
        extra_fields={"version": version, "target_device_type": "esp32"},
    )
    return resp


def test_tenant_upload_firmware_ok():
    resp = upload_firmware(t1)
    assert_status(resp, 201, "POST /client/firmware")
    data = assert_json(resp)
    assert_fields(data, "id", "version", "checksum_sha256")
    assert len(data["checksum_sha256"]) == 64, "checksum_sha256 should be a 64-char hex string"


def test_tenant_list_firmware():
    resp = t1.get("/api/v1/client/firmware")
    assert_status(resp, 200, "GET /client/firmware")
    assert_list(assert_json(resp), "tenant firmware list")


def test_admin_list_firmware():
    resp = admin.get("/api/v1/firmware")
    assert_status(resp, 200, "GET /api/v1/firmware (admin)")
    assert_list(assert_json(resp), "admin firmware list")


def test_firmware_download_ok():
    resp = upload_firmware(t1)
    if resp.status_code != 201:
        pytest.skip("Upload failed, cannot test download")
    firmware_id = resp.json()["id"]

    dl_resp = admin.get(f"/api/v1/firmware/{firmware_id}/download")
    assert_status(dl_resp, 200, f"GET /firmware/{firmware_id}/download")
    assert len(dl_resp.content) > 0, "Download returned empty body"


def test_firmware_download_checksum_header():
    resp = upload_firmware(t1)
    if resp.status_code != 201:
        pytest.skip("Upload failed, cannot test checksum header")
    fw = resp.json()
    firmware_id = fw["id"]
    expected_checksum = fw.get("checksum_sha256", "")

    dl_resp = admin.get(f"/api/v1/firmware/{firmware_id}/download")
    assert_status(dl_resp, 200, f"GET /firmware/{firmware_id}/download")

    header_checksum = dl_resp.headers.get("X-Firmware-Sha256", "")
    assert header_checksum, "X-Firmware-Sha256 header missing from download response"
    if expected_checksum:
        assert header_checksum.lower() == expected_checksum.lower(), (
            f"Checksum mismatch: header={header_checksum}, db={expected_checksum}"
        )
    # Also verify the downloaded bytes match
    actual_sha = hashlib.sha256(dl_resp.content).hexdigest()
    assert actual_sha.lower() == header_checksum.lower(), (
        f"Downloaded content sha256 {actual_sha} != header {header_checksum}"
    )


def test_empty_firmware_upload_fails():
    resp = t1.upload_file(
        "/api/v1/client/firmware",
        file_field="file",
        file_bytes=b"",
        filename="empty.bin",
        extra_fields={"version": f"0.0.{unique_suffix()}", "target_device_type": "esp32"},
    )
    assert resp.status_code in (400, 413, 422), (
        f"Empty firmware upload should fail (400/413/422), got {resp.status_code}: {resp.text}"
    )


def test_oversized_firmware_upload_fails():
    large_data = fake_firmware_bytes(4 * 1024 * 1024)  # 4 MB
    resp = t1.upload_file(
        "/api/v1/client/firmware",
        file_field="file",
        file_bytes=large_data,
        filename="huge.bin",
        extra_fields={"version": f"99.0.{unique_suffix()}", "target_device_type": "esp32"},
    )
    if resp.status_code == 201:
        pytest.skip("Backend has no size limit configured — skipping oversized test")
    assert resp.status_code in (400, 413, 422), (
        f"Oversized upload should fail (400/413/422), got {resp.status_code}"
    )


def test_admin_firmware_get_by_id():
    resp = admin.get("/api/v1/firmware")
    firmware_list = resp.json() if resp.status_code == 200 else []
    if not firmware_list:
        pytest.skip("No firmware in system yet")
    fw_id = firmware_list[0]["id"]
    resp2 = admin.get(f"/api/v1/firmware/{fw_id}")
    assert_status(resp2, 200, f"GET /firmware/{fw_id}")
    assert_fields(assert_json(resp2), "id", "version")
