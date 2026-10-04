"""Device Provisioning Admin API router."""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.security import require_admin
from app.bounded_contexts.device_provisioning.application.schemas import ProvisioningSessionResponse
from app.bounded_contexts.device_provisioning.infrastructure.models import ProvisioningSession
from app.bounded_contexts.tenant_management.infrastructure.persistence.models import Tenant

router = APIRouter(prefix="/admin/provisioning", tags=["admin"])


@router.get("/sessions", response_model=dict)
def list_all_sessions(
    tenant_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """List all provisioning sessions across tenants (admin only)."""
    query = db.query(ProvisioningSession, Tenant).outerjoin(
        Tenant, ProvisioningSession.tenant_id == Tenant.id
    )

    if tenant_id:
        try:
            tid = UUID(tenant_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="tenant_id must be a valid UUID")
        query = query.filter(ProvisioningSession.tenant_id == tid)
    if status:
        query = query.filter(ProvisioningSession.status == status)

    total = query.count()
    rows = query.order_by(ProvisioningSession.created_at.desc()).offset(skip).limit(limit).all()
    sessions = []
    for session, tenant in rows:
        session.tenant = tenant
        sessions.append(
            ProvisioningSessionResponse.from_orm_model(session).model_copy(
                update={"claim_code": None}
            )
        )

    return {
        "items": sessions,
        "total": total,
        "skip": skip,
        "limit": limit,
    }
