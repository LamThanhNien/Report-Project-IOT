from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DeviceTypeCreate(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    default_hardware_model: str | None = Field(default=None, max_length=128)


class DeviceTypeRead(BaseModel):
    id: UUID
    key: str
    name: str
    description: str | None = None
    default_hardware_model: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DeviceTypeUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    default_hardware_model: str | None = Field(default=None, max_length=128)
