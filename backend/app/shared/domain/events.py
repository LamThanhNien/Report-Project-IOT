"""Shared domain event base classes.

Domain events are used for cross-context communication within the modular
monolith.  They are plain Python dataclasses — no framework dependencies.

Usage:
    from shared.domain.events import DomainEvent

    class DeviceRegistered(DomainEvent):
        device_uid: str
        tenant_id: str | None = None
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import UUID, uuid4


@dataclass(frozen=True)
class DomainEvent:
    """Base class for all domain events.

    Every event gets a unique ID and a UTC timestamp automatically.
    Events are immutable (frozen dataclass).
    """

    event_id: UUID = field(default_factory=uuid4)
    occurred_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Identity events
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class UserLoggedIn(DomainEvent):
    user_id: str = ""
    email: str = ""


# ---------------------------------------------------------------------------
# Device registry events
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DeviceRegistered(DomainEvent):
    device_uid: str = ""
    tenant_id: str | None = None


@dataclass(frozen=True)
class DeviceStatusChanged(DomainEvent):
    device_uid: str = ""
    old_status: str = ""
    new_status: str = ""


# ---------------------------------------------------------------------------
# Firmware / OTA events
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class FirmwareUploaded(DomainEvent):
    firmware_id: str = ""
    version: str = ""
    target_device_type: str = ""
    tenant_id: str | None = None


@dataclass(frozen=True)
class OtaJobCreated(DomainEvent):
    job_id: str = ""
    device_uid: str = ""
    firmware_version: str = ""


@dataclass(frozen=True)
class OtaJobCompleted(DomainEvent):
    job_id: str = ""
    device_uid: str = ""
    status: str = ""  # "success" or "failed"


# ---------------------------------------------------------------------------
# Telemetry events
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TelemetryIngested(DomainEvent):
    device_uid: str = ""
    metric_count: int = 0


# ---------------------------------------------------------------------------
# Tenant management events
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TenantCreated(DomainEvent):
    tenant_id: str = ""
    name: str = ""
    slug: str = ""


@dataclass(frozen=True)
class DeviceAssignedToTenant(DomainEvent):
    device_id: str = ""
    tenant_id: str = ""
