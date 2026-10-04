"""Use cases for device platform and model management."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
from app.bounded_contexts.device_registry.infrastructure.persistence.platform_models import (
    CapabilityTemplate,
    DeviceModel,
    DevicePlatform,
)


# ── Platform queries ──────────────────────────────────────────────────────────


def list_platforms(db: Session) -> list[DevicePlatform]:
    """List all device platforms."""
    return list(db.scalars(select(DevicePlatform).order_by(DevicePlatform.name)).all())


def get_platform(db: Session, platform_id: uuid.UUID) -> DevicePlatform | None:
    """Get a platform by ID."""
    return db.get(DevicePlatform, platform_id)


def get_platform_by_key(db: Session, key: str) -> DevicePlatform | None:
    """Get a platform by key."""
    return db.scalar(select(DevicePlatform).where(DevicePlatform.key == key))


def create_platform(db: Session, **kwargs) -> DevicePlatform:
    """Create a new device platform."""
    platform = DevicePlatform(**kwargs)
    db.add(platform)
    db.flush()
    return platform


def update_platform(db: Session, platform: DevicePlatform, **kwargs) -> DevicePlatform:
    """Update an existing device platform."""
    for key, value in kwargs.items():
        setattr(platform, key, value)
    db.flush()
    return platform


def delete_platform(db: Session, platform: DevicePlatform) -> None:
    """Delete a device platform and its dependent models/templates."""
    db.delete(platform)
    db.flush()


# ── Model queries ─────────────────────────────────────────────────────────────


def list_models(
    db: Session,
    platform_id: uuid.UUID | None = None,
) -> list[DeviceModel]:
    """List device models, optionally filtered by platform."""
    stmt = select(DeviceModel).options(joinedload(DeviceModel.platform))
    if platform_id is not None:
        stmt = stmt.where(DeviceModel.platform_id == platform_id)
    stmt = stmt.order_by(DeviceModel.name)
    return list(db.scalars(stmt).unique().all())


def get_model(db: Session, model_id: uuid.UUID) -> DeviceModel | None:
    """Get a device model by ID."""
    return db.scalar(
        select(DeviceModel)
        .options(joinedload(DeviceModel.platform))
        .where(DeviceModel.id == model_id)
    )


def get_model_by_key(db: Session, platform_key: str, model_key: str) -> DeviceModel | None:
    """Get a device model by platform key and model key."""
    return db.scalar(
        select(DeviceModel)
        .join(DevicePlatform)
        .where(DevicePlatform.key == platform_key, DeviceModel.key == model_key)
    )


def get_model_by_platform_id_and_key(
    db: Session,
    platform_id: uuid.UUID,
    model_key: str,
) -> DeviceModel | None:
    """Get a device model by platform ID and model key."""
    return db.scalar(
        select(DeviceModel).where(
            DeviceModel.platform_id == platform_id,
            DeviceModel.key == model_key,
        )
    )


def create_model(db: Session, **kwargs) -> DeviceModel:
    """Create a new device model."""
    model = DeviceModel(**kwargs)
    db.add(model)
    db.flush()
    return model


def update_model(db: Session, model: DeviceModel, **kwargs) -> DeviceModel:
    """Update an existing device model."""
    for key, value in kwargs.items():
        setattr(model, key, value)
    db.flush()
    return model


def delete_model(db: Session, model: DeviceModel) -> None:
    """Delete a device model and its dependent capability templates."""
    db.delete(model)
    db.flush()


# ── Capability template queries ───────────────────────────────────────────────


def list_capability_templates(
    db: Session,
    device_model_id: uuid.UUID | None = None,
) -> list[CapabilityTemplate]:
    """List capability templates, optionally filtered by device model."""
    stmt = select(CapabilityTemplate)
    if device_model_id is not None:
        stmt = stmt.where(CapabilityTemplate.device_model_id == device_model_id)
    stmt = stmt.order_by(CapabilityTemplate.capability_key)
    return list(db.scalars(stmt).all())


def get_capability_template(db: Session, template_id: uuid.UUID) -> CapabilityTemplate | None:
    """Get a capability template by ID."""
    return db.get(CapabilityTemplate, template_id)


def get_capability_template_by_model_id_and_key(
    db: Session,
    device_model_id: uuid.UUID,
    capability_key: str,
) -> CapabilityTemplate | None:
    """Get a capability template by model ID and capability key."""
    return db.scalar(
        select(CapabilityTemplate).where(
            CapabilityTemplate.device_model_id == device_model_id,
            CapabilityTemplate.capability_key == capability_key,
        )
    )


def create_capability_template(db: Session, **kwargs) -> CapabilityTemplate:
    """Create a new capability template."""
    template = CapabilityTemplate(**kwargs)
    db.add(template)
    db.flush()
    return template


def update_capability_template(
    db: Session,
    template: CapabilityTemplate,
    **kwargs,
) -> CapabilityTemplate:
    """Update an existing capability template."""
    for key, value in kwargs.items():
        setattr(template, key, value)
    db.flush()
    return template


def delete_capability_template(db: Session, template: CapabilityTemplate) -> None:
    """Delete a capability template."""
    db.delete(template)
    db.flush()


# ── Device platform assignment ────────────────────────────────────────────────


def assign_device_platform(
    db: Session,
    device_id: uuid.UUID,
    platform_id: uuid.UUID,
    device_model_id: uuid.UUID | None = None,
) -> Device | None:
    """Assign a platform (and optionally a model) to a device."""
    device = db.get(Device, device_id)
    if device is None:
        return None
    device.platform_id = platform_id
    device.device_model_id = device_model_id
    db.flush()
    return device


def get_device_with_platform(db: Session, device_id: uuid.UUID) -> Device | None:
    """Get a device with platform and model relationships loaded."""
    return db.scalar(
        select(Device)
        .options(
            joinedload(Device.platform),
            joinedload(Device.device_model),
        )
        .where(Device.id == device_id)
    )


# ── Compatibility check ──────────────────────────────────────────────────────


def check_firmware_device_compatibility(
    db: Session,
    firmware_platform_id: uuid.UUID | None,
    firmware_model_id: uuid.UUID | None,
    device_platform_id: uuid.UUID | None,
    device_model_id: uuid.UUID | None,
) -> tuple[bool, str | None]:
    """Check if a firmware is compatible with a device.

    Returns (is_compatible, error_message).
    """
    # If firmware has no platform targeting, it's universal (backward compat)
    if firmware_platform_id is None:
        return True, None

    # If device has no platform assigned, we can't validate — allow it
    if device_platform_id is None:
        return True, None

    # Platform must match
    if firmware_platform_id != device_platform_id:
        firmware_platform = db.get(DevicePlatform, firmware_platform_id)
        device_platform = db.get(DevicePlatform, device_platform_id)
        fw_name = firmware_platform.name if firmware_platform else "unknown"
        dev_name = device_platform.name if device_platform else "unknown"
        return False, (
            f"Firmware platform '{fw_name}' is not compatible with device platform '{dev_name}'"
        )

    # If firmware targets a specific model, model must match
    if firmware_model_id is not None and device_model_id is not None:
        if firmware_model_id != device_model_id:
            firmware_model = db.get(DeviceModel, firmware_model_id)
            device_model = db.get(DeviceModel, device_model_id)
            fw_name = firmware_model.name if firmware_model else "unknown"
            dev_name = device_model.name if device_model else "unknown"
            return False, (f"Firmware targets model '{fw_name}' but device is '{dev_name}'")

    return True, None
