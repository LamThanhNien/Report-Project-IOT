"""
Test 01 — Authentication

Verifies:
  - Admin login returns a Bearer token
  - Tenant login returns a Bearer token
  - Invalid credentials return 401
  - GET /api/v1/auth/me returns correct role for each user
  - Protected endpoints reject requests without a token
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from utils.api_client import ApiClient
from utils.auth import admin_client, tenant1_client, anon_client
from utils.assertions import assert_status, assert_json, assert_fields
from config.settings import ADMIN_EMAIL, TENANT1_EMAIL


def test_admin_login_ok():
    from config.settings import ADMIN_PASSWORD
    # Use _login() which caches the token so that later tests calling
    # admin_client() reuse the cached token instead of consuming another
    # rate-limit slot on the /auth/login endpoint (5/minute).
    from utils.auth import _login
    token = _login(ADMIN_EMAIL, ADMIN_PASSWORD)
    assert len(token) > 20, "Admin login should return a long token"


def test_tenant1_login_ok():
    from config.settings import TENANT1_PASSWORD
    from utils.auth import _login
    token = _login(TENANT1_EMAIL, TENANT1_PASSWORD)
    assert len(token) > 20, "Tenant1 login should return a long token"


def test_invalid_credentials_return_401():
    resp = ApiClient().post("/api/v1/auth/login", json={"email": "nobody@aifom.local", "password": "wrong"})
    assert_status(resp, 401, "Invalid login")


def test_wrong_password_returns_401():
    resp = ApiClient().post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong_password"})
    assert_status(resp, 401, "Wrong password")


def test_auth_me_admin_role():
    resp = admin_client().get("/api/v1/auth/me")
    assert_status(resp, 200, "GET /auth/me (admin)")
    data = assert_json(resp)
    assert_fields(data, "id", "email", "role")
    assert data["role"] == "admin", f"Expected role=admin, got: {data['role']}"
    assert data["email"] == ADMIN_EMAIL


def test_auth_me_tenant_role():
    resp = tenant1_client().get("/api/v1/auth/me")
    assert_status(resp, 200, "GET /auth/me (tenant)")
    data = assert_json(resp)
    assert data["role"] in ("tenant_owner", "viewer"), f"Unexpected role: {data['role']}"
    assert data["email"] == TENANT1_EMAIL


def test_protected_api_requires_token():
    resp = anon_client().get("/api/v1/devices")
    assert resp.status_code in (401, 403), (
        f"Expected 401/403 without token, got {resp.status_code}. "
        "Protected endpoints must reject unauthenticated requests."
    )


def test_invalid_token_returns_401():
    c = ApiClient()
    c.set_token("this.is.not.a.valid.jwt")
    resp = c.get("/api/v1/auth/me")
    assert resp.status_code in (401, 403), f"Expected 401/403 for invalid token, got {resp.status_code}"
