import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.devices.model_device_types import DeviceType
from app.modules.devices.schema_device_types import DeviceTypeCreate, DeviceTypeUpdate


def list_device_types(db: Session) -> list[DeviceType]:
    return list(db.scalars(select(DeviceType).order_by(DeviceType.key)).all())


def get_device_type_by_id(db: Session, device_type_id: uuid.UUID) -> DeviceType | None:
    return db.scalar(select(DeviceType).where(DeviceType.id == device_type_id))


def get_device_type_by_key(db: Session, key: str) -> DeviceType | None:
    return db.scalar(select(DeviceType).where(DeviceType.key == key))


def create_device_type(db: Session, payload: DeviceTypeCreate) -> DeviceType:
    device_type = DeviceType(**payload.model_dump())
    db.add(device_type)
    db.commit()
    db.refresh(device_type)
    return device_type


def update_device_type(
    db: Session, device_type: DeviceType, payload: DeviceTypeUpdate
) -> DeviceType:
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(device_type, field, value)
    db.commit()
    db.refresh(device_type)
    return device_type


def delete_device_type(db: Session, device_type: DeviceType) -> None:
    db.delete(device_type)
    db.commit()
