"""Pydantic schemas for device platform and model management."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

# ── DevicePlatform ────────────────────────────────────────────────────────────


class DevicePlatformResponse(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    sdk_toolchain: str | None = None
    description: str | None = None
    wifi_required: bool = True
    supports_mqtt: bool = True
    supports_ota: bool = True
    supports_gpio_config: bool = True
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class DevicePlatformCreate(BaseModel):
    key: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    sdk_toolchain: str | None = Field(None, max_length=128)
    description: str | None = None
    wifi_required: bool = True
    supports_mqtt: bool = True
    supports_ota: bool = True
    supports_gpio_config: bool = True


class DevicePlatformUpdate(DevicePlatformCreate):
    pass


# ── DeviceModel ───────────────────────────────────────────────────────────────


class GpioPinsConfig(BaseModel):
    """GPIO pin configuration for a device model."""

    min: int = 0
    max: int = 39
    reserved: list[int] = Field(default_factory=list)
    bootstraps: list[int] = Field(default_factory=list)
    output_capable: list[int] = Field(default_factory=list)


class DeviceModelResponse(BaseModel):
    id: uuid.UUID
    platform_id: uuid.UUID
    key: str
    name: str
    description: str | None = None
    gpio_pins_json: dict = Field(default_factory=dict)
    default_capabilities_json: list = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_validator("gpio_pins_json", mode="before")
    @classmethod
    def normalize_legacy_gpio(cls, value):
        if value is None:
            return {}
        if isinstance(value, list):
            pins = [p for p in value if isinstance(p, dict) and type(p.get("gpio_num")) is int]
            if len(pins) != len(value):
                raise ValueError("Legacy GPIO pins must contain integer gpio_num values")
            numbers = [p["gpio_num"] for p in pins]
            return {
                "min": min(numbers, default=0),
                "max": max(numbers, default=0),
                "reserved": [p["gpio_num"] for p in pins if p.get("is_reserved")],
                "bootstraps": [p["gpio_num"] for p in pins if p.get("is_bootstrapping")],
                "output_capable": [
                    p["gpio_num"]
                    for p in pins
                    if p.get("digital_output") and not p.get("is_reserved")
                ],
                "pins": pins,
            }
        return value

    model_config = {"from_attributes": True}


class DeviceModelWithPlatform(DeviceModelResponse):
    """Device model with platform info included."""

    platform: DevicePlatformResponse | None = None


class DeviceModelCreate(BaseModel):
    platform_id: uuid.UUID
    key: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    gpio_pins_json: dict = Field(default_factory=dict)
    default_capabilities_json: list = Field(default_factory=list)


class DeviceModelUpdate(DeviceModelCreate):
    pass


# ── CapabilityTemplate ────────────────────────────────────────────────────────


class CapabilityTemplateResponse(BaseModel):
    id: uuid.UUID
    device_model_id: uuid.UUID
    capability_key: str
    capability_type: str
    label: str
    gpio_pin: int | None = None
    channel: str | None = None
    command_name: str
    telemetry_state_key: str | None = None
    is_bindable: bool = True
    config_json: dict = Field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}


class CapabilityTemplateCreate(BaseModel):
    device_model_id: uuid.UUID
    capability_key: str = Field(..., min_length=1, max_length=128)
    capability_type: str = Field(..., min_length=1, max_length=64)
    label: str = Field(..., min_length=1, max_length=255)
    gpio_pin: int | None = None
    channel: str | None = Field(None, max_length=64)
    command_name: str = Field(..., min_length=1, max_length=64)
    telemetry_state_key: str | None = Field(None, max_length=128)
    is_bindable: bool = True
    config_json: dict = Field(default_factory=dict)


class CapabilityTemplateUpdate(CapabilityTemplateCreate):
    pass


# ── Device with platform info ─────────────────────────────────────────────────


class DeviceWithPlatformResponse(BaseModel):
    """Device response enriched with platform and model info."""

    id: uuid.UUID
    device_uid: str
    name: str
    hardware_model: str | None = None
    mac_address: str | None = None
    description: str | None = None
    firmware_version: str | None = None
    status: str
    ip_address: str | None = None
    rssi: int | None = None
    free_heap: int | None = None
    uptime_ms: int | None = None
    last_seen_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    # Platform info
    platform_id: uuid.UUID | None = None
    device_model_id: uuid.UUID | None = None
    platform: DevicePlatformResponse | None = None
    device_model: DeviceModelResponse | None = None

    model_config = {"from_attributes": True}


# ── Firmware with platform info ───────────────────────────────────────────────


class FirmwareWithPlatformResponse(BaseModel):
    """Firmware response enriched with platform targeting info."""

    id: uuid.UUID
    version: str
    target_device_type: str
    target_platform_id: uuid.UUID | None = None
    target_model_id: uuid.UUID | None = None
    file_name: str | None = None
    file_size: int | None = None
    checksum_sha256: str | None = None
    release_notes: str | None = None
    is_active: bool = True
    source_type: str = "binary"
    uploaded_by_tenant_id: uuid.UUID | None = None
    status: str = "uploaded"
    created_at: datetime | None = None
    # Platform info
    platform: DevicePlatformResponse | None = None
    device_model: DeviceModelResponse | None = None

    model_config = {"from_attributes": True}
