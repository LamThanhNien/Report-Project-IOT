from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.bounded_contexts.firmware_ota.application.firmware_governance import (
    protection_reasons,
    retention_plan,
    sign_firmware,
)
from app.bounded_contexts.firmware_ota.infrastructure.minio_adapter import MinioStorageAdapter
from app.bounded_contexts.firmware_ota.presentation.firmware_schemas import FirmwareRead
from app.core.security import require_admin
from app.core.platform_tenant_access import ensure_platform_owned
from app.db.session import get_db
from app.modules.audit import service as audit_service
from app.modules.auth.model import User
from app.modules.firmware.model import FirmwareVersion
from app.shared.infrastructure.persistence.settings_models import SystemSettings

router = APIRouter(prefix="/admin/firmware", tags=["admin-firmware-governance"])
minio = MinioStorageAdapter()


class BulkDeleteRequest(BaseModel):
    firmware_ids: list[UUID] = Field(min_length=1, max_length=100)
    dry_run: bool = False


class RetentionPolicyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    firmware_retention_days: int
    firmware_min_versions_per_target: int


class RetentionPolicyUpdate(BaseModel):
    firmware_retention_days: int | None = Field(default=None, ge=1, le=3650)
    firmware_min_versions_per_target: int | None = Field(default=None, ge=1, le=100)


def _policy(db: Session) -> SystemSettings:
    policy = db.get(SystemSettings, 1)
    if policy is None:
        policy = SystemSettings(id=1)
        db.add(policy)
        db.commit()
        db.refresh(policy)
    return policy


def _audit(db: Session, admin: User, action: str, detail: dict) -> None:
    audit_service.log_event_best_effort(
        db, action=action, user_id=admin.id, resource_type="firmware", detail=detail
    )


@router.post("/{firmware_id}/sign", response_model=FirmwareRead)
def sign_firmware_endpoint(
    firmware_id: UUID,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    firmware = db.get(FirmwareVersion, firmware_id)
    if firmware is None:
        raise HTTPException(status_code=404, detail="Firmware not found")
    ensure_platform_owned(firmware.uploaded_by_tenant_id)
    try:
        firmware = sign_firmware(db, firmware)
    except ValueError as exc:
        _audit(
            db,
            admin,
            "sign_firmware_failed",
            {"firmware_id": str(firmware_id), "reason": "invalid_firmware"},
        )
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        _audit(
            db,
            admin,
            "sign_firmware_failed",
            {"firmware_id": str(firmware_id), "reason": "signing_unavailable"},
        )
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    _audit(
        db,
        admin,
        "sign_firmware",
        {"firmware_id": str(firmware.id), "key_id": firmware.signing_key_id},
    )
    return firmware


def _delete_records(
    db: Session,
    records: list[FirmwareVersion],
    admin: User,
    dry_run: bool,
) -> dict:
    for firmware in records:
        ensure_platform_owned(firmware.uploaded_by_tenant_id)
    plan = retention_plan(db)
    newest_ids = {
        UUID(item["id"])
        for item in plan["protected"]
        if "minimum_versions_per_target" in item["reasons"]
    }
    deleted, protected = [], []
    for firmware in records:
        reasons = protection_reasons(db, firmware, newest_ids)
        if reasons:
            protected.append({"id": str(firmware.id), "reasons": reasons})
            continue
        if not dry_run:
            if firmware.object_key:
                try:
                    minio.remove_object(firmware.object_key)
                except Exception as exc:
                    protected.append({"id": str(firmware.id), "reasons": [f"storage_error:{exc}"]})
                    continue
            db.delete(firmware)
        deleted.append(str(firmware.id))
    if not dry_run:
        db.commit()
        _audit(db, admin, "bulk_delete_firmware", {"deleted_ids": deleted, "protected": protected})
    return {"dry_run": dry_run, "deleted_ids": deleted, "protected": protected}


@router.post("/bulk-delete")
def bulk_delete_firmware(
    payload: BulkDeleteRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    records = list(
        db.scalars(
            select(FirmwareVersion).where(FirmwareVersion.id.in_(payload.firmware_ids))
        ).all()
    )
    return _delete_records(db, records, admin, payload.dry_run)


@router.get("/retention-policy", response_model=RetentionPolicyRead)
def get_retention_policy(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return _policy(db)


@router.patch("/retention-policy", response_model=RetentionPolicyRead)
def update_retention_policy(
    payload: RetentionPolicyUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    policy = _policy(db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(policy, key, value)
    db.commit()
    db.refresh(policy)
    _audit(db, admin, "update_firmware_retention_policy", payload.model_dump(exclude_unset=True))
    return policy


@router.post("/retention/dry-run")
def retention_dry_run(db: Session = Depends(get_db), _admin: User = Depends(require_admin)):
    return retention_plan(db)


@router.post("/retention/run")
def retention_run(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    plan = retention_plan(db)
    ids = [UUID(item["id"]) for item in plan["candidates"]]
    records = (
        list(
            db.scalars(
                select(FirmwareVersion).where(
                    FirmwareVersion.id.in_(ids),
                    FirmwareVersion.uploaded_by_tenant_id.is_(None),
                )
            ).all()
        )
        if ids
        else []
    )
    return _delete_records(db, records, admin, False)
