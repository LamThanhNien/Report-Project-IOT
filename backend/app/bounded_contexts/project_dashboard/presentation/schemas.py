import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.modules.devices.schema import DeviceRead
from app.modules.firmware.schema import FirmwareRead
from app.modules.ota.schema import OtaJobRead
from app.modules.telemetry.schema import TelemetryRead
from app.bounded_contexts.project_dashboard.domain.widget_registry import (
    ALL_WIDGET_TYPES, canonical_widget_type, normalize_widget_document,
)

WidgetType = str
ALLOWED_WIDGET_TYPES = ALL_WIDGET_TYPES




class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None








class PageCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    slug: str = Field(default="main", min_length=1, max_length=120)
    sort_order: int = Field(default=0, ge=0, le=2_147_483_647)
    layout: dict[str, Any] = Field(default_factory=dict)


class WidgetCreate(BaseModel):
    widget_type: WidgetType
    title: str = Field(min_length=1, max_length=255)
    sort_order: int = Field(default=0, ge=0, le=2_147_483_647)
    layout: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    binding: dict[str, Any] = Field(default_factory=dict)

    @field_validator("widget_type")
    @classmethod
    def validate_widget_type(cls, value: str) -> str:
        canonical = canonical_widget_type(value)
        if value not in ALLOWED_WIDGET_TYPES and canonical not in ALLOWED_WIDGET_TYPES:
            raise ValueError(f"widget_type must be one of {sorted(ALLOWED_WIDGET_TYPES)}")
        return canonical

    @field_validator("layout", "config", "binding")
    @classmethod
    def validate_json_document(cls, value: dict[str, Any]) -> dict[str, Any]:
        return normalize_widget_document(value)


class WidgetUpdate(BaseModel):
    widget_type: WidgetType | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    sort_order: int | None = Field(default=None, ge=0, le=2_147_483_647)
    layout: dict[str, Any] | None = None
    config: dict[str, Any] | None = None
    binding: dict[str, Any] | None = None

    @field_validator("widget_type")
    @classmethod
    def validate_widget_type(cls, value: str | None) -> str | None:
        canonical = canonical_widget_type(value) if value is not None else None
        if (
            value is not None
            and value not in ALLOWED_WIDGET_TYPES
            and canonical not in ALLOWED_WIDGET_TYPES
        ):
            raise ValueError(f"widget_type must be one of {sorted(ALLOWED_WIDGET_TYPES)}")
        return canonical

    @field_validator("layout", "config", "binding")
    @classmethod
    def validate_json_document(cls, value: dict[str, Any] | None) -> dict[str, Any] | None:
        return normalize_widget_document(value) if value is not None else value


class ProjectWidgetRead(BaseModel):
    id: uuid.UUID
    page_id: uuid.UUID
    widget_type: str
    title: str
    sort_order: int
    layout: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    binding: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectPageRead(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    title: str
    slug: str
    sort_order: int
    layout: dict[str, Any] = Field(default_factory=dict)
    widgets: list[ProjectWidgetRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DeviceCommandRequest(BaseModel):
    command: str = Field(min_length=1, max_length=64)
    params: dict[str, Any] = Field(default_factory=dict)


class DeviceCommandResponse(BaseModel):
    accepted: bool
    request_id: uuid.UUID
    topic: str


class DeviceCapabilityRead(BaseModel):
    id: uuid.UUID
    device_id: uuid.UUID
    tenant_id: uuid.UUID | None
    capability_key: str
    capability_type: str
    label: str
    gpio_pin: int | None
    channel: str | None = None
    command_name: str
    telemetry_state_key: str | None
    is_bindable: bool = True
    config_json: dict[str, Any]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)






class TenantProjectRead(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TenantProjectSummary(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime


class TenantProjectDetail(TenantProjectRead):
    pages: list[ProjectPageRead] = Field(default_factory=list)
    latest_state: dict[str, dict[str, Any]] = Field(default_factory=dict)






class DeviceProjectBindingRead(BaseModel):
    project_id: uuid.UUID
    project_name: str


class DeviceLiveStatusRead(BaseModel):
    connection_status: str | None = None
    mqtt_status: str | None = None
    last_telemetry_at: datetime | None = None
    latest_payload: dict[str, Any] = Field(default_factory=dict)
    sensor_values: dict[str, Any] = Field(default_factory=dict)
    output_states: dict[str, Any] = Field(default_factory=dict)
    system_values: dict[str, Any] = Field(default_factory=dict)


class DeviceActivityItemRead(BaseModel):
    kind: str
    title: str
    timestamp: datetime
    severity: str | None = None
    status: str | None = None
    detail: dict[str, Any] = Field(default_factory=dict)


class TenantDeviceDetailRead(BaseModel):
    device: DeviceRead
    live_status: DeviceLiveStatusRead
    project_bindings: list[DeviceProjectBindingRead] = Field(default_factory=list)
    recent_telemetry: list[TelemetryRead] = Field(default_factory=list)
    ota_jobs: list[OtaJobRead] = Field(default_factory=list)
    alerts: list[dict[str, Any]] = Field(default_factory=list)
    available_firmware: list[FirmwareRead] = Field(default_factory=list)
    activity: list[DeviceActivityItemRead] = Field(default_factory=list)
    can_send_commands: bool = False
    can_reboot: bool = False


class ProjectDeviceSummaryRead(BaseModel):
    device: DeviceRead
    latest_state: dict[str, Any] = Field(default_factory=dict)
    last_telemetry_at: datetime | None = None
    latest_ota_status: str | None = None
    latest_ota_progress: int | None = None
    recent_alert_count: int = 0
    recent_alerts: list[dict[str, Any]] = Field(default_factory=list)


class ProjectAccessPolicyRead(BaseModel):
    tenant_ownership_rule: str
    admin_access_rule: str
    support_mode_rule: str
    read_only: bool = True


class AdminTenantProjectReadOnlyRead(TenantProjectDetail):
    tenant_name: str
    tenant_slug: str
    read_only: bool = True
    access_policy: ProjectAccessPolicyRead
    device_summaries: list[ProjectDeviceSummaryRead] = Field(default_factory=list)
    recent_ota_jobs: list[OtaJobRead] = Field(default_factory=list)
    recent_alerts: list[dict[str, Any]] = Field(default_factory=list)


# ─── Datastream (Virtual Pin) Schemas ──────────────────────────────────────────

DATA_TYPES = {"integer", "double", "string", "boolean"}
DIRECTIONS = {"telemetry", "command", "bidirectional"}


class DatastreamCreate(BaseModel):
    project_id: uuid.UUID
    name: str = Field(min_length=1, max_length=255)
    alias: str = Field(default="", max_length=255)
    pin: int = Field(ge=0, le=255, description="Virtual pin number (0-255 → V0-V255)")
    data_type: str = Field(default="double")
    direction: str = Field(default="bidirectional")
    unit: str | None = Field(default=None, max_length=64)
    min_value: float | None = None
    max_value: float | None = None
    default_value: str | None = Field(default=None, max_length=255)
    description: str | None = None
    is_custom: bool = Field(default=True)
    status: str = Field(default="active", max_length=32)
    supported_model_ids: list[uuid.UUID] = Field(default=[])

    @field_validator("data_type")
    @classmethod
    def validate_data_type(cls, v: str) -> str:
        if v not in DATA_TYPES:
            raise ValueError(f"data_type must be one of {sorted(DATA_TYPES)}")
        return v

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, v: str) -> str:
        if v not in DIRECTIONS:
            raise ValueError(f"direction must be one of {sorted(DIRECTIONS)}")
        return v

    @field_validator("alias")
    @classmethod
    def auto_alias(cls, v: str) -> str:
        """Nếu alias trống sẽ được tự sinh từ name ở tầng repo."""
        return v.strip()

    @model_validator(mode="after")
    def validate_value_constraints(self):
        if self.data_type not in {"integer", "double"} and (
            self.min_value is not None or self.max_value is not None
        ):
            raise ValueError("min_value and max_value require numeric data_type")
        if (
            self.min_value is not None
            and self.max_value is not None
            and self.min_value >= self.max_value
        ):
            raise ValueError("min_value must be less than max_value")
        if self.data_type == "integer" and any(
            value is not None and not value.is_integer()
            for value in (self.min_value, self.max_value)
        ):
            raise ValueError("integer datastream bounds must be whole numbers")
        self._validate_default_value()
        return self

    def _validate_default_value(self) -> None:
        if self.default_value is None:
            return
        if self.data_type == "boolean" and self.default_value.lower() not in {"true", "false"}:
            raise ValueError("boolean default_value must be 'true' or 'false'")
        if self.data_type in {"integer", "double"}:
            try:
                value = float(self.default_value)
            except ValueError as exc:
                raise ValueError("numeric default_value must be numeric") from exc
            if self.data_type == "integer" and not value.is_integer():
                raise ValueError("integer default_value must be a whole number")
            if (
                self.min_value is not None
                and value < self.min_value
                or self.max_value is not None
                and value > self.max_value
            ):
                raise ValueError("default_value must be within min_value and max_value")


class DatastreamUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    alias: str | None = Field(default=None, max_length=255)
    data_type: str | None = None
    direction: str | None = None
    unit: str | None = None
    min_value: float | None = None
    max_value: float | None = None
    default_value: str | None = None
    description: str | None = None
    is_custom: bool | None = None
    status: str | None = None
    supported_model_ids: list[uuid.UUID] | None = None

    @field_validator("data_type")
    @classmethod
    def validate_data_type(cls, v: str | None) -> str | None:
        if v is not None and v not in DATA_TYPES:
            raise ValueError(f"data_type must be one of {sorted(DATA_TYPES)}")
        return v

    @field_validator("direction")
    @classmethod
    def validate_direction(cls, v: str | None) -> str | None:
        if v is not None and v not in DIRECTIONS:
            raise ValueError(f"direction must be one of {sorted(DIRECTIONS)}")
        return v


class DatastreamRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tenant_id: uuid.UUID
    project_id: uuid.UUID
    name: str
    alias: str
    pin: int
    data_type: str
    direction: str
    unit: str | None
    min_value: float | None
    max_value: float | None
    default_value: str | None
    description: str | None
    is_custom: bool
    status: str
    supported_model_ids: list[uuid.UUID] = []
    created_at: datetime
    updated_at: datetime


class DatastreamCompatibilityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    datastream_id: uuid.UUID
    device_model_id: uuid.UUID
    channel: str
    created_at: datetime


class DatastreamListResponse(BaseModel):
    items: list[DatastreamRead]
    total: int
    used_pins: list[int]
