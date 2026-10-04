"""
Test 07 — Viewer Write Protection

Verifies that users with the 'viewer' role receive HTTP 403 on all write
endpoints.  The test creates a temporary viewer user under Tenant1 (which
requires the tenant_owner, i.e. tenant1_client), performs the checks, then
deletes the viewer user so the run is idempotent.

Endpoints tested:
  POST   /api/v1/client/devices      → 403
  DELETE /api/v1/client/devices/{uid} → 403
  POST   /api/v1/client/firmware     → 403
  POST   /api/v1/client/ota-jobs     → 403
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from utils.auth import tenant1_client
from utils.api_client import ApiClient
from utils.assertions import assert_status
from utils.test_data import fake_firmware_bytes, unique_suffix
from config.settings import API_BASE_URL

t1_owner = tenant1_client()

VIEWER_EMAIL = f"viewer_test_{unique_suffix()}@aifom.test"
VIEWER_PASSWORD = "Viewer_test_pw_9x"


@pytest.fixture(scope="module")
def viewer_client():
    """Create a viewer user under Tenant1, yield an authenticated client, then delete."""
    # Create viewer via tenant-owner endpoint
    resp = t1_owner.post("/api/v1/client/users", json={
        "email": VIEWER_EMAIL,
        "password": VIEWER_PASSWORD,
        "full_name": "Test Viewer",
        "role": "viewer",
    })
    if resp.status_code not in (200, 201):
        pytest.skip(
            f"Could not create viewer user (status {resp.status_code}): {resp.text}\n"
            "Make sure tenant1 has the 'user_management' feature enabled (Pro plan)."
        )

    user_id = resp.json().get("id")

    # Login as viewer
    login_resp = ApiClient(API_BASE_URL).post(
        "/api/v1/auth/login",
        json={"email": VIEWER_EMAIL, "password": VIEWER_PASSWORD},
    )
    if login_resp.status_code != 200:
        pytest.skip(f"Viewer login failed: {login_resp.status_code} {login_resp.text}")

    token = login_resp.json()["access_token"]
    client = ApiClient(API_BASE_URL)
    client.set_token(token)

    yield client

    # Teardown: delete the viewer user
    if user_id:
        t1_owner.delete(f"/api/v1/client/users/{user_id}")


def test_viewer_cannot_register_device(viewer_client):
    resp = viewer_client.post("/api/v1/client/devices", json={
        "device_uid": f"VIEWER_TEST_{unique_suffix()}",
        "name": "viewer test device",
    })
    assert resp.status_code == 403, (
        f"Viewer POST /client/devices should return 403, got {resp.status_code}: {resp.text}"
    )


def test_viewer_cannot_unassign_device(viewer_client):
    # Use a plausible but non-existent UID; 403 must come before 404 due to role check
    resp = viewer_client.delete("/api/v1/client/devices/VIEWER_FAKE_UID")
    assert resp.status_code == 403, (
        f"Viewer DELETE /client/devices/uid should return 403, got {resp.status_code}: {resp.text}"
    )


def test_viewer_cannot_upload_firmware(viewer_client):
    data = fake_firmware_bytes(256)
    resp = viewer_client.upload_file(
        "/api/v1/client/firmware",
        file_field="file",
        file_bytes=data,
        filename="viewer_test.bin",
        extra_fields={"version": f"v-{unique_suffix()}", "target_device_type": "esp32"},
    )
    assert resp.status_code == 403, (
        f"Viewer POST /client/firmware should return 403, got {resp.status_code}: {resp.text}"
    )


def test_viewer_cannot_create_ota_job(viewer_client):
    import uuid
    resp = viewer_client.post("/api/v1/client/ota-jobs", json={
        "device_uid": "VIEWER_FAKE_UID",
        "firmware_version_id": str(uuid.uuid4()),
    })
    assert resp.status_code == 403, (
        f"Viewer POST /client/ota-jobs should return 403, got {resp.status_code}: {resp.text}"
    )


def test_viewer_can_read_devices(viewer_client):
    """Viewers must still be able to READ — only writes are blocked."""
    resp = viewer_client.get("/api/v1/client/devices")
    assert resp.status_code == 200, (
        f"Viewer GET /client/devices should return 200, got {resp.status_code}: {resp.text}"
    )


def test_viewer_can_list_firmware(viewer_client):
    resp = viewer_client.get("/api/v1/client/firmware")
    assert resp.status_code == 200, (
        f"Viewer GET /client/firmware should return 200, got {resp.status_code}: {resp.text}"
    )
