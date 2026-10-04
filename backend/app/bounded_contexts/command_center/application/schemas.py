"""Command Center schemas."""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.shared.schemas.tenant import TenantSummary, tenant_summary


class CommandTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    command_type: str = Field(..., min_length=1, max_length=64)
    payload_template: dict = {}


class CommandTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    command_type: Optional[str] = Field(None, min_length=1, max_length=64)
    payload_template: Optional[dict] = None


class CommandTemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: Optional[UUID]
    name: str
    description: Optional[str]
    command_type: str
    payload_template: dict
    is_system: bool
    created_at: datetime
    updated_at: datetime


class CommandDispatchRequest(BaseModel):
    template_id: Optional[UUID] = None
    command_type: str = Field(..., min_length=1, max_length=64)
    payload: dict = {}
    target_type: str = Field(..., pattern="^(device|group)$")
    target_device_id: Optional[UUID] = None
    target_group_id: Optional[UUID] = None


class CommandTargetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    device_id: UUID
    status: str
    sent_at: Optional[datetime]
    acked_at: Optional[datetime]
    completed_at: Optional[datetime]
    error_message: Optional[str]


class CommandDispatchResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: Optional[UUID]
    tenant: TenantSummary | None = None
    command_type: str
    target_type: str
    status: str
    sent_at: Optional[datetime]
    completed_at: Optional[datetime]
    error_message: Optional[str]
    retry_count: int
    created_at: datetime
    targets: List[CommandTargetResponse] = []

    @classmethod
    def from_orm_model(cls, model):
        return cls(
            id=model.id,
            tenant_id=model.tenant_id,
            tenant=tenant_summary(getattr(model, "tenant", None)),
            command_type=model.command_type,
            target_type=model.target_type,
            status=model.status,
            sent_at=model.sent_at,
            completed_at=model.completed_at,
            error_message=model.error_message,
            retry_count=model.retry_count,
            created_at=model.created_at,
            targets=getattr(model, "targets", []),
        )
