"""
MQTT Test — Connection

Verifies:
  - Can connect to the Mosquitto broker
  - Can publish a message
  - Can subscribe and receive a loopback message

Requires Mosquitto running on MQTT_HOST:MQTT_PORT (default localhost:1883).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
import json
import time
from utils.mqtt_client import MQTTTestClient
from config.settings import MQTT_HOST, MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD

# Use a topic the backend ACL user has readwrite access to
LOOPBACK_TOPIC = "aifom/devices/test_loopback/telemetry"


def _make_client():
    """Create an authenticated MQTT test client."""
    return MQTTTestClient(username=MQTT_USERNAME, password=MQTT_PASSWORD)


def test_mqtt_broker_reachable():
    client = _make_client()
    connected = client.connect(timeout=5)
    client.disconnect()
    assert connected, (
        f"Could not connect to MQTT broker at {MQTT_HOST}:{MQTT_PORT}.\n"
        "Make sure Mosquitto is running:\n"
        "  docker compose -f infrastructure/docker-compose.dev.yml up mosquitto -d"
    )


def test_mqtt_publish_and_subscribe():
    client = _make_client()
    connected = client.connect(timeout=5)
    if not connected:
        pytest.skip(f"MQTT broker not reachable at {MQTT_HOST}:{MQTT_PORT}")

    client.subscribe(LOOPBACK_TOPIC)
    time.sleep(0.3)  # wait for subscription to be active

    payload = {"test": "loopback", "ts": time.time()}
    client.publish(LOOPBACK_TOPIC, payload)

    received = client.wait_for_message(LOOPBACK_TOPIC, timeout=5)
    client.disconnect()

    assert received is not None, "No message received on loopback topic within 5 seconds"
    assert received.get("test") == "loopback", f"Unexpected loopback payload: {received}"


def test_mqtt_device_telemetry_topic_publish():
    """Publish a fake telemetry payload to a device topic (no response expected)."""
    client = _make_client()
    if not client.connect(timeout=5):
        pytest.skip("MQTT broker not reachable")

    topic = "devices/TEST_esp32_000/telemetry"
    payload = {"metrics": {"temperature": 28.0, "humidity": 65.0}}
    client.publish(topic, payload)
    client.disconnect()
    # No assertion needed — just verifying publish does not raise an exception


def test_mqtt_device_status_topic_publish():
    """Publish a fake status update to a device topic."""
    client = _make_client()
    if not client.connect(timeout=5):
        pytest.skip("MQTT broker not reachable")

    topic = "devices/TEST_esp32_000/status"
    payload = {"status": "online"}
    client.publish(topic, payload)
    client.disconnect()
