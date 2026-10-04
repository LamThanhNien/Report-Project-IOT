"""Telemetry application use cases.

Encapsulates telemetry business logic — ingestion from MQTT and querying.
Orchestrates between domain entities, repository adapters, and device services.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.bounded_contexts.telemetry.domain.value_objects import (
    TelemetryFilter,
    TelemetryIngestResult,
)
from app.modules.devices import repository as device_repository
from app.modules.telemetry import repository as telemetry_repository
from app.modules.telemetry.model import Telemetry

logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_iso_timestamp(value: str | None) -> datetime:
    """Parse ISO 8601 timestamp string, defaulting to now if invalid/missing.

    Logs a warning when the input is malformed so operators can detect
    devices sending bad timestamps.
    """
    if not value:
        return utc_now()
    try:
        ts = datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError:
        logger.warning("Malformed timestamp %r, falling back to now()", value)
        return utc_now()
    # Reject timestamps more than 5 minutes in the future
    now = utc_now()
    from datetime import timedelta

    if ts - now > timedelta(minutes=5):
        logger.warning("Future timestamp %r rejected, falling back to now()", value)
        return now
    return ts


def extract_numeric_metrics(payload: dict[str, Any]) -> dict[str, float]:
    """Extract numeric metrics from an MQTT telemetry payload.

    Handles both structured (metrics key) and flat payload formats.
    Returns only numeric (non-boolean) values.
    """
    numeric_metrics: dict[str, float] = {}

    # Extract from 'metrics' key if present
    metrics = payload.get("metrics")
    if isinstance(metrics, dict):
        for metric_name, metric_value in metrics.items():
            if (
                isinstance(metric_name, str)
                and isinstance(metric_value, (int, float))
                and not isinstance(metric_value, bool)
            ):
                numeric_metrics[metric_name] = float(metric_value)

    # Extract flat numeric keys (excluding known non-metric keys)
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
            and isinstance(metric_value, (int, float))
            and not isinstance(metric_value, bool)
        ):
            numeric_metrics[metric_name] = float(metric_value)

    return numeric_metrics


def ingest_telemetry(
    db: Session,
    device_uid: str,
    payload: dict[str, Any],
) -> TelemetryIngestResult:
    """Ingest telemetry data from an MQTT payload.

    Extracts numeric metrics, stores them, and updates device status.
    Returns TelemetryIngestResult with success/failure details.
    """
    if not isinstance(payload, dict):
        return TelemetryIngestResult(
            device_uid=device_uid,
            success=False,
            error_message="Payload is not a JSON object",
        )

    device = device_repository.get_device_by_uid(db, device_uid)
    if not device:
        return TelemetryIngestResult(
            device_uid=device_uid,
            success=False,
            error_message=f"Unknown device_uid: {device_uid}",
        )

    numeric_metrics = extract_numeric_metrics(payload)

    timestamp = parse_iso_timestamp(payload.get("timestamp"))

    # Store telemetry records
    records = telemetry_repository.create_telemetry_metrics(
        db,
        device_uid=device_uid,
        timestamp=timestamp,
        metrics=numeric_metrics,
        raw_payload=payload,
    )

    # Update device status
    device_repository.touch_device(
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

    _evaluate_automation_rules(db, device_uid, payload)

    logger.info(
        "Telemetry ingested device_uid=%s metrics=%s",
        device_uid,
        list(numeric_metrics.keys()),
    )

    return TelemetryIngestResult(
        device_uid=device_uid,
        metrics_stored=len(records),
        metric_names=list(numeric_metrics.keys()),
        success=True,
        raw_payload=payload,
    )


def _evaluate_automation_rules(db: Session, device_uid: str, payload: dict[str, Any]) -> None:
    """Evaluate tenant-defined telemetry rules for the device payload.

    Rule evaluation is best-effort: ingestion must not fail because an action
    backend such as MQTT is temporarily unavailable.
    """
    try:
        from sqlalchemy import select

        from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
        from app.bounded_contexts.rule_engine.application.use_cases import RuleEngineUseCases
        from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
            TenantDeviceMapping,
        )

        device = db.scalar(select(Device).where(Device.device_uid == device_uid))
        if device is None:
            return
        mapping = db.scalar(
            select(TenantDeviceMapping).where(TenantDeviceMapping.device_id == device.id)
        )
        if mapping is None:
            return
        RuleEngineUseCases(db).evaluate_enabled_rules_for_telemetry(
            mapping.tenant_id,
            device,
            payload,
        )
    except Exception:
        logger.exception("Automation rule evaluation failed device_uid=%s", device_uid)


def query_telemetry(
    db: Session,
    filter: TelemetryFilter,
) -> list[Telemetry]:
    """Query telemetry records with filters.

    Delegates to the repository with the given filter criteria.
    """
    return telemetry_repository.list_telemetry(
        db,
        tenant_id=filter.tenant_id,
        device_uid=filter.device_uid,
        metric_name=filter.metric_name,
        from_time=filter.from_time,
        to_time=filter.to_time,
        limit=filter.limit,
        offset=filter.offset,
    )


def query_device_telemetry(
    db: Session,
    device_uid: str,
    filter: TelemetryFilter,
) -> list[Telemetry]:
    """Query telemetry records for a specific device."""
    return telemetry_repository.list_telemetry_by_device_uid(
        db,
        device_uid,
        metric_name=filter.metric_name,
        from_time=filter.from_time,
        to_time=filter.to_time,
        limit=filter.limit,
        offset=filter.offset,
    )


def query_latest_device_telemetry(
    db: Session,
    device_uid: str,
) -> list[Telemetry]:
    """Get the latest telemetry records for a device."""
    return telemetry_repository.latest_telemetry_by_device_uid(db, device_uid)


def create_single_telemetry(
    db: Session,
    device_uid: str,
    metric_name: str,
    metric_value: float,
    timestamp: datetime | None = None,
    unit: str | None = None,
    raw_payload: dict | None = None,
) -> Telemetry | None:
    """Create a single telemetry record via REST API."""
    from app.modules.telemetry.schema import TelemetryCreate

    payload = TelemetryCreate(
        device_uid=device_uid,
        timestamp=timestamp or utc_now(),
        metric_name=metric_name,
        metric_value=metric_value,
        unit=unit,
        raw_payload=raw_payload,
    )
    return telemetry_repository.create_telemetry(db, payload)
