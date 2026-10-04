"""Integration checks for operational device alerts in the reduced scope."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from utils.assertions import assert_json, assert_status
from utils.auth import tenant1_client


def test_client_alerts_endpoint():
    response = tenant1_client().get("/api/v1/client/alerts")
    assert_status(response, 200, "GET /client/alerts")
    assert isinstance(assert_json(response), list)
