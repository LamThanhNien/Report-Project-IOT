from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.shared.schemas.tenant import TenantSummary


class DeviceCreate(BaseModel):
    device_uid: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=255)
    hardware_model: str | None = Field(default=None, max_length=128)
    mac_address: str | None = Field(default=None, max_length=17)
    description: str | None = Field(default=None)
    firmware_version: str | None = Field(default=None, max_length=64)
    device_type_id: UUID | None = None
    tenant_id: UUID | None = None
    auth_token_hash: str | None = None
    project_id: UUID | None = None
    device_model_id: UUID | None = None


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    hardware_model: str | None = Field(default=None, max_length=128)
    mac_address: str | None = Field(default=None, max_length=17)
    description: str | None = Field(default=None)
    auth_token_hash: str | None = None
    device_model_id: UUID | None = None


class AdminDeviceCreate(DeviceCreate):
    """Admin device creation can optionally assign a tenant."""

    tenant_id: UUID | None = None


class DeviceRead(BaseModel):
    id: UUID
    device_uid: str
    name: str
    hardware_model: str | None = None
    mac_address: str | None = None
    description: str | None = None
    firmware_version: str | None
    status: str
    ip_address: str | None = None
    rssi: int | None = None
    free_heap: int | None = None
    uptime_ms: int | None = None
    last_status_payload: dict | None = None
    last_seen_at: datetime | None
    offline_timeout_seconds: int = 60
    device_model_id: UUID | None = None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None
    deleted_by: UUID | None = None
    mqtt_username: str | None = None
    project_id: UUID | None = None
    platform_id: UUID | None = None
    device_model_id: UUID | None = None
    tenant: TenantSummary | None = None

    model_config = ConfigDict(from_attributes=True)


class DeviceRegisterResponse(BaseModel):
    device_uid: str
    mqtt_topics: dict[str, str]
    mqtt_username: str | None = None
    mqtt_password: str | None = None


class DeviceStatusResponse(BaseModel):
    device_uid: str
    name: str
    firmware_version: str | None
    status: str
    ip_address: str | None = None
    rssi: int | None = None
    free_heap: int | None = None
    uptime_ms: int | None = None
    last_status_payload: dict | None = None
    last_seen_at: datetime | None
    offline_timeout_seconds: int = 60
    tenant: TenantSummary | None = None


class DeviceOfflineTimeoutUpdate(BaseModel):
    offline_timeout_seconds: int = Field(ge=10, le=600)


class DeviceOfflineTimeoutResponse(BaseModel):
    device_uid: str
    offline_timeout_seconds: int
