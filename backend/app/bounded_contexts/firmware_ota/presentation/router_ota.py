"""Firmware OTA presentation — admin OTA router.

Functionally identical to app/modules/ota/router.py but delegates
through the bounded context's use cases and adapters.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.ota_tokens import create_ota_download_token
from app.core.security import require_admin
from app.core.platform_tenant_access import ensure_platform_owned
from app.db.session import get_db
from app.bounded_contexts.firmware_ota.application.use_cases import (
    create_ota_job,
    get_firmware_by_id,
    increment_ota_counter,
    mark_ota_job_failed,
    mark_ota_job_sent,
    to_ota_job_read,
)
from app.bounded_contexts.firmware_ota.infrastructure.adapters import OtaRepositoryAdapter
from app.bounded_contexts.firmware_ota.infrastructure.mqtt_adapter import MqttOtaPublisherAdapter
from app.modules.audit import service as audit_service
from app.modules.devices import repository as device_repository
from app.modules.ota.schema import OtaJobCreate, OtaJobCreateResponse, OtaJobRead
from app.bounded_contexts.tenant_management.infrastructure.persistence.models import Tenant
from app.shared.schemas.tenant import tenant_summary

logger = logging.getLogger(__name__)
router = APIRouter()

ota_adapter = OtaRepositoryAdapter()
mqtt = MqttOtaPublisherAdapter()


def _ensure_firmware_compatible(device, firmware) -> None:
    device_model = (getattr(device, "hardware_model", None) or "").strip()
    firmware_target = (getattr(firmware, "target_device_type", None) or "").strip()
    if device_model and firmware_target and device_model.lower() != firmware_target.lower():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Firmware target_device_type is not compatible with this device",
        )


def _audit_admin_read(db: Session, current_user, action: str, detail: dict) -> None:
    audit_service.log_event_best_effort(
        db,
        action=action,
        user_id=getattr(current_user, "id", None),
        tenant_id=getattr(current_user, "tenant_id", None),
        detail=detail,
    )


def _build_signed_ota_payload(job_id, firmware, device_uid: str, tenant_id) -> dict:
    """Build OTA request payload with signed download token."""
    base = settings.device_api_base_url.rstrip("/")
    token = create_ota_download_token(firmware.id, job_id, device_uid, tenant_id)
    download_url = f"{base}/api/v1/firmware/ota-download/{firmware.id}?token={token}"
    payload_dict = {
        "job_id": str(job_id),
        "firmware_version": firmware.version,
        "firmware_url": download_url,
        "checksum_sha256": firmware.checksum_sha256,
        "size_bytes": firmware.file_size,
    }

    if getattr(firmware, "md5", ""):
        payload_dict["firmware_md5"] = firmware.md5
    if getattr(firmware, "signature", None):
        payload_dict["signature"] = firmware.signature
    if getattr(firmware, "signature_alg", None):
        payload_dict["signature_alg"] = firmware.signature_alg
    if getattr(firmware, "signature_payload", None):
        payload_dict["signature_payload"] = firmware.signature_payload
    if getattr(firmware, "signing_key_id", None):
        payload_dict["signing_key_id"] = firmware.signing_key_id
    if getattr(firmware, "signing_public_key", None):
        payload_dict["signing_public_key"] = firmware.signing_public_key
    if getattr(firmware, "verification_required", False):
        payload_dict["verification_required"] = True

    return payload_dict


@router.post(
    "/jobs",
    response_model=OtaJobCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_ota_job_endpoint(
    payload: OtaJobCreate,
    current_user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> OtaJobCreateResponse:
    if not payload.device_uid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Admin OTA endpoint supports device_uid targets only",
        )

    device = device_repository.get_device_by_uid(db, payload.device_uid)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device UID not found")
    ensure_platform_owned(device.tenant_id)

    firmware = get_firmware_by_id(db, payload.firmware_version_id)
    if firmware is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Firmware not found")
    _ensure_firmware_compatible(device, firmware)

    job = create_ota_job(db, device_id=device.id, firmware_version_id=firmware.id)

    request_payload = _build_signed_ota_payload(
        job.id, firmware, device.device_uid, device.tenant_id
    )

    try:
        mqtt.publish_ota_request(device.device_uid, request_payload)
    except Exception as exc:
        logger.exception(
            "OTA request publish failed job_id=%s device_uid=%s", job.id, device.device_uid
        )
        mark_ota_job_failed(db, job.id, f"publish failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="OTA request could not be published",
        ) from exc

    mark_ota_job_sent(db, job.id)
    increment_ota_counter()
    logger.info(
        "[OTA] publish ok job=%s device=%s firmware=%s", job.id, device.device_uid, firmware.version
    )

    audit_service.log_event_best_effort(
        db,
        action="admin_create_ota_job",
        user_id=getattr(current_user, "id", None),
        tenant_id=getattr(current_user, "tenant_id", None),
        resource_type="ota_job",
        resource_id=str(job.id),
        detail={
            "device_uid": device.device_uid,
            "firmware_version": firmware.version,
        },
    )

    from app.modules.ota.model import JOB_STATUS_SENT

    return OtaJobCreateResponse(job_id=job.id, device_uid=device.device_uid, status=JOB_STATUS_SENT)


@router.get("/jobs", response_model=list[OtaJobRead])
def list_ota_jobs(
    tenant_id: UUID | None = None,
    device_uid: str | None = None,
    limit: int = 100,
    current_user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[OtaJobRead]:
    device_id: UUID | None = None
    if device_uid is not None:
        device = device_repository.get_device_by_uid(db, device_uid)
        if device is None:
            _audit_admin_read(
                db,
                current_user,
                "admin_list_ota_jobs",
                {"device_uid": device_uid, "limit": limit, "count": 0},
            )
            return []
        device_id = device.id
    all_jobs = ota_adapter.list_jobs(db, device_id=device_id, limit=limit)
    jobs = [job for job in all_jobs if tenant_id is None or job.tenant_id == tenant_id]
    tenant_ids = {job.tenant_id for job in jobs if job.tenant_id}
    tenants = (
        {t.id: t for t in db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()}
        if tenant_ids
        else {}
    )
    _audit_admin_read(
        db,
        current_user,
        "admin_list_ota_jobs",
        {"device_uid": device_uid, "limit": limit, "count": len(jobs)},
    )
    result = []
    for job in jobs:
        read = to_ota_job_read(job)
        result.append(
            read.model_copy(update={"tenant": tenant_summary(tenants.get(job.tenant_id))})
        )
    return result


@router.get(
    "/jobs/{job_id}",
    response_model=OtaJobRead,
)
def get_ota_job(
    job_id: UUID,
    _user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> OtaJobRead:
    job = ota_adapter.get_job_by_id(db, job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OTA job not found")
    read = to_ota_job_read(job)
    tenant = db.get(Tenant, job.tenant_id) if job.tenant_id else None
    return read.model_copy(update={"tenant": tenant_summary(tenant)})
