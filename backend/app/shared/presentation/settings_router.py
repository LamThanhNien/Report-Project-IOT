from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.core.security import require_admin
from app.db.session import get_db
from app.modules.audit import service as audit_service
from app.modules.auth.model import User
from app.shared.infrastructure.persistence.settings_models import SystemSettings

router = APIRouter(prefix="/admin/settings", tags=["admin-settings"])


class SystemSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    organization_name: str
    timezone: str
    default_locale: str
    email_notifications_enabled: bool
    updated_at: datetime


class SystemSettingsUpdate(BaseModel):
    organization_name: str | None = Field(default=None, min_length=1, max_length=255)
    timezone: str | None = Field(default=None, max_length=64)
    default_locale: str | None = Field(default=None, pattern="^[a-z]{2}(?:-[A-Z]{2})?$")
    email_notifications_enabled: bool | None = None

    @field_validator("organization_name")
    @classmethod
    def strip_organization_name(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("timezone must be a valid IANA timezone") from exc
        return value


class OtaPolicyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    auto_update_enabled: bool
    maintenance_window_start: str
    maintenance_window_end: str
    rollback_threshold: int
    max_concurrent_updates: int
    ota_retry_limit: int
    allowed_release_channels: list[str]
    require_signed_stable_firmware: bool
    updated_at: datetime


class OtaPolicyUpdate(BaseModel):
    auto_update_enabled: bool | None = None
    maintenance_window_start: str | None = Field(
        default=None, pattern="^(?:[01]\\d|2[0-3]):[0-5]\\d$"
    )
    maintenance_window_end: str | None = Field(
        default=None, pattern="^(?:[01]\\d|2[0-3]):[0-5]\\d$"
    )
    rollback_threshold: int | None = Field(default=None, ge=1, le=100)
    max_concurrent_updates: int | None = Field(default=None, ge=1, le=1000)
    ota_retry_limit: int | None = Field(default=None, ge=0, le=10)
    allowed_release_channels: list[str] | None = None
    require_signed_stable_firmware: bool | None = None

    @field_validator("allowed_release_channels")
    @classmethod
    def validate_channels(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        allowed = {"dev", "staging", "stable"}
        normalized = list(dict.fromkeys(item.strip().lower() for item in value))
        if not normalized or any(item not in allowed for item in normalized):
            raise ValueError("allowed_release_channels may contain dev, staging, and stable")
        return normalized


def _get_or_create(db: Session) -> SystemSettings:
    settings = db.get(SystemSettings, 1)
    if settings is None:
        settings = SystemSettings(id=1)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def _apply_update(
    db: Session, settings: SystemSettings, payload: BaseModel, admin: User, action: str
):
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    for key, value in changes.items():
        setattr(settings, key, value)
    db.add(settings)
    db.commit()
    db.refresh(settings)
    audit_service.log_event_best_effort(
        db,
        action=action,
        user_id=admin.id,
        resource_type="system_settings",
        resource_id="1",
        detail={"changed_fields": sorted(changes)},
    )
    return settings


@router.get("", response_model=SystemSettingsRead)
def get_system_settings(
    db: Session = Depends(get_db), _admin: User = Depends(require_admin)
) -> SystemSettings:
    return _get_or_create(db)


@router.patch("", response_model=SystemSettingsRead)
def update_system_settings(
    payload: SystemSettingsUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> SystemSettings:
    return _apply_update(db, _get_or_create(db), payload, admin, "update_system_settings")


@router.get("/ota-policy", response_model=OtaPolicyRead)
def get_ota_policy(
    db: Session = Depends(get_db), _admin: User = Depends(require_admin)
) -> SystemSettings:
    return _get_or_create(db)


@router.patch("/ota-policy", response_model=OtaPolicyRead)
def update_ota_policy(
    payload: OtaPolicyUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> SystemSettings:
    if not payload.model_fields_set:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No fields to update"
        )
    return _apply_update(db, _get_or_create(db), payload, admin, "update_ota_policy")
