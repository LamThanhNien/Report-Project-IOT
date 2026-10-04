"""
Test 02 — Admin Tenant Management

Verifies the full demo flow:
  2. Admin can create a new tenant
  3. Admin can create a tenant owner user
  4. Admin can list tenants
  5. Admin can view tenant detail
  6. Admin can assign a device to a tenant
  7. Admin can list devices assigned to a tenant

NOTE: If any step fails with a clear error this test prints a helpful message
rather than a bare assertion failure.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from utils.auth import admin_client
from utils.assertions import assert_status, assert_json, assert_fields, assert_list, assert_uuid
from utils.test_data import test_tenant_name, test_tenant_slug, unique_suffix

admin = admin_client()


# --- Tenants -----------------------------------------------------------------

@pytest.fixture(scope="module")
def new_tenant():
    name = test_tenant_name()
    slug = test_tenant_slug()
    plans_response = admin.get("/api/v1/admin/service-plans")
    assert_status(plans_response, 200, "GET /admin/service-plans (onboarding defaults)")
    plans = assert_json(plans_response)
    plan = next((item for item in plans if item["name"] == "Pro"), plans[0] if plans else None)
    resp = admin.post("/api/v1/admin/tenants", json={
        "name": name,
        "slug": slug,
        "plan_id": plan["id"] if plan else None,
    })
    if resp.status_code == 409:
        pytest.skip("Tenant already exists — idempotency: skipping")
    assert_status(resp, 201, "POST /admin/tenants")
    data = assert_json(resp)
    assert_fields(data, "id", "name", "slug")
    return data


def test_admin_create_tenant(new_tenant):
    assert_uuid(new_tenant["id"], "tenant.id")


def test_admin_list_tenants():
    resp = admin.get("/api/v1/admin/tenants")
    assert_status(resp, 200, "GET /admin/tenants")
    data = assert_json(resp)
    assert_list(data, "tenants list")


def test_admin_get_tenant_detail(new_tenant):
    tenant_id = new_tenant["id"]
    resp = admin.get(f"/api/v1/admin/tenants/{tenant_id}")
    assert_status(resp, 200, f"GET /admin/tenants/{tenant_id}")
    data = assert_json(resp)
    assert_fields(data, "id", "name")
    assert data["id"] == tenant_id


def test_admin_create_tenant_user(new_tenant):
    tenant_id = new_tenant["id"]
    email = f"test.owner.{unique_suffix()}@aifom.local"
    resp = admin.post(f"/api/v1/admin/tenants/{tenant_id}/users", json={
        "email": email,
        "password": "Test1234!",
        "full_name": f"TEST User {unique_suffix()}",
        "role": "tenant_owner",
    })
    if resp.status_code == 409:
        pytest.skip("User already exists")
    assert_status(resp, 201, f"POST /admin/tenants/{tenant_id}/users")
    data = assert_json(resp)
    assert_fields(data, "id", "email", "role")
    assert data["email"] == email


def test_admin_list_tenant_users(new_tenant):
    tenant_id = new_tenant["id"]
    resp = admin.get(f"/api/v1/admin/tenants/{tenant_id}/users")
    assert_status(resp, 200, f"GET /admin/tenants/{tenant_id}/users")
    assert_list(assert_json(resp))


def test_admin_assign_device_to_tenant(new_tenant):
    tenant_id = new_tenant["id"]
    # Create a device first
    from utils.test_data import test_device_uid
    uid = test_device_uid()
    dev_resp = admin.post("/api/v1/devices", json={"device_uid": uid, "name": f"TEST_{uid}"})
    if dev_resp.status_code not in (201, 409):
        pytest.skip(f"Could not create device: {dev_resp.text}")
    device_id = dev_resp.json()["id"] if dev_resp.status_code == 201 else None
    if device_id is None:
        pytest.skip("Device creation returned 409, cannot determine device_id to assign")

    resp = admin.post(f"/api/v1/admin/tenants/{tenant_id}/devices", json={"device_id": device_id})
    assert resp.status_code in (201, 409), (
        f"Expected 201 (assigned) or 409 (already assigned), got {resp.status_code}: {resp.text}"
    )


def test_admin_list_tenant_devices(new_tenant):
    tenant_id = new_tenant["id"]
    resp = admin.get(f"/api/v1/admin/tenants/{tenant_id}/devices")
    assert_status(resp, 200, f"GET /admin/tenants/{tenant_id}/devices")
    assert_list(assert_json(resp))
