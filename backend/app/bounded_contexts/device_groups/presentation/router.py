"""Device Group API router."""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_tenant_permission
from app.core.tenant import get_current_tenant_user
from app.modules.auth.model import User
from app.bounded_contexts.device_groups.application.schemas import (
    DeviceGroupCreate,
    DeviceGroupUpdate,
    DeviceGroupResponse,
    DeviceGroupMemberAdd,
    DeviceGroupMemberRemove,
)
from app.bounded_contexts.device_groups.application.use_cases import DeviceGroupUseCases

router = APIRouter(prefix="/client/device-groups", tags=["Device Groups"])
device_router = APIRouter(prefix="/client/devices", tags=["Device Groups"])


@router.post(
    "",
    response_model=DeviceGroupResponse,
    status_code=201,
    dependencies=[require_tenant_permission("device_groups.manage")],
)
def create_group(
    data: DeviceGroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = DeviceGroupUseCases(db)
    try:
        group = uc.create_group(current_user.tenant_id, data, created_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    group.device_count = 0
    return DeviceGroupResponse.from_orm_model(group)


@router.get("", response_model=dict, dependencies=[require_tenant_permission("device_groups.view")])
def list_groups(
    group_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = DeviceGroupUseCases(db)
    groups, total = uc.list_groups(current_user.tenant_id, group_type, status, search, skip, limit)
    return {
        "items": [DeviceGroupResponse.from_orm_model(g) for g in groups],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.get(
    "/{group_id}",
    response_model=DeviceGroupResponse,
    dependencies=[require_tenant_permission("device_groups.view")],
)
def get_group(
    group_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = DeviceGroupUseCases(db)
    group = uc.get_group(current_user.tenant_id, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Device group not found")
    return DeviceGroupResponse.from_orm_model(group)


@router.put(
    "/{group_id}",
    response_model=DeviceGroupResponse,
    dependencies=[require_tenant_permission("device_groups.manage")],
)
def update_group(
    group_id: UUID,
    data: DeviceGroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = DeviceGroupUseCases(db)
    try:
        group = uc.update_group(current_user.tenant_id, group_id, data)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not group:
        raise HTTPException(status_code=404, detail="Device group not found")
    return DeviceGroupResponse.from_orm_model(group)


@router.post(
    "/{group_id}/archive",
    status_code=200,
    dependencies=[require_tenant_permission("device_groups.manage")],
)
def archive_group(
    group_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = DeviceGroupUseCases(db)
    success = uc.archive_group(current_user.tenant_id, group_id)
    if not success:
        raise HTTPException(status_code=404, detail="Device group not found")
    return {"message": "Group archived successfully"}


@router.delete(
    "/{group_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[require_tenant_permission("device_groups.manage")],
)
def delete_group(
    group_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = DeviceGroupUseCases(db)
    success = uc.delete_group(current_user.tenant_id, group_id)
    if not success:
        raise HTTPException(status_code=404, detail="Device group not found")
    return None


@router.post(
    "/{group_id}/members",
    status_code=200,
    dependencies=[require_tenant_permission("device_groups.manage")],
)
def add_members(
    group_id: UUID,
    data: DeviceGroupMemberAdd,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = DeviceGroupUseCases(db)
    try:
        added = uc.add_devices_to_group(
            current_user.tenant_id,
            group_id,
            data.device_ids,
            added_by=current_user.id,
        )
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"added": added}


@router.post(
    "/{group_id}/members/remove",
    status_code=200,
    dependencies=[require_tenant_permission("device_groups.manage")],
)
def remove_members(
    group_id: UUID,
    data: DeviceGroupMemberRemove,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = DeviceGroupUseCases(db)
    try:
        removed = uc.remove_devices_from_group(current_user.tenant_id, group_id, data.device_ids)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    return {"removed": removed}


@router.get(
    "/{group_id}/devices",
    response_model=dict,
    dependencies=[require_tenant_permission("device_groups.view")],
)
def list_group_devices(
    group_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = DeviceGroupUseCases(db)
    try:
        devices, total = uc.list_group_devices(current_user.tenant_id, group_id, skip, limit)
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "items": devices,
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@device_router.get(
    "/{device_id}/groups",
    response_model=dict,
    dependencies=[require_tenant_permission("device_groups.view")],
)
def list_device_groups(
    device_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_tenant_user),
):
    uc = DeviceGroupUseCases(db)
    try:
        groups, total = uc.list_device_groups(current_user.tenant_id, device_id, skip, limit)
    except PermissionError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {
        "items": [DeviceGroupResponse.from_orm_model(group) for group in groups],
        "total": total,
        "skip": skip,
        "limit": limit,
    }
