"""Device Group schemas."""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.shared.schemas.tenant import TenantSummary, tenant_summary


class DeviceGroupCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    group_type: str = Field(default="manual", pattern="^(manual|dynamic|tag_based)$")
    tags: List[str] = []
    metadata: dict = {}


class DeviceGroupUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    metadata: Optional[dict] = None
    status: Optional[str] = Field(None, pattern="^(active|archived)$")


class DeviceGroupResponse(BaseModel):
    id: UUID
    tenant_id: UUID
    tenant: TenantSummary | None = None
    name: str
    description: Optional[str]
    group_type: str
    status: str
    tags: List[str]
    metadata: dict = {}
    device_count: int = 0
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm_model(cls, model):
        raw_meta = model.extra_metadata
        if not isinstance(raw_meta, dict):
            raw_meta = {}
        return cls(
            id=model.id,
            tenant_id=model.tenant_id,
            tenant=tenant_summary(getattr(model, "tenant", None)),
            name=model.name,
            description=model.description,
            group_type=model.group_type,
            status=model.status,
            tags=model.tags if isinstance(model.tags, list) else [],
            metadata=raw_meta,
            device_count=getattr(model, "device_count", 0),
            created_at=model.created_at,
            updated_at=model.updated_at,
        )


class DeviceGroupMemberAdd(BaseModel):
    device_ids: List[UUID] = Field(..., min_length=1)


class DeviceGroupMemberRemove(BaseModel):
    device_ids: List[UUID] = Field(..., min_length=1)


class DeviceGroupMemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    device_id: UUID
    device_uid: Optional[str] = None
    device_name: Optional[str] = None
    added_at: datetime
