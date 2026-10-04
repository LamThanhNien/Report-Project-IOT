import json
import logging
import queue
import ssl
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import paho.mqtt.client as mqtt
from sqlalchemy import select

from app.core.config import settings
from app.core.metrics import MQTT_MESSAGES, OTA_JOBS_BY_STATUS, TELEMETRY_INGESTED
from app.db.session import SessionLocal
from app.modules.devices import repository as device_repository
from app.modules.ota import repository as ota_repository
from app.modules.telemetry import repository as telemetry_repository
from app.services import mqtt_topics
from app.shared.infrastructure.messaging.device_status_events import (
    DeviceStatusEvent,
    device_status_bus,
)

logger = logging.getLogger(__name__)

TOPIC_TELEMETRY = "devices/+/telemetry"
TOPIC_TELEMETRY_CHANNEL = "devices/+/telemetry/+"
TOPIC_STATUS = "devices/+/status"
TOPIC_HEARTBEAT = "devices/+/heartbeat"
TOPIC_EVENTS = "devices/+/events"
TOPIC_OTA_STATUS = "devices/+/ota/status"

# Legacy subscriptions for compatibility with existing firmware.
TOPIC_LEGACY_TELEMETRY = "aifom/devices/+/telemetry"
TOPIC_LEGACY_STATUS = "aifom/devices/+/status"
TOPIC_LEGACY_HEARTBEAT = "aifom/devices/+/heartbeat"
TOPIC_LEGACY_OTA_RESULT = "aifom/devices/+/ota/result"

_RETRY_INITIAL_DELAY = 3  # seconds before first retry
_RETRY_MAX_DELAY = 30  # cap for exponential backoff

# Message queue settings — decouple MQTT recv from DB writes.
_MSG_QUEUE_MAX = 10000
_WORKER_COUNT = 2
_BATCH_SIZE = 50
_FLUSH_DEADLINE_S = 0.25  # 250ms


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_iso_timestamp(value: str | None) -> datetime:
    """Parse ISO 8601 timestamp, defaulting to now if invalid/missing.

    Logs a warning on malformed or future timestamps.
    """
    if not value:
        return utc_now()
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        logger.warning("Malformed timestamp %r, falling back to now()", value)
        return utc_now()
    from datetime import timedelta

    if ts - utc_now() > timedelta(minutes=5):
        logger.warning("Future timestamp %r rejected, falling back to now()", value)
        return utc_now()
    return ts


def _get_standard_field_key(alias: str, name: str) -> str | None:
    alias_lower = alias.lower().strip()
    name_lower = name.lower().strip()

    alias_map = {
        "d": "humidity",
        "do_am": "humidity",
        "doam": "humidity",
        "humidity": "humidity",
        "nhit_": "temperature",
        "nhiet_do": "temperature",
        "nhietdo": "temperature",
        "temp": "temperature",
        "temperature": "temperature",
        "light": "light",
        "anh_sang": "light",
        "anhsang": "light",
        "lux": "light",
        "pressure": "pressure",
        "ap_suat": "pressure",
        "apsuat": "pressure",
        "voltage": "voltage",
        "dien_ap": "voltage",
        "dienap": "voltage",
        "vol": "voltage",
        "current": "current",
        "dong_dien": "current",
        "dongdien": "current",
        "amp": "current",
        "power": "power",
        "cong_suat": "power",
        "congsuat": "power",
        "watt": "power",
        "battery": "battery",
        "pin": "battery",
        "bat": "battery",
        "relay_state": "relay_state",
        "relay": "relay_state",
        "led": "relay_state",
        "motion": "motion",
        "chuyen_dong": "motion",
        "chuyendong": "motion",
        "smoke_detected": "smoke_detected",
        "smoke": "smoke_detected",
        "khoi": "smoke_detected",
        "gas_detected": "gas_detected",
        "gas": "gas_detected",
        "khi_gas": "gas_detected",
    }

    if alias_lower in alias_map:
        return alias_map[alias_lower]

    if "ẩm" in name_lower or "humidity" in name_lower:
        return "humidity"
    if "nhiệt" in name_lower or "temp" in name_lower:
        return "temperature"
    if "sáng" in name_lower or "light" in name_lower or "lux" in name_lower:
        return "light"
    if "áp" in name_lower or "pressure" in name_lower:
        return "pressure"
    if "điện áp" in name_lower or "voltage" in name_lower or "hiệu điện thế" in name_lower:
        return "voltage"
    if "dòng" in name_lower or "current" in name_lower:
        return "current"
    if "công suất" in name_lower or "power" in name_lower or "watt" in name_lower:
        return "power"
    if "pin" in name_lower or "battery" in name_lower:
        return "battery"
    if "chuyển động" in name_lower or "motion" in name_lower:
        return "motion"
    if "relay" in name_lower or "công tắc" in name_lower or "led" in name_lower:
        return "relay_state"
    if "khói" in name_lower or "smoke" in name_lower:
        return "smoke_detected"
    if "gas" in name_lower or "khi" in name_lower:
        return "gas_detected"

    return None


class MQTTSubscriber:
    def __init__(self) -> None:
        # clean_session=True so the broker does NOT replay queued messages
        # after a backend restart.  With clean_session=False the broker
        # would deliver stale QoS-1 messages from devices that are now
        # offline, flipping them back to "online" and defeating the
        # startup reconciliation in main.py.
        self._client = mqtt.Client(
            client_id=settings.mqtt_client_id,
            protocol=mqtt.MQTTv311,
            clean_session=True,
        )
        if settings.mqtt_username:
            self._client.username_pw_set(settings.mqtt_username, settings.mqtt_password)
        if settings.mqtt_tls_enabled:
            self._client.tls_set(
                ca_certs=settings.mqtt_tls_ca_cert,
                certfile=settings.mqtt_tls_certfile,
                keyfile=settings.mqtt_tls_keyfile,
                cert_reqs=ssl.CERT_NONE if settings.mqtt_tls_insecure else ssl.CERT_REQUIRED,
                tls_version=ssl.PROTOCOL_TLS_CLIENT,
            )
            self._client.tls_insecure_set(settings.mqtt_tls_insecure)
        self._client.on_connect = self._on_connect
        self._client.on_disconnect = self._on_disconnect
        self._client.on_message = self._on_message
        # Let paho handle reconnects automatically after the first successful connect.
        self._client.reconnect_delay_set(min_delay=_RETRY_INITIAL_DELAY, max_delay=_RETRY_MAX_DELAY)
        self._running = False
        self._connected = False
        self._last_message_at: float | None = None
        # Message queue: _on_message enqueues, worker threads dequeue + DB write.
        # This keeps the paho network loop thread unblocked so keepalive pings
        # are always sent on time.
        self._msg_queue: queue.Queue = queue.Queue(maxsize=_MSG_QUEUE_MAX)
        self._workers: list[threading.Thread] = []

    @property
    def is_connected(self) -> bool:
        """Whether the authenticated Paho on_connect callback has succeeded."""
        return self._connected

    @property
    def last_message_age_seconds(self) -> float | None:
        if self._last_message_at is None:
            return None
        return max(0.0, time.monotonic() - self._last_message_at)

    def start(self) -> None:
        if self._running:
            return
        self._running = True
        # Start worker threads that drain the message queue into the DB.
        for i in range(_WORKER_COUNT):
            t = threading.Thread(
                target=self._queue_worker,
                daemon=True,
                name=f"mqtt-worker-{i}",
            )
            t.start()
            self._workers.append(t)
        # Start the paho event loop first so it is ready to process events
        # as soon as the socket is established.
        self._client.loop_start()
        # Connect in a background daemon thread so the initial connection race
        # (Mosquitto not yet listening) does not block or crash the API startup.
        t = threading.Thread(target=self._connect_loop, daemon=True, name="mqtt-connect")
        t.start()

    def _connect_loop(self) -> None:
        """Retry the initial TCP connection with exponential backoff.

        Once the first connect() call succeeds, paho's own reconnect logic
        (configured via reconnect_delay_set) takes over for any future drops.
        """
        delay = _RETRY_INITIAL_DELAY
        attempt = 0
        while self._running:
            attempt += 1
            try:
                self._client.connect(settings.mqtt_host, settings.mqtt_port, keepalive=60)
                # connect() succeeded — paho loop_start thread handles everything from here.
                return
            except Exception as exc:
                logger.warning(
                    "MQTT connect attempt %d failed: %s -- retry in %ds",
                    attempt,
                    exc,
                    delay,
                )
                time.sleep(delay)
                delay = min(delay * 2, _RETRY_MAX_DELAY)

    def stop(self) -> None:
        if not self._running:
            return
        self._running = False  # signals _connect_loop to exit if still retrying
        try:
            self._client.loop_stop()
            self._client.disconnect()
        except Exception:
            logger.exception("MQTT subscriber failed to stop cleanly")

    def _on_connect(self, client: mqtt.Client, userdata, flags, rc: int) -> None:
        if rc != 0:
            self._connected = False
            logger.error("MQTT connect failed rc=%s", rc)
            return
        self._connected = True
        # QoS 1 for all subscriptions — guarantees at-least-once delivery.
        client.subscribe(TOPIC_TELEMETRY, qos=1)
        client.subscribe(TOPIC_TELEMETRY_CHANNEL, qos=1)
        client.subscribe(TOPIC_STATUS, qos=1)
        client.subscribe(TOPIC_HEARTBEAT, qos=1)
        client.subscribe(TOPIC_EVENTS, qos=1)
        client.subscribe(TOPIC_OTA_STATUS, qos=1)
        client.subscribe(TOPIC_LEGACY_TELEMETRY, qos=1)
        client.subscribe(TOPIC_LEGACY_STATUS, qos=1)
        client.subscribe(TOPIC_LEGACY_HEARTBEAT, qos=1)
        client.subscribe(TOPIC_LEGACY_OTA_RESULT, qos=1)
        logger.info(
            "MQTT subscriber connected host=%s port=%s clean_session=True",
            settings.mqtt_host,
            settings.mqtt_port,
        )

    def _on_disconnect(self, client: mqtt.Client, userdata, rc: int) -> None:
        self._connected = False
        if rc == 0:
            logger.info("MQTT disconnected cleanly")
        else:
            logger.warning("MQTT disconnected unexpectedly rc=%s -- paho will reconnect", rc)

    def _on_message(self, client: mqtt.Client, userdata, message: mqtt.MQTTMessage) -> None:
        """Enqueue message for async processing. Must NOT block the paho loop."""
        from app.core.background_context import mqtt_callback_context

        mqtt_callback_context(lambda: self._enqueue_message(message))

    def _enqueue_message(self, message: mqtt.MQTTMessage) -> None:
        """Validate and enqueue a message while a fresh callback context is active."""
        from app.core.logging import get_correlation_id

        parsed = mqtt_topics.parse_device_topic(message.topic)
        if parsed is None:
            logger.warning("MQTT ignored unexpected topic=%s", message.topic)
            return

        device_uid, topic_kind = parsed
        MQTT_MESSAGES.labels(topic_type=topic_kind).inc()
        self._last_message_at = time.monotonic()

        try:
            self._msg_queue.put_nowait(
                (
                    topic_kind,
                    device_uid,
                    message.payload,
                    bool(getattr(message, "retain", False)),
                    get_correlation_id(),
                )
            )
        except queue.Full:
            logger.error(
                "MQTT message queue full — dropping message topic=%s device_uid=%s",
                topic_kind,
                device_uid,
            )

    def _emit_device_status_event(self, db, device) -> None:
        """Publish a device status change event to the tenant event bus."""
        try:
            from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
                TenantDeviceMapping,
            )

            mapping = db.scalar(
                select(TenantDeviceMapping).where(TenantDeviceMapping.device_id == device.id)
            )
            if mapping is None:
                return
            event: DeviceStatusEvent = {
                "device_uid": device.device_uid,
                "tenant_id": str(mapping.tenant_id),
                "status": device.status,
                "last_seen_at": device.last_seen_at.isoformat() if device.last_seen_at else None,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            device_status_bus.publish(event)

            from app.bounded_contexts.rule_engine.application.use_cases import (
                RuleEngineUseCases,
            )

            RuleEngineUseCases(db).evaluate_enabled_rules_for_device_status(
                mapping.tenant_id,
                device,
            )
        except Exception:
            logger.debug("Failed to emit device status event for %s", device.device_uid)

    def _get_registered_device(self, db, device_uid: str, topic_kind: str):
        device = device_repository.get_device_by_uid(db, device_uid)
        if device is None:
            logger.warning(
                "MQTT %s rejected unknown device_uid=%s",
                topic_kind,
                device_uid,
            )
            return None
        if not hasattr(db, "scalar"):
            return device

        from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
            TenantDeviceMapping,
        )

        mapping = db.scalar(
            select(TenantDeviceMapping).where(TenantDeviceMapping.device_id == device.id)
        )
        if mapping is not None:
            tenant = getattr(mapping, "tenant", None)
            if tenant is not None and not tenant.is_active:
                logger.warning(
                    "MQTT %s rejected inactive tenant mapping device_uid=%s",
                    topic_kind,
                    device_uid,
                )
                return None
        return device

    def _get_registered_device_by_identifier(self, db, device_identifier: str, topic_kind: str):
        try:
            device_id = uuid.UUID(str(device_identifier))
        except ValueError:
            return self._get_registered_device(db, device_identifier, topic_kind)
        from app.modules.devices.model import Device

        device = db.get(Device, device_id)
        if device is None:
            logger.warning("MQTT %s rejected unknown device_id=%s", topic_kind, device_identifier)
            return None
        return self._get_registered_device(db, device.device_uid, topic_kind)

    def _queue_worker(self) -> None:
        """Drain the message queue and write to DB in small batches."""
        while self._running:
            batch: list[tuple[str, str, bytes]] = []
            try:
                # Block until at least one message arrives.
                item = self._msg_queue.get(timeout=1.0)
                batch.append(item)
                # Drain up to _BATCH_SIZE-1 more without blocking.
                deadline = time.monotonic() + _FLUSH_DEADLINE_S
                while len(batch) < _BATCH_SIZE and time.monotonic() < deadline:
                    try:
                        batch.append(self._msg_queue.get_nowait())
                    except queue.Empty:
                        break
            except queue.Empty:
                continue

            self._process_batch(batch)

    def process_message_sync(self, message) -> None:
        """Process a single MQTT message synchronously (for unit tests only).

        Bypasses the queue and processes the message in the calling thread.
        """
        from app.core.tenant_context import tenant_context

        with tenant_context(bypass_rls=True):
            parsed = mqtt_topics.parse_device_topic(message.topic)
            if parsed is None:
                return
            device_uid, topic_kind = parsed
            try:
                payload = json.loads(message.payload.decode("utf-8"))
            except Exception:
                payload = message.payload.decode("utf-8")

            db = SessionLocal()
            try:
                if topic_kind == "telemetry":
                    self._handle_telemetry(db, device_uid, payload)
                elif topic_kind.startswith("telemetry/ch_"):
                    channel = topic_kind.split("ch_")[-1]
                    self._handle_channel_telemetry(db, device_uid, channel, payload)
                elif topic_kind == "status":
                    self._handle_status(
                        db, device_uid, payload, retained=bool(getattr(message, "retain", False))
                    )
                elif topic_kind == "heartbeat":
                    self._handle_heartbeat(db, device_uid, payload)
                elif topic_kind == "events":
                    self._handle_events(db, device_uid, payload)
                elif topic_kind == "ota_status":
                    self._handle_ota_status(db, device_uid, payload)
                db.commit()
            except Exception:
                db.rollback()
                raise
            finally:
                db.close()

    def _process_batch(self, batch: list[tuple]) -> None:
        """Process a batch of messages in a single DB session.

        Each message is committed individually so that a failure in one
        message does not roll back the successfully processed messages
        before it.
        """
        from app.core.tenant_context import tenant_context

        with tenant_context(bypass_rls=True):
            db = SessionLocal()
            try:
                for item in batch:
                    from app.core.background_context import new_operation_id
                    from app.core.logging import correlation_id_ctx

                    topic_kind, device_uid, raw_payload = item[:3]
                    retained = bool(item[3]) if len(item) > 3 else False
                    operation_id = item[4] if len(item) > 4 and item[4] else new_operation_id()
                    context_token = correlation_id_ctx.set(operation_id)
                    try:
                        payload = json.loads(raw_payload.decode("utf-8"))
                    except Exception:
                        payload = raw_payload.decode("utf-8")

                    try:
                        if topic_kind == "telemetry":
                            self._handle_telemetry(db, device_uid, payload)
                        elif topic_kind.startswith("telemetry/ch_"):
                            channel = topic_kind.split("ch_")[-1]
                            self._handle_channel_telemetry(db, device_uid, channel, payload)
                        elif topic_kind == "status":
                            self._handle_status(db, device_uid, payload, retained=retained)
                        elif topic_kind == "heartbeat":
                            self._handle_heartbeat(db, device_uid, payload)
                        elif topic_kind == "events":
                            self._handle_events(db, device_uid, payload)
                        elif topic_kind == "ota_status":
                            self._handle_ota_status(db, device_uid, payload)
                        db.commit()
                    except Exception:
                        logger.exception(
                            "MQTT message handler failed topic=%s device_uid=%s",
                            topic_kind,
                            device_uid,
                        )
                        db.rollback()
                    finally:
                        correlation_id_ctx.reset(context_token)
            except Exception:
                logger.exception("MQTT batch processing failed")
                db.rollback()
            finally:
                db.close()

    def _handle_telemetry(self, db, device_uid: str, payload: dict) -> None:
        if not isinstance(payload, dict):
            logger.warning("MQTT telemetry payload is not object device_uid=%s", device_uid)
            return
        if self._get_registered_device(db, device_uid, "telemetry") is None:
            return

        _MAX_METRIC_NAME_LEN = 128  # matches DB column and Pydantic schema

        numeric_metrics: dict[str, float] = {}
        metrics = payload.get("metrics")
        if isinstance(metrics, dict):
            for metric_name, metric_value in metrics.items():
                if (
                    isinstance(metric_name, str)
                    and 0 < len(metric_name) <= _MAX_METRIC_NAME_LEN
                    and isinstance(metric_value, (int, float))
                    and not isinstance(metric_value, bool)
                ):
                    numeric_metrics[metric_name] = float(metric_value)

        ignored_keys = {
            "device_id",
            "firmware_version",
            "timestamp",
            "status",
            "ip",
            "message",
            "metrics",
            "event",
            "command_id",
            "type",
            "target",
        }
        for metric_name, metric_value in payload.items():
            if metric_name in ignored_keys:
                continue
            if (
                isinstance(metric_name, str)
                and 0 < len(metric_name) <= _MAX_METRIC_NAME_LEN
                and isinstance(metric_value, (int, float))
                and not isinstance(metric_value, bool)
            ):
                numeric_metrics[metric_name] = float(metric_value)

        if not numeric_metrics:
            logger.debug("MQTT telemetry has no numeric metrics device_uid=%s", device_uid)

        timestamp = parse_iso_timestamp(payload.get("timestamp"))
        telemetry_repository.create_telemetry_metrics(
            db,
            device_uid=device_uid,
            timestamp=timestamp,
            metrics=numeric_metrics,
            raw_payload=payload,
        )

        updated = device_repository.touch_device(
            db,
            device_uid,
            status="online",
            firmware_version=(
                str(payload.get("firmware_version")) if payload.get("firmware_version") else None
            ),
            ip_address=(str(payload.get("ip")) if payload.get("ip") else None),
            rssi=(int(payload["rssi"]) if isinstance(payload.get("rssi"), (int, float)) else None),
            free_heap=(
                int(payload["free_heap"])
                if isinstance(payload.get("free_heap"), (int, float))
                else None
            ),
            uptime_ms=(
                int(payload["uptime_ms"])
                if isinstance(payload.get("uptime_ms"), (int, float))
                else None
            ),
            last_status_payload=payload,
        )
        if updated is not None:
            self._emit_device_status_event(db, updated)

            try:
                from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
                    TenantDeviceMapping,
                )
                from app.bounded_contexts.rule_engine.application.use_cases import (
                    RuleEngineUseCases,
                )

                mapping = db.scalar(
                    select(TenantDeviceMapping).where(TenantDeviceMapping.device_id == updated.id)
                )
                if mapping is not None:
                    RuleEngineUseCases(db).evaluate_enabled_rules_for_telemetry(
                        mapping.tenant_id,
                        updated,
                        payload,
                    )
            except Exception:
                logger.exception(
                    "Automation rule evaluation failed for telemetry device_uid=%s", device_uid
                )

        TELEMETRY_INGESTED.inc()
        logger.info(
            "MQTT telemetry stored device_uid=%s metrics=%s",
            device_uid,
            list(numeric_metrics.keys()),
        )

    def _handle_channel_telemetry(self, db, device_uid: str, channel: str, payload) -> None:
        if self._get_registered_device(db, device_uid, f"telemetry/ch_{channel}") is None:
            return

        numeric_metrics = {}
        # Parse numeric value from payload
        try:
            if isinstance(payload, bytes):
                payload_str = payload.decode("utf-8").strip()
            elif isinstance(payload, (int, float)):
                payload_str = str(payload)
            elif isinstance(payload, dict):
                payload_str = str(
                    payload.get("value", payload.get("metrics", {}).get(f"ch_{channel}", ""))
                )
            else:
                payload_str = str(payload).strip()
            val = float(payload_str)
            numeric_metrics = {f"ch_{channel}": val}
        except Exception:
            logger.debug(
                "MQTT virtual channel telemetry payload is not numeric device_uid=%s channel=%s payload=%s",
                device_uid,
                channel,
                payload,
            )
            val = payload_str

        if numeric_metrics:
            metric_name = f"ch_{channel}"
            numeric_metrics = {metric_name: val}
            if channel.isdigit():
                numeric_metrics[f"gpio_{channel}_state"] = val

        timestamp = utc_now()

        telemetry_repository.create_telemetry_metrics(
            db,
            device_uid=device_uid,
            timestamp=timestamp,
            metrics=numeric_metrics,
            raw_payload={"value": val},
        )

        updated = device_repository.touch_device(
            db,
            device_uid,
            status="online",
        )
        if updated is not None:
            self._emit_device_status_event(db, updated)

            try:
                from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
                    TenantDeviceMapping,
                )
                from app.bounded_contexts.rule_engine.application.use_cases import (
                    RuleEngineUseCases,
                )
                from app.bounded_contexts.project_dashboard.infrastructure.persistence.models import (
                    TenantDatastream,
                )

                mapping = db.scalar(
                    select(TenantDeviceMapping).where(TenantDeviceMapping.device_id == updated.id)
                )
                if mapping is not None:
                    pin_num = None
                    if channel.startswith("v") and channel[1:].isdigit():
                        pin_num = int(channel[1:])
                    elif channel.isdigit():
                        pin_num = int(channel)

                    datastream_alias = None
                    datastream_name = None
                    if pin_num is not None and updated.project_id is not None:
                        ds = db.scalar(
                            select(TenantDatastream).where(
                                TenantDatastream.project_id == updated.project_id,
                                TenantDatastream.pin == pin_num,
                            )
                        )
                        if ds is not None:
                            datastream_alias = ds.alias
                            datastream_name = ds.name

                    rule_payload = {"value": val}
                    if datastream_alias:
                        rule_payload[datastream_alias] = val
                        standard_key = _get_standard_field_key(
                            datastream_alias, datastream_name or ""
                        )
                        if standard_key:
                            rule_payload[standard_key] = val

                    RuleEngineUseCases(db).evaluate_enabled_rules_for_telemetry(
                        mapping.tenant_id,
                        updated,
                        rule_payload,
                    )
            except Exception:
                logger.exception(
                    "Automation rule evaluation failed for virtual channel device_uid=%s",
                    device_uid,
                )

        TELEMETRY_INGESTED.inc()
        logger.info(
            "MQTT virtual channel telemetry stored device_uid=%s metrics=%s",
            device_uid,
            list(numeric_metrics.keys()),
        )

    def _is_fresh_status_payload(self, device, payload: dict) -> bool:
        timestamp_value = payload.get("timestamp")
        if not timestamp_value:
            return False
        try:
            timestamp = datetime.fromisoformat(str(timestamp_value).replace("Z", "+00:00"))
        except ValueError:
            return False
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
        else:
            timestamp = timestamp.astimezone(timezone.utc)
        timeout_seconds = device_repository.normalize_offline_timeout_seconds(
            getattr(device, "offline_timeout_seconds", None)
        )
        age = utc_now() - timestamp
        return timedelta(seconds=0) <= age <= timedelta(seconds=timeout_seconds)

    def _handle_status(self, db, device_uid: str, payload, retained: bool = False) -> None:
        device = self._get_registered_device(db, device_uid, "status")
        if device is None:
            return
        status_value = "unknown"
        firmware_version = None
        ip_address = None
        rssi = None
        free_heap = None
        uptime_ms = None
        status_payload = payload if isinstance(payload, dict) else None
        if isinstance(payload, dict):
            status_value = str(payload.get("status") or payload.get("state") or "unknown")
            if payload.get("firmware_version"):
                firmware_version = str(payload["firmware_version"])
            if payload.get("ip"):
                ip_address = str(payload["ip"])
            if isinstance(payload.get("rssi"), (int, float)):
                rssi = int(payload["rssi"])
            if isinstance(payload.get("free_heap"), (int, float)):
                free_heap = int(payload["free_heap"])
            if isinstance(payload.get("uptime_ms"), (int, float)):
                uptime_ms = int(payload["uptime_ms"])
        elif isinstance(payload, str):
            status_value = payload

        normalized_status = device_repository.normalize_connection_status(status_value)
        if retained and normalized_status == "online":
            if not isinstance(payload, dict) or not self._is_fresh_status_payload(device, payload):
                logger.info(
                    "MQTT retained online status ignored as stale device_uid=%s payload=%s",
                    device_uid,
                    payload,
                )
                return
        updated = device_repository.touch_device(
            db,
            device_uid,
            status=normalized_status,
            firmware_version=firmware_version,
            ip_address=ip_address,
            rssi=rssi,
            free_heap=free_heap,
            uptime_ms=uptime_ms,
            last_status_payload=status_payload,
            update_last_seen=normalized_status != "offline",
        )
        if updated is None:
            logger.warning("MQTT status ignored unknown device_uid=%s", device_uid)
            return
        self._emit_device_status_event(db, updated)
        logger.info("MQTT status updated device_uid=%s status=%s", device_uid, normalized_status)

    def _handle_heartbeat(self, db, device_uid: str, payload) -> None:
        if self._get_registered_device(db, device_uid, "heartbeat") is None:
            return
        status_payload = payload if isinstance(payload, dict) else None
        updated = device_repository.touch_device(
            db,
            device_uid,
            status="online",
            last_status_payload=status_payload,
            update_last_seen=True,
        )
        if updated is None:
            logger.warning("MQTT heartbeat ignored unknown device_uid=%s", device_uid)
            return
        self._emit_device_status_event(db, updated)
        logger.info("MQTT heartbeat updated device_uid=%s", device_uid)

    def _handle_events(self, db, device_uid: str, payload) -> None:
        if not isinstance(payload, dict):
            logger.warning("MQTT events payload is not object device_uid=%s", device_uid)
            return
        if self._get_registered_device(db, device_uid, "events") is None:
            return
        updated = device_repository.touch_device(
            db,
            device_uid,
            status="online",
            firmware_version=(
                str(payload.get("firmware_version")) if payload.get("firmware_version") else None
            ),
        )
        if updated is None:
            logger.warning("MQTT events ignored unknown device_uid=%s", device_uid)
            return
        self._emit_device_status_event(db, updated)
        event_type = str(payload.get("event") or "")
        if event_type == "command_result":
            try:
                from app.bounded_contexts.command_center.infrastructure.ack_handler import (
                    CommandAckHandler,
                )
                from app.bounded_contexts.rule_engine.application.use_cases import (
                    RuleEngineUseCases,
                )
                from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
                    TenantDeviceMapping,
                )

                CommandAckHandler(db).handle_event(device_uid, event_type, payload)
                mapping = db.scalar(
                    select(TenantDeviceMapping).where(TenantDeviceMapping.device_id == updated.id)
                )
                if mapping is not None:
                    RuleEngineUseCases(db).evaluate_enabled_rules_for_device_event(
                        mapping.tenant_id,
                        updated,
                        payload,
                    )
            except Exception:
                logger.exception("Command result event handling failed device_uid=%s", device_uid)
        logger.info(
            "MQTT event received device_uid=%s type=%s command_id=%s status=%s",
            device_uid,
            payload.get("type"),
            payload.get("command_id"),
            payload.get("status"),
        )

    def _handle_ota_status(self, db, device_uid: str, payload) -> None:
        if not isinstance(payload, dict):
            logger.warning("MQTT ota/status payload is not object device_uid=%s", device_uid)
            return
        if self._get_registered_device(db, device_uid, "ota_status") is None:
            return
        job_id_raw = payload.get("job_id")
        new_status = payload.get("status")
        if not job_id_raw or not new_status:
            logger.warning(
                "MQTT ota/status missing job_id or status device_uid=%s payload=%s",
                device_uid,
                payload,
            )
            return
        try:
            job_id = uuid.UUID(str(job_id_raw))
        except ValueError:
            logger.warning(
                "MQTT ota/status invalid job_id=%s device_uid=%s", job_id_raw, device_uid
            )
            return
        job = ota_repository.get_job_by_id(db, job_id)
        job_device_uid = getattr(getattr(job, "device", None), "device_uid", None)
        if job is None or job_device_uid != device_uid:
            logger.warning(
                "MQTT ota/status rejected job_id=%s topic_device_uid=%s",
                job_id,
                device_uid,
            )
            return
        message = payload.get("message")
        error_code = payload.get("error_code")
        progress = payload.get("progress")
        progress_int = None
        if isinstance(progress, (int, float)):
            progress_int = max(0, min(100, int(progress)))
        updated = ota_repository.update_status(
            db,
            job_id,
            str(new_status),
            progress=progress_int,
            message=str(message) if message else None,
            error_message=str(message) if message else None,
            error_code=str(error_code) if error_code else None,
        )
        if updated is None:
            logger.warning("MQTT ota/status unknown job_id=%s device_uid=%s", job_id, device_uid)
            return
        firmware_version = payload.get("firmware_version")
        updated_device = device_repository.touch_device(
            db,
            device_uid,
            status="online",
            firmware_version=str(firmware_version) if firmware_version else None,
        )
        if updated_device is not None:
            self._emit_device_status_event(db, updated_device)
        OTA_JOBS_BY_STATUS.labels(status=str(new_status)).inc()
        logger.info(
            "MQTT ota/status job_id=%s device_uid=%s status=%s progress=%s",
            job_id,
            device_uid,
            new_status,
            progress_int,
        )
