"""Telemetry domain value objects.

Pure domain objects with no framework dependencies (no FastAPI, SQLAlchemy, etc.).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID


@dataclass(frozen=True)
class TelemetryMetric:
    """A single numeric telemetry measurement.

    Immutable value object representing one metric reading from a device.
    """

    metric_name: str
    metric_value: float
    unit: str | None = None

    def __post_init__(self) -> None:
        if not self.metric_name:
            raise ValueError("metric_name must not be empty")
        if not isinstance(self.metric_value, (int, float)):
            raise ValueError("metric_value must be numeric")


@dataclass(frozen=True)
class TelemetryFilter:
    """Filter criteria for querying telemetry records.

    Used by the application layer to pass query parameters to the repository.
    """

    tenant_id: UUID | None = None
    device_uid: str | None = None
    metric_name: str | None = None
    from_time: datetime | None = None
    to_time: datetime | None = None
    limit: int = 100
    offset: int = 0

    def __post_init__(self) -> None:
        if self.limit < 1:
            raise ValueError("limit must be >= 1")
        if self.limit > 1000:
            raise ValueError("limit must be <= 1000")
        if self.offset < 0:
            raise ValueError("offset must be >= 0")


@dataclass
class TelemetryIngestResult:
    """Result of a telemetry ingestion operation.

    Returned by the ingest use case to indicate success/failure and counts.
    """

    device_uid: str
    metrics_stored: int = 0
    metric_names: list[str] = field(default_factory=list)
    success: bool = True
    error_message: str | None = None
    raw_payload: dict[str, Any] | None = None
