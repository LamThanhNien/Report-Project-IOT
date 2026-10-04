import json
import socket
import time
import uuid

import paho.mqtt.client as mqtt
import pytest
from paho.mqtt.enums import CallbackAPIVersion

HOST = "localhost"
PORT = 18885

pytestmark = pytest.mark.integration


def is_broker_listening(host=HOST, port=PORT):
    try:
        with socket.create_connection((host, port), timeout=1.0):
            return True
    except OSError:
        return False


if not is_broker_listening():
    pytest.skip("MQTT ACL test broker is not running on localhost:18885", allow_module_level=True)


def _connect(username, password):
    client = mqtt.Client(callback_api_version=CallbackAPIVersion.VERSION2, protocol=mqtt.MQTTv5)
    client.username_pw_set(username, password)

    # Store received messages and subscription results on the client object
    client.received_messages = []
    client.sub_results = {}  # mid -> reason_code

    def on_message(c, userdata, message):
        try:
            payload = message.payload.decode("utf-8")
            client.received_messages.append({"topic": message.topic, "payload": payload})
        except Exception:
            pass

    def on_subscribe(c, userdata, mid, reason_codes, properties=None):
        for rc in reason_codes:
            client.sub_results[mid] = rc.value

    client.on_message = on_message
    client.on_subscribe = on_subscribe

    client.connect(HOST, PORT, 5)
    client.loop_start()
    return client


@pytest.fixture(scope="function")
def clients():
    dev_a = _connect("device-a", "pw-a")
    dev_b = _connect("device-b", "pw-b")
    backend = _connect("aifom_backend", "backend-pw")
    yield dev_a, dev_b, backend
    dev_a.disconnect()
    dev_a.loop_stop()
    dev_b.disconnect()
    dev_b.loop_stop()
    backend.disconnect()
    backend.loop_stop()


# ---------- Positive tests ----------


def test_device_a_can_publish_telemetry(clients):
    dev_a, _, backend = clients
    msg_id = str(uuid.uuid4())
    payload = json.dumps({"t": 1, "msg_id": msg_id})

    backend.subscribe("devices/device-a/telemetry")
    time.sleep(0.1)

    dev_a.publish("devices/device-a/telemetry", payload, qos=1)
    time.sleep(0.3)

    received = [m for m in backend.received_messages if msg_id in m["payload"]]
    assert len(received) == 1
    assert received[0]["topic"] == "devices/device-a/telemetry"


def test_device_a_can_publish_status(clients):
    dev_a, _, backend = clients
    msg_id = str(uuid.uuid4())
    payload = json.dumps({"status": "online", "msg_id": msg_id})

    backend.subscribe("devices/device-a/status")
    time.sleep(0.1)

    dev_a.publish("devices/device-a/status", payload, qos=1)
    time.sleep(0.3)

    received = [m for m in backend.received_messages if msg_id in m["payload"]]
    assert len(received) == 1
    assert received[0]["topic"] == "devices/device-a/status"


def test_device_a_can_subscribe_own_commands(clients):
    dev_a, _, backend = clients
    msg_id = str(uuid.uuid4())
    payload = json.dumps({"cmd": "reboot", "msg_id": msg_id})

    dev_a.subscribe("devices/device-a/commands")
    time.sleep(0.1)

    backend.publish("devices/device-a/commands", payload, qos=1)
    time.sleep(0.3)

    received = [m for m in dev_a.received_messages if msg_id in m["payload"]]
    assert len(received) == 1
    assert received[0]["topic"] == "devices/device-a/commands"


def test_backend_can_subscribe_all_telemetry(clients):
    dev_a, _, backend = clients
    msg_id = str(uuid.uuid4())
    payload = json.dumps({"t": 2, "msg_id": msg_id})

    backend.subscribe("devices/+/telemetry")
    time.sleep(0.1)

    dev_a.publish("devices/device-a/telemetry", payload, qos=1)
    time.sleep(0.3)

    received = [m for m in backend.received_messages if msg_id in m["payload"]]
    assert len(received) == 1
    assert received[0]["topic"] == "devices/device-a/telemetry"


def test_backend_can_publish_command_to_device_a(clients):
    dev_a, _, backend = clients
    msg_id = str(uuid.uuid4())
    payload = json.dumps({"cmd": "ota", "msg_id": msg_id})

    dev_a.subscribe("devices/device-a/commands")
    time.sleep(0.1)

    backend.publish("devices/device-a/commands", payload, qos=1)
    time.sleep(0.3)

    received = [m for m in dev_a.received_messages if msg_id in m["payload"]]
    assert len(received) == 1


# ---------- Negative tests ----------


def test_device_a_cannot_publish_device_b_telemetry(clients):
    dev_a, _, backend = clients
    msg_id = str(uuid.uuid4())
    payload = json.dumps({"t": 3, "msg_id": msg_id})

    backend.subscribe("devices/device-b/telemetry")
    time.sleep(0.1)

    dev_a.publish("devices/device-b/telemetry", payload, qos=1)
    time.sleep(0.3)

    received = [m for m in backend.received_messages if msg_id in m["payload"]]
    assert len(received) == 0


def test_device_a_cannot_subscribe_device_b_commands(clients):
    dev_a, _, backend = clients
    msg_id = str(uuid.uuid4())
    payload = json.dumps({"cmd": "exploit", "msg_id": msg_id})

    res, mid = dev_a.subscribe("devices/device-b/commands")
    time.sleep(0.3)
    assert mid in dev_a.sub_results
    assert dev_a.sub_results[mid] in (128, 0, 1, 2)

    backend.publish("devices/device-b/commands", payload, qos=1)
    time.sleep(0.3)

    received = [m for m in dev_a.received_messages if msg_id in m["payload"]]
    assert len(received) == 0


def test_device_a_cannot_publish_unknown_telemetry(clients):
    dev_a, _, backend = clients
    msg_id = str(uuid.uuid4())
    payload = json.dumps({"t": 4, "msg_id": msg_id})

    backend.subscribe("devices/+/telemetry")
    time.sleep(0.1)

    dev_a.publish("devices/unknown/telemetry", payload, qos=1)
    time.sleep(0.3)

    received = [m for m in backend.received_messages if msg_id in m["payload"]]
    assert len(received) == 0


def test_anonymous_connect_fails():
    client = mqtt.Client(callback_api_version=CallbackAPIVersion.VERSION2)
    failed = False
    try:
        client.connect(HOST, PORT, timeout=2)
        client.loop_start()
        time.sleep(0.3)
        if not client.is_connected():
            failed = True
        client.loop_stop()
        client.disconnect()
    except (ConnectionError, OSError, Exception):
        failed = True
    assert failed


def test_aifom_device_connect_fails():
    client = mqtt.Client(callback_api_version=CallbackAPIVersion.VERSION2)
    client.username_pw_set("aifom_device", "demo")
    failed = False
    try:
        client.connect(HOST, PORT, timeout=2)
        client.loop_start()
        time.sleep(0.3)
        if not client.is_connected():
            failed = True
        client.loop_stop()
        client.disconnect()
    except (ConnectionError, OSError, Exception):
        failed = True
    assert failed


def test_device_a_cannot_subscribe_sys(clients):
    dev_a, _, _ = clients
    res, mid = dev_a.subscribe("$SYS/#")
    time.sleep(0.3)
    assert mid in dev_a.sub_results
    assert dev_a.sub_results[mid] in (128, 0, 1, 2)
    # Verify that no $SYS messages were received by dev_a
    sys_msgs = [m for m in dev_a.received_messages if m["topic"].startswith("$SYS")]
    assert len(sys_msgs) == 0


def test_device_a_cannot_read_device_b_ota(clients):
    dev_a, _, backend = clients
    msg_id = str(uuid.uuid4())
    payload = json.dumps({"ota_url": "http://evil.com", "msg_id": msg_id})

    res, mid = dev_a.subscribe("devices/device-b/ota")
    time.sleep(0.3)
    assert mid in dev_a.sub_results
    assert dev_a.sub_results[mid] in (128, 0, 1, 2)

    backend.publish("devices/device-b/ota", payload, qos=1)
    time.sleep(0.3)

    received = [m for m in dev_a.received_messages if msg_id in m["payload"]]
    assert len(received) == 0
