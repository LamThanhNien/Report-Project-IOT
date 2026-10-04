import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.bounded_contexts.identity.presentation.schemas import validate_password_policy
from app.core.permissions import VIEWER_ROLE, validate_permissions, validate_viewer_permissions


# ── Service Plan ────────────────────────────────────────────────────────────


class ServicePlanCreate(BaseModel):
    name: str
    max_devices: int = 5
    max_users: int = 3
    telemetry_retention_days: int = 7
    features: dict[str, bool] = {}


class ServicePlanUpdate(BaseModel):
    name: str | None = None
    max_devices: int | None = None
    max_users: int | None = None
    telemetry_retention_days: int | None = None
    features: dict[str, bool] | None = None
    is_active: bool | None = None


class ServicePlanRead(BaseModel):
    id: uuid.UUID
    name: str
    max_devices: int
    max_users: int
    telemetry_retention_days: int
    features: dict[str, bool]
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Tenant ───────────────────────────────────────────────────────────────────


class TenantCreate(BaseModel):
    name: str
    slug: str = Field(..., min_length=3, max_length=63, pattern=r"^[a-z0-9-]+$")
    plan_id: uuid.UUID | None = None
    owner_email: EmailStr | None = None
    owner_password: str | None = None
    owner_full_name: str | None = None

    @field_validator("owner_password")
    @classmethod
    def validate_owner_password(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return validate_password_policy(value, "Owner password")


class TenantUpdate(BaseModel):
    name: str | None = None
    slug: str | None = Field(default=None, min_length=3, max_length=63, pattern=r"^[a-z0-9-]+$")
    plan_id: uuid.UUID | None = None
    is_active: bool | None = None


class TenantStatusUpdate(BaseModel):
    is_active: bool


class TenantRead(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    is_active: bool
    plan_id: uuid.UUID | None
    plan_name: str | None = None
    device_count: int = 0
    user_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Feature overrides ────────────────────────────────────────────────────────


class FeatureOverrideItem(BaseModel):
    feature_name: str
    is_enabled: bool


class TenantFeaturesUpdate(BaseModel):
    overrides: list[FeatureOverrideItem]


class TenantFeaturesRead(BaseModel):
    tenant_id: uuid.UUID
    plan_features: dict[str, bool]
    overrides: dict[str, bool]
    effective: dict[str, bool]


# ── Tenant user management (admin) ───────────────────────────────────────────


class TenantUserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str | None = None
    role: str = VIEWER_ROLE
    permissions: list[str] | None = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not v or len(v) > 255:
            raise ValueError("Email must be between 1 and 255 characters")
        # Basic email format validation
        if "@" not in v or "." not in v.rsplit("@", 1)[-1]:
            raise ValueError("Invalid email format")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        return validate_password_policy(v)

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        allowed = {"tenant_owner", "viewer"}
        if v not in allowed:
            raise ValueError(f"role must be one of {allowed}")
        return v

    @field_validator("permissions")
    @classmethod
    def validate_user_permissions(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        return validate_permissions(value)


    @model_validator(mode="after")
    def validate_role_permissions(self):
        if self.role == VIEWER_ROLE and self.permissions is not None:
            self.permissions = validate_viewer_permissions(self.permissions)
        return self


class TenantUserUpdate(BaseModel):
    full_name: str | None = None
    role: str | None = None
    permissions: list[str] | None = None
    is_active: bool | None = None

    @field_validator("role")
    @classmethod
    def validate_role(cls, value: str | None) -> str | None:
        if value is None:
            return None
        allowed = {VIEWER_ROLE}
        if value not in allowed:
            raise ValueError(f"role must be one of {allowed}")
        return value

    @field_validator("permissions")
    @classmethod
    def validate_user_permissions(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        return validate_viewer_permissions(value)


class TenantDeviceAssign(BaseModel):
    device_id: uuid.UUID


# ── Client portal responses ──────────────────────────────────────────────────


class ClientMeRead(BaseModel):
    user_id: uuid.UUID
    email: str
    full_name: str | None
    role: str
    permissions: list[str]
    tenant_id: uuid.UUID
    tenant_name: str
    tenant_slug: str
    plan_name: str | None
    features: dict[str, bool]


class ClientDashboardRead(BaseModel):
    total_devices: int
    online_devices: int
    offline_devices: int
    total_telemetry_today: int
    device_status_summary: dict[str, int]


class ClientPlanRead(BaseModel):
    plan_name: str | None
    max_devices: int
    max_users: int
    telemetry_retention_days: int
    current_device_count: int
    current_user_count: int
    features: dict[str, bool]


class ClientAuditLogRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID | None
    action: str
    resource_type: str | None
    resource_id: str | None
    detail: dict | None
    created_at: datetime

    model_config = {"from_attributes": True}
