"""Device Group Admin API router."""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.security import require_admin
from app.bounded_contexts.device_groups.application.schemas import DeviceGroupResponse

router = APIRouter(prefix="/admin/device-groups", tags=["admin"])


@router.get("", response_model=dict)
def list_all_groups(
    tenant_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """List all device groups across tenants (admin only)."""
    from app.bounded_contexts.device_groups.infrastructure.persistence.models import (
        DeviceGroup,
        DeviceGroupMember,
    )
    from app.bounded_contexts.tenant_management.infrastructure.persistence.models import Tenant
    from sqlalchemy import func

    query = db.query(DeviceGroup, Tenant).outerjoin(Tenant, DeviceGroup.tenant_id == Tenant.id)

    if tenant_id:
        try:
            tid = UUID(tenant_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="tenant_id must be a valid UUID")
        query = query.filter(DeviceGroup.tenant_id == tid)
    if status:
        query = query.filter(DeviceGroup.status == status)

    total = query.count()
    rows = query.order_by(DeviceGroup.created_at.desc()).offset(skip).limit(limit).all()

    # Attach device_count
    groups = []
    for g, tenant in rows:
        g.tenant = tenant
        g.device_count = (
            db.query(func.count(DeviceGroupMember.id))
            .filter(DeviceGroupMember.group_id == g.id)
            .scalar()
        )
        groups.append(g)

    return {
        "items": [DeviceGroupResponse.from_orm_model(g) for g in groups],
        "total": total,
        "skip": skip,
        "limit": limit,
    }
