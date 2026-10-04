"""Device Registry application use cases.

Orchestrates device management operations through domain value objects
and infrastructure repositories.  Presentation layer delegates to these
use cases instead of calling repositories directly.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Protocol

from app.bounded_contexts.device_registry.domain.value_objects import (
    DeviceStatus,
    DeviceUID,
    MqttTopics,
    OfflineTimeout,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Port interfaces (Protocol-based dependency inversion)
# ---------------------------------------------------------------------------


class DeviceRepository(Protocol):
    """Port for device persistence operations."""

    def list_devices(self) -> list: ...
    def get_device_by_uid(self, device_uid: str) -> object | None: ...
    def create_device(self, payload: object) -> object: ...
    def register_device(self, payload: object) -> object: ...
    def touch_device(self, device_uid: str, **kwargs) -> object | None: ...
    def update_offline_timeout(self, device: object, seconds: int) -> object: ...
    def mark_stale_devices_offline(self) -> int: ...


class MqttTopicsService(Protocol):
    """Port for MQTT topic generation."""

    def topics_for_device(self, device_uid: str) -> MqttTopics: ...


# ---------------------------------------------------------------------------
# Use case result types
# ---------------------------------------------------------------------------


@dataclass
class DeviceRegistrationResult:
    """Result of device registration."""

    device: object
    mqtt_topics: MqttTopics


@dataclass
class DeviceListResult:
    """Result of listing devices."""

    devices: list[object]
    count: int


# ---------------------------------------------------------------------------
# Use cases
# ---------------------------------------------------------------------------


def list_devices(repo: DeviceRepository) -> DeviceListResult:
    """List all devices in the system."""
    devices = repo.list_devices()
    return DeviceListResult(devices=devices, count=len(devices))


def get_device_by_uid(repo: DeviceRepository, device_uid: str) -> object | None:
    """Get a single device by its unique identifier."""
    uid = DeviceUID(device_uid)
    return repo.get_device_by_uid(str(uid))


def register_device(
    repo: DeviceRepository,
    mqtt_service: MqttTopicsService,
    payload: object,
) -> DeviceRegistrationResult:
    """Register a new device or update existing one.

    This is the primary use case for device provisioning.
    The device is created/updated and MQTT topics are generated.
    """
    device = repo.register_device(payload)
    device_uid = getattr(device, "device_uid", "")
    topics = mqtt_service.topics_for_device(device_uid)
    return DeviceRegistrationResult(device=device, mqtt_topics=topics)


def touch_device_status(
    repo: DeviceRepository,
    device_uid: str,
    status: str | None = None,
    **kwargs,
) -> object | None:
    """Update device status and last-seen timestamp.

    Called by MQTT handler when receiving telemetry/heartbeat/status messages.
    Normalizes the raw status string to a DeviceStatus enum value.
    """
    normalized_status = DeviceStatus.normalize(status).value if status else None
    return repo.touch_device(device_uid, status=normalized_status, **kwargs)


def update_offline_timeout(
    repo: DeviceRepository,
    device_uid: str,
    timeout_seconds: int,
) -> object:
    """Update the offline timeout configuration for a device."""
    timeout = OfflineTimeout(seconds=timeout_seconds)
    device = repo.get_device_by_uid(device_uid)
    if device is None:
        raise ValueError(f"Device not found: {device_uid}")
    return repo.update_offline_timeout(device, timeout.seconds)


def check_device_staleness(repo: DeviceRepository) -> int:
    """Mark devices as offline if they haven't been seen within their timeout.

    Returns the number of devices that were marked offline.
    """
    return repo.mark_stale_devices_offline()
