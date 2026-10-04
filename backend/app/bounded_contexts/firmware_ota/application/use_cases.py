"""Firmware OTA application use cases.

Encapsulates firmware upload, listing, OTA job creation, and
OTA status update logic. Delegates to legacy repository modules
for DB operations and infrastructure adapters for external services.
"""

import hashlib
import logging
import uuid
from pathlib import PurePosixPath

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.metrics import OTA_JOBS_CREATED
from app.modules.firmware import repository as firmware_repo
from app.modules.firmware.model import FirmwareVersion
from app.modules.firmware.schema import FirmwareCreate
from app.modules.ota import repository as ota_repo
from app.modules.ota.model import JOB_STATUS_SENT, OtaJob

logger = logging.getLogger(__name__)


# ── Firmware use cases ────────────────────────────────────────────────────────


def safe_filename(name: str | None) -> str:
    """Extract a safe filename from an upload name.

    Strips path components and characters that could break HTTP headers
    (double-quotes, backslashes).
    """
    base = PurePosixPath((name or "firmware.bin").replace("\\", "/")).name
    # Remove characters that could break Content-Disposition header
    base = base.replace('"', "").replace("'", "")
    return base or "firmware.bin"


def build_object_key(target_device_type: str, version: str, safe_name: str) -> str:
    """Build a MinIO object key for a firmware artifact."""
    return f"{target_device_type}/{version}/{uuid.uuid4().hex}-{safe_name}"


ALLOWED_FIRMWARE_EXTENSIONS = {".bin", ".ino", ".hex", ".elf", ".uf2", ".zip"}


def validate_firmware_size(data: bytes) -> None:
    """Raise ValueError if firmware data exceeds max size or is empty."""
    if len(data) == 0:
        raise ValueError("Firmware file is empty")
    max_bytes = settings.firmware_max_size_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise ValueError(f"Firmware exceeds max size of {settings.firmware_max_size_mb} MB")


def validate_firmware_filename(filename: str | None) -> None:
    """Raise ValueError if firmware filename has a disallowed extension."""
    if not filename:
        return
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext and ext not in ALLOWED_FIRMWARE_EXTENSIONS:
        raise ValueError(
            f"File extension '{ext}' not allowed. Allowed: {', '.join(sorted(ALLOWED_FIRMWARE_EXTENSIONS))}"
        )


def compute_checksum(data: bytes) -> str:
    """Compute SHA-256 checksum of firmware data."""
    return hashlib.sha256(data).hexdigest()


def create_firmware_record(
    db: Session,
    *,
    version: str,
    target_device_type: str,
    file_name: str,
    object_key: str,
    file_size: int,
    checksum_sha256: str,
    release_notes: str | None = None,
    tenant_id: uuid.UUID | None = None,
    signature: str | None = None,
    signature_alg: str | None = None,
    signature_payload: str | None = None,
    signing_key_id: str | None = None,
    release_channel: str = "dev",
    verification_required: bool = False,
) -> FirmwareVersion:
    """Create a firmware metadata record in the database."""
    payload = FirmwareCreate(
        version=version,
        target_device_type=target_device_type,
        file_name=file_name,
        object_key=object_key,
        file_size=file_size,
        checksum_sha256=checksum_sha256,
        release_notes=release_notes,
        signature=signature,
        signature_alg=signature_alg,
        signature_payload=signature_payload,
        signing_key_id=signing_key_id,
        release_channel=release_channel,
        verification_required=verification_required,
    )
    if tenant_id is None:
        return firmware_repo.create_firmware(db, payload)
    return firmware_repo.create_firmware(db, payload, tenant_id=tenant_id)


def list_firmware_versions(
    db: Session,
    *,
    target_device_type: str | None = None,
    limit: int = 100,
    tenant_id: uuid.UUID | None = None,
) -> list[FirmwareVersion]:
    """List firmware versions with optional filters."""
    kwargs: dict = {"target_device_type": target_device_type, "limit": limit}
    if tenant_id is not None:
        kwargs["tenant_id"] = tenant_id
    return firmware_repo.list_firmware(db, **kwargs)


def get_firmware_by_id(db: Session, firmware_id: uuid.UUID) -> FirmwareVersion | None:
    """Get a single firmware version by ID."""
    return firmware_repo.get_firmware_by_id(db, firmware_id)


def get_latest_firmware(db: Session, target_device_type: str) -> FirmwareVersion | None:
    """Get the latest active firmware for a device type."""
    return firmware_repo.latest_firmware(db, target_device_type)


def create_firmware_source_record(
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
    tenant_id: uuid.UUID | None = None,
) -> FirmwareVersion:
    """Create a firmware record from source code."""
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


# ── OTA use cases ─────────────────────────────────────────────────────────────


def build_ota_request_payload(
    job_id: uuid.UUID,
    firmware: FirmwareVersion,
) -> dict:
    """Build the MQTT OTA request payload for a device.

    This preserves the exact payload format expected by ESP32 firmware.
    """
    base = settings.device_api_base_url.rstrip("/")
    return {
        "job_id": str(job_id),
        "firmware_version_id": str(firmware.id),
        "firmware_version": firmware.version,
        "firmware_url": f"{base}/api/v1/firmware/{firmware.id}/download",
        "checksum": firmware.checksum_sha256,
        "force": False,
        # Backward compatibility for older device clients.
        "version": firmware.version,
        "download_url": f"{base}/api/v1/firmware/{firmware.id}/download",
        "checksum_sha256": firmware.checksum_sha256,
        "signature": getattr(firmware, "signature", None),
        "signature_alg": getattr(firmware, "signature_alg", None),
        "signature_payload": getattr(firmware, "signature_payload", None),
        "signing_key_id": getattr(firmware, "signing_key_id", None),
        "signing_public_key": getattr(firmware, "signing_public_key", None),
        "verification_required": getattr(firmware, "verification_required", False),
    }


def create_ota_job(
    db: Session,
    *,
    device_id: uuid.UUID,
    firmware_version_id: uuid.UUID,
) -> OtaJob:
    """Create an OTA job record."""
    return ota_repo.create_job(db, device_id=device_id, firmware_version_id=firmware_version_id)


def mark_ota_job_sent(db: Session, job_id: uuid.UUID) -> OtaJob | None:
    """Mark an OTA job as sent."""
    return ota_repo.update_status(db, job_id, JOB_STATUS_SENT)


def mark_ota_job_failed(db: Session, job_id: uuid.UUID, error_message: str) -> OtaJob | None:
    """Mark an OTA job as failed."""
    return ota_repo.update_status(db, job_id, "failed", error_message=error_message)


def increment_ota_counter() -> None:
    """Increment the OTA jobs created Prometheus counter."""
    OTA_JOBS_CREATED.inc()


def to_ota_job_read(job: OtaJob):
    """Convert an OtaJob ORM object to OtaJobRead schema."""
    from app.modules.ota.schema import OtaJobRead

    return OtaJobRead(
        id=job.id,
        device_id=job.device_id,
        device_uid=job.device.device_uid,
        firmware_version_id=job.firmware_version_id,
        firmware_version=job.firmware_version.version,
        status=job.status,
        requested_at=job.requested_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
        progress=job.progress,
        last_message=job.last_message,
        error_code=getattr(job, "error_code", None),
        error_message=job.error_message,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )
