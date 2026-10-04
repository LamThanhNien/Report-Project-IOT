"""
Test 09 — Security Hardening

Verifies the security hardening changes from the 9/10 stabilization:
  - Logout token blacklist then session restore returns 401
  - Disabled tenant user receives 403
  - Tenant endpoint rejects platform_admin role creation
  - Audit log is created for key admin/tenant actions
  - Future telemetry timestamp is rejected or normalized
  - Firmware upload validation strips dangerous filename characters
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import time
import uuid
import pytest
from utils.auth import admin_client, tenant1_client
from utils.assertions import assert_status
from utils.test_data import fake_firmware_bytes, unique_suffix


# --- Logout token blacklist → session restore → 401 --------------------------

def test_logout_blacklists_token_and_session_restore_fails():
    """After logout, the old access token must be rejected."""
    from utils.api_client import ApiClient
    from config.settings import API_BASE_URL

    # Login as admin
    client = ApiClient(API_BASE_URL)
    resp = client.post("/api/v1/auth/login", json={
        "email": "admin@aifom.local",
        "password": "admin1234",
    })
    assert_status(resp, 200, "Admin login")
    token = resp.json()["access_token"]
    client.set_token(token)

    # Verify the token works
    resp = client.get("/api/v1/admin/tenants")
    assert_status(resp, 200, "Authenticated request before logout")

    # Logout
    resp = client.post("/api/v1/auth/logout")
    assert_status(resp, 200, "Logout")

    # Try to use the old token — should get 401
    resp = client.get("/api/v1/admin/tenants")
    assert resp.status_code == 401, (
        f"Session restore after logout should return 401, got {resp.status_code}: {resp.text}"
    )


# --- Disabled tenant user receives 403 ----------------------------------------

def test_disabled_tenant_user_gets_403():
    """A user whose tenant is deactivated should get 401/403 on tenant endpoints.

    Note: set_tenant_active also deactivates tenant users when disabling,
    but does NOT re-enable them on re-enable. This test verifies the blocking
    behavior and uses direct DB access for cleanup.
    """
    import utils.auth as auth_module
    from utils.api_client import ApiClient
    from config.settings import API_BASE_URL, TENANT1_EMAIL
    import subprocess

    admin = admin_client()
    # Use cached tenant1 token (conftest already warmed it)
    t1 = tenant1_client()

    resp = t1.get("/api/v1/client/me")
    if resp.status_code != 200:
        pytest.skip("Tenant1 user cannot authenticate — run seed scripts")
    tenant_id = resp.json().get("tenant_id")
    if not tenant_id:
        pytest.skip("Tenant1 user has no tenant_id")

    try:
        # Disable the tenant via admin (this also deactivates tenant users)
        resp = admin.patch(
            f"/api/v1/admin/tenants/{tenant_id}/status",
            json={"is_active": False},
        )
        assert_status(resp, 200, "Disable tenant")

        # Tenant1 user should now get 401 (user inactive) or 403 (tenant disabled)
        resp = t1.get("/api/v1/client/devices")
        assert resp.status_code in (401, 403), (
            f"Disabled tenant user should get 401 or 403, got {resp.status_code}: {resp.text}"
        )
    finally:
        # Re-enable the tenant
        admin.patch(f"/api/v1/admin/tenants/{tenant_id}/status", json={"is_active": True})
        # Re-enable tenant users via direct DB (no API endpoint for user status toggle)
        subprocess.run(
            ["docker", "exec", "aifom-postgres-1", "psql", "-U", "aifom", "-d", "aifom",
             "-c", f"UPDATE users SET is_active = true WHERE tenant_id = '{tenant_id}' AND role != 'admin';"],
            capture_output=True,
        )

    # Clear token cache and re-login (one login call)
    auth_module._token_cache.pop(TENANT1_EMAIL, None)
    fresh_t1 = ApiClient(API_BASE_URL)
    fresh_t1.set_token(auth_module.tenant1_token())

    # Verify tenant1 can access again
    resp = fresh_t1.get("/api/v1/client/devices")
    assert resp.status_code == 200, (
        f"Re-enabled tenant user should get 200, got {resp.status_code}: {resp.text}"
    )


# --- Tenant endpoint rejects platform_admin role creation --------------------

def test_tenant_endpoint_rejects_admin_role():
    """Creating a user with 'admin' role via tenant endpoint must be rejected."""
    t1 = tenant1_client()
    suffix = unique_suffix()
    resp = t1.post("/api/v1/client/users", json={
        "email": f"evil_admin_{suffix}@test.local",
        "password": "ValidPassword123",
        "full_name": "Evil Admin",
        "role": "admin",
    })
    assert resp.status_code in (403, 422), (
        f"Creating user with 'admin' role should be rejected, got {resp.status_code}: {resp.text}"
    )


def test_admin_endpoint_rejects_admin_role_for_tenant_user():
    """Creating a tenant user with 'admin' role via admin endpoint must be rejected."""
    admin = admin_client()
    # Get a tenant ID
    resp = admin.get("/api/v1/admin/tenants")
    assert_status(resp, 200, "List tenants")
    tenants = resp.json()
    if not tenants:
        pytest.skip("No tenants found")
    tenant_id = tenants[0]["id"]

    suffix = unique_suffix()
    resp = admin.post(f"/api/v1/admin/tenants/{tenant_id}/users", json={
        "email": f"evil_admin2_{suffix}@test.local",
        "password": "ValidPassword123",
        "full_name": "Evil Admin",
        "role": "admin",
    })
    assert resp.status_code == 422, (
        f"Creating tenant user with 'admin' role should be rejected with 422, got {resp.status_code}: {resp.text}"
    )


# --- Audit log is created for key actions ------------------------------------

def test_audit_log_created_for_tenant_user_creation():
    """Creating a tenant user should create an audit log entry."""
    t1 = tenant1_client()
    suffix = unique_suffix()
    email = f"audit_test_{suffix}@test.local"

    # Create a user
    resp = t1.post("/api/v1/client/users", json={
        "email": email,
        "password": "ValidPassword123",
        "full_name": "Audit Test",
        "role": "viewer",
    })
    if resp.status_code not in (200, 201):
        pytest.skip(f"Could not create user: {resp.status_code} {resp.text}")
    user_id = resp.json().get("id")

    # Check audit logs
    resp = t1.get("/api/v1/client/audit-logs?action=tenant_create_user&limit=5")
    assert_status(resp, 200, "Get audit logs")
    logs = resp.json()
    assert any(log.get("action") == "tenant_create_user" for log in logs), (
        "Audit log entry for tenant_create_user not found"
    )

    # Cleanup
    if user_id:
        t1.delete(f"/api/v1/client/users/{user_id}")


def test_audit_log_created_for_admin_tenant_update():
    """Updating a tenant via admin should create an audit log entry."""
    admin = admin_client()
    resp = admin.get("/api/v1/admin/tenants")
    assert_status(resp, 200, "List tenants")
    tenants = resp.json()
    if not tenants:
        pytest.skip("No tenants found")
    tenant_id = tenants[0]["id"]

    # Update tenant name temporarily
    original_name = tenants[0]["name"]
    resp = admin.put(f"/api/v1/admin/tenants/{tenant_id}", json={
        "name": f"{original_name} (audit test)",
    })
    assert_status(resp, 200, "Update tenant")

    # Check audit logs
    resp = admin.get(f"/api/v1/admin/audit-logs?action=update_tenant&tenant_id={tenant_id}&limit=5")
    assert_status(resp, 200, "Get audit logs")
    logs = resp.json()
    assert any(log.get("action") == "update_tenant" for log in logs), (
        "Audit log entry for update_tenant not found"
    )

    # Restore original name
    admin.put(f"/api/v1/admin/tenants/{tenant_id}", json={"name": original_name})


# --- Future telemetry timestamp is rejected or normalized --------------------

def test_future_telemetry_timestamp_rejected_or_normalized():
    """Telemetry with a timestamp >5min in the future should be rejected or normalized."""
    admin = admin_client()

    # Get a device
    resp = admin.get("/api/v1/devices")
    assert_status(resp, 200, "List devices")
    devices = resp.json()
    if not devices:
        pytest.skip("No devices found")
    device_id = devices[0]["id"]

    # Try to submit telemetry with a far-future timestamp via admin endpoint
    future_ts = "2099-01-01T00:00:00Z"
    resp = admin.post("/api/v1/telemetry", json={
        "device_id": device_id,
        "metric_name": "test_future_ts",
        "metric_value": 42.0,
        "timestamp": future_ts,
    })
    # Should either be rejected (4xx) or accepted with normalized timestamp
    if resp.status_code in (200, 201):
        # Accepted — check that timestamp was normalized (not 2099)
        data = resp.json()
        ts = data.get("timestamp", "")
        assert "2099" not in ts, (
            f"Future timestamp should be normalized, but got: {ts}"
        )
    else:
        # Rejected — this is also acceptable
        assert resp.status_code in (400, 422), (
            f"Unexpected status for future timestamp: {resp.status_code}: {resp.text}"
        )


# --- Firmware upload validation strips dangerous filename chars ---------------

def test_firmware_upload_strips_quotes_from_filename():
    """Firmware upload should strip quotes from the stored filename."""
    admin = admin_client()
    data = fake_firmware_bytes(256)
    version = f"safe-fn-{unique_suffix()}"

    resp = admin.upload_file(
        "/api/v1/firmware",
        file_field="file",
        file_bytes=data,
        filename='test"firmware.bin',
        extra_fields={"version": version, "target_device_type": "esp32"},
    )
    if resp.status_code != 201:
        pytest.skip(f"Firmware upload failed: {resp.status_code} {resp.text}")

    stored_name = resp.json().get("file_name", "")
    assert '"' not in stored_name, (
        f"Quotes should be stripped from filename, got: {stored_name}"
    )
    assert "'" not in stored_name, (
        f"Single quotes should be stripped from filename, got: {stored_name}"
    )
