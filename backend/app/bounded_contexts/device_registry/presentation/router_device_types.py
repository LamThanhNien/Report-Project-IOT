import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import require_admin
from app.db.session import get_db
from app.modules.audit import service as audit_service
from app.modules.devices import repository_device_types as repository
from app.modules.devices.schema_device_types import (
    DeviceTypeCreate,
    DeviceTypeRead,
    DeviceTypeUpdate,
)

router = APIRouter()


@router.get("", response_model=list[DeviceTypeRead], dependencies=[Depends(require_admin)])
def list_device_types(db: Session = Depends(get_db)) -> list[DeviceTypeRead]:
    return repository.list_device_types(db)


@router.post(
    "",
    response_model=DeviceTypeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_device_type(
    payload: DeviceTypeCreate,
    current_user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> DeviceTypeRead:
    try:
        dt = repository.create_device_type(db, payload)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Device type key already exists",
        ) from exc
    audit_service.log_event_best_effort(
        db,
        action="admin_create_device_type",
        user_id=getattr(current_user, "id", None),
        resource_type="device_type",
        resource_id=str(dt.id),
        detail={"key": dt.key, "name": dt.name},
    )
    return dt


@router.get(
    "/{device_type_id}",
    response_model=DeviceTypeRead,
    dependencies=[Depends(require_admin)],
)
def get_device_type(device_type_id: uuid.UUID, db: Session = Depends(get_db)) -> DeviceTypeRead:
    device_type = repository.get_device_type_by_id(db, device_type_id)
    if device_type is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device type not found",
        )
    return device_type


@router.put(
    "/{device_type_id}",
    response_model=DeviceTypeRead,
)
def update_device_type(
    device_type_id: uuid.UUID,
    payload: DeviceTypeUpdate,
    current_user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> DeviceTypeRead:
    device_type = repository.get_device_type_by_id(db, device_type_id)
    if device_type is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device type not found",
        )
    updated = repository.update_device_type(db, device_type, payload)
    audit_service.log_event_best_effort(
        db,
        action="admin_update_device_type",
        user_id=getattr(current_user, "id", None),
        resource_type="device_type",
        resource_id=str(device_type_id),
        detail={"key": updated.key, "name": updated.name},
    )
    return updated


@router.delete(
    "/{device_type_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_device_type(
    device_type_id: uuid.UUID,
    current_user=Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    device_type = repository.get_device_type_by_id(db, device_type_id)
    if device_type is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device type not found",
        )
    dt_key = device_type.key
    repository.delete_device_type(db, device_type)
    audit_service.log_event_best_effort(
        db,
        action="admin_delete_device_type",
        user_id=getattr(current_user, "id", None),
        resource_type="device_type",
        resource_id=str(device_type_id),
        detail={"key": dt_key},
    )
