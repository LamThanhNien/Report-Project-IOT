"""Regression contracts for the reduced IoT platform scope."""

from app.main import app
from app.shared.infrastructure.messaging.mqtt_topics import parse_device_topic


def test_removed_feature_endpoints_are_not_registered() -> None:
    paths = set(app.openapi()["paths"])
    assert not any(
        fragment in path
        for path in paths
        for fragment in (
            "/anomaly",
            "/tinyml",
            "/api-docs",
            "/health-score",
            "/ai-events",
            "/public/",
            "/widgets",
            "/pages",
            "/used-gpio",
        )
    )
    assert set(app.openapi()["paths"]["/api/v1/admin/service-plans"]) == {"get"}


def test_operational_feature_endpoints_remain_registered() -> None:
    paths = set(app.openapi()["paths"])
    for path in (
        "/api/v1/client/devices",
        "/api/v1/client/features",
        "/api/v1/client/projects",
        "/api/v1/client/datastreams",
        "/api/v1/client/devices/{device_id}/commands",
        "/api/v1/client/automation/rules",
        "/api/v1/client/commands/templates",
        "/api/v1/client/firmware",
        "/api/v1/client/ota-jobs",
    ):
        assert path in paths, path


def test_mqtt_topic_parser_ignores_removed_ml_contracts() -> None:
    assert parse_device_topic("devices/node-1/ml/status") is None
    assert parse_device_topic("devices/node-1/ml/deploy/ack") is None
    assert parse_device_topic("aifom/tenants/t-1/devices/node-1/ml/inference") is None
    assert parse_device_topic("devices/node-1/telemetry") == ("node-1", "telemetry")
    assert parse_device_topic("devices/node-1/ota/status") == ("node-1", "ota_status")
