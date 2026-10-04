import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from utils.api_client import ApiClient
from config.settings import (
    ADMIN_EMAIL, ADMIN_PASSWORD,
    TENANT1_EMAIL, TENANT1_PASSWORD,
    TENANT2_EMAIL, TENANT2_PASSWORD,
)

_token_cache: dict[str, str] = {}


def _login(email: str, password: str) -> str:
    if email in _token_cache:
        return _token_cache[email]
    if not password:
        raise RuntimeError(
            f"Password for {email} is not set. "
            "Create tester/.env from tester/.env.example and set the required passwords."
        )
    client = ApiClient()
    resp = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    if resp.status_code != 200:
        raise RuntimeError(
            f"Login failed for {email}: {resp.status_code} {resp.text}\n"
            "Make sure the backend is running and seed scripts have been executed:\n"
            "  cd tester\n"
            "  seed_test_data.bat"
        )
    token = resp.json()["access_token"]
    _token_cache[email] = token
    return token


def admin_token() -> str:
    return _login(ADMIN_EMAIL, ADMIN_PASSWORD)


def tenant1_token() -> str:
    return _login(TENANT1_EMAIL, TENANT1_PASSWORD)


def tenant2_token() -> str:
    return _login(TENANT2_EMAIL, TENANT2_PASSWORD)


def admin_client() -> ApiClient:
    c = ApiClient()
    c.set_token(admin_token())
    return c


def tenant1_client() -> ApiClient:
    c = ApiClient()
    c.set_token(tenant1_token())
    return c


def tenant2_client() -> ApiClient:
    c = ApiClient()
    c.set_token(tenant2_token())
    return c


def anon_client() -> ApiClient:
    return ApiClient()
