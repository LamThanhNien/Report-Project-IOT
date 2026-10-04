"""Telemetry infrastructure adapters — wraps modules/telemetry/repository.

Provides a clean interface for the application layer while delegating
actual persistence to the existing repository module.
Old import paths (app.modules.telemetry.repository) remain valid.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.bounded_contexts.telemetry.domain.value_objects import TelemetryFilter
from app.modules.telemetry import repository as telemetry_repository
from app.modules.telemetry.model import Telemetry
from app.modules.telemetry.schema import TelemetryCreate


class SqlAlchemyTelemetryRepository:
    """Adapter wrapping modules/telemetry/repository functions.

    Provides a class-based interface for the bounded context while
    delegating to the existing functional repository.
    """

    def __init__(self, db: Session) -> None:
        self._db = db

    def list_telemetry(self, filter: TelemetryFilter) -> list[Telemetry]:
        """List telemetry records with filter criteria."""
        return telemetry_repository.list_telemetry(
            self._db,
            device_uid=filter.device_uid,
            metric_name=filter.metric_name,
            from_time=filter.from_time,
            to_time=filter.to_time,
            limit=filter.limit,
            offset=filter.offset,
        )

    def list_by_device_uid(
        self,
        device_uid: str,
        filter: TelemetryFilter,
    ) -> list[Telemetry]:
        """List telemetry records for a specific device."""
        return telemetry_repository.list_telemetry_by_device_uid(
            self._db,
            device_uid,
            metric_name=filter.metric_name,
            from_time=filter.from_time,
            to_time=filter.to_time,
            limit=filter.limit,
            offset=filter.offset,
        )

    def latest_by_device_uid(self, device_uid: str) -> list[Telemetry]:
        """Get latest telemetry records for a device."""
        return telemetry_repository.latest_telemetry_by_device_uid(self._db, device_uid)

    def create(self, payload: TelemetryCreate) -> Telemetry | None:
        """Create a single telemetry record."""
        return telemetry_repository.create_telemetry(self._db, payload)

    def create_metrics(
        self,
        device_uid: str,
        timestamp: datetime,
        metrics: dict[str, float],
        raw_payload: dict[str, Any] | None = None,
    ) -> list[Telemetry]:
        """Create multiple telemetry records from a metrics dict."""
        return telemetry_repository.create_telemetry_metrics(
            self._db,
            device_uid=device_uid,
            timestamp=timestamp,
            metrics=metrics,
            raw_payload=raw_payload,
        )
