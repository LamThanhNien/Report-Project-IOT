"""Device Provisioning API router."""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_tenant_permission
from app.core.tenant import get_current_tenant_user
from app.modules.auth.model import User
from app.bounded_contexts.device_provisioning.application.schemas import (
    ClaimCodeCreate,
    ClaimDeviceRequest,
    ProvisioningSessionResponse,
)
from app.bounded_contexts.device_provisioning.application.use_cases import ProvisioningUseCases
from app.modules.audit import service as audit_service

router = APIRouter(prefix="/client/provisioning", tags=["Device Provisioning"])


def _resolve_device_name(db: Session, device_id) -> Optional[str]:
    """Look up device name from device_registry if available."""
    if not device_id:
        return None
    try:
        from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device

        device = db.query(Device).filter(Device.id == device_id).first()
        if device:
            return device.name
    except Exception:
        pass
    return None


@router.post(
    "/claim-code",
    response_model=ProvisioningSessionResponse,
    status_code=201,
    dependencies=[require_tenant_permission("devices.manage")],
)
def create_claim_code(
    data: ClaimCodeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = ProvisioningUseCases(db)
    try:
        session = uc.create_claim_code(current_user.tenant_id, data, created_by=current_user.id)
    except ValueError as e:
        audit_service.log_event_best_effort(
            db,
            action="provisioning.claim_code_create",
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            resource_type="provisioning_session",
            detail={"device_id": str(data.device_id) if data.device_id else None},
            outcome="failure",
        )
        raise HTTPException(status_code=409, detail=str(e))
    audit_service.log_event_best_effort(
        db,
        action="provisioning.claim_code_create",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="provisioning_session",
        resource_id=str(session.id),
        detail={"device_id": str(session.device_id) if session.device_id else None},
        outcome="success",
    )
    device_name = _resolve_device_name(db, session.device_id)
    return ProvisioningSessionResponse.from_orm_model(session, device_name=device_name)


@router.get(
    "/sessions", response_model=dict, dependencies=[require_tenant_permission("devices.view")]
)
def list_sessions(
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = ProvisioningUseCases(db)
    sessions, total = uc.list_sessions(current_user.tenant_id, status, skip, limit)
    return {
        "items": [ProvisioningSessionResponse.from_orm_model(s) for s in sessions],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.get(
    "/sessions/{session_id}",
    response_model=ProvisioningSessionResponse,
    dependencies=[require_tenant_permission("devices.view")],
)
def get_session_detail(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = ProvisioningUseCases(db)
    session = uc.get_session(current_user.tenant_id, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên cấp phát.")
    device_name = _resolve_device_name(db, session.device_id)
    return ProvisioningSessionResponse.from_orm_model(session, device_name=device_name)


@router.post(
    "/claim",
    response_model=ProvisioningSessionResponse,
    dependencies=[require_tenant_permission("devices.manage")],
)
def claim_device(
    data: ClaimDeviceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = ProvisioningUseCases(db)
    try:
        session = uc.claim_device(
            data.claim_code, claimed_by=current_user.id, claimer_tenant_id=current_user.tenant_id
        )
    except ValueError as e:
        audit_service.log_event_best_effort(
            db,
            action="device.provisioning_claim",
            user_id=current_user.id,
            tenant_id=current_user.tenant_id,
            resource_type="provisioning_session",
            detail={"reason": "claim_rejected"},
            outcome="failure",
        )
        raise HTTPException(status_code=400, detail=str(e))
    audit_service.log_event_best_effort(
        db,
        action="device.provisioning_claim",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="provisioning_session",
        resource_id=str(session.id),
        detail={"device_id": str(session.device_id) if session.device_id else None},
        outcome="success",
    )
    return ProvisioningSessionResponse.from_orm_model(session)


@router.post(
    "/revoke/{session_id}",
    status_code=200,
    dependencies=[require_tenant_permission("devices.manage")],
)
def revoke_claim(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = ProvisioningUseCases(db)
    success = uc.revoke_claim(current_user.tenant_id, session_id)
    if not success:
        raise HTTPException(
            status_code=404, detail="Provisioning session not found or cannot be revoked"
        )
    audit_service.log_event_best_effort(
        db,
        action="provisioning.claim_revoke",
        user_id=current_user.id,
        tenant_id=current_user.tenant_id,
        resource_type="provisioning_session",
        resource_id=str(session_id),
        outcome="success",
    )
    return {"message": "Claim code revoked successfully"}
