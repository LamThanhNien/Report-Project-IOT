"""Admin API for device platform and model management.

Provides endpoints for listing/creating device platforms, device models,
and capability templates.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.security import get_current_user, require_admin
from app.db.session import get_db
from app.modules.auth.model import User

from .platform_schemas import (
    CapabilityTemplateCreate,
    CapabilityTemplateResponse,
    CapabilityTemplateUpdate,
    DeviceModelCreate,
    DeviceModelResponse,
    DeviceModelUpdate,
    DeviceModelWithPlatform,
    DevicePlatformCreate,
    DevicePlatformResponse,
    DevicePlatformUpdate,
)
from ..application import platform_use_cases

router = APIRouter(tags=["admin-platforms"])


# ── Platforms ─────────────────────────────────────────────────────────────────


@router.get("", response_model=list[DevicePlatformResponse])
def list_platforms(
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """List all device platforms."""
    return platform_use_cases.list_platforms(db)


@router.get("/{platform_id}", response_model=DevicePlatformResponse)
def get_platform(
    platform_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Get a device platform by ID."""
    platform = platform_use_cases.get_platform(db, platform_id)
    if platform is None:
        raise HTTPException(status_code=404, detail="Platform not found")
    return platform


@router.post("", response_model=DevicePlatformResponse, status_code=201)
def create_platform(
    data: DevicePlatformCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Create a new device platform."""
    existing = platform_use_cases.get_platform_by_key(db, data.key)
    if existing is not None:
        raise HTTPException(
            status_code=409, detail=f"Platform with key '{data.key}' already exists"
        )
    platform = platform_use_cases.create_platform(db, **data.model_dump())
    db.commit()
    return platform


@router.put("/{platform_id}", response_model=DevicePlatformResponse)
def update_platform(
    platform_id: uuid.UUID,
    data: DevicePlatformUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Update a device platform."""
    platform = platform_use_cases.get_platform(db, platform_id)
    if platform is None:
        raise HTTPException(status_code=404, detail="Platform not found")
    existing = platform_use_cases.get_platform_by_key(db, data.key)
    if existing is not None and existing.id != platform_id:
        raise HTTPException(
            status_code=409, detail=f"Platform with key '{data.key}' already exists"
        )
    updated = platform_use_cases.update_platform(db, platform, **data.model_dump())
    db.commit()
    return updated


@router.delete("/{platform_id}", status_code=204, response_class=Response)
def delete_platform(
    platform_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Delete a device platform."""
    platform = platform_use_cases.get_platform(db, platform_id)
    if platform is None:
        raise HTTPException(status_code=404, detail="Platform not found")
    platform_use_cases.delete_platform(db, platform)
    db.commit()


# ── Device Models ─────────────────────────────────────────────────────────────

models_router = APIRouter(tags=["admin-device-models"])


@models_router.get("", response_model=list[DeviceModelWithPlatform])
def list_device_models(
    platform_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """List all device models, optionally filtered by platform."""
    return platform_use_cases.list_models(db, platform_id=platform_id)


@models_router.get("/{model_id}", response_model=DeviceModelWithPlatform)
def get_device_model(
    model_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Get a device model by ID."""
    model = platform_use_cases.get_model(db, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Device model not found")
    return model


@models_router.post("", response_model=DeviceModelResponse, status_code=201)
def create_device_model(
    data: DeviceModelCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Create a new device model."""
    # Verify platform exists
    platform = platform_use_cases.get_platform(db, data.platform_id)
    if platform is None:
        raise HTTPException(status_code=404, detail="Platform not found")
    model = platform_use_cases.create_model(db, **data.model_dump())
    db.commit()
    return model


@models_router.put("/{model_id}", response_model=DeviceModelResponse)
def update_device_model(
    model_id: uuid.UUID,
    data: DeviceModelUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Update a device model."""
    model = platform_use_cases.get_model(db, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Device model not found")
    platform = platform_use_cases.get_platform(db, data.platform_id)
    if platform is None:
        raise HTTPException(status_code=404, detail="Platform not found")
    existing = platform_use_cases.get_model_by_platform_id_and_key(
        db,
        data.platform_id,
        data.key,
    )
    if existing is not None and existing.id != model_id:
        raise HTTPException(
            status_code=409,
            detail=f"Device model with key '{data.key}' already exists for this platform",
        )
    updated = platform_use_cases.update_model(db, model, **data.model_dump())
    db.commit()
    return updated


@models_router.delete("/{model_id}", status_code=204, response_class=Response)
def delete_device_model(
    model_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Delete a device model."""
    model = platform_use_cases.get_model(db, model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Device model not found")
    platform_use_cases.delete_model(db, model)
    db.commit()


# ── Capability Templates ──────────────────────────────────────────────────────

caps_router = APIRouter(tags=["admin-capability-templates"])


@caps_router.get("", response_model=list[CapabilityTemplateResponse])
def list_capability_templates(
    device_model_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """List capability templates, optionally filtered by device model."""
    return platform_use_cases.list_capability_templates(db, device_model_id=device_model_id)


@caps_router.get("/{template_id}", response_model=CapabilityTemplateResponse)
def get_capability_template(
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Get a capability template by ID."""
    template = platform_use_cases.get_capability_template(db, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Capability template not found")
    return template


@caps_router.post("", response_model=CapabilityTemplateResponse, status_code=201)
def create_capability_template(
    data: CapabilityTemplateCreate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Create a new capability template."""
    # Verify device model exists
    model = platform_use_cases.get_model(db, data.device_model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Device model not found")
    template = platform_use_cases.create_capability_template(db, **data.model_dump())
    db.commit()
    return template


@caps_router.put("/{template_id}", response_model=CapabilityTemplateResponse)
def update_capability_template(
    template_id: uuid.UUID,
    data: CapabilityTemplateUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Update a capability template."""
    template = platform_use_cases.get_capability_template(db, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Capability template not found")
    model = platform_use_cases.get_model(db, data.device_model_id)
    if model is None:
        raise HTTPException(status_code=404, detail="Device model not found")
    existing = platform_use_cases.get_capability_template_by_model_id_and_key(
        db,
        data.device_model_id,
        data.capability_key,
    )
    if existing is not None and existing.id != template_id:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Capability template with key '{data.capability_key}' already exists "
                "for this device model"
            ),
        )
    updated = platform_use_cases.update_capability_template(
        db,
        template,
        **data.model_dump(),
    )
    db.commit()
    return updated


@caps_router.delete("/{template_id}", status_code=204, response_class=Response)
def delete_capability_template(
    template_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(require_admin),
):
    """Delete a capability template."""
    template = platform_use_cases.get_capability_template(db, template_id)
    if template is None:
        raise HTTPException(status_code=404, detail="Capability template not found")
    platform_use_cases.delete_capability_template(db, template)
    db.commit()


# ── Public (client) platform/model listing ────────────────────────────────────

client_router = APIRouter(tags=["client-platforms"])


@client_router.get("/platforms", response_model=list[DevicePlatformResponse])
def list_platforms_client(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """List available device platforms (for tenant device onboarding)."""
    return platform_use_cases.list_platforms(db)


@client_router.get("/device-models", response_model=list[DeviceModelWithPlatform])
def list_device_models_client(
    platform_id: uuid.UUID | None = Query(None),
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """List available device models (for tenant device onboarding)."""
    return platform_use_cases.list_models(db, platform_id=platform_id)


@client_router.get(
    "/device-models/{model_id}/capabilities",
    response_model=list[CapabilityTemplateResponse],
)
def list_model_capabilities_client(
    model_id: uuid.UUID,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """List capability templates for a device model."""
    return platform_use_cases.list_capability_templates(db, device_model_id=model_id)
