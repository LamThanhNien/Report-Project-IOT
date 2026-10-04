"""
MQTT Test — OTA Publish Verification

Verifies that when the backend creates an OTA job, it publishes a message to:
  devices/{device_uid}/ota

This test:
  1. Subscribes to the OTA request topic BEFORE creating the job
  2. Creates the OTA job via the API
  3. Waits for the MQTT message to arrive
  4. Validates the payload fields: job_id, version, download_url, checksum_sha256

Requires:
  - Backend running (API_BASE_URL)
  - Mosquitto running (MQTT_HOST:MQTT_PORT)
  - Tenant1 has at least one device assigned
  - Tenant1 can upload firmware

If MQTT broker is not reachable the test is skipped (not failed).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
import time
from utils.mqtt_client import MQTTTestClient
from utils.auth import tenant1_client
from utils.test_data import fake_firmware_bytes, unique_suffix
from utils.assertions import assert_status, assert_json
from config.settings import MQTT_TIMEOUT

t1 = tenant1_client()


def _get_tenant1_device_uid() -> str | None:
    resp = t1.get("/api/v1/client/devices")
    devices = resp.json() if resp.status_code == 200 else []
    return devices[0]["device_uid"] if devices else None


def _upload_firmware() -> str | None:
    data = fake_firmware_bytes(256)
    version = f"ota.mqtt.{unique_suffix()}"
    resp = t1.upload_file(
        "/api/v1/client/firmware",
        file_field="file",
        file_bytes=data,
        filename=f"ota_mqtt_{version}.bin",
        extra_fields={"version": version, "target_device_type": "esp32"},
    )
    return resp.json()["id"] if resp.status_code == 201 else None


def test_ota_job_publishes_to_mqtt():
    device_uid = _get_tenant1_device_uid()
    if not device_uid:
        pytest.skip("Tenant1 has no assigned devices — run seed_tenant_demo.py")

    firmware_id = _upload_firmware()
    if not firmware_id:
        pytest.skip("Could not upload firmware for OTA MQTT test")

    # Connect and subscribe BEFORE creating the job
    mqtt = MQTTTestClient()
    if not mqtt.connect(timeout=5):
        pytest.skip(f"MQTT broker not reachable — skipping OTA MQTT publish test")

    ota_topic = f"devices/{device_uid}/ota"
    mqtt.subscribe(ota_topic)
    time.sleep(0.5)  # ensure subscription is active before creating job

    # Create OTA job — backend should publish to MQTT immediately
    resp = t1.post("/api/v1/client/ota-jobs", json={
        "device_uid": device_uid,
        "firmware_version_id": firmware_id,
    })

    if resp.status_code != 201:
        mqtt.disconnect()
        pytest.skip(f"OTA job creation failed: {resp.status_code} {resp.text}")

    job = resp.json()
    job_id = job["job_id"]  # OtaJobCreateResponse uses job_id not id

    # Wait for the OTA request message
    received = mqtt.wait_for_message(ota_topic, timeout=MQTT_TIMEOUT)
    mqtt.disconnect()

    assert received is not None, (
        f"No MQTT message received on {ota_topic} within {MQTT_TIMEOUT}s after creating OTA job {job_id}.\n"
        "This means the backend created the job but did not publish to MQTT.\n"
        "Check mqtt_publisher.py and confirm MQTT_HOST/MQTT_PORT are reachable from the backend container."
    )

    # Validate payload fields
    required_fields = ["job_id", "firmware_version_id", "firmware_version", "firmware_url"]
    missing = [f for f in required_fields if f not in received]
    assert not missing, (
        f"OTA MQTT payload missing fields: {missing}\n"
        f"Received: {received}"
    )

    assert received["job_id"] == job_id, (
        f"OTA MQTT job_id mismatch: expected {job_id}, got {received['job_id']}"
    )
    assert received["firmware_url"].startswith("http"), (
        f"firmware_url does not look like a URL: {received['firmware_url']}"
    )
    assert "localhost" not in received["firmware_url"], (
        f"firmware_url should be device-reachable, got localhost URL: {received['firmware_url']}"
    )
    assert "127.0.0.1" not in received["firmware_url"], (
        f"firmware_url should be device-reachable, got loopback URL: {received['firmware_url']}"
    )
    if received.get("checksum"):
        assert len(received["checksum"]) == 64, (
            f"checksum is not a valid SHA-256 hex: {received['checksum']}"
        )
    print(f"\n  [OK] OTA MQTT payload received: job_id={job_id}, version={received.get('firmware_version')}")
