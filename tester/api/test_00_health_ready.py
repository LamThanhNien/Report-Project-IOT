"""
Test 00 — Health & Readiness

Verifies:
  GET /health → 200 {"status": "ok"}
  GET /ready  → 200 {"status": "ready"} (backend uses "ready" not "ok" for this endpoint)

These must pass before any other test group is meaningful.
If these fail the backend is not running or not reachable.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from utils.api_client import ApiClient
from utils.assertions import assert_status, assert_json

client = ApiClient()


def test_health():
    resp = client.get("/health")
    assert_status(resp, 200, "GET /health")
    data = assert_json(resp)
    assert data.get("status") == "ok", f"Expected status=ok, got: {data}"


def test_ready():
    resp = client.get("/ready")
    assert_status(resp, 200, "GET /ready")
    data = assert_json(resp)
    # Backend returns {"status": "ready"} for /ready (distinct from "ok" in /health)
    assert data.get("status") in ("ok", "ready"), (
        f"Expected status=ok or ready, got: {data}"
    )
