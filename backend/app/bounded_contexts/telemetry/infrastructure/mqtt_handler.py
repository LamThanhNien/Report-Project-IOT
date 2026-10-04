"""Telemetry MQTT handler — extracts telemetry ingestion logic from mqtt_subscriber.

This module provides a clean handler for MQTT telemetry messages that can be
called by the MQTT subscriber. It delegates to the application use cases.

The actual MQTT connection and subscription logic remains in services/mqtt_subscriber.py
to avoid breaking app startup. This handler only processes telemetry payloads.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.bounded_contexts.telemetry.application.use_cases import (
    ingest_telemetry,
)
from app.core.metrics import TELEMETRY_INGESTED
from app.modules.devices import repository as device_repository

logger = logging.getLogger(__name__)


def handle_telemetry_message(
    db: Session,
    device_uid: str,
    payload: dict[str, Any],
) -> bool:
    """Handle an MQTT telemetry message.

    This is the entry point called by mqtt_subscriber._handle_telemetry().
    Returns True if telemetry was successfully ingested, False otherwise.
    """
    result = ingest_telemetry(db, device_uid, payload)

    if not result.success:
        logger.warning(
            "Telemetry ingestion failed device_uid=%s error=%s",
            device_uid,
            result.error_message,
        )
        return False

    TELEMETRY_INGESTED.inc()
    logger.info(
        "Telemetry ingested device_uid=%s metrics=%s",
        device_uid,
        result.metric_names,
    )
    return True


def handle_status_message(
    db: Session,
    device_uid: str,
    payload: Any,
) -> bool:
    """Handle an MQTT status message.

    Updates device connection status and health metrics.
    Returns True if device was found and updated, False otherwise.
    """
    status_value = "online"
    firmware_version = None
    ip_address = None
    rssi = None
    free_heap = None
    uptime_ms = None
    status_payload = payload if isinstance(payload, dict) else None

    if isinstance(payload, dict):
        status_value = str(payload.get("status") or payload.get("state") or "online")
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
        return False

    logger.info("MQTT status updated device_uid=%s status=%s", device_uid, normalized_status)
    return True


def handle_heartbeat_message(
    db: Session,
    device_uid: str,
    payload: Any,
) -> bool:
    """Handle an MQTT heartbeat message.

    Marks device as online and updates last_seen_at.
    Returns True if device was found and updated, False otherwise.
    """
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
        return False

    logger.info("MQTT heartbeat updated device_uid=%s", device_uid)
    return True


def handle_event_message(
    db: Session,
    device_uid: str,
    payload: Any,
) -> bool:
    """Handle an MQTT events message.

    Updates device status and logs the event.
    Returns True if device was found and updated, False otherwise.
    """
    if not isinstance(payload, dict):
        logger.warning("MQTT events payload is not object device_uid=%s", device_uid)
        return False

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
        return False

    logger.info(
        "MQTT event received device_uid=%s type=%s command_id=%s status=%s",
        device_uid,
        payload.get("type"),
        payload.get("command_id"),
        payload.get("status"),
    )
    return True
