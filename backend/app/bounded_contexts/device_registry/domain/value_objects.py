"""Device Registry domain value objects.

Framework-agnostic value objects for device management business rules.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class DeviceStatus(str, Enum):
    """Normalized device connection status."""

    ONLINE = "online"
    OFFLINE = "offline"
    UNKNOWN = "unknown"
    MAINTENANCE = "maintenance"

    @classmethod
    def normalize(cls, raw: str | None) -> DeviceStatus:
        """Normalize raw status string to enum value."""
        if raw is None:
            return cls.UNKNOWN
        normalized = str(raw).strip().lower()
        ONLINE_VARIANTS = {"online", "connected", "ok", "up", "alive"}
        OFFLINE_VARIANTS = {"offline", "disconnected", "down", "dead", "unreachable", "lost"}
        MAINTENANCE_VARIANTS = {"maintenance", "maint", "service"}

        if normalized in ONLINE_VARIANTS:
            return cls.ONLINE
        if normalized in OFFLINE_VARIANTS:
            return cls.OFFLINE
        if normalized in MAINTENANCE_VARIANTS:
            return cls.MAINTENANCE
        return cls.UNKNOWN

    @property
    def is_online(self) -> bool:
        return self == DeviceStatus.ONLINE

    @property
    def is_offline(self) -> bool:
        return self == DeviceStatus.OFFLINE


@dataclass(frozen=True)
class OfflineTimeout:
    """Value object for device offline timeout configuration."""

    MIN_SECONDS = 10
    MAX_SECONDS = 600
    DEFAULT_SECONDS = 60

    seconds: int

    def __post_init__(self) -> None:
        if not isinstance(self.seconds, int):
            object.__setattr__(self, "seconds", self.DEFAULT_SECONDS)
        clamped = max(self.MIN_SECONDS, min(self.MAX_SECONDS, self.seconds))
        if clamped != self.seconds:
            object.__setattr__(self, "seconds", clamped)

    @classmethod
    def default(cls) -> OfflineTimeout:
        return cls(seconds=cls.DEFAULT_SECONDS)

    @classmethod
    def from_optional(cls, value: int | None) -> OfflineTimeout:
        if value is None:
            return cls.default()
        return cls(seconds=value)


@dataclass(frozen=True)
class DeviceUID:
    """Value object for device unique identifier."""

    value: str

    def __post_init__(self) -> None:
        if not self.value or not self.value.strip():
            raise ValueError("DeviceUID cannot be empty")
        object.__setattr__(self, "value", self.value.strip())

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class MqttTopics:
    """MQTT topic paths for a device."""

    telemetry: str
    status: str
    events: str
    commands: str
    ota: str
    ota_status: str

    def to_dict(self) -> dict[str, str]:
        return {
            "telemetry": self.telemetry,
            "status": self.status,
            "events": self.events,
            "commands": self.commands,
            "ota": self.ota,
            "ota_status": self.ota_status,
        }
