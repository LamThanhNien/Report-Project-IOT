"""Device Provisioning schemas."""

from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.shared.schemas.tenant import TenantSummary, tenant_summary


class ClaimCodeCreate(BaseModel):
    device_id: Optional[UUID] = None
    expires_in_hours: int = Field(default=24, ge=1, le=720)

    @field_validator("device_id", mode="before")
    @classmethod
    def empty_str_to_none(cls, v):
        """Treat empty string as None (no device)."""
        if isinstance(v, str) and v.strip() == "":
            return None
        return v


class ProvisioningSessionResponse(BaseModel):
    id: UUID
    device_id: Optional[UUID]
    device_name: Optional[str] = None
    tenant_id: Optional[UUID]
    tenant: TenantSummary | None = None
    claim_code: Optional[str]
    status: str
    expires_at: Optional[datetime]
    claimed_at: Optional[datetime]
    claimed_by: Optional[UUID]
    created_at: datetime

    @classmethod
    def from_orm_model(cls, obj, device_name: Optional[str] = None):
        """Explicit mapper — avoids reading reserved ORM attributes like .metadata.

        Args:
            obj: ProvisioningSession ORM instance.
            device_name: Optional device name resolved by the router.
        """
        return cls(
            id=obj.id,
            device_id=obj.device_id,
            device_name=device_name,
            tenant_id=obj.tenant_id,
            tenant=tenant_summary(getattr(obj, "tenant", None)),
            claim_code=obj.claim_code,
            status=obj.status,
            expires_at=obj.expires_at,
            claimed_at=obj.claimed_at,
            claimed_by=obj.claimed_by,
            created_at=obj.created_at,
        )


class ClaimDeviceRequest(BaseModel):
    claim_code: str = Field(..., min_length=1, max_length=128)
