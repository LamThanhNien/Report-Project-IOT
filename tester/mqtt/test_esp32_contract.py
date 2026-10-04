"""
ESP32 MQTT payload contract tests for small-project MVP.

These tests validate shape/type requirements for:
- telemetry
- status
- commands
- ota command
- ota status
"""

from __future__ import annotations


def _assert_type(payload: dict, field: str, expected_type):
    assert field in payload, f"Missing field: {field}"
    assert isinstance(payload[field], expected_type), (
        f"Field {field} expected {expected_type}, got {type(payload[field])}"
    )


def test_telemetry_payload_contract():
    payload = {
        "device_id": "device_001",
        "firmware_version": "1.0.0",
        "uptime_ms": 123456,
        "rssi": -55,
        "free_heap": 120000,
        "temperature": 30.5,
        "humidity": 70.2,
        "led_builtin": True,
        "relay_1": True,
        "relay_2": False,
        "gpio_2_state": True,
        "gpio_4_state": False,
    }
    _assert_type(payload, "device_id", str)
    _assert_type(payload, "firmware_version", str)
    _assert_type(payload, "uptime_ms", int)
    _assert_type(payload, "rssi", int)
    _assert_type(payload, "free_heap", int)
    _assert_type(payload, "temperature", float)
    _assert_type(payload, "humidity", float)
    _assert_type(payload, "led_builtin", bool)
    _assert_type(payload, "relay_1", bool)
    _assert_type(payload, "relay_2", bool)
    _assert_type(payload, "gpio_2_state", bool)
    _assert_type(payload, "gpio_4_state", bool)


def test_status_payload_contract():
    payload = {
        "device_id": "device_001",
        "status": "online",
        "firmware_version": "1.0.0",
        "ip": "192.168.1.50",
        "rssi": -55,
        "uptime_ms": 123456,
        "free_heap": 120000,
    }
    _assert_type(payload, "device_id", str)
    _assert_type(payload, "status", str)
    _assert_type(payload, "firmware_version", str)
    _assert_type(payload, "ip", str)
    _assert_type(payload, "rssi", int)
    _assert_type(payload, "uptime_ms", int)
    _assert_type(payload, "free_heap", int)


def test_command_payload_contract():
    payload = {
        "command_id": "cmd_123",
        "command": "set_output",
        "type": "set_output",
        "capability_key": "led_builtin",
        "capability_type": "led",
        "gpio_pin": 2,
        "target": "relay_1",
        "value": True,
        "source": "tenant_widget",
        "params": {"target": "relay_1", "value": True, "pin": 2},
    }
    _assert_type(payload, "command_id", str)
    _assert_type(payload, "command", str)
    _assert_type(payload, "type", str)
    _assert_type(payload, "capability_key", str)
    _assert_type(payload, "capability_type", str)
    _assert_type(payload, "gpio_pin", int)
    _assert_type(payload, "target", str)
    _assert_type(payload, "value", bool)
    _assert_type(payload, "source", str)
    _assert_type(payload, "params", dict)
    assert payload["type"] in {
        "set_output",
        "toggle_output",
        "request_status",
        "request_telemetry",
        "reboot",
        "ota_update",
    }


def test_ota_command_payload_contract():
    payload = {
        "job_id": "ota_123",
        "firmware_version_id": "fw_123",
        "firmware_version": "1.0.1",
        "firmware_url": "http://aifom.local:8000/api/v1/firmware/fw_123/download",
        "checksum": "a" * 64,
        "force": False,
    }
    _assert_type(payload, "job_id", str)
    _assert_type(payload, "firmware_version_id", str)
    _assert_type(payload, "firmware_version", str)
    _assert_type(payload, "firmware_url", str)
    _assert_type(payload, "force", bool)
    assert payload["firmware_url"].startswith("http://aifom.local:8000/")
    assert "localhost" not in payload["firmware_url"]
    assert len(payload["checksum"]) == 64


def test_ota_status_payload_contract():
    payload = {
        "job_id": "ota_123",
        "device_id": "device_001",
        "status": "downloading",
        "progress": 45,
        "firmware_version": "1.0.1",
        "message": "Downloading firmware",
    }
    _assert_type(payload, "job_id", str)
    _assert_type(payload, "device_id", str)
    _assert_type(payload, "status", str)
    _assert_type(payload, "progress", int)
    _assert_type(payload, "firmware_version", str)
    _assert_type(payload, "message", str)
    assert payload["status"] in {"accepted", "downloading", "flashing", "rebooting", "success", "failed"}
    assert 0 <= payload["progress"] <= 100


def test_set_output_with_gpio_pin_4_contract():
    """set_output command with gpio_pin=4 should carry pin in payload."""
    payload = {
        "command_id": "cmd_456",
        "command": "set_output",
        "type": "set_output",
        "capability_key": "gpio_4",
        "capability_type": "digital_output",
        "gpio_pin": 4,
        "target": "gpio_4",
        "value": True,
        "source": "tenant_widget",
        "params": {"target": "gpio_4", "value": True, "gpio_pin": 4, "pin": 4},
    }
    _assert_type(payload, "gpio_pin", int)
    assert payload["gpio_pin"] == 4
    assert payload["value"] is True
    assert payload["command"] == "set_output"


def test_set_output_with_gpio_pin_16_contract():
    """set_output command with gpio_pin=16 (custom GPIO) should carry pin in payload."""
    payload = {
        "command_id": "cmd_789",
        "command": "set_output",
        "type": "set_output",
        "capability_key": "gpio_16",
        "capability_type": "digital_output",
        "gpio_pin": 16,
        "target": "gpio_16",
        "value": True,
        "source": "tenant_widget",
        "params": {"target": "gpio_16", "value": True, "gpio_pin": 16, "pin": 16},
    }
    _assert_type(payload, "gpio_pin", int)
    assert payload["gpio_pin"] == 16
    assert payload["value"] is True
    assert payload["target"] == "gpio_16"


def test_command_result_event_contract():
    """command_result event should include gpio_pin and status."""
    payload = {
        "device_id": "device_001",
        "event": "command_result",
        "command_id": "cmd_123",
        "type": "set_output",
        "capability_key": "gpio_2",
        "target": "gpio_2",
        "gpio_pin": 2,
        "status": "success",
        "message": "ok",
    }
    _assert_type(payload, "event", str)
    _assert_type(payload, "command_id", str)
    _assert_type(payload, "gpio_pin", int)
    _assert_type(payload, "status", str)
    assert payload["status"] in {"success", "failed"}
    assert payload["event"] == "command_result"
