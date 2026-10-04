"""Device Registry presentation router.

Admin device management endpoints.  Delegates through application use
cases rather than calling repositories directly.
"""

import hmac
import logging
import threading
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import require_admin
from app.db.session import get_db
from app.bounded_contexts.device_registry.application import use_cases
from app.bounded_contexts.device_registry.domain.value_objects import MqttTopics
from app.bounded_contexts.device_registry.infrastructure import repositories as device_repo
from app.modules.devices.schema import (
    DeviceCreate,
    DeviceRead,
    DeviceRegisterResponse,
    DeviceStatusResponse,
)
from app.bounded_contexts.device_registry.presentation.schemas import AdminDeviceCreate
from app.modules.telemetry import repository as telemetry_repository
from app.modules.telemetry.model import Telemetry
from app.modules.telemetry.schema import TelemetryRead
from app.modules.audit import service as audit_service
from app.services import mqtt_topics as mqtt_topics_service
from app.shared.schemas.tenant import TenantSummary

logger = logging.getLogger(__name__)
router = APIRouter()
_limiter = Limiter(key_func=get_remote_address)


class DeviceRegisterRequest(DeviceCreate):
    # Prefer Authorization: Bearer <token> or this body field.
    # The provisioning_token query parameter remains temporarily for legacy ESP32 demos.
    provisioning_token: str | None = None


# ---------------------------------------------------------------------------
# Adapter: bridge legacy modules to use-case port interfaces
# ---------------------------------------------------------------------------


class _DeviceRepoAdapter:
    """Wraps legacy device repository functions as a use-case port."""

    def list_devices(self):
        return device_repo.list_devices(db=_current_db())

    def get_device_by_uid(self, device_uid: str):
        return device_repo.get_device_by_uid(db=_current_db(), device_uid=device_uid)

    def create_device(self, payload):
        return device_repo.create_device(db=_current_db(), payload=payload)

    def register_device(self, payload):
        return device_repo.register_device(db=_current_db(), payload=payload)

    def touch_device(self, device_uid: str, **kwargs):
        return device_repo.touch_device(db=_current_db(), device_uid=device_uid, **kwargs)

    def update_offline_timeout(self, device, seconds: int):
        return device_repo.update_offline_timeout_seconds(
            db=_current_db(), device=device, offline_timeout_seconds=seconds
        )

    def mark_stale_devices_offline(self):
        return device_repo.mark_stale_devices_offline(db=_current_db())


class _MqttTopicsAdapter:
    """Wraps legacy mqtt_topics module as a use-case port."""

    def topics_for_device(self, device_uid: str) -> MqttTopics:
        return MqttTopics(
            telemetry=mqtt_topics_service.telemetry_topic(device_uid),
            status=mqtt_topics_service.status_topic(device_uid),
            events=mqtt_topics_service.events_topic(device_uid),
            commands=mqtt_topics_service.commands_topic(device_uid),
            ota=mqtt_topics_service.ota_topic(device_uid),
            ota_status=mqtt_topics_service.ota_status_topic(device_uid),
        )


# Thread-local DB session holder for adapter
_db_local = threading.local()


def _current_db() -> Session:
    return _db_local.session


def _set_db(session: Session):
    _db_local.session = session


# Singleton adapters
_repo_adapter = _DeviceRepoAdapter()
_mqtt_adapter = _MqttTopicsAdapter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _telemetry_to_read(record: Telemetry) -> TelemetryRead:
    return TelemetryRead(
        id=record.id,
        device_id=record.device_id,
        device_uid=record.device.device_uid,
        timestamp=record.timestamp,
        metric_name=record.metric_name,
        metric_value=record.metric_value,
        unit=record.unit,
        raw_payload=record.raw_payload,
        created_at=record.created_at,
    )


def _device_to_read(device, tenant=None) -> DeviceRead:
    read = DeviceRead.model_validate(device)
    status = (
        "deleted" if device.status == "deleted" else device_repo.effective_connection_status(device)
    )
    read = read.model_copy(update={"status": status})
    if tenant is not None:
        read = read.model_copy(
            update={"tenant": TenantSummary(id=tenant.id, name=tenant.name, slug=tenant.slug)}
        )
    return read


def _extract_provisioning_token(
    payload: DeviceRegisterRequest,
    authorization: str | None,
    query_token: str | None,
) -> str | None:
    if authorization:
        scheme, _, value = authorization.partition(" ")
        if scheme.lower() == "bearer" and value.strip():
            return value.strip()
    if payload.provisioning_token:
        return payload.provisioning_token
    return query_token


def _audit_admin_read(db: Session, current_user, action: str, detail: dict) -> None:
    audit_service.log_event_best_effort(
        db,
        action=action,
        user_id=getattr(current_user, "id", None),
        tenant_id=getattr(current_user, "tenant_id", None),
        detail=detail,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[DeviceRead])
def list_devices(
    tenant_id: str | None = Query(default=None, description="Filter by tenant UUID"),
    current_user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[DeviceRead]:
    _set_db(db)
    rows = device_repo.list_devices_with_tenant(db=db, tenant_id=tenant_id)
    _audit_admin_read(
        db,
        current_user,
        "admin_list_devices",
        {"count": len(rows), "tenant_id_filter": tenant_id},
    )
    return [_device_to_read(device, tenant=tenant) for device, tenant in rows]


@router.post(
    "",
    response_model=DeviceRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def create_device(payload: AdminDeviceCreate, db: Session = Depends(get_db)) -> DeviceRead:
    _set_db(db)
    if payload.tenant_id is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform administrators cannot create or assign tenant-owned devices",
        )
    from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
        Tenant,
    )

    tenant = db.get(Tenant, payload.tenant_id) if payload.tenant_id else None
    if payload.tenant_id and tenant is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tenant not found",
        )
    try:
        device_payload = DeviceCreate(**payload.model_dump(exclude={"tenant_id"}))
        device = _repo_adapter.create_device(device_payload)
        from app.bounded_contexts.tenant_management.infrastructure.repositories import (
            assign_device,
        )

        if tenant is not None:
            assign_device(db, tenant.id, device.id)
            db.refresh(device)
        return _device_to_read(device, tenant=tenant)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Device UID already exists",
        ) from exc


@router.post("/register", response_model=DeviceRegisterResponse)
@_limiter.limit("5/minute")
def register_device(
    request: Request,
    payload: DeviceRegisterRequest,
    authorization: str | None = Header(default=None),
    provisioning_token: str | None = Query(
        default=None,
        deprecated=True,
        description="Deprecated. Prefer Authorization: Bearer <token> or provisioning_token in body.",
    ),
    db: Session = Depends(get_db),
) -> DeviceRegisterResponse:
    """Register a device using a provisioning token."""
    expected = settings.device_provisioning_secret
    if not expected:
        logger.warning("[DEVICE REGISTER] Provisioning secret not configured — rejecting")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Device provisioning not configured on this server",
        )
    provided_token = _extract_provisioning_token(payload, authorization, provisioning_token)
    if not provided_token or not hmac.compare_digest(provided_token, expected):
        logger.warning(
            "[DEVICE REGISTER] Invalid provisioning token device_uid=%s",
            payload.device_uid,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid provisioning token",
        )

    _set_db(db)
    device_payload = DeviceCreate(**payload.model_dump(exclude={"provisioning_token"}))
    device_payload.tenant_id = None
    result = use_cases.register_device(_repo_adapter, _mqtt_adapter, device_payload)
    device = result.device
    logger.info("[DEVICE REGISTER] device_uid=%s via provisioning token", device.device_uid)
    audit_service.log_event_best_effort(
        db,
        action="register_device",
        resource_type="device",
        resource_id=str(device.id),
        detail={"device_uid": device.device_uid, "method": "provisioning_token"},
    )
    return DeviceRegisterResponse(
        device_uid=device.device_uid,
        mqtt_topics=result.mqtt_topics.to_dict(),
        mqtt_username=getattr(device, "mqtt_username", None),
        mqtt_password=getattr(device, "mqtt_password", None),
    )


@router.get(
    "/{device_uid}/telemetry",
    response_model=list[TelemetryRead],
)
def get_device_telemetry(
    device_uid: str,
    metric_name: str | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    current_user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[TelemetryRead]:
    records = telemetry_repository.list_telemetry_by_device_uid(
        db,
        device_uid,
        metric_name=metric_name,
        from_time=from_time,
        to_time=to_time,
        limit=limit,
        offset=offset,
    )
    _audit_admin_read(
        db,
        current_user,
        "admin_read_device_telemetry",
        {
            "device_uid": device_uid,
            "metric_name": metric_name,
            "from_time": from_time.isoformat() if from_time else None,
            "to_time": to_time.isoformat() if to_time else None,
            "limit": limit,
            "offset": offset,
            "count": len(records),
        },
    )
    return [_telemetry_to_read(record) for record in records]


@router.get(
    "/{device_uid}/latest-telemetry",
    response_model=list[TelemetryRead],
)
def get_latest_device_telemetry(
    device_uid: str,
    current_user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[TelemetryRead]:
    records = telemetry_repository.latest_telemetry_by_device_uid(db, device_uid)
    _audit_admin_read(
        db,
        current_user,
        "admin_read_latest_device_telemetry",
        {"device_uid": device_uid, "count": len(records)},
    )
    return [_telemetry_to_read(record) for record in records]


@router.get(
    "/{device_uid}/status",
    response_model=DeviceStatusResponse,
    dependencies=[Depends(require_admin)],
)
def get_device_status(device_uid: str, db: Session = Depends(get_db)) -> DeviceStatusResponse:
    _set_db(db)
    device = use_cases.get_device_by_uid(_repo_adapter, device_uid)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device UID not found")
    tenant = device_repo.get_tenant_for_device(db=db, device_id=device.id)
    tenant_summary = (
        TenantSummary(id=tenant.id, name=tenant.name, slug=tenant.slug) if tenant else None
    )
    return DeviceStatusResponse(
        device_uid=device.device_uid,
        name=device.name,
        firmware_version=device.firmware_version,
        status="deleted"
        if device.status == "deleted"
        else device_repo.effective_connection_status(device),
        ip_address=device.ip_address,
        rssi=device.rssi,
        free_heap=device.free_heap,
        uptime_ms=device.uptime_ms,
        last_status_payload=device.last_status_payload,
        last_seen_at=device.last_seen_at,
        offline_timeout_seconds=device.offline_timeout_seconds,
        tenant=tenant_summary,
    )


class DeviceMqttCredentialsResponse(BaseModel):
    mqtt_username: str
    mqtt_password: str


@router.post(
    "/{device_uid}/rotate-mqtt-creds",
    response_model=DeviceMqttCredentialsResponse,
    dependencies=[Depends(require_admin)],
)
def rotate_device_mqtt_credentials(
    device_uid: str,
    publish_to_device: bool = Query(
        default=True, description="Publish the new credentials to the device via MQTT"
    ),
    db: Session = Depends(get_db),
) -> DeviceMqttCredentialsResponse:
    _set_db(db)
    device = use_cases.get_device_by_uid(_repo_adapter, device_uid)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    import secrets
    import uuid
    from datetime import timedelta, timezone
    from sqlalchemy.orm.attributes import flag_modified

    raw_password = secrets.token_hex(16)
    command_id = str(uuid.uuid4())
    new_hash = device_repo.hash_mqtt_password(raw_password)

    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=15)

    # Initialize metadata if None
    if device.metadata_ is None:
        device.metadata_ = {}

    device.metadata_["pending_mqtt_creds"] = {
        "command_id": command_id,
        "username": device.device_uid,
        "password_hash": new_hash,
        "created_at": now.isoformat(),
        "expires_at": expires.isoformat(),
    }
    flag_modified(device, "metadata_")
    db.commit()
    db.refresh(device)

    if publish_to_device:
        try:
            from app.shared.infrastructure.messaging.mqtt_publisher import publish_device_command

            mqtt_payload = {
                "command_id": command_id,
                "command_type": "rotate_mqtt_creds",
                "username": device.device_uid,
                "password": raw_password,
                "mqtt_username": device.device_uid,
                "mqtt_password": raw_password,
            }
            publish_device_command(device.device_uid, mqtt_payload)
        except Exception as exc:
            logger.error(
                f"Failed to publish rotate_mqtt_creds command to device {device.device_uid}: {exc}"
            )

    audit_service.log_event_best_effort(
        db,
        action="rotate_device_mqtt_credentials",
        resource_type="device",
        resource_id=str(device.id),
        detail={"device_uid": device.device_uid, "published": publish_to_device},
    )

    return DeviceMqttCredentialsResponse(
        mqtt_username=device.device_uid,
        mqtt_password=raw_password,
    )


@router.post(
    "/{device_uid}/revoke-mqtt-creds",
    response_model=DeviceRead,
    dependencies=[Depends(require_admin)],
)
def revoke_device_mqtt_credentials(
    device_uid: str,
    db: Session = Depends(get_db),
) -> DeviceRead:
    _set_db(db)
    device = use_cases.get_device_by_uid(_repo_adapter, device_uid)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    device.mqtt_username = None
    device.mqtt_password_hash = None
    if device.metadata_ and "pending_mqtt_creds" in device.metadata_:
        from sqlalchemy.orm.attributes import flag_modified

        del device.metadata_["pending_mqtt_creds"]
        flag_modified(device, "metadata_")
    db.commit()
    db.refresh(device)

    device_repo.sync_mosquitto_passwd(db)

    audit_service.log_event_best_effort(
        db,
        action="revoke_device_mqtt_credentials",
        resource_type="device",
        resource_id=str(device.id),
        detail={"device_uid": device.device_uid},
    )

    tenant = device_repo.get_tenant_for_device(db=db, device_id=device.id)
    return _device_to_read(device, tenant=tenant)
