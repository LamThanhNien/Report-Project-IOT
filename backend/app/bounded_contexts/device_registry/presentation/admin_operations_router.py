from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.bounded_contexts.command_center.application.schemas import CommandDispatchResponse
from app.bounded_contexts.command_center.application.use_cases import CommandCenterUseCases
from app.bounded_contexts.device_registry.infrastructure import repositories as device_repo
from app.core.security import require_admin
from app.core.platform_tenant_access import ensure_platform_owned
from app.db.session import get_db
from app.modules.audit import service as audit_service
from app.modules.auth.model import User

router = APIRouter(prefix="/admin/devices", tags=["admin-device-operations"])


def _device_or_404(db: Session, device_uid: str):
    device = device_repo.get_device_by_uid(db, device_uid)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return device


def _dispatch(db: Session, device, admin: User, command_type: str):
    tenant = device_repo.get_tenant_for_device(db=db, device_id=device.id)
    dispatch = CommandCenterUseCases(db).dispatch_admin_device_command(
        device,
        command_type,
        created_by=admin.id,
        tenant_id=tenant.id if tenant else None,
    )
    if dispatch.status == "failed":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=dispatch.error_message or "Device command could not be dispatched",
        )
    return dispatch


@router.post("/{device_uid}/commands/reboot", response_model=CommandDispatchResponse)
def reboot_device(
    device_uid: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    device = _device_or_404(db, device_uid)
    tenant = device_repo.get_tenant_for_device(db=db, device_id=device.id)
    ensure_platform_owned(tenant.id if tenant else None)
    dispatch = _dispatch(db, device, admin, "reboot")
    audit_service.log_event_best_effort(
        db,
        action="admin_reboot_device",
        user_id=admin.id,
        resource_type="device",
        resource_id=str(device.id),
        detail={"device_uid": device.device_uid, "command_id": str(dispatch.id)},
    )
    return dispatch


def _set_maintenance(db: Session, device_uid: str, admin: User, enabled: bool):
    device = _device_or_404(db, device_uid)
    tenant = device_repo.get_tenant_for_device(db=db, device_id=device.id)
    ensure_platform_owned(tenant.id if tenant else None)
    command_type = "maintenance_enable" if enabled else "maintenance_disable"
    dispatch = _dispatch(db, device, admin, command_type)
    device.status = "maintenance" if enabled else "online"
    if not enabled:
        device.status = device_repo.effective_connection_status(device)
    db.add(device)
    db.commit()
    db.refresh(device)
    audit_service.log_event_best_effort(
        db,
        action="enable_device_maintenance" if enabled else "disable_device_maintenance",
        user_id=admin.id,
        resource_type="device",
        resource_id=str(device.id),
        detail={"device_uid": device.device_uid, "command_id": str(dispatch.id)},
    )
    return dispatch


@router.post("/{device_uid}/maintenance/enable", response_model=CommandDispatchResponse)
def enable_maintenance(
    device_uid: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    return _set_maintenance(db, device_uid, admin, True)


@router.post("/{device_uid}/maintenance/disable", response_model=CommandDispatchResponse)
def disable_maintenance(
    device_uid: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    return _set_maintenance(db, device_uid, admin, False)
