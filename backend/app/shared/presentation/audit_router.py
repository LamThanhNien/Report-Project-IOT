import json
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import require_admin
from app.db.session import get_db
from app.modules.audit.model import AuditLog
from app.bounded_contexts.tenant_management.infrastructure.persistence.models import Tenant
from app.shared.schemas.tenant import TenantSummary, tenant_summary

router = APIRouter()


class AuditLogRead(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID | None
    tenant: TenantSummary | None = None
    user_id: uuid.UUID | None
    action: str
    resource_type: str | None
    resource_id: str | None
    detail: dict | None
    ip_address: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


def _audit_log_read(log: AuditLog, tenant: Tenant | None = None) -> AuditLogRead:
    return AuditLogRead(
        id=log.id,
        tenant_id=log.tenant_id,
        tenant=tenant_summary(tenant),
        user_id=log.user_id,
        action=log.action,
        resource_type=log.resource_type,
        resource_id=log.resource_id,
        detail=log.detail,
        ip_address=log.ip_address,
        created_at=log.created_at,
    )


@router.get("", response_model=list[AuditLogRead])
def list_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None),
    tenant_id: str | None = Query(default=None),
    user_id: str | None = Query(default=None),
    _user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[AuditLogRead]:
    stmt = (
        select(AuditLog, Tenant)
        .outerjoin(Tenant, AuditLog.tenant_id == Tenant.id)
        .order_by(AuditLog.created_at.desc())
    )
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if tenant_id:
        try:
            tid = uuid.UUID(tenant_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="tenant_id must be a valid UUID")
        stmt = stmt.where(AuditLog.tenant_id == tid)
    if user_id:
        try:
            uid = uuid.UUID(user_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="user_id must be a valid UUID")
        stmt = stmt.where(AuditLog.user_id == uid)
    stmt = stmt.limit(limit).offset(offset)
    return [_audit_log_read(log, tenant) for log, tenant in db.execute(stmt).all()]


@router.get("/timeline")
def admin_audit_timeline(
    limit: int = Query(default=500, ge=1, le=2000),
    tenant_id: uuid.UUID | None = Query(default=None),
    action: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    _user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[dict]:
    """Return audit logs grouped by date for admin timeline display."""
    stmt = (
        select(AuditLog, Tenant)
        .outerjoin(Tenant, AuditLog.tenant_id == Tenant.id)
        .order_by(AuditLog.created_at.desc())
    )
    if tenant_id:
        stmt = stmt.where(AuditLog.tenant_id == tenant_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if date_from:
        try:
            from_dt = datetime.fromisoformat(date_from)
            stmt = stmt.where(AuditLog.created_at >= from_dt)
        except ValueError:
            pass
    if date_to:
        try:
            to_dt = datetime.fromisoformat(date_to)
            stmt = stmt.where(AuditLog.created_at <= to_dt)
        except ValueError:
            pass
    stmt = stmt.limit(limit)
    rows = list(db.execute(stmt).all())

    grouped: dict[str, list[dict]] = {}
    for log, tenant in rows:
        date_key = log.created_at.strftime("%Y-%m-%d")
        if date_key not in grouped:
            grouped[date_key] = []
        grouped[date_key].append(
            {
                "id": str(log.id),
                "tenant_id": str(log.tenant_id) if log.tenant_id else None,
                "tenant": tenant_summary(tenant).model_dump(mode="json") if tenant else None,
                "user_id": str(log.user_id) if log.user_id else None,
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "detail": log.detail,
                "ip_address": log.ip_address,
                "created_at": log.created_at.isoformat(),
            }
        )

    return [{"date": date, "events": events} for date, events in grouped.items()]


@router.get("/export")
def admin_audit_export(
    limit: int = Query(default=5000, ge=1, le=10000),
    tenant_id: uuid.UUID | None = Query(default=None),
    action: str | None = Query(default=None),
    date_from: str | None = Query(default=None),
    date_to: str | None = Query(default=None),
    _user=Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Export audit logs as CSV (admin scope)."""
    import csv
    import io

    stmt = select(AuditLog).order_by(AuditLog.created_at.desc())
    if tenant_id:
        stmt = stmt.where(AuditLog.tenant_id == tenant_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if date_from:
        try:
            from_dt = datetime.fromisoformat(date_from)
            stmt = stmt.where(AuditLog.created_at >= from_dt)
        except ValueError:
            pass
    if date_to:
        try:
            to_dt = datetime.fromisoformat(date_to)
            stmt = stmt.where(AuditLog.created_at <= to_dt)
        except ValueError:
            pass
    stmt = stmt.limit(limit)
    logs = list(db.scalars(stmt).all())

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "id",
            "tenant_id",
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
                str(log.tenant_id) if log.tenant_id else "",
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
