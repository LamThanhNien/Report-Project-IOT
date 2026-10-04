import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import json
import threading
import time
import paho.mqtt.client as mqtt
from config.settings import MQTT_HOST, MQTT_PORT, MQTT_TIMEOUT


class MQTTTestClient:
    """Lightweight MQTT client for integration tests."""

    def __init__(self, host: str = MQTT_HOST, port: int = MQTT_PORT, username: str = "", password: str = ""):
        self.host = host
        self.port = port
        self._client = mqtt.Client(client_id=f"aifom-tester-{os.getpid()}")
        if username:
            self._client.username_pw_set(username, password)
        self._received: list[tuple[str, dict]] = []
        self._lock = threading.Lock()
        self._connected = threading.Event()

        self._client.on_connect = self._on_connect
        self._client.on_message = self._on_message

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self._connected.set()

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
        except Exception:
            payload = {"_raw": msg.payload.decode()}
        with self._lock:
            self._received.append((msg.topic, payload))

    def connect(self, timeout: int = MQTT_TIMEOUT) -> bool:
        self._client.connect(self.host, self.port, keepalive=60)
        self._client.loop_start()
        return self._connected.wait(timeout=timeout)

    def disconnect(self):
        self._client.loop_stop()
        self._client.disconnect()

    def subscribe(self, topic: str, qos: int = 0):
        self._client.subscribe(topic, qos)

    def publish(self, topic: str, payload: dict, qos: int = 0):
        self._client.publish(topic, json.dumps(payload), qos=qos)

    def wait_for_message(self, topic_prefix: str, timeout: int = MQTT_TIMEOUT) -> dict | None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            with self._lock:
                for t, p in self._received:
                    if t.startswith(topic_prefix) or t == topic_prefix:
                        return p
            time.sleep(0.2)
        return None

    def clear(self):
        with self._lock:
            self._received.clear()
