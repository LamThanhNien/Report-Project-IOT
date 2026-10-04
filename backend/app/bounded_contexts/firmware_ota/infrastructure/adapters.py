"""Firmware OTA infrastructure adapters.

Wraps legacy repository modules and services through a clean interface.
"""

from uuid import UUID

from sqlalchemy.orm import Session

from app.modules.firmware import repository as firmware_repo
from app.modules.firmware.model import FirmwareVersion
from app.modules.firmware.schema import FirmwareCreate
from app.modules.ota import repository as ota_repo
from app.modules.ota.model import OtaJob


class FirmwareRepositoryAdapter:
    """Adapter wrapping modules.firmware.repository."""

    @staticmethod
    def create(
        db: Session, payload: FirmwareCreate, tenant_id: UUID | None = None
    ) -> FirmwareVersion:
        return firmware_repo.create_firmware(db, payload, tenant_id=tenant_id)

    @staticmethod
    def create_source(
        db: Session,
        *,
        version: str,
        target_device_type: str,
        source_code: str,
        source_type: str,
        board_fqbn: str,
        release_notes: str | None = None,
        file_name: str | None = None,
        object_key: str | None = None,
        file_size: int | None = None,
        checksum_sha256: str | None = None,
        tenant_id: UUID | None = None,
    ) -> FirmwareVersion:
        return firmware_repo.create_firmware_source(
            db,
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
            tenant_id=tenant_id,
        )

    @staticmethod
    def list(
        db: Session,
        target_device_type: str | None = None,
        limit: int = 100,
        tenant_id: UUID | None = None,
    ) -> list[FirmwareVersion]:
        return firmware_repo.list_firmware(
            db, target_device_type=target_device_type, limit=limit, tenant_id=tenant_id
        )

    @staticmethod
    def get_by_id(db: Session, firmware_id: UUID) -> FirmwareVersion | None:
        return firmware_repo.get_firmware_by_id(db, firmware_id)

    @staticmethod
    def latest(db: Session, target_device_type: str) -> FirmwareVersion | None:
        return firmware_repo.latest_firmware(db, target_device_type)


class OtaRepositoryAdapter:
    """Adapter wrapping modules.ota.repository."""

    @staticmethod
    def create_job(db: Session, *, device_id: UUID, firmware_version_id: UUID) -> OtaJob:
        return ota_repo.create_job(db, device_id=device_id, firmware_version_id=firmware_version_id)

    @staticmethod
    def update_status(
        db: Session,
        job_id: UUID,
        new_status: str,
        progress: int | None = None,
        message: str | None = None,
        error_message: str | None = None,
        error_code: str | None = None,
    ) -> OtaJob | None:
        return ota_repo.update_status(
            db,
            job_id,
            new_status,
            progress=progress,
            message=message,
            error_message=error_message,
            error_code=error_code,
        )

    @staticmethod
    def list_jobs(db: Session, device_id: UUID | None = None, limit: int = 100) -> list[OtaJob]:
        return ota_repo.list_jobs(db, device_id=device_id, limit=limit)

    @staticmethod
    def get_job_by_id(db: Session, job_id: UUID) -> OtaJob | None:
        return ota_repo.get_job_by_id(db, job_id)
