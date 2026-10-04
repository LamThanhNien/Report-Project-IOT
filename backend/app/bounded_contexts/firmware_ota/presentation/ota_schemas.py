from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.shared.schemas.tenant import TenantSummary


class OtaJobCreate(BaseModel):
    device_uid: str | None = Field(default=None, min_length=1, max_length=128)
    group_id: UUID | None = None
    firmware_version_id: UUID

    @model_validator(mode="after")
    def _exactly_one_target(self) -> "OtaJobCreate":
        if bool(self.device_uid) == bool(self.group_id):
            raise ValueError("Provide exactly one OTA target: device_uid or group_id")
        return self


class OtaJobCreateResponse(BaseModel):
    job_id: UUID
    device_uid: str
    tenant: TenantSummary | None = None
    status: str
    job_ids: list[UUID] | None = None
    group_id: UUID | None = None
    created_count: int | None = None
    target_type: str = "device"


class OtaJobRead(BaseModel):
    id: UUID
    device_id: UUID
    device_uid: str
    firmware_version_id: UUID
    firmware_version: str
    status: str
    requested_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    progress: int | None = None
    last_message: str | None = None
    error_code: str | None = None
    error_message: str | None
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class OtaHistoryRead(BaseModel):
    """Device firmware update history record.

    Each record represents one completed (terminal) OTA job on a device,
    conveying the firmware upgrade path: previous_version → new firmware_version.
    """

    id: UUID
    device_id: UUID
    device_uid: str
    firmware_version_id: UUID
    firmware_version: str
    previous_firmware_version: str | None = None
    status: str
    requested_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    error_code: str | None = None
    error_message: str | None
    archived_at: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
