"""Firmware OTA presentation — admin firmware router.

Functionally identical to app/modules/firmware/router.py but delegates
through the bounded context's use cases and adapters.
"""

import hashlib
import logging
import uuid as _uuid
from datetime import datetime, timezone

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.ota_tokens import decode_ota_download_token
from app.core.security import require_admin
from app.db.session import get_db, postgres_rls_bypass
from app.bounded_contexts.firmware_ota.application.use_cases import (
    build_object_key,
    compute_checksum,
    create_firmware_record,
    get_firmware_by_id,
    get_latest_firmware,
    list_firmware_versions,
    safe_filename,
    validate_firmware_filename,
    validate_firmware_size,
)
from app.bounded_contexts.firmware_ota.application.firmware_governance import (
    verify_firmware_signature_metadata,
)
from app.bounded_contexts.firmware_ota.infrastructure.minio_adapter import MinioStorageAdapter
from app.modules.devices.model import Device
from app.modules.ota.model import OtaJob
from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_campaign_models import (
    OtaCampaign,
)
from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_models import (
    JOB_TERMINAL_STATUSES,
    UsedOtaToken,
)
from app.modules.audit import service as audit_service
from app.modules.firmware.schema import FirmwareRead
from app.bounded_contexts.tenant_management.infrastructure.persistence.models import Tenant

logger = logging.getLogger(__name__)
router = APIRouter()
_limiter = Limiter(key_func=get_remote_address)

minio = MinioStorageAdapter()


def _audit_admin_read(db: Session, current_user, action: str, detail: dict) -> None:
    audit_service.log_event_best_effort(
        db,
        action=action,
        user_id=getattr(current_user, "id", None),
        tenant_id=getattr(current_user, "tenant_id", None),
        detail=detail,
    )


def _iter_stream(response, chunk_size: int = 64 * 1024):
    try:
        while True:
            chunk = response.read(chunk_size)
            if not chunk:
                break
            yield chunk
    finally:
        response.close()
        response.release_conn()


def _open_firmware_object(firmware):
    try:
        return minio.get_object_stream(firmware.object_key)
    except Exception as exc:
        logger.exception("Firmware fetch from MinIO failed object_key=%s", firmware.object_key)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Firmware storage backend unavailable",
        ) from exc


def _close_firmware_object(response) -> None:
    try:
        response.close()
    finally:
        response.release_conn()


def _stream_firmware(firmware, response=None) -> StreamingResponse:
    """Stream a firmware binary from MinIO."""
    response = response or _open_firmware_object(firmware)

    headers = {
        "Content-Disposition": f'attachment; filename="{firmware.file_name or "firmware.bin"}"',
        "X-Firmware-Sha256": firmware.checksum_sha256 or "",
        "X-Firmware-Version": firmware.version,
    }
    if getattr(firmware, "signature", None):
        headers["X-Firmware-Signature"] = firmware.signature
        headers["X-Firmware-Signature-Alg"] = getattr(firmware, "signature_alg", None) or ""
        headers["X-Firmware-Signing-Key-Id"] = getattr(firmware, "signing_key_id", None) or ""
    if firmware.file_size:
        headers["Content-Length"] = str(firmware.file_size)
    return StreamingResponse(
        _iter_stream(response),
        media_type="application/octet-stream",
        headers=headers,
    )


def _ensure_ota_firmware_integrity(firmware) -> None:
    checksum = (getattr(firmware, "checksum_sha256", None) or "").lower()
    if len(checksum) != 64 or any(char not in "0123456789abcdef" for char in checksum):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Firmware has invalid integrity metadata",
        )
    signature_fields = (
        getattr(firmware, "signature", None),
        getattr(firmware, "signature_alg", None),
        getattr(firmware, "signing_public_key", None),
    )
    signature_required = bool(
        getattr(firmware, "verification_required", False)
        or getattr(firmware, "release_channel", None) == "stable"
        or any(signature_fields)
    )
    if signature_required and not verify_firmware_signature_metadata(firmware):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Firmware signature metadata is invalid",
        )


def _ensure_ota_resource_scope(payload, firmware_id, job, device, firmware, campaign=None) -> None:
    if str(job.firmware_version_id) != str(firmware_id) or job.status in JOB_TERMINAL_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token is not valid for this OTA job",
        )
    if device.device_uid != payload.get("device_uid"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token is not valid for this device",
        )
    token_tenant_id = payload.get("tenant_id")
    if str(device.tenant_id) != token_tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token tenant does not match device tenant",
        )
    job_tenant_id = getattr(job, "tenant_id", None)
    if job_tenant_id is not None and str(job_tenant_id) != token_tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token tenant does not match OTA job tenant",
        )

    expected_campaign_id = str(job.campaign_id) if job.campaign_id is not None else None
    if payload.get("campaign_id") != expected_campaign_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token campaign does not match OTA job campaign",
        )
    if job.campaign_id is not None and (
        campaign is None
        or str(campaign.firmware_version_id) != str(firmware_id)
        or str(campaign.tenant_id) != token_tenant_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token is not valid for this OTA campaign",
        )

    if (
        firmware.uploaded_by_tenant_id is not None
        and str(firmware.uploaded_by_tenant_id) != token_tenant_id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Firmware does not belong to the target tenant",
        )
    _ensure_ota_firmware_integrity(firmware)


@router.post(
    "",
    response_model=FirmwareRead,
    status_code=status.HTTP_201_CREATED,
)
def upload_firmware(
    version: str = Form(..., min_length=1, max_length=64),
    target_device_type: str = Form(..., min_length=1, max_length=64),
    release_notes: str | None = Form(default=None, max_length=4096),
    signature: str | None = Form(default=None),
    signature_alg: str | None = Form(default=None, max_length=32),
    signature_payload: str | None = Form(default=None, max_length=64),
    signing_key_id: str | None = Form(default=None, max_length=128),
    release_channel: str = Form(default="dev", pattern="^(dev|staging|stable)$"),
    verification_required: bool = Form(default=False),
    file: UploadFile = File(...),
    current_user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> FirmwareRead:
    data = file.file.read()

    try:
        validate_firmware_filename(file.filename)
        validate_firmware_size(data)
    except ValueError as exc:
        code = (
            status.HTTP_400_BAD_REQUEST
            if "empty" in str(exc)
            else status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
        )
        raise HTTPException(status_code=code, detail=str(exc))

    checksum = compute_checksum(data)
    sname = safe_filename(file.filename)
    object_key = build_object_key(target_device_type, version, sname)

    try:
        minio.ensure_bucket()
        minio.put_object(
            object_key, data, content_type=file.content_type or "application/octet-stream"
        )
    except Exception as exc:
        logger.exception("Firmware upload to MinIO failed object_key=%s", object_key)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Firmware storage backend unavailable",
        ) from exc

    try:
        firmware = create_firmware_record(
            db,
            version=version,
            target_device_type=target_device_type,
            file_name=sname,
            object_key=object_key,
            file_size=len(data),
            checksum_sha256=checksum,
            release_notes=release_notes,
            tenant_id=getattr(current_user, "tenant_id", None),
            signature=signature,
            signature_alg=signature_alg,
            signature_payload=signature_payload,
            signing_key_id=signing_key_id,
            release_channel=release_channel,
            verification_required=verification_required,
        )
    except Exception:
        logger.exception("Firmware DB insert failed object_key=%s", object_key)
        minio.remove_object(object_key)
        raise

    audit_service.log_event_best_effort(
        db,
        action="admin_upload_firmware",
        user_id=getattr(current_user, "id", None),
        tenant_id=getattr(current_user, "tenant_id", None),
        resource_type="firmware",
        resource_id=str(firmware.id),
        detail={
            "version": version,
            "target_device_type": target_device_type,
            "file_name": sname,
            "file_size": len(data),
        },
    )

    return FirmwareRead.model_validate(firmware)


@router.get("", response_model=list[FirmwareRead])
def list_firmware(
    target_device_type: str | None = None,
    limit: int = 100,
    current_user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[FirmwareRead]:
    records = list_firmware_versions(db, target_device_type=target_device_type, limit=limit)
    tenant_ids = {r.uploaded_by_tenant_id for r in records if r.uploaded_by_tenant_id}
    tenants = (
        {t.id: t for t in db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()}
        if tenant_ids
        else {}
    )
    for record in records:
        record.tenant = tenants.get(record.uploaded_by_tenant_id)
    _audit_admin_read(
        db,
        current_user,
        "admin_list_firmware",
        {"target_device_type": target_device_type, "limit": limit, "count": len(records)},
    )
    return [FirmwareRead.model_validate(r) for r in records]


@router.get(
    "/latest",
    response_model=FirmwareRead,
    dependencies=[Depends(require_admin)],
)
def latest_firmware(
    target_device_type: str,
    db: Session = Depends(get_db),
) -> FirmwareRead:
    firmware = get_latest_firmware(db, target_device_type)
    if firmware is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No firmware found for target_device_type",
        )
    firmware.tenant = (
        db.get(Tenant, firmware.uploaded_by_tenant_id) if firmware.uploaded_by_tenant_id else None
    )
    return FirmwareRead.model_validate(firmware)


@router.get(
    "/{firmware_id}",
    response_model=FirmwareRead,
    dependencies=[Depends(require_admin)],
)
def get_firmware(firmware_id: _uuid.UUID, db: Session = Depends(get_db)) -> FirmwareRead:
    firmware = get_firmware_by_id(db, firmware_id)
    if firmware is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Firmware not found")
    firmware.tenant = (
        db.get(Tenant, firmware.uploaded_by_tenant_id) if firmware.uploaded_by_tenant_id else None
    )
    return FirmwareRead.model_validate(firmware)


@router.get("/{firmware_id}/download", dependencies=[Depends(require_admin)])
@_limiter.limit("10/minute")
def download_firmware(
    request: Request,
    firmware_id: _uuid.UUID,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Download firmware binary — requires admin authentication."""
    firmware = get_firmware_by_id(db, firmware_id)
    if firmware is None or not firmware.object_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Firmware not found")
    return _stream_firmware(firmware)


@router.get("/ota-download/{firmware_id}")
@_limiter.limit("10/minute")
def ota_download_firmware(
    request: Request,
    firmware_id: _uuid.UUID,
    token: str = Query(..., description="Short-lived OTA download token"),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    """Download firmware using a short-lived OTA token (for devices).

    This endpoint is used by ESP32 devices during OTA updates. The token is
    generated by the backend when creating an OTA job and sent to the device
    via MQTT. The token is scoped to a specific firmware/job/device and expires
    after a short time (default 30 minutes).
    """
    payload = decode_ota_download_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTA download token",
        )

    # Verify the token's firmware_id matches the requested firmware
    token_firmware_id = payload.get("firmware_id")
    if token_firmware_id != str(firmware_id):
        logger.warning(
            "OTA download token firmware mismatch: token=%s requested=%s",
            token_firmware_id,
            firmware_id,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Token not valid for this firmware",
        )

    try:
        token_job_id = _uuid.UUID(str(payload.get("job_id")))
    except (TypeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTA download token",
        ) from None

    jti = str(payload["jti"])

    with postgres_rls_bypass(db):
        job = db.get(OtaJob, token_job_id)
        if job is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Token is not valid for an OTA job",
            )

        device = db.get(Device, job.device_id)
        if device is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Token is not valid for this device",
            )

        firmware = get_firmware_by_id(db, firmware_id)
        if firmware is None or not firmware.object_key:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Firmware not found")
        campaign = db.get(OtaCampaign, job.campaign_id) if job.campaign_id is not None else None

        _ensure_ota_resource_scope(payload, firmware_id, job, device, firmware, campaign)

        # Open storage before consuming the one-time token. Once the object exists and
        # authorization succeeds, token consumption is the atomic start of a download.
        expires_at = datetime.fromtimestamp(int(payload["exp"]), tz=timezone.utc)
        existing_used = (
            db.query(UsedOtaToken)
            .filter(
                UsedOtaToken.jti == jti,
                UsedOtaToken.device_uid == device.device_uid,
                UsedOtaToken.job_id == job.id,
                UsedOtaToken.expires_at > datetime.now(timezone.utc),
            )
            .first()
        )
        if existing_used is None:
            db.query(UsedOtaToken).filter(UsedOtaToken.expires_at <= datetime.now(timezone.utc)).delete(
                synchronize_session=False
            )
            used_token = UsedOtaToken(
                jti=jti,
                job_id=job.id,
                tenant_id=device.tenant_id,
                device_uid=device.device_uid,
                expires_at=expires_at,
            )
            db.add(used_token)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                _close_firmware_object(storage_response)
                fingerprint = hashlib.sha256(jti.encode("utf-8")).hexdigest()[:12]
                logger.warning("ota_download_token_replay token_fingerprint=%s", fingerprint)
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="OTA download token has already been used",
                ) from None
            except Exception:
                db.rollback()
                _close_firmware_object(storage_response)
                raise

        logger.info(
            "OTA download: firmware=%s job=%s device=%s",
            firmware_id,
            payload.get("job_id"),
            payload.get("device_uid"),
        )
        return _stream_firmware(firmware, storage_response)
