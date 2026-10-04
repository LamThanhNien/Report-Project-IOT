"""Telemetry presentation router — re-wires telemetry endpoints.

This router provides the same API endpoints as modules/telemetry/router.py
but delegates to the bounded context's use cases.

API paths are preserved:
- GET  /api/v1/telemetry
- POST /api/v1/telemetry
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.bounded_contexts.telemetry.application.use_cases import (
    create_single_telemetry,
    query_telemetry,
)
from app.bounded_contexts.telemetry.domain.value_objects import TelemetryFilter
from app.core.security import require_admin
from app.core.platform_tenant_access import ensure_platform_owned
from app.db.session import get_db
from app.modules.audit import service as audit_service
from app.modules.telemetry.model import Telemetry
from app.modules.telemetry.schema import TelemetryCreate, TelemetryRead

router = APIRouter()


def _audit_admin_read(db: Session, current_user, action: str, detail: dict) -> None:
    audit_service.log_event_best_effort(
        db,
        action=action,
        user_id=getattr(current_user, "id", None),
        tenant_id=getattr(current_user, "tenant_id", None),
        detail=detail,
    )


def _to_read(record: Telemetry) -> TelemetryRead:
    """Convert a Telemetry ORM model to TelemetryRead schema."""
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


@router.get("", response_model=list[TelemetryRead])
def list_telemetry(
    tenant_id: UUID | None = None,
    device_uid: str | None = None,
    metric_name: str | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    current_user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[TelemetryRead]:
    """List telemetry records with optional filters."""
    filter = TelemetryFilter(
        tenant_id=tenant_id,
        device_uid=device_uid,
        metric_name=metric_name,
        from_time=from_time,
        to_time=to_time,
        limit=limit,
        offset=offset,
    )
    records = query_telemetry(db, filter)
    _audit_admin_read(
        db,
        current_user,
        "admin_list_telemetry",
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
    return [_to_read(record) for record in records]


@router.post(
    "",
    response_model=TelemetryRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_admin)],
)
def create_telemetry(
    payload: TelemetryCreate,
    db: Session = Depends(get_db),
) -> TelemetryRead:
    """Create a single telemetry record."""
    from app.modules.devices import repository as device_repository

    device = device_repository.get_device_by_uid(db, payload.device_uid)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device UID not found")
    ensure_platform_owned(device.tenant_id)
    record = create_single_telemetry(
        db,
        device_uid=payload.device_uid,
        metric_name=payload.metric_name,
        metric_value=payload.metric_value,
        timestamp=payload.timestamp,
        unit=payload.unit,
        raw_payload=payload.raw_payload,
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device UID not found",
        )
    return _to_read(record)
