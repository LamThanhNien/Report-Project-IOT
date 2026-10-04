from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.modules.firmware.model import FirmwareVersion
from app.modules.firmware.schema import FirmwareCreate


def create_firmware(
    db: Session,
    payload: FirmwareCreate,
    tenant_id: UUID | None = None,
) -> FirmwareVersion:
    firmware = FirmwareVersion(**payload.model_dump())
    if tenant_id is not None:
        firmware.uploaded_by_tenant_id = tenant_id
    db.add(firmware)
    db.commit()
    db.refresh(firmware)
    return firmware


def create_firmware_source(
    db: Session,
    *,
    version: str,
    target_device_type: str,
    source_code: str,
    source_type: str,
    board_fqbn: str,
    release_notes: str | None,
    file_name: str | None = None,
    object_key: str | None = None,
    file_size: int | None = None,
    checksum_sha256: str | None = None,
    tenant_id: UUID | None = None,
) -> FirmwareVersion:
    firmware = FirmwareVersion(
        version=version,
        target_device_type=target_device_type,
        source_code=source_code,
        source_type=source_type,
        board_fqbn=board_fqbn,
        release_notes=release_notes,
        file_name=file_name,
        object_key=object_key,
        file_size=file_size,
        checksum_sha256=checksum_sha256,
        uploaded_by_tenant_id=tenant_id,
    )
    db.add(firmware)
    db.commit()
    db.refresh(firmware)
    return firmware


def list_firmware(
    db: Session,
    target_device_type: str | None = None,
    limit: int = 100,
    tenant_id: UUID | None = None,
) -> list[FirmwareVersion]:
    stmt = select(FirmwareVersion).order_by(FirmwareVersion.created_at.desc()).limit(limit)
    if target_device_type:
        stmt = stmt.where(FirmwareVersion.target_device_type == target_device_type)
    if tenant_id is not None:
        # Tenant sees own firmware OR admin-uploaded global firmware (NULL tenant)
        stmt = stmt.where(
            or_(
                FirmwareVersion.uploaded_by_tenant_id == tenant_id,
                FirmwareVersion.uploaded_by_tenant_id.is_(None),
            )
        )
    return list(db.scalars(stmt).all())


def get_firmware_by_id(db: Session, firmware_id: UUID) -> FirmwareVersion | None:
    return db.scalar(select(FirmwareVersion).where(FirmwareVersion.id == firmware_id))


def latest_firmware(db: Session, target_device_type: str) -> FirmwareVersion | None:
    stmt = (
        select(FirmwareVersion)
        .where(
            FirmwareVersion.target_device_type == target_device_type,
            FirmwareVersion.is_active.is_(True),
        )
        .order_by(FirmwareVersion.created_at.desc())
        .limit(1)
    )
    return db.scalar(stmt)
