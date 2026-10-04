from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.shared.schemas.tenant import TenantSummary


class FirmwareRead(BaseModel):
    id: UUID
    version: str
    target_device_type: str
    file_name: str | None
    object_key: str | None
    file_size: int | None
    checksum_sha256: str | None
    release_notes: str | None
    is_active: bool
    source_type: str = "binary"
    source_code: str | None = None
    board_fqbn: str | None = None
    uploaded_by_tenant_id: UUID | None = None
    tenant: TenantSummary | None = None
    signature: str | None = None
    signature_alg: str | None = None
    signature_payload: str | None = None
    signing_key_id: str | None = None
    signing_public_key: str | None = None
    signed_at: datetime | None = None
    verification_required: bool = False
    release_channel: str | None = None
    archived_at: datetime | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FirmwareCreate(BaseModel):
    version: str = Field(min_length=1, max_length=64)
    target_device_type: str = Field(min_length=3, max_length=63, pattern=r"^[a-z0-9-]+$")
    file_name: str = Field(min_length=1, max_length=255)
    object_key: str = Field(min_length=1, max_length=512)
    file_size: int = Field(ge=1)
    checksum_sha256: str = Field(min_length=64, max_length=64)
    release_notes: str | None = None
    signature: str | None = None
    signature_alg: str | None = Field(default=None, max_length=32)
    signature_payload: str | None = Field(default=None, max_length=64)
    signing_key_id: str | None = Field(default=None, max_length=128)
    release_channel: str = Field(default="dev", pattern="^(dev|staging|stable)$")
    verification_required: bool = False


class FirmwareFromSourceRequest(BaseModel):
    version: str = Field(min_length=1, max_length=64)
    target_device_type: str = Field(min_length=3, max_length=63, pattern=r"^[a-z0-9-]+$")
    board_fqbn: str = Field(default="esp32:esp32:esp32", min_length=1, max_length=128)
    source_code: str = Field(min_length=1)
    release_notes: str | None = None
