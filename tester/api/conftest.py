"""
Shared pytest fixtures for API tests.

Fixtures marked session-scoped create resources once per test run to avoid
hammering the database with redundant inserts.
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from utils.auth import admin_client, tenant1_client, admin_token, tenant1_token
from utils.test_data import test_device_uid, fake_firmware_bytes, unique_suffix


@pytest.fixture(scope="session")
def admin():
    return admin_client()


@pytest.fixture(scope="session")
def tenant1():
    return tenant1_client()


@pytest.fixture(scope="session")
def shared_device(admin):
    """Create one test device for the whole session."""
    uid = test_device_uid()
    resp = admin.post("/api/v1/devices", json={
        "device_uid": uid,
        "name": f"TEST_Device_{uid}",
    })
    if resp.status_code == 409:
        # Already exists — find it
        devices = admin.get("/api/v1/devices").json()
        for d in devices:
            if d["device_uid"] == uid:
                return d
    assert resp.status_code == 201, f"Failed to create shared device: {resp.text}"
    return resp.json()


@pytest.fixture(scope="session")
def shared_firmware(tenant1):
    """Upload one test firmware .bin for the whole session (as tenant)."""
    data = fake_firmware_bytes(256)
    resp = tenant1.upload_file(
        "/api/v1/client/firmware",
        file_field="file",
        file_bytes=data,
        filename="test_v1.0.0.bin",
        extra_fields={"version": f"1.0.{unique_suffix()}", "target_device_type": "esp32"},
    )
    assert resp.status_code == 201, f"Failed to upload shared firmware: {resp.text}"
    return resp.json()
