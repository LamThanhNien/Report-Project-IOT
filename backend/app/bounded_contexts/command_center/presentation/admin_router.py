"""Command Center Admin API router."""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.security import require_admin
from app.bounded_contexts.command_center.application.schemas import CommandDispatchResponse
from app.bounded_contexts.command_center.infrastructure.models import CommandDispatch, CommandTarget
from app.bounded_contexts.tenant_management.infrastructure.persistence.models import Tenant

router = APIRouter(prefix="/admin/commands", tags=["admin"])


@router.get("/history", response_model=dict)
def list_all_history(
    tenant_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    command_type: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _admin: dict = Depends(require_admin),
):
    """List all command dispatches across tenants (admin only)."""
    query = db.query(CommandDispatch, Tenant).outerjoin(
        Tenant, CommandDispatch.tenant_id == Tenant.id
    )

    if tenant_id:
        try:
            tid = UUID(tenant_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="tenant_id must be a valid UUID")
        query = query.filter(CommandDispatch.tenant_id == tid)
    if status:
        query = query.filter(CommandDispatch.status == status)
    if command_type:
        query = query.filter(CommandDispatch.command_type == command_type)

    total = query.count()
    rows = query.order_by(CommandDispatch.created_at.desc()).offset(skip).limit(limit).all()

    targets_by_dispatch = {dispatch.id: [] for dispatch, _tenant in rows}
    if targets_by_dispatch:
        targets = (
            db.query(CommandTarget)
            .filter(CommandTarget.dispatch_id.in_(list(targets_by_dispatch)))
            .all()
        )
        for target in targets:
            targets_by_dispatch.setdefault(target.dispatch_id, []).append(target)

    dispatches = []
    for d, tenant in rows:
        d.tenant = tenant
        d.targets = targets_by_dispatch.get(d.id, [])
        dispatches.append(d)

    return {
        "items": [CommandDispatchResponse.from_orm_model(d) for d in dispatches],
        "total": total,
        "skip": skip,
        "limit": limit,
    }
