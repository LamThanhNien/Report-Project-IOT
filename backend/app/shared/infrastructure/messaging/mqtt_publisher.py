"""Canonical MQTT publisher helpers.

All three publishers follow the same contract:
- The caller's ``payload`` dict is NEVER mutated (a copy is always made).
- Correlation metadata is injected from the validated ContextVar value.
- If no valid context exists, a background operation ID is generated.
- An invalid caller-supplied ``correlation_id`` inside the payload is
  replaced with the validated ContextVar value or a fresh op-ID.
- Nested ``metadata`` structures are deep-copied before modification.

Firmware / ESP32 compatibility:
- New ``correlation_id`` field is added only when absent.
- No existing fields are renamed or removed.
- Unknown consumer metadata fields do not break existing consumers.
"""

import json
import logging
import ssl
import threading
import time

import paho.mqtt.client as mqtt
import paho.mqtt.publish as paho_publish

from app.core.config import settings
from app.core.correlation import is_valid_correlation_id
from app.core.logging import get_correlation_id
from app.services import mqtt_topics

logger = logging.getLogger(__name__)


class MqttPublisherClient:
    """Persistent singleton MQTT client manager for high-throughput publishing.

    Reuses an open TCP connection to Mosquitto, avoiding TCP connect/disconnect
    overhead per published message. Falls back to paho_publish.single() / multiple()
    if disconnected or if publishing encounters an error.
    """

    def __init__(self) -> None:
        self._client: mqtt.Client | None = None
        self._connected = False
        self._running = False
        self._lock = threading.Lock()

    @property
    def is_connected(self) -> bool:
        return self._connected and self._client is not None

    def start(self) -> None:
        with self._lock:
            if self._running:
                return
            self._running = True
            client_id = f"{settings.mqtt_client_id}-publisher"
            client = mqtt.Client(
                client_id=client_id,
                protocol=mqtt.MQTTv311,
                clean_session=True,
            )
            if settings.mqtt_username:
                client.username_pw_set(settings.mqtt_username, settings.mqtt_password)
            if settings.mqtt_tls_enabled:
                client.tls_set(
                    ca_certs=settings.mqtt_tls_ca_cert,
                    certfile=settings.mqtt_tls_certfile,
                    keyfile=settings.mqtt_tls_keyfile,
                    cert_reqs=ssl.CERT_NONE if settings.mqtt_tls_insecure else ssl.CERT_REQUIRED,
                    tls_version=ssl.PROTOCOL_TLS_CLIENT,
                )
                client.tls_insecure_set(settings.mqtt_tls_insecure)

            client.on_connect = self._on_connect
            client.on_disconnect = self._on_disconnect
            client.reconnect_delay_set(min_delay=1, max_delay=30)
            self._client = client
            self._client.loop_start()

            t = threading.Thread(
                target=self._connect_loop, daemon=True, name="mqtt-publisher-connect"
            )
            t.start()

    def _connect_loop(self) -> None:
        delay = 2
        while self._running and self._client is not None:
            try:
                self._client.connect(settings.mqtt_host, settings.mqtt_port, keepalive=60)
                logger.info(
                    "Persistent MQTT publisher connection initiated host=%s port=%s",
                    settings.mqtt_host,
                    settings.mqtt_port,
                )
                return
            except Exception as exc:
                logger.warning(
                    "Persistent MQTT publisher connect attempt failed: %s -- retrying in %ds",
                    exc,
                    delay,
                )
                time.sleep(delay)
                delay = min(delay * 2, 30)

    def stop(self) -> None:
        with self._lock:
            if not self._running:
                return
            self._running = False
            self._connected = False
            if self._client is not None:
                try:
                    self._client.loop_stop()
                    self._client.disconnect()
                except Exception:
                    logger.exception(
                        "Failed to disconnect persistent MQTT publisher client cleanly"
                    )
                finally:
                    self._client = None
            logger.info("Persistent MQTT publisher client stopped")

    def _on_connect(self, client: mqtt.Client, userdata, flags, rc: int) -> None:
        if rc == 0:
            self._connected = True
            logger.info("Persistent MQTT publisher connected successfully rc=%s", rc)
        else:
            self._connected = False
            logger.error("Persistent MQTT publisher connect failed rc=%s", rc)

    def _on_disconnect(self, client: mqtt.Client, userdata, rc: int) -> None:
        self._connected = False
        if rc == 0:
            logger.info("Persistent MQTT publisher disconnected cleanly")
        else:
            logger.warning(
                "Persistent MQTT publisher disconnected unexpectedly rc=%s -- paho will reconnect",
                rc,
            )

    def publish(
        self, topic: str, payload: str | bytes, qos: int = 1, retain: bool = False
    ) -> bool:
        """Publish a message using the persistent client if connected, returning True if successful."""
        if not self.is_connected or self._client is None:
            return False
        try:
            info = self._client.publish(topic, payload=payload, qos=qos, retain=retain)
            if info.rc == mqtt.MQTT_ERR_SUCCESS:
                return True
            logger.warning(
                "Persistent MQTT publisher publish returned rc=%d for topic=%s, falling back",
                info.rc,
                topic,
            )
            return False
        except Exception as exc:
            logger.warning(
                "Persistent MQTT publisher publish error: %s for topic=%s, falling back",
                exc,
                topic,
            )
            return False

    def publish_multiple(self, msgs: list[dict]) -> bool:
        """Publish multiple messages using the persistent client if connected."""
        if not self.is_connected or self._client is None:
            return False
        try:
            for msg in msgs:
                info = self._client.publish(
                    msg["topic"],
                    payload=msg.get("payload"),
                    qos=msg.get("qos", 1),
                    retain=msg.get("retain", False),
                )
                if info.rc != mqtt.MQTT_ERR_SUCCESS:
                    logger.warning(
                        "Persistent MQTT publisher publish_multiple item returned rc=%d for topic=%s",
                        info.rc,
                        msg.get("topic"),
                    )
                    return False
            return True
        except Exception as exc:
            logger.warning(
                "Persistent MQTT publisher publish_multiple error: %s, falling back", exc
            )
            return False


_persistent_client = MqttPublisherClient()


def get_persistent_mqtt_client() -> MqttPublisherClient:
    """Return the singleton MqttPublisherClient instance."""
    return _persistent_client


def _validated_correlation_id() -> str:
    """Return the current validated correlation ID or a background op-ID.

    Policy:
    - If the ContextVar holds a valid ID (set by HTTP middleware), use it.
    - Otherwise generate a background op-ID. Never propagate an invalid value.
    """
    from app.core.background_context import new_operation_id

    corr_id = get_correlation_id()
    if is_valid_correlation_id(corr_id):
        return corr_id
    return new_operation_id()


def _inject_correlation_id(payload: dict) -> dict:
    """Return a shallow copy of *payload* with a validated ``correlation_id``.

    - Always returns a new dict (never mutates the argument).
    - The existing ``correlation_id`` field, if any, is validated and replaced
      with the canonical ContextVar value (not trusted as-is from callers).
    - Source is tracked for metrics.
    """
    from app.core.metrics import MQTT_PUBLISH_CORRELATION

    corr_id = _validated_correlation_id()

    # Shallow copy is sufficient — nested values are not modified here.
    result = dict(payload)

    existing = result.get("correlation_id")
    if isinstance(existing, str) and is_valid_correlation_id(existing):
        # Existing value is valid — but we still prefer the ContextVar to
        # ensure consistency across the HTTP→MQTT boundary.
        source = "propagated"
    else:
        source = "generated"

    result["correlation_id"] = corr_id
    MQTT_PUBLISH_CORRELATION.labels(source=source).inc()
    return result


def _tls_params() -> dict | None:
    if not settings.mqtt_tls_enabled:
        return None
    return {
        "ca_certs": settings.mqtt_tls_ca_cert,
        "certfile": settings.mqtt_tls_certfile,
        "keyfile": settings.mqtt_tls_keyfile,
        "cert_reqs": ssl.CERT_NONE if settings.mqtt_tls_insecure else ssl.CERT_REQUIRED,
        "tls_version": ssl.PROTOCOL_TLS_CLIENT,
    }


def publish_ota_request(device_uid: str, payload: dict) -> None:
    """Publish an OTA request to ``devices/{device_uid}/ota``.

    Uses persistent client if connected, falling back to single-shot publish.
    The caller's ``payload`` is not mutated.
    """
    topic = mqtt_topics.ota_topic(device_uid)
    auth = None
    if settings.mqtt_username:
        auth = {"username": settings.mqtt_username, "password": settings.mqtt_password or ""}

    enriched = _inject_correlation_id(payload)
    payload_str = json.dumps(enriched)

    client = get_persistent_mqtt_client()
    if not client.publish(topic, payload=payload_str, qos=1, retain=False):
        paho_publish.single(
            topic,
            payload=payload_str,
            qos=1,
            retain=False,
            hostname=settings.mqtt_host,
            port=settings.mqtt_port,
            client_id=f"{settings.mqtt_client_id}-pub",
            auth=auth,
            tls=_tls_params(),
            keepalive=10,
        )
    logger.info("OTA request published topic=%s job_id=%s", topic, enriched.get("job_id"))


def publish_channel_command(device_uid: str, channel: str, value: str | int) -> None:
    """Publish raw string/integer payload to devices/{device_uid}/commands/ch_{channel}."""
    topic = mqtt_topics.commands_channel_topic(device_uid, channel)
    auth = None
    if settings.mqtt_username:
        auth = {"username": settings.mqtt_username, "password": settings.mqtt_password or ""}

    payload_str = str(value)

    client = get_persistent_mqtt_client()
    if not client.publish(topic, payload=payload_str, qos=1, retain=False):
        paho_publish.single(
            topic,
            payload=payload_str,
            qos=1,
            retain=False,
            hostname=settings.mqtt_host,
            port=settings.mqtt_port,
            client_id=f"{settings.mqtt_client_id}-chan-pub",
            auth=auth,
            tls=_tls_params(),
            keepalive=10,
        )
    logger.info("Channel command published topic=%s payload=%s", topic, payload_str)


def publish_device_command(device_uid: str, payload: dict) -> None:
    """Publish a tenant-scoped device command.

    The frontend never talks to MQTT directly; API handlers call this only after
    tenant ownership and command capability validation.

    The caller's ``payload`` is not mutated.
    """
    # Check if this is a virtual channel write command
    target = payload.get("target")
    params = payload.get("params") or {}
    channel = None
    if isinstance(target, str) and target.startswith("ch_"):
        channel = target[3:]
    elif isinstance(target, str) and target.startswith("gpio_"):
        channel = target[5:]
    elif payload.get("command") == "virtual_write" and isinstance(target, str):
        channel = target
    elif isinstance(params.get("channel"), str):
        chan_str = params["channel"]
        if chan_str.startswith("ch_"):
            channel = chan_str[3:]
        else:
            channel = chan_str

    if channel:
        val = payload.get("value")
        if val is None:
            val = params.get("value")
        if val is None and isinstance(params.get("state"), bool):
            val = params.get("state")

        if val is not None:
            if isinstance(val, bool):
                val_str = "1" if val else "0"
            else:
                val_str = str(val)

            publish_channel_command(device_uid, channel, val_str)
            return

    topic = mqtt_topics.commands_topic(device_uid)
    auth = None
    if settings.mqtt_username:
        auth = {"username": settings.mqtt_username, "password": settings.mqtt_password or ""}

    enriched = _inject_correlation_id(payload)
    payload_str = json.dumps(enriched)

    client = get_persistent_mqtt_client()
    if not client.publish(topic, payload=payload_str, qos=1, retain=False):
        paho_publish.single(
            topic,
            payload=payload_str,
            qos=1,
            retain=False,
            hostname=settings.mqtt_host,
            port=settings.mqtt_port,
            client_id=f"{settings.mqtt_client_id}-cmd-pub",
            auth=auth,
            tls=_tls_params(),
            keepalive=10,
        )
    logger.info(
        "Device command published topic=%s command_id=%s",
        topic,
        enriched.get("command_id") or enriched.get("request_id"),
    )




def publish_custom_topic(topic: str, payload: dict | str) -> None:
    """Publish a custom payload to an arbitrary topic."""
    auth = None
    if settings.mqtt_username:
        auth = {"username": settings.mqtt_username, "password": settings.mqtt_password or ""}

    payload_str = json.dumps(payload) if isinstance(payload, dict) else str(payload)

    client = get_persistent_mqtt_client()
    if not client.publish(topic, payload=payload_str, qos=1, retain=False):
        paho_publish.single(
            topic,
            payload=payload_str,
            qos=1,
            retain=False,
            hostname=settings.mqtt_host,
            port=settings.mqtt_port,
            client_id=f"{settings.mqtt_client_id}-custom-pub",
            auth=auth,
            tls=_tls_params(),
            keepalive=10,
        )
    logger.info("Custom topic published topic=%s payload_size=%d", topic, len(payload_str))
