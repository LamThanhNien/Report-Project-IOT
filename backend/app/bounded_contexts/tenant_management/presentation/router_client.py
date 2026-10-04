"""Tenant management client presentation router.

Preserves all existing /api/v1/client/* endpoints.
Uses get_current_tenant_user to resolve tenant from JWT.
"""

import hashlib
import json
import logging
import uuid as _uuid
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any, Literal

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.metrics import OTA_JOBS_CREATED
from app.core.ota_tokens import create_ota_download_token
from app.modules.audit import service as audit_service
from app.modules.audit.model import AuditLog
from app.db.session import get_db
from app.modules.auth import repository as auth_repo
from app.modules.auth import service as auth_service
from app.modules.auth.model import User
from app.modules.auth.schema import UserRead
from app.modules.devices import repository as device_repo
from app.modules.devices.schema import (
    DeviceCreate,
    DeviceOfflineTimeoutResponse,
    DeviceOfflineTimeoutUpdate,
    DeviceRead,
    DeviceUpdate,
)
from app.modules.firmware import repository as firmware_repo
from app.modules.firmware.schema import FirmwareCreate, FirmwareFromSourceRequest, FirmwareRead
from app.services.arduino_compiler import CompilerError, compile_ino, validate_board_fqbn
from app.modules.ota import repository as ota_repo
from app.modules.ota.model import JOB_STATUS_SENT, OtaJob
from app.modules.ota.schema import OtaJobCreate, OtaJobCreateResponse, OtaJobRead
from app.modules.projects import repository as project_repository
from app.modules.projects.schema import (
    DeviceActivityItemRead,
    DeviceLiveStatusRead,
    TenantDeviceDetailRead,
)
from app.modules.telemetry.model import Telemetry
from app.modules.telemetry import repository as telemetry_repo
from app.modules.telemetry.schema import TelemetryRead
from app.modules.tenants import repository, service as tenant_service
from app.modules.tenants.schema import (
    ClientAuditLogRead,
    ClientDashboardRead,
    ClientMeRead,
    TenantUserCreate,
    TenantUserUpdate,
)
from app.core.permissions import (
    OWNER_ROLE,
    VIEWER_ROLE,
    default_permissions_for_role,
    get_effective_permissions,
    require_tenant_permission,
    validate_permissions,
)
from app.services import minio_client, mqtt_publisher, mqtt_topics

from app.bounded_contexts.tenant_management.presentation.dependencies import (
    get_current_tenant_user,
    require_feature,
    require_tenant_owner,
)
from app.bounded_contexts.device_groups.application.use_cases import DeviceGroupUseCases
from app.bounded_contexts.firmware_ota.application.firmware_governance import sign_firmware
from app.bounded_contexts.telemetry.infrastructure.persistence.alert_models import Alert
from app.bounded_contexts.telemetry.infrastructure.repositories import TelemetryQueryResult

logger = logging.getLogger(__name__)

router = APIRouter()
_limiter = Limiter(key_func=get_remote_address)

TENANT_FIRMWARE_EXTENSION = ".bin"


def _device_to_read(device) -> DeviceRead:
    read = DeviceRead.model_validate(device)
    return read.model_copy(update={"status": device_repo.effective_connection_status(device)})


# ── Profile & features ────────────────────────────────────────────────────────


@router.get("/me", response_model=ClientMeRead)
def client_me(
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> ClientMeRead:
    tenant = repository.get_tenant(db, current_user.tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    features = tenant_service.get_effective_features(db, current_user.tenant_id)
    return ClientMeRead(
        user_id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        permissions=get_effective_permissions(current_user),
        tenant_id=tenant.id,
        tenant_name=tenant.name,
        tenant_slug=tenant.slug,
        plan_name=tenant.plan.name if tenant.plan else None,
        features=features,
    )


@router.get("/features", response_model=dict)
def client_features(
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> dict:
    return tenant_service.get_effective_features(db, current_user.tenant_id)


# ── Dashboard ─────────────────────────────────────────────────────────────────


@router.get("/dashboard", response_model=ClientDashboardRead)
def client_dashboard(
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> ClientDashboardRead:
    devices = repository.list_tenant_devices(db, current_user.tenant_id)
    device_ids = [d.id for d in devices]

    effective_statuses = [device_repo.effective_connection_status(d) for d in devices]
    online = sum(1 for status_value in effective_statuses if status_value == "online")
    offline = sum(1 for status_value in effective_statuses if status_value == "offline")
    status_summary = {
        "online": online,
        "offline": offline,
        "other": len(devices) - online - offline,
    }

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    total_telemetry_today = 0
    if device_ids:
        total_telemetry_today = (
            db.scalar(
                select(func.count(Telemetry.id)).where(
                    Telemetry.device_id.in_(device_ids),
                    Telemetry.timestamp >= today_start,
                )
            )
            or 0
        )

    return ClientDashboardRead(
        total_devices=len(devices),
        online_devices=online,
        offline_devices=offline,
        total_telemetry_today=total_telemetry_today,
        device_status_summary=status_summary,
    )


# ── Devices ───────────────────────────────────────────────────────────────────


@router.get(
    "/devices",
    response_model=list[DeviceRead],
    dependencies=[require_feature("device_management"), require_tenant_permission("devices.view")],
)
def client_list_devices(
    project_id: _uuid.UUID | None = Query(default=None, description="Filter by project ID"),
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> list[DeviceRead]:
    devices = repository.list_tenant_devices(db, current_user.tenant_id, project_id=project_id)
    return [_device_to_read(d) for d in devices]


class TokenGenerateResponse(BaseModel):
    raw_token: str
    token_hash: str


@router.get(
    "/devices/generate-token",
    response_model=TokenGenerateResponse,
    dependencies=[
        require_feature("device_management"),
        require_tenant_permission("devices.manage"),
    ],
)
def client_generate_device_token(
    current_user: User = Depends(get_current_tenant_user),
) -> TokenGenerateResponse:
    import secrets

    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    return TokenGenerateResponse(raw_token=raw_token, token_hash=token_hash)


@router.post(
    "/devices/{device_uid}/regenerate-token",
    response_model=TokenGenerateResponse,
    dependencies=[
        require_feature("device_management"),
        require_tenant_permission("devices.manage"),
    ],
)
def client_regenerate_device_token_atomic(
    device_uid: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> TokenGenerateResponse:
    import secrets

    # 1. Verify device exists and belongs to tenant
    device = repository.get_tenant_device(db, current_user.tenant_id, device_uid)
    if device is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Device not found or not assigned to your tenant"
        )

    # 2. Generate new token
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    # 3. Update device metadata atomically
    device_repo.update_device_metadata(
        db,
        device,
        auth_token_hash=token_hash,
        fields_set={"auth_token_hash"},
    )

    # 4. Audit log the regeneration
    audit_service.log_event_best_effort(
        db,
        action="tenant_regenerate_device_token",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="device",
        resource_id=str(device.id),
        detail={"device_uid": device.device_uid},
    )

    return TokenGenerateResponse(raw_token=raw_token, token_hash=token_hash)


@router.get(
    "/devices/{device_uid}",
    response_model=DeviceRead,
    dependencies=[require_feature("device_management"), require_tenant_permission("devices.view")],
)
def client_get_device(
    device_uid: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> DeviceRead:
    device = repository.get_tenant_device(db, current_user.tenant_id, device_uid)
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not found")
    return _device_to_read(device)


@router.patch(
    "/devices/{device_uid}/offline-timeout",
    response_model=DeviceOfflineTimeoutResponse,
    dependencies=[
        require_feature("device_management"),
        require_tenant_permission("devices.manage"),
    ],
)
def client_update_device_offline_timeout(
    device_uid: str,
    payload: DeviceOfflineTimeoutUpdate,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> DeviceOfflineTimeoutResponse:
    from app.core.tenant_context import current_tenant_id_context, current_user_role_context

    current_tenant_id_context.set(current_user.tenant_id)
    current_user_role_context.set(current_user.role)

    device = repository.get_tenant_device(db, current_user.tenant_id, device_uid)
    if device is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Device not found or not assigned to your tenant"
        )
    updated = device_repo.update_offline_timeout_seconds(
        db, device, payload.offline_timeout_seconds
    )
    return DeviceOfflineTimeoutResponse(
        device_uid=updated.device_uid,
        offline_timeout_seconds=updated.offline_timeout_seconds,
    )


@router.get(
    "/devices/{device_uid}/detail",
    response_model=TenantDeviceDetailRead,
    dependencies=[require_feature("device_management"), require_tenant_permission("devices.view")],
)
def client_get_device_detail(
    device_uid: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> TenantDeviceDetailRead:
    device = repository.get_tenant_device(db, current_user.tenant_id, device_uid)
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not found")

    device_read = _device_to_read(device)
    features = tenant_service.get_effective_features(db, current_user.tenant_id)
    telemetry_enabled = bool(features.get("telemetry_view"))
    ota_enabled = bool(features.get("ota_update"))
    alerts_enabled = bool(features.get("alert_management"))
    firmware_enabled = bool(features.get("firmware_history") or features.get("ota_update"))

    latest_records = (
        telemetry_repo.latest_telemetry_by_device_uid(db, device_uid) if telemetry_enabled else []
    )
    recent_telemetry_records = (
        telemetry_repo.list_telemetry_by_device_uid(db, device_uid, limit=40)
        if telemetry_enabled
        else []
    )
    recent_telemetry = [
        TelemetryRead(
            id=item.id,
            device_id=item.device_id,
            device_uid=item.device.device_uid,
            timestamp=item.timestamp,
            metric_name=item.metric_name,
            metric_value=item.metric_value,
            unit=item.unit,
            raw_payload=item.raw_payload,
            created_at=item.created_at,
        )
        for item in recent_telemetry_records
    ]

    project_bindings = project_repository.list_device_project_bindings(
        db, current_user.tenant_id, device
    )

    ota_jobs = _list_device_ota_jobs(db, device.id, limit=20) if ota_enabled else []
    ota_job_reads = [_ota_job_read(job) for job in ota_jobs]

    firmware_records = (
        firmware_repo.list_firmware(
            db,
            target_device_type=device.hardware_model,
            limit=20,
            tenant_id=current_user.tenant_id,
        )
        if firmware_enabled
        else []
    )
    available_firmware = [FirmwareRead.model_validate(item) for item in firmware_records]

    alert_events = _list_device_alert_events(db, device.id, limit=20) if alerts_enabled else []
    alerts = [_automation_alert_item(item, device.device_uid) for item in alert_events]

    audit_logs = _list_tenant_audit_logs(db, current_user.tenant_id, limit=120)

    return TenantDeviceDetailRead(
        device=device_read,
        live_status=_build_live_status(device_read, latest_records),
        project_bindings=project_bindings,
        recent_telemetry=recent_telemetry,
        ota_jobs=ota_job_reads,
        alerts=alerts,
        available_firmware=available_firmware,
        activity=_device_activity(
            device=device_read,
            tenant_id=current_user.tenant_id,
            telemetry_records=recent_telemetry,
            ota_jobs=ota_job_reads,
            alerts=alerts,
                audit_logs=audit_logs,
        ),
        can_send_commands=current_user.role != "viewer",
        can_reboot=current_user.role != "viewer",
    )


@router.get(
    "/devices/{device_uid}/latest-telemetry",
    response_model=list[TelemetryRead],
    dependencies=[require_feature("telemetry_view"), require_tenant_permission("monitoring.view")],
)
def client_device_latest_telemetry(
    device_uid: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> list[TelemetryRead]:
    """Return the most recent telemetry record per metric for a tenant device."""
    device = repository.get_tenant_device(db, current_user.tenant_id, device_uid)
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not found")
    records = telemetry_repo.latest_telemetry_by_device_uid(db, device_uid)
    return [TelemetryRead.model_validate(r) for r in records]


@router.get(
    "/devices/{device_uid}/telemetry",
    dependencies=[require_feature("telemetry_view"), require_tenant_permission("monitoring.view")],
)
def client_device_telemetry(
    device_uid: str,
    metric_name: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    from_time: datetime | None = Query(default=None),
    to_time: datetime | None = Query(default=None),
    time_range: Literal["6h", "1d", "1w", "1m"] | None = Query(default=None),
    aggregate: Literal["avg", "min", "max"] = Query(default="avg"),
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
):
    """List telemetry records for a tenant device.

    When ``time_range`` is provided the response is a JSON object::

        {
            "aggregated": true,
            "grouping": "5 minutes",
            "data": [<TelemetryRead>, ...]
        }

    When ``time_range`` is absent the response is a plain JSON array of
    ``TelemetryRead`` objects (backward-compatible with the previous contract).
    """
    device = repository.get_tenant_device(db, current_user.tenant_id, device_uid)
    if device is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not found")

    result = telemetry_repo.list_telemetry_by_device_uid(
        db,
        device_uid,
        metric_name=metric_name,
        limit=limit,
        offset=offset,
        from_time=from_time,
        to_time=to_time,
        time_range=time_range,
        aggregate=aggregate,
    )

    def _to_read(r) -> TelemetryRead:
        return TelemetryRead(
            id=r.id,
            device_id=r.device_id,
            device_uid=r.device.device_uid if r.device else device_uid,
            timestamp=r.timestamp,
            metric_name=r.metric_name,
            metric_value=r.metric_value,
            unit=r.unit,
            raw_payload=r.raw_payload,
            created_at=r.created_at or r.timestamp,
        )

    if isinstance(result, TelemetryQueryResult):
        # Aggregated path — return wrapper object so frontend can inspect metadata
        return {
            "aggregated": result.aggregated,
            "grouping": result.grouping,
            "data": [_to_read(r) for r in result.records],
        }

    # Legacy path — plain list for callers that don’t pass time_range
    return [_to_read(r) for r in result]


class MqttConfigResponse(BaseModel):
    broker_host: str
    broker_port: int
    broker_tls_enabled: bool
    client_id_suggestion: str
    topic_telemetry: str
    topic_status: str
    topic_events: str
    topic_commands: str
    topic_ota: str
    topic_ota_status: str
    sdkconfig_snippet: str


def _ota_job_read(job: OtaJob) -> OtaJobRead:
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


def _firmware_accessible_to_tenant(firmware, tenant_id: _uuid.UUID) -> bool:
    owner = getattr(firmware, "uploaded_by_tenant_id", None)
    return owner is None or owner == tenant_id


def _ensure_firmware_accessible(firmware, tenant_id: _uuid.UUID) -> None:
    if firmware is None or not _firmware_accessible_to_tenant(firmware, tenant_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Firmware not found",
        )


def _ensure_firmware_compatible(device, firmware) -> None:
    device_model = (getattr(device, "hardware_model", None) or "").strip()
    firmware_target = (getattr(firmware, "target_device_type", None) or "").strip()
    if device_model and firmware_target and device_model.lower() != firmware_target.lower():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Firmware target_device_type is not compatible with this device",
        )


def _iter_firmware_stream(response, chunk_size: int = 64 * 1024):
    try:
        while True:
            chunk = response.read(chunk_size)
            if not chunk:
                break
            yield chunk
    finally:
        response.close()
        response.release_conn()


def _stream_client_firmware(firmware) -> StreamingResponse:
    if not getattr(firmware, "object_key", None):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Firmware binary not found"
        )
    try:
        response = minio_client.get_firmware_object_stream(firmware.object_key)
    except Exception as exc:
        logger.exception("Tenant firmware download failed object_key=%s", firmware.object_key)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Firmware storage backend unavailable",
        ) from exc

    headers = {
        "Content-Disposition": f'attachment; filename="{firmware.file_name or "firmware.bin"}"',
        "X-Firmware-Sha256": firmware.checksum_sha256 or "",
        "X-Firmware-Version": firmware.version,
    }
    if firmware.file_size:
        headers["Content-Length"] = str(firmware.file_size)
    return StreamingResponse(
        _iter_firmware_stream(response),
        media_type="application/octet-stream",
        headers=headers,
    )


def _build_client_ota_payload(
    job_id: _uuid.UUID, firmware, device_uid: str, tenant_id, campaign_id=None
) -> dict:
    base = settings.device_api_base_url.rstrip("/")
    token = create_ota_download_token(
        firmware_id=firmware.id,
        job_id=job_id,
        device_uid=device_uid,
        tenant_id=tenant_id,
        campaign_id=campaign_id,
    )
    download_url = f"{base}/api/v1/firmware/ota-download/{firmware.id}?token={token}"
    return {
        "job_id": str(job_id),
        "firmware_version_id": str(firmware.id),
        "firmware_version": firmware.version,
        "firmware_url": download_url,
        "checksum": firmware.checksum_sha256,
        "force": False,
        "version": firmware.version,
        "download_url": download_url,
        "checksum_sha256": firmware.checksum_sha256,
        "file_size": firmware.file_size,
        "size_bytes": firmware.file_size,
        "signature": getattr(firmware, "signature", None),
        "signature_alg": getattr(firmware, "signature_alg", None),
        "signature_payload": getattr(firmware, "signature_payload", None),
        "signing_key_id": getattr(firmware, "signing_key_id", None),
        "signing_public_key": getattr(firmware, "signing_public_key", None),
        "verification_required": getattr(firmware, "verification_required", False),
    }


def _build_live_status(device: DeviceRead, latest_records: list[Telemetry]) -> DeviceLiveStatusRead:
    latest_payload: dict[str, Any] = {}
    for record in latest_records:
        if isinstance(record.raw_payload, dict):
            latest_payload.update(record.raw_payload)

    sensor_values: dict[str, Any] = {}
    output_states: dict[str, Any] = {}
    system_values: dict[str, Any] = {}

    for record in latest_records:
        key = record.metric_name
        value = record.metric_value
        if (
            key.startswith("gpio_")
            or key.endswith("_state")
            or key.startswith("relay_")
            or key.startswith("led_")
        ):
            output_states[key] = value
        elif key in {"temperature", "humidity", "light", "soil_moisture"} or key.startswith(
            "sensor_"
        ):
            sensor_values[key] = value
        else:
            system_values[key] = value

    if device.rssi is not None:
        system_values.setdefault("rssi", device.rssi)
    if device.free_heap is not None:
        system_values.setdefault("free_heap", device.free_heap)
    if device.uptime_ms is not None:
        system_values.setdefault("uptime_ms", device.uptime_ms)

    payload_mqtt = latest_payload.get("mqtt_status")
    return DeviceLiveStatusRead(
        # Use computed DB presence.  The telemetry payload's
        # ``connection_status`` is a device self-report that can be stale.
        connection_status=device_repo.effective_connection_status(device),
        mqtt_status=str(payload_mqtt) if payload_mqtt is not None else None,
        last_telemetry_at=latest_records[0].timestamp if latest_records else None,
        latest_payload=latest_payload,
        sensor_values=sensor_values,
        output_states=output_states,
        system_values=system_values,
    )




def _automation_alert_item(alert: Alert, device_uid: str) -> dict[str, Any]:
    timestamp = alert.last_seen_at or alert.created_at
    return {
        "id": str(alert.id),
        "device_uid": device_uid,
        "timestamp": timestamp.isoformat(),
        "metric_name": alert.title,
        "metric_value": None,
        "anomaly_score": None,
        "severity": alert.severity,
        "title": alert.title,
        "message": alert.message,
        "source": alert.source,
        "source_type": alert.source,
        "source_id": str(alert.source_id) if getattr(alert, "source_id", None) else None,
        "status": alert.status,
        "details": alert.details or {},
        "metadata": alert.details or {},
    }




def _device_activity(
    *,
    device: DeviceRead,
    tenant_id: _uuid.UUID,
    telemetry_records: list[TelemetryRead],
    ota_jobs: list[OtaJobRead],
    alerts: list[dict[str, Any]],
    audit_logs: list[AuditLog],
    limit: int = 25,
) -> list[DeviceActivityItemRead]:
    items: list[DeviceActivityItemRead] = []

    for log in audit_logs:
        detail = log.detail or {}
        resource_matches = log.resource_type == "device" and log.resource_id == str(device.id)
        detail_matches = detail.get("device_uid") == device.device_uid
        if not resource_matches and not detail_matches:
            continue
        items.append(
            DeviceActivityItemRead(
                kind="command" if log.action == "send_device_command" else "audit",
                title=log.action.replace("_", " ").title(),
                timestamp=log.created_at,
                status=log.action,
                detail=detail,
            )
        )

    for record in telemetry_records[:8]:
        items.append(
            DeviceActivityItemRead(
                kind="telemetry",
                title=f"Telemetry: {record.metric_name}",
                timestamp=record.timestamp,
                detail={"metric_value": record.metric_value, "unit": record.unit},
            )
        )

    for job in ota_jobs[:8]:
        items.append(
            DeviceActivityItemRead(
                kind="ota",
                title=f"OTA {job.status}",
                timestamp=job.updated_at,
                status=job.status,
                detail={
                    "firmware_version": job.firmware_version,
                    "progress": job.progress,
                    "message": job.last_message,
                },
            )
        )

    for alert in alerts[:8]:
        items.append(
            DeviceActivityItemRead(
                kind="alert",
                title=f"Alert: {alert['metric_name']}",
                timestamp=datetime.fromisoformat(str(alert["timestamp"])),
                severity=str(alert["severity"]),
                detail=alert,
            )
        )

    items.sort(key=lambda item: item.timestamp, reverse=True)
    return items[:limit]


def _list_device_ota_jobs(db: Session, device_id: _uuid.UUID, limit: int = 20) -> list[OtaJob]:
    legacy_helper = _legacy_router_helper("_list_device_ota_jobs")
    if legacy_helper is not None:
        return legacy_helper(db, device_id, limit)
    return list(
        db.scalars(
            select(OtaJob)
            .where(OtaJob.device_id == device_id)
            .order_by(OtaJob.created_at.desc())
            .limit(limit)
        ).all()
    )


def _list_device_alert_events(
    db: Session, device_id: _uuid.UUID, limit: int = 20
) -> list[Alert]:
    return list(
        db.scalars(
            select(Alert)
            .where(Alert.device_id == device_id)
            .order_by(Alert.last_seen_at.desc(), Alert.created_at.desc())
            .limit(limit)
        ).all()
    )




def _list_tenant_audit_logs(db: Session, tenant_id: _uuid.UUID, limit: int = 120) -> list[AuditLog]:
    legacy_helper = _legacy_router_helper("_list_tenant_audit_logs")
    if legacy_helper is not None:
        return legacy_helper(db, tenant_id, limit)
    return list(
        db.scalars(
            select(AuditLog)
            .where(AuditLog.tenant_id == tenant_id)
            .order_by(AuditLog.created_at.desc())
            .limit(limit)
        ).all()
    )


def _legacy_router_helper(name: str):
    """Preserve monkeypatch/test compatibility while /client routes move contexts."""
    try:
        from app.modules.tenants import router_client as legacy_router_client
    except Exception:
        return None
    helper = getattr(legacy_router_client, name, None)
    if helper is None or getattr(helper, "__module__", None) == __name__:
        return None
    return helper


@router.delete(
    "/devices/{device_uid}",
    dependencies=[
        require_feature("device_management"),
        require_tenant_permission("devices.manage"),
    ],
)
def client_unassign_device(
    device_uid: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> dict:
    device = repository.get_tenant_device(db, current_user.tenant_id, device_uid)
    if device is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail="Device not found or not assigned to your tenant"
        )
    repository.remove_device(db, current_user.tenant_id, device.id, deleted_by=current_user.id)
    audit_service.log_event_best_effort(
        db,
        action="tenant_unassign_device",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="device",
        resource_id=str(device.id),
        detail={"device_uid": device_uid},
    )
    return {"message": "Device deleted", "device_id": str(device.id), "status": "deleted"}


@router.post(
    "/devices",
    response_model=DeviceRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[
        require_feature("device_management"),
        require_tenant_permission("devices.manage"),
    ],
)
def client_register_device(
    payload: DeviceCreate,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> DeviceRead:
    from app.core.tenant_context import current_tenant_id_context

    current_tenant_id_context.set(current_user.tenant_id)
    payload_dict = payload.model_dump(exclude={"tenant_id"})
    payload_dict["tenant_id"] = current_user.tenant_id
    payload = DeviceCreate(**payload_dict)
    tenant = repository.get_tenant(db, current_user.tenant_id)
    plan = tenant.plan if tenant else None
    max_devices = plan.max_devices if plan else 5
    current_count = repository.count_tenant_devices(db, current_user.tenant_id)
    if current_count >= max_devices:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"Device limit reached ({max_devices}). Upgrade your plan.",
        )
    existing = device_repo.get_device_by_uid(db, payload.device_uid)
    if existing is not None:
        if existing.status == "deleted":
            existing.status = "offline"
            existing.deleted_at = None
            existing.deleted_by = None
            existing.tenant_id = current_user.tenant_id
            existing.project_id = payload.project_id
            existing.name = payload.name
            if payload.hardware_model is not None:
                existing.hardware_model = payload.hardware_model
            if payload.description is not None:
                existing.description = payload.description
            if payload.auth_token_hash:
                existing.auth_token_hash = payload.auth_token_hash
            db.commit()
            repository.assign_device(db, current_user.tenant_id, existing.id)
            db.refresh(existing)
            audit_service.log_event_best_effort(
                db,
                action="tenant_resurrect_device",
                user_id=current_user.id,
                tenant_id=current_user.tenant_id,
                resource_type="device",
                resource_id=str(existing.id),
                detail={"device_uid": existing.device_uid},
            )
            return _device_to_read(existing)

        if existing.tenant_id == current_user.tenant_id:
            # Check if mapping exists to handle idempotency (e.g., React Strict Mode double-POST)
            from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
                TenantDeviceMapping,
            )

            mapping = db.scalar(
                select(TenantDeviceMapping).where(
                    TenantDeviceMapping.tenant_id == current_user.tenant_id,
                    TenantDeviceMapping.device_id == existing.id,
                )
            )
            if not mapping:
                repository.assign_device(db, current_user.tenant_id, existing.id)
                db.refresh(existing)
                return _device_to_read(existing)
            else:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail="Device UID already exists. Edit the existing device instead.",
                )
        if existing.tenant_id is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="Device is already assigned to another tenant",
            )
        repository.assign_device(db, current_user.tenant_id, existing.id)
        db.refresh(existing)
        audit_service.log_event_best_effort(
            db,
            action="tenant_claim_device",
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            resource_type="device",
            resource_id=str(existing.id),
            detail={"device_uid": existing.device_uid},
        )
        return _device_to_read(existing)

    device = device_repo.register_device(db, payload)
    repository.assign_device(db, current_user.tenant_id, device.id)
    db.refresh(device)
    audit_service.log_event_best_effort(
        db,
        action="tenant_register_device",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="device",
        resource_id=str(device.id),
        detail={"device_uid": device.device_uid},
    )
    return _device_to_read(device)


@router.patch(
    "/devices/{device_uid}",
    response_model=DeviceRead,
    dependencies=[
        require_feature("device_management"),
        require_tenant_permission("devices.manage"),
    ],
)
@router.put(
    "/devices/{device_uid}",
    response_model=DeviceRead,
    dependencies=[
        require_feature("device_management"),
        require_tenant_permission("devices.manage"),
    ],
)
def client_update_device(
    device_uid: str,
    payload: DeviceUpdate,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> DeviceRead:
    device = repository.get_tenant_device(db, current_user.tenant_id, device_uid)
    if device is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail="Device not found or not assigned to your tenant",
        )
    updated = device_repo.update_device_metadata(
        db,
        device,
        name=payload.name.strip() if payload.name is not None else None,
        hardware_model=payload.hardware_model.strip() if payload.hardware_model else None,
        mac_address=payload.mac_address.strip() if payload.mac_address else None,
        description=payload.description.strip() if payload.description else None,
        auth_token_hash=payload.auth_token_hash,
        device_model_id=payload.device_model_id,
        fields_set=payload.model_fields_set,
    )
    audit_service.log_event_best_effort(
        db,
        action="tenant_update_device",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="device",
        resource_id=str(updated.id),
        detail={"device_uid": updated.device_uid, "fields": sorted(payload.model_fields_set)},
    )
    return _device_to_read(updated)


@router.get(
    "/devices/{device_uid}/mqtt-config",
    response_model=MqttConfigResponse,
    dependencies=[require_feature("device_management"), require_tenant_permission("devices.view")],
)
def client_device_mqtt_config(
    device_uid: str,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> MqttConfigResponse:
    device = device_repo.get_device_by_uid(db, device_uid)
    if device is not None and device.tenant_id not in (None, current_user.tenant_id):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail="Device is already assigned to another tenant",
        )
    host = settings.device_mqtt_host
    port = settings.device_mqtt_port
    mqtt_scheme = "mqtts" if settings.mqtt_tls_enabled else "mqtt"
    device_username = device_uid
    snippet = (
        f'CONFIG_AIFOM_WIFI_SSID="YourSSID"\n'
        f'CONFIG_AIFOM_WIFI_PASSWORD="***"\n'
        f"CONFIG_AIFOM_ENABLE_MDNS_DISCOVERY=y\n"
        f'CONFIG_AIFOM_MDNS_HOST="{host}"\n'
        f'CONFIG_AIFOM_MQTT_SCHEME="{mqtt_scheme}"\n'
        f'CONFIG_AIFOM_MQTT_HOST="{host}"\n'
        f"CONFIG_AIFOM_MQTT_PORT={port}\n"
        f'CONFIG_AIFOM_MQTT_USERNAME="{device_username}"\n'
        f'CONFIG_AIFOM_MQTT_PASSWORD="***"\n'
        f"CONFIG_AIFOM_API_PORT={settings.device_api_port}\n"
        f'CONFIG_AIFOM_FALLBACK_API_BASE_URL="{settings.device_api_base_url}"\n'
        f'CONFIG_AIFOM_DEVICE_UID="{device_uid}"'
    )
    return MqttConfigResponse(
        broker_host=host,
        broker_port=port,
        broker_tls_enabled=settings.mqtt_tls_enabled,
        client_id_suggestion=f"esp32-{device_uid}",
        topic_telemetry=mqtt_topics.telemetry_topic(device_uid),
        topic_status=mqtt_topics.status_topic(device_uid),
        topic_events=mqtt_topics.events_topic(device_uid),
        topic_commands=mqtt_topics.commands_topic(device_uid),
        topic_ota=mqtt_topics.ota_topic(device_uid),
        topic_ota_status=mqtt_topics.ota_status_topic(device_uid),
        sdkconfig_snippet=snippet,
    )


# ── Firmware (tenant self-service) ───────────────────────────────────────────


@router.get(
    "/firmware",
    response_model=list[FirmwareRead],
    dependencies=[require_feature("firmware_history"), require_tenant_permission("firmware.view")],
)
def client_list_firmware(
    target_device_type: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> list[FirmwareRead]:
    records = firmware_repo.list_firmware(
        db,
        target_device_type=target_device_type,
        limit=limit,
        tenant_id=current_user.tenant_id,
    )
    return [FirmwareRead.model_validate(r) for r in records]


@router.post(
    "/firmware",
    response_model=FirmwareRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_feature("ota_update"), require_tenant_permission("firmware.manage")],
)
def client_upload_firmware(
    version: str = Form(..., min_length=1, max_length=64),
    target_device_type: str = Form(..., min_length=1, max_length=64),
    release_notes: str | None = Form(default=None),
    signature: str | None = Form(default=None),
    signature_alg: str | None = Form(default=None, max_length=32),
    signature_payload: str | None = Form(default=None, max_length=64),
    signing_key_id: str | None = Form(default=None, max_length=128),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> FirmwareRead:
    data = file.file.read()
    size = len(data)

    # Validate file extension
    ext = (
        "." + file.filename.rsplit(".", 1)[-1].lower()
        if file.filename and "." in file.filename
        else ""
    )
    if ext != TENANT_FIRMWARE_EXTENSION:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tenant firmware upload accepts precompiled .bin files only",
        )

    if size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Firmware file is empty"
        )

    max_bytes = settings.firmware_max_size_mb * 1024 * 1024
    if size > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Firmware exceeds max size of {settings.firmware_max_size_mb} MB",
        )

    checksum = hashlib.sha256(data).hexdigest()
    safe_name = (
        PurePosixPath((file.filename or "firmware.bin").replace("\\", "/")).name or "firmware.bin"
    )
    object_key = f"{target_device_type}/{version}/{_uuid.uuid4().hex}-{safe_name}"

    try:
        minio_client.ensure_firmware_bucket()
        minio_client.put_firmware_object(
            object_key, data, content_type=file.content_type or "application/octet-stream"
        )
    except Exception as exc:
        logger.exception(
            "Tenant firmware upload to MinIO failed object_key=%s tenant=%s",
            object_key,
            current_user.tenant_id,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Firmware storage backend unavailable"
        ) from exc

    payload = FirmwareCreate(
        version=version,
        target_device_type=target_device_type,
        file_name=safe_name,
        object_key=object_key,
        file_size=size,
        checksum_sha256=checksum,
        release_notes=release_notes,
        signature=signature,
        signature_alg=signature_alg,
        signature_payload=signature_payload,
        signing_key_id=signing_key_id,
    )

    try:
        firmware = firmware_repo.create_firmware(db, payload, tenant_id=current_user.tenant_id)
    except IntegrityError as exc:
        db.rollback()
        logger.info(
            "Tenant firmware duplicate version target=%s version=%s tenant=%s",
            target_device_type,
            version,
            current_user.tenant_id,
        )
        minio_client.remove_firmware_object(object_key)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Firmware version already exists for this tenant and target device type",
        ) from exc
    except Exception:
        db.rollback()
        logger.exception("Tenant firmware DB insert failed object_key=%s", object_key)
        minio_client.remove_firmware_object(object_key)
        raise

    logger.info(
        "[FIRMWARE] upload version=%s target=%s tenant=%s",
        version,
        target_device_type,
        current_user.tenant_id,
    )
    audit_service.log_event_best_effort(
        db,
        action="upload_firmware",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="firmware",
        resource_id=str(firmware.id),
        detail={
            "version": firmware.version,
            "target": firmware.target_device_type,
            "size": firmware.file_size,
        },
    )
    return FirmwareRead.model_validate(firmware)


@router.post(
    "/firmware/from-source",
    response_model=FirmwareRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_feature("ota_update"), require_tenant_permission("firmware.manage")],
)
@_limiter.limit("5/minute")
def client_upload_firmware_from_source(
    request: Request,
    payload: FirmwareFromSourceRequest,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> FirmwareRead:
    """Accept .ino source code, attempt compilation, store the result."""
    from app.services.arduino_compiler import is_available as cli_available

    if not settings.enable_source_firmware_compile:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Source firmware compilation is disabled on this server.",
        )

    try:
        board_fqbn = validate_board_fqbn(payload.board_fqbn)
    except CompilerError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    if not cli_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Source firmware compilation is not configured on this server.",
        )

    version = payload.version
    target = payload.target_device_type
    source_key = f"{target}/{version}/{_uuid.uuid4().hex}-sketch.ino"

    try:
        minio_client.ensure_firmware_bucket()
        minio_client.put_firmware_object(
            source_key,
            payload.source_code.encode("utf-8"),
            content_type="text/x-arduino",
        )
    except Exception as exc:
        logger.exception(
            "Source upload to MinIO failed object_key=%s tenant=%s",
            source_key,
            current_user.tenant_id,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Storage backend unavailable"
        ) from exc

    binary_object_key: str | None = None
    binary_size: int | None = None
    checksum: str | None = None
    file_name: str | None = None
    source_type = "ino_source"

    try:
        # TODO(security): replace host execution with a Docker sandbox for Arduino builds.
        compiled_binary = compile_ino(payload.source_code, board_fqbn)
        import hashlib as _hashlib

        checksum = _hashlib.sha256(compiled_binary).hexdigest()
        binary_object_key = f"{target}/{version}/{_uuid.uuid4().hex}-firmware.bin"
        file_name = f"firmware-{version}.bin"
        binary_size = len(compiled_binary)
        minio_client.put_firmware_object(
            binary_object_key,
            compiled_binary,
            content_type="application/octet-stream",
        )
        source_type = "ino_compiled"
        logger.info(
            "[FIRMWARE] source compiled version=%s target=%s size=%d tenant=%s",
            version,
            target,
            binary_size,
            current_user.tenant_id,
        )
    except CompilerError as exc:
        minio_client.remove_firmware_object(source_key)
        logger.warning("[FIRMWARE] compile error version=%s: %s", version, exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc

    try:
        firmware = firmware_repo.create_firmware_source(
            db,
            version=version,
            target_device_type=target,
            source_code=payload.source_code,
            source_type=source_type,
            board_fqbn=board_fqbn,
            release_notes=payload.release_notes,
            file_name=file_name,
            object_key=binary_object_key,
            file_size=binary_size,
            checksum_sha256=checksum,
            tenant_id=current_user.tenant_id,
        )
    except Exception:
        logger.exception("Firmware source DB insert failed object_key=%s", source_key)
        minio_client.remove_firmware_object(source_key)
        if binary_object_key:
            minio_client.remove_firmware_object(binary_object_key)
        raise

    audit_service.log_event_best_effort(
        db,
        action="upload_firmware",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="firmware",
        resource_id=str(firmware.id),
        detail={
            "version": firmware.version,
            "target": firmware.target_device_type,
            "source_type": firmware.source_type,
        },
    )
    return FirmwareRead.model_validate(firmware)


@router.get(
    "/firmware/{firmware_id}",
    response_model=FirmwareRead,
    dependencies=[require_feature("firmware_history"), require_tenant_permission("firmware.view")],
)
def client_get_firmware(
    firmware_id: _uuid.UUID,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> FirmwareRead:
    firmware = firmware_repo.get_firmware_by_id(db, firmware_id)
    _ensure_firmware_accessible(firmware, current_user.tenant_id)
    return FirmwareRead.model_validate(firmware)


@router.post(
    "/firmware/{firmware_id}/sign",
    response_model=FirmwareRead,
    dependencies=[require_feature("ota_update"), require_tenant_permission("firmware.manage")],
)
def client_sign_firmware(
    firmware_id: _uuid.UUID,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> FirmwareRead:
    firmware = firmware_repo.get_firmware_by_id(db, firmware_id)
    _ensure_firmware_accessible(firmware, current_user.tenant_id)
    if firmware.uploaded_by_tenant_id != current_user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only sign firmware uploaded by your tenant",
        )
    try:
        firmware = sign_firmware(db, firmware)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    audit_service.log_event_best_effort(
        db,
        action="sign_firmware",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="firmware",
        resource_id=str(firmware.id),
        detail={"version": firmware.version, "key_id": firmware.signing_key_id},
    )
    return FirmwareRead.model_validate(firmware)


@router.post(
    "/firmware/{firmware_id}/archive",
    response_model=FirmwareRead,
    dependencies=[require_feature("ota_update"), require_tenant_permission("firmware.manage")],
)
def client_archive_firmware(
    firmware_id: _uuid.UUID,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> FirmwareRead:
    firmware = firmware_repo.get_firmware_by_id(db, firmware_id)
    _ensure_firmware_accessible(firmware, current_user.tenant_id)

    firmware.archived_at = datetime.now(timezone.utc)
    firmware.archived_by = current_user.id
    db.commit()
    db.refresh(firmware)

    audit_service.log_event_best_effort(
        db,
        action="archive_firmware",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="firmware",
        resource_id=str(firmware.id),
    )
    return FirmwareRead.model_validate(firmware)


@router.post(
    "/firmware/{firmware_id}/unarchive",
    response_model=FirmwareRead,
    dependencies=[require_feature("ota_update"), require_tenant_permission("firmware.manage")],
)
def client_unarchive_firmware(
    firmware_id: _uuid.UUID,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> FirmwareRead:
    firmware = firmware_repo.get_firmware_by_id(db, firmware_id)
    _ensure_firmware_accessible(firmware, current_user.tenant_id)

    firmware.archived_at = None
    firmware.archived_by = None
    db.commit()
    db.refresh(firmware)

    audit_service.log_event_best_effort(
        db,
        action="unarchive_firmware",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="firmware",
        resource_id=str(firmware.id),
    )
    return FirmwareRead.model_validate(firmware)


@router.delete(
    "/firmware/{firmware_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[require_feature("ota_update"), require_tenant_permission("firmware.manage")],
)
def client_delete_firmware(
    firmware_id: _uuid.UUID,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> None:
    firmware = firmware_repo.get_firmware_by_id(db, firmware_id)
    _ensure_firmware_accessible(firmware, current_user.tenant_id)
    if firmware.uploaded_by_tenant_id != current_user.tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete global platform firmware",
        )

    from app.modules.ota.model import OtaJob
    from sqlalchemy import select

    has_jobs = db.execute(
        select(OtaJob.id).where(OtaJob.firmware_version_id == firmware.id).limit(1)
    ).scalar_one_or_none()

    if has_jobs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Firmware has been used in OTA jobs and cannot be deleted. Please archive it instead.",
        )

    try:
        if firmware.object_key:
            minio_client.remove_firmware_object(firmware.object_key)
    except Exception:
        logger.warning("Failed to delete firmware object from storage", exc_info=True)

    db.delete(firmware)
    db.commit()

    audit_service.log_event_best_effort(
        db,
        action="delete_firmware",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="firmware",
        resource_id=str(firmware_id),
    )


@router.get(
    "/firmware/{firmware_id}/download-url",
    dependencies=[require_feature("firmware_history"), require_tenant_permission("firmware.view")],
)
def client_get_firmware_download_url(
    firmware_id: _uuid.UUID,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> dict:
    firmware = firmware_repo.get_firmware_by_id(db, firmware_id)
    _ensure_firmware_accessible(firmware, current_user.tenant_id)
    if not getattr(firmware, "object_key", None):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Firmware binary not found"
        )
    return {
        "download_url": f"/api/v1/client/firmware/{firmware_id}/download",
        "expires_at": None,
        "auth": "tenant-session",
    }


@router.get(
    "/firmware/{firmware_id}/download",
    dependencies=[require_feature("firmware_history"), require_tenant_permission("firmware.view")],
)
def client_download_firmware(
    firmware_id: _uuid.UUID,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    firmware = firmware_repo.get_firmware_by_id(db, firmware_id)
    _ensure_firmware_accessible(firmware, current_user.tenant_id)
    audit_service.log_event_best_effort(
        db,
        action="download_firmware",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="firmware",
        resource_id=str(firmware.id),
        detail={"version": firmware.version, "target": firmware.target_device_type},
    )
    return _stream_client_firmware(firmware)


# ── OTA jobs ──────────────────────────────────────────────────────────────────


@router.get(
    "/ota-jobs",
    response_model=list[OtaJobRead],
    dependencies=[require_feature("ota_update"), require_tenant_permission("ota.view")],
)
def client_ota_jobs(
    project_id: _uuid.UUID | None = Query(default=None, description="Filter by project ID"),
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> list[OtaJobRead]:
    devices = repository.list_tenant_devices(db, current_user.tenant_id, project_id=project_id)
    device_ids = [d.id for d in devices]
    if not device_ids:
        return []
    jobs = list(
        db.scalars(
            select(OtaJob)
            .where(OtaJob.device_id.in_(device_ids))
            .order_by(OtaJob.created_at.desc())
            .limit(200)
        ).all()
    )
    return [
        OtaJobRead(
            id=j.id,
            device_id=j.device_id,
            device_uid=j.device.device_uid,
            firmware_version_id=j.firmware_version_id,
            firmware_version=j.firmware_version.version,
            status=j.status,
            requested_at=j.requested_at,
            started_at=j.started_at,
            completed_at=j.completed_at,
            progress=j.progress,
            last_message=j.last_message,
            error_code=getattr(j, "error_code", None),
            error_message=j.error_message,
            created_at=j.created_at,
            updated_at=j.updated_at,
        )
        for j in jobs
    ]


@router.post(
    "/ota-jobs",
    response_model=OtaJobCreateResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_feature("ota_update"), require_tenant_permission("ota.manage")],
)
def client_create_ota_job(
    payload: OtaJobCreate,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> OtaJobCreateResponse:
    devices = []
    target_type = "device"
    group_id = payload.group_id

    if payload.group_id is not None:
        target_type = "group"
        group_uc = DeviceGroupUseCases(db)
        group = group_uc.get_group(current_user.tenant_id, payload.group_id)
        if group is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Device group not found"
            )
        group_devices, total = group_uc.list_group_devices(
            current_user.tenant_id, payload.group_id, skip=0, limit=200
        )
        if total == 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Device group has no devices",
            )
        if total > len(group_devices):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Device group exceeds OTA batch limit of 200 devices",
            )
        for item in group_devices:
            device = repository.get_tenant_device(db, current_user.tenant_id, item["device_uid"])
            if device is not None:
                devices.append(device)
    else:
        device = repository.get_tenant_device(db, current_user.tenant_id, payload.device_uid or "")
        if device is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Device not found or not assigned to your tenant",
            )
        devices.append(device)

    if not devices:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No target devices found for OTA job",
        )

    firmware = firmware_repo.get_firmware_by_id(db, payload.firmware_version_id)
    _ensure_firmware_accessible(firmware, current_user.tenant_id)

    created_jobs = []
    for device in devices:
        _ensure_firmware_compatible(device, firmware)
        job = ota_repo.create_job(db, device_id=device.id, firmware_version_id=firmware.id)
        request_payload = _build_client_ota_payload(
            job.id, firmware, device.device_uid, device.tenant_id, getattr(job, "campaign_id", None)
        )
        try:
            mqtt_publisher.publish_ota_request(device.device_uid, request_payload)
        except Exception as exc:
            logger.exception(
                "Client OTA publish failed job_id=%s device_uid=%s", job.id, device.device_uid
            )
            ota_repo.update_status(db, job.id, "failed", error_message=f"publish failed: {exc}")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="OTA request could not be published",
            ) from exc

        ota_repo.update_status(db, job.id, JOB_STATUS_SENT)
        OTA_JOBS_CREATED.inc()
        created_jobs.append((job, device))
        logger.info(
            "[OTA] create job=%s device=%s firmware=%s tenant=%s target_type=%s",
            job.id,
            device.device_uid,
            firmware.version,
            current_user.tenant_id,
            target_type,
        )

    first_job, first_device = created_jobs[0]
    audit_service.log_event_best_effort(
        db,
        action="create_ota_job",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="ota_job",
        resource_id=str(first_job.id),
        detail={
            "device_uid": first_device.device_uid,
            "firmware_version": firmware.version,
            "target_type": target_type,
            "group_id": str(group_id) if group_id else None,
            "job_ids": [str(job.id) for job, _device in created_jobs],
        },
    )
    return OtaJobCreateResponse(
        job_id=first_job.id,
        device_uid=first_device.device_uid,
        status=JOB_STATUS_SENT,
        job_ids=[job.id for job, _device in created_jobs],
        group_id=group_id,
        created_count=len(created_jobs),
        target_type=target_type,
    )


@router.post(
    "/ota-jobs/{job_id}/archive",
    response_model=OtaJobRead,
    dependencies=[require_feature("ota_update"), require_tenant_permission("ota.manage")],
)
def client_archive_ota_job(
    job_id: _uuid.UUID,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> OtaJobRead:
    job = db.get(OtaJob, job_id)
    if job is None or job.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OTA job not found")

    job.archived_at = datetime.now(timezone.utc)
    job.archived_by = current_user.id
    db.commit()
    db.refresh(job)

    audit_service.log_event_best_effort(
        db,
        action="archive_ota_job",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="ota_job",
        resource_id=str(job.id),
    )
    return OtaJobRead.model_validate(job)


@router.post(
    "/ota-jobs/{job_id}/unarchive",
    response_model=OtaJobRead,
    dependencies=[require_feature("ota_update"), require_tenant_permission("ota.manage")],
)
def client_unarchive_ota_job(
    job_id: _uuid.UUID,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> OtaJobRead:
    job = db.get(OtaJob, job_id)
    if job is None or job.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="OTA job not found")

    job.archived_at = None
    job.archived_by = None
    db.commit()
    db.refresh(job)

    audit_service.log_event_best_effort(
        db,
        action="unarchive_ota_job",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="ota_job",
        resource_id=str(job.id),
    )
    return OtaJobRead.model_validate(job)


# ── Alerts / Anomalies ────────────────────────────────────────────────────────


@router.get(
    "/alerts",
    dependencies=[
        require_feature("alert_management"),
        require_tenant_permission("monitoring.view"),
    ],
)
def client_alerts(
    project_id: _uuid.UUID | None = Query(default=None, description="Filter by project ID"),
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    devices = repository.list_tenant_devices(db, current_user.tenant_id, project_id=project_id)
    device_ids = [d.id for d in devices]
    device_uid_map = {d.id: d.device_uid for d in devices}
    if not device_ids:
        return []
    automation_alerts = list(
        db.scalars(
            select(Alert)
            .where(Alert.tenant_id == current_user.tenant_id)
            .where((Alert.device_id.is_(None)) | (Alert.device_id.in_(device_ids)))
            .order_by(Alert.last_seen_at.desc(), Alert.created_at.desc())
            .limit(limit)
        ).all()
    )
    items = (
        _automation_alert_item(alert, device_uid_map.get(alert.device_id, "unknown"))
        for alert in automation_alerts
    )
    items = list(items)
    items.sort(key=lambda item: item["timestamp"], reverse=True)
    return items[:limit]


@router.delete(
    "/alerts/{alert_id}",
    dependencies=[
        require_feature("alert_management"),
        require_tenant_permission("monitoring.view"),
    ],
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_client_alert(
    alert_id: _uuid.UUID,
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
):
    alert = db.get(Alert, alert_id)
    if not alert or alert.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")

    db.delete(alert)
    db.commit()

    audit_service.log_event_best_effort(
        db,
        action="delete_alert",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="alert",
        resource_id=str(alert.id),
    )
    return None




# ── AI / Anomaly detection ────────────────────────────────────────────────────




# ── User management ───────────────────────────────────────────────────────────


@router.get(
    "/users",
    response_model=list[UserRead],
    dependencies=[require_feature("user_management"), require_tenant_permission("members.view")],
)
def client_list_users(
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
) -> list[UserRead]:
    users = repository.list_tenant_users(db, current_user.tenant_id)
    return [UserRead.model_validate(u) for u in users]


def _active_owner_count(db: Session, tenant_id: _uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.tenant_id == tenant_id,
                User.role == OWNER_ROLE,
                User.is_active.is_(True),
            )
        )
        or 0
    )


@router.post(
    "/users",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[require_feature("user_management")],
)
def client_create_user(
    payload: TenantUserCreate,
    current_user: User = Depends(require_tenant_owner),
    db: Session = Depends(get_db),
) -> UserRead:
    from app.core.tenant_context import current_tenant_id_context, current_user_role_context

    current_tenant_id_context.set(current_user.tenant_id)
    current_user_role_context.set(current_user.role)

    if auth_repo.get_user_by_email(db, payload.email):
        raise HTTPException(status.HTTP_409_CONFLICT, detail="Email already exists")
    tenant = repository.get_tenant(db, current_user.tenant_id)
    plan = tenant.plan if tenant else None
    max_users = plan.max_users if plan else 3
    current_count = repository.count_tenant_users(db, current_user.tenant_id)
    if current_count >= max_users:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail=f"User limit reached ({max_users}). Upgrade your plan.",
        )
    # Tenant owners manage sub-users here; new owner creation stays out of this simple UI/API.
    _VALID_TENANT_ROLES = {VIEWER_ROLE}
    if payload.role not in _VALID_TENANT_ROLES:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid role '{payload.role}'. Must be one of: {', '.join(sorted(_VALID_TENANT_ROLES))}",
        )
    permissions = (
        validate_permissions(payload.permissions)
        if payload.permissions is not None
        else default_permissions_for_role(payload.role)
    )
    hashed = auth_service.hash_password(payload.password)
    user = User(
        email=payload.email,
        hashed_password=hashed,
        full_name=payload.full_name,
        role=payload.role,
        permissions=permissions,
        tenant_id=current_user.tenant_id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    audit_service.log_event_best_effort(
        db,
        action="tenant_create_user",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="user",
        resource_id=str(user.id),
        detail={"email": user.email, "role": user.role},
    )
    return UserRead.model_validate(user)


@router.patch(
    "/users/{user_id}",
    response_model=UserRead,
    dependencies=[require_feature("user_management")],
)
def client_update_user(
    user_id: str,
    payload: TenantUserUpdate,
    current_user: User = Depends(require_tenant_owner),
    db: Session = Depends(get_db),
) -> UserRead:
    from app.core.tenant_context import current_tenant_id_context, current_user_role_context

    current_tenant_id_context.set(current_user.tenant_id)
    current_user_role_context.set(current_user.role)

    try:
        uid = _uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid user id")

    user = auth_repo.get_user_by_id(db, uid)
    if user is None or user.tenant_id != current_user.tenant_id or user.role not in {OWNER_ROLE, VIEWER_ROLE}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")

    if user.role == OWNER_ROLE:
        if payload.role is not None and payload.role != OWNER_ROLE:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Owner role cannot be changed here"
            )
        if payload.permissions is not None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, detail="Owner permissions cannot be edited"
            )
        if payload.is_active is False:
            if user.id == current_user.id:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cannot disable yourself")
            if _active_owner_count(db, current_user.tenant_id) <= 1:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST, detail="Cannot disable the last Owner"
                )

    if user.id == current_user.id and payload.is_active is False:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cannot disable yourself")

    role_changed = payload.role is not None and payload.role != user.role
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip() or None
    if payload.role is not None:
        if payload.role == OWNER_ROLE:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Owner cannot be assigned from tenant portal",
            )
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.permissions is not None:
        user.permissions = validate_permissions(payload.permissions)
    elif role_changed:
        user.permissions = default_permissions_for_role(user.role)

    db.commit()
    db.refresh(user)
    audit_service.log_event_best_effort(
        db,
        action="tenant_update_user",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="user",
        resource_id=str(user.id),
        detail={"email": user.email, "role": user.role},
    )
    return UserRead.model_validate(user)


@router.delete(
    "/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[require_feature("user_management")],
)
def client_delete_user(
    user_id: str,
    current_user: User = Depends(require_tenant_owner),
    db: Session = Depends(get_db),
) -> None:
    try:
        uid = _uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Invalid user id")
    user = auth_repo.get_user_by_id(db, uid)
    if user is None or user.tenant_id != current_user.tenant_id or user.role not in {OWNER_ROLE, VIEWER_ROLE}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")
    if user.role == "tenant_owner":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Owner accounts cannot be removed from the tenant portal",
        )
    deleted_email = user.email
    db.delete(user)
    db.commit()
    audit_service.log_event_best_effort(
        db,
        action="tenant_delete_user",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="user",
        resource_id=str(uid),
        detail={"email": deleted_email},
    )


# ── Plan / Billing ────────────────────────────────────────────────────────────




# ── Audit logs ───────────────────────────────────────────────────────────────


@router.get(
    "/audit-logs",
    response_model=list[ClientAuditLogRead],
    dependencies=[require_feature("audit_log")],
)
def client_audit_logs(
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None),
) -> list[ClientAuditLogRead]:
    # Apply action filtering at DB level for correct pagination
    stmt = (
        select(AuditLog)
        .where(AuditLog.tenant_id == current_user.tenant_id)
        .order_by(AuditLog.created_at.desc())
    )
    if action:
        stmt = stmt.where(AuditLog.action == action)
    stmt = stmt.limit(limit).offset(offset)
    logs = list(db.scalars(stmt).all())
    return [ClientAuditLogRead.model_validate(log) for log in logs]


# ── Real-time device status stream (SSE) ─────────────────────────────────────


@router.get(
    "/audit-logs/timeline",
    dependencies=[require_feature("audit_log")],
)
def client_audit_timeline(
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=200, ge=1, le=1000),
    action: str | None = Query(default=None),
    resource_type: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
) -> list[dict]:
    """Return tenant audit logs grouped by date for timeline display."""
    stmt = (
        select(AuditLog)
        .where(AuditLog.tenant_id == current_user.tenant_id)
        .order_by(AuditLog.created_at.desc())
    )
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if date_from:
        try:
            stmt = stmt.where(AuditLog.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            stmt = stmt.where(AuditLog.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    logs = list(db.scalars(stmt.limit(limit)).all())

    grouped: dict[str, list[dict]] = {}
    for log in logs:
        date_key = log.created_at.strftime("%Y-%m-%d")
        grouped.setdefault(date_key, []).append(
            {
                "id": str(log.id),
                "user_id": str(log.user_id) if log.user_id else None,
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "detail": log.detail,
                "created_at": log.created_at.isoformat(),
            }
        )

    return [{"date": date, "events": events} for date, events in grouped.items()]


@router.get(
    "/audit-logs/export",
    dependencies=[require_feature("audit_log")],
)
def client_audit_export(
    current_user: User = Depends(get_current_tenant_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=1000, ge=1, le=5000),
    action: str | None = Query(default=None),
    resource_type: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
):
    """Export tenant audit logs as CSV."""
    import csv
    import io

    from fastapi.responses import StreamingResponse

    stmt = (
        select(AuditLog)
        .where(AuditLog.tenant_id == current_user.tenant_id)
        .order_by(AuditLog.created_at.desc())
    )
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if date_from:
        try:
            stmt = stmt.where(AuditLog.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            stmt = stmt.where(AuditLog.created_at <= datetime.fromisoformat(date_to))
        except ValueError:
            pass
    logs = list(db.scalars(stmt.limit(limit)).all())

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "id",
            "user_id",
            "action",
            "resource_type",
            "resource_id",
            "detail",
            "ip_address",
            "created_at",
        ]
    )
    for log in logs:
        writer.writerow(
            [
                str(log.id),
                str(log.user_id) if log.user_id else "",
                log.action,
                log.resource_type or "",
                log.resource_id or "",
                json.dumps(log.detail) if log.detail else "",
                log.ip_address or "",
                log.created_at.isoformat(),
            ]
        )

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=audit_logs.csv"},
    )


@router.get("/devices/status/stream")
async def device_status_stream(
    current_user: User = Depends(get_current_tenant_user),
):
    """Server-Sent Events stream of device status changes for the current tenant.

    EventSource authenticates with the browser's httpOnly auth cookie. JWTs
    must not be passed in the URL because query strings leak through logs and
    browser history.
    """
    import json as _json

    from sse_starlette.sse import EventSourceResponse

    from app.shared.infrastructure.messaging.device_status_events import device_status_bus

    tenant_id = str(current_user.tenant_id)

    async def event_generator():
        async for event in device_status_bus.subscribe(tenant_id):
            yield {"event": "device_status_changed", "data": _json.dumps(event)}

    return EventSourceResponse(event_generator())


@router.get("/alerts/stream")
async def alert_stream(
    current_user: User = Depends(get_current_tenant_user),
):
    """Server-Sent Events stream of real-time alerts for the current tenant."""
    import json as _json

    from sse_starlette.sse import EventSourceResponse

    from app.shared.infrastructure.messaging.alert_events import alert_bus

    tenant_id = str(current_user.tenant_id)

    async def event_generator():
        async for event in alert_bus.subscribe(tenant_id):
            yield {"event": "alert_created", "data": _json.dumps(event)}

    return EventSourceResponse(event_generator())
