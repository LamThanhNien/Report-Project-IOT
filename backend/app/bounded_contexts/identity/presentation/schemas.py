import uuid
from datetime import datetime
from typing import Any, Literal
from types import SimpleNamespace

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.core.permissions import (
    get_effective_permissions,
)



def validate_password_policy(value: str, field_name: str = "Password") -> str:
    if len(value) < 8:
        raise ValueError(f"{field_name} must be at least 8 characters")
    if len(value) > 128:
        raise ValueError(f"{field_name} must not exceed 128 characters")
    if not any(ch.isupper() for ch in value):
        raise ValueError(f"{field_name} must include at least one uppercase letter")
    if not any(ch.islower() for ch in value):
        raise ValueError(f"{field_name} must include at least one lowercase letter")
    if not any(ch.isdigit() for ch in value):
        raise ValueError(f"{field_name} must include at least one digit")
    return value


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not v or len(v) > 255:
            raise ValueError("Email must be between 1 and 255 characters")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if not v or len(v) > 128:
            raise ValueError("Password must be between 1 and 128 characters")
        return v


class RegisterRequest(BaseModel):
    tenant_name: str
    tenant_slug: str | None = Field(
        default=None, min_length=3, max_length=63, pattern=r"^[a-z0-9-]+$"
    )
    owner_email: EmailStr
    owner_password: str
    owner_full_name: str | None = None

    @field_validator("tenant_name")
    @classmethod
    def validate_tenant_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("tenant_name must contain at least 2 characters")
        return value

    @field_validator("tenant_slug")
    @classmethod
    def validate_tenant_slug(cls, value: str | None) -> str | None:
        if value is None or value.strip() == "":
            return None
        value = value.strip().lower()
        if len(value) < 3:
            raise ValueError("tenant_slug must contain at least 3 characters")
        return value

    @field_validator("owner_email")
    @classmethod
    def validate_owner_email(cls, value: EmailStr | str) -> str:
        value_str = str(value).strip().lower()
        if "@" not in value_str or "." not in value_str.rsplit("@", 1)[-1]:
            raise ValueError("owner_email must be a valid email address")
        return value_str

    @field_validator("owner_password")
    @classmethod
    def validate_owner_password(cls, value: str) -> str:
        return validate_password_policy(value, "Password")


class UserRead(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    role: Literal["admin", "tenant_owner", "viewer"]
    is_active: bool
    permissions: list[str]
    tenant_id: uuid.UUID | None = None
    created_at: datetime

    @model_validator(mode="before")
    @classmethod
    def include_effective_permissions(cls, data: Any) -> Any:
        if isinstance(data, dict):
            data = dict(data)
            data["permissions"] = get_effective_permissions(SimpleNamespace(
                role=data.get("role"), permissions=data.get("permissions"),
            ))
            return data
        if hasattr(data, "role"):
            permissions = get_effective_permissions(data)
            return {
                "id": data.id,
                "email": data.email,
                "full_name": data.full_name,
                "role": data.role,
                "is_active": data.is_active,
                "permissions": permissions,
                "tenant_id": data.tenant_id,
                "created_at": data.created_at,
            }
        return data

    model_config = {"from_attributes": True}


class UserProfileUpdate(BaseModel):
    full_name: str | None = None

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None
        if len(value) > 255:
            raise ValueError("full_name must not exceed 255 characters")
        return value


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("current_password")
    @classmethod
    def validate_current_password(cls, value: str) -> str:
        if not value or len(value) > 128:
            raise ValueError("Current password is invalid")
        return value

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str) -> str:
        return validate_password_policy(value, "New password")


class TokenResponse(BaseModel):
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
    user: UserRead | None = None
