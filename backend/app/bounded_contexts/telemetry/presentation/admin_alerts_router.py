"""Explicit admin API for persistent alerts."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.bounded_contexts.telemetry.infrastructure.persistence.alert_models import Alert
from app.core.platform_tenant_access import ensure_platform_owned
from app.core.security import require_admin
from app.db.session import get_db
from app.modules.auth.model import User
from app.modules.devices import repository as device_repository
from app.modules.devices.model import Device
from app.modules.tenants import repository as tenant_repository

router = APIRouter(dependencies=[Depends(require_admin)])


def _alert_item(db: Session, alert: Alert) -> dict:
    device = db.get(Device, alert.device_id) if alert.device_id else None
    tenant = tenant_repository.get_tenant(db, alert.tenant_id) if alert.tenant_id else None
    return {
        "id": str(alert.id),
        "severity": alert.severity,
        "status": alert.status,
        "title": alert.title,
        "message": alert.message,
        "source": alert.source,
        "source_type": alert.source,
        "source_id": str(alert.source_id) if alert.source_id else None,
        "device_id": str(alert.device_id) if alert.device_id else None,
        "device_uid": device.device_uid if device else None,
        "first_seen_at": alert.first_seen_at,
        "last_seen_at": alert.last_seen_at,
        "acknowledged_at": alert.acknowledged_at,
        "resolved_at": alert.resolved_at,
        "metadata": alert.details or {},
        # Compatibility fields used by the existing Admin Alerts page.
        "timestamp": alert.last_seen_at,
        "tenant": (
            {"id": str(tenant.id), "name": tenant.name, "slug": tenant.slug} if tenant else None
        ),
    }


def _filtered_alerts_query(
    *,
    severity: str | None,
    alert_status: str | None,
    source_type: str | None,
    device_id: uuid.UUID | None,
    from_time: datetime | None,
    to_time: datetime | None,
    tenant_id: uuid.UUID | None = None,
):
    stmt = select(Alert)
    if tenant_id is not None:
        stmt = stmt.where(Alert.tenant_id == tenant_id)
    if severity:
        stmt = stmt.where(Alert.severity == severity)
    if alert_status:
        stmt = stmt.where(Alert.status == alert_status)
    if source_type:
        stmt = stmt.where(Alert.source == source_type)
    if device_id:
        stmt = stmt.where(Alert.device_id == device_id)
    if from_time:
        stmt = stmt.where(Alert.last_seen_at >= from_time)
    if to_time:
        stmt = stmt.where(Alert.last_seen_at <= to_time)
    return stmt


@router.get("")
def list_admin_alerts(
    tenant_id: uuid.UUID | None = Query(default=None),
    severity: str | None = None,
    alert_status: str | None = Query(default=None, alias="status"),
    source_type: str | None = None,
    device_id: uuid.UUID | None = None,
    device_uid: str | None = None,
    from_time: datetime | None = None,
    to_time: datetime | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    page: int | None = Query(default=None, ge=1),
    db: Session = Depends(get_db),
) -> list[dict]:
    if device_uid:
        device = device_repository.get_device_by_uid(db, device_uid)
        if device is None:
            return []
        if device_id is not None and device.id != device_id:
            return []
        device_id = device.id
    if page is not None:
        offset = (page - 1) * limit
    stmt = (
        _filtered_alerts_query(
            severity=severity,
            alert_status=alert_status,
            source_type=source_type,
            device_id=device_id,
            from_time=from_time,
            to_time=to_time,
            tenant_id=tenant_id,
        )
        .order_by(Alert.last_seen_at.desc(), Alert.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return [_alert_item(db, alert) for alert in db.scalars(stmt).all()]


@router.get("/summary")
def admin_alert_summary(
    tenant_id: uuid.UUID | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    severity_stmt = select(Alert.severity, func.count(Alert.id))
    status_stmt = select(Alert.status, func.count(Alert.id))
    if tenant_id is not None:
        severity_stmt = severity_stmt.where(Alert.tenant_id == tenant_id)
        status_stmt = status_stmt.where(Alert.tenant_id == tenant_id)
    severity_rows = db.execute(severity_stmt.group_by(Alert.severity)).all()
    status_rows = db.execute(status_stmt.group_by(Alert.status)).all()
    severity = {key: int(count) for key, count in severity_rows}
    statuses = {key: int(count) for key, count in status_rows}
    return {
        "total": sum(severity.values()),
        "by_severity": {
            "critical": severity.get("critical", 0),
            "warning": severity.get("warning", 0),
            "info": severity.get("info", 0),
        },
        "by_status": {
            "open": statuses.get("open", 0),
            "acknowledged": statuses.get("acknowledged", 0),
            "resolved": statuses.get("resolved", 0),
        },
    }


@router.post("/{alert_id}/ack")
@router.post("/{alert_id}/acknowledge", include_in_schema=False)
def acknowledge_admin_alert(
    alert_id: uuid.UUID,
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Alert not found")
    ensure_platform_owned(alert.tenant_id)
    if alert.status != "resolved":
        alert.status = "acknowledged"
        alert.acknowledged_at = datetime.now(timezone.utc)
        alert.acknowledged_by_user_id = current_admin.id
        db.commit()
        db.refresh(alert)
    return _alert_item(db, alert)


@router.post("/{alert_id}/resolve")
def resolve_admin_alert(
    alert_id: uuid.UUID,
    db: Session = Depends(get_db),
) -> dict:
    alert = db.get(Alert, alert_id)
    if alert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Alert not found")
    ensure_platform_owned(alert.tenant_id)
    if alert.status != "resolved":
        alert.status = "resolved"
        alert.resolved_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(alert)
    return _alert_item(db, alert)
