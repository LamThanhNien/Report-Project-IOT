import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.modules.auth.model import User
from app.modules.devices.model import Device
from app.modules.tenants.model import (
    FEATURE_KEYS,
    ServicePlan,
    Tenant,
    TenantDeviceMapping,
    TenantFeatureOverride,
)
from app.modules.tenants.schema import (
    ServicePlanCreate,
    ServicePlanUpdate,
    TenantCreate,
    TenantFeaturesUpdate,
    TenantUpdate,
)


# ── ServicePlan ──────────────────────────────────────────────────────────────


def list_plans(db: Session) -> list[ServicePlan]:
    return list(db.scalars(select(ServicePlan).order_by(ServicePlan.created_at)).all())


def get_plan(db: Session, plan_id: uuid.UUID) -> ServicePlan | None:
    return db.scalar(select(ServicePlan).where(ServicePlan.id == plan_id))


def get_plan_by_name(db: Session, name: str) -> ServicePlan | None:
    return db.scalar(select(ServicePlan).where(ServicePlan.name == name))


def create_plan(db: Session, payload: ServicePlanCreate) -> ServicePlan:
    # Ensure all feature keys are present
    features = {k: payload.features.get(k, False) for k in FEATURE_KEYS}
    plan = ServicePlan(
        name=payload.name,
        max_devices=payload.max_devices,
        max_users=payload.max_users,
        telemetry_retention_days=payload.telemetry_retention_days,
        features=features,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def update_plan(db: Session, plan: ServicePlan, payload: ServicePlanUpdate) -> ServicePlan:
    if payload.name is not None:
        plan.name = payload.name
    if payload.max_devices is not None:
        plan.max_devices = payload.max_devices
    if payload.max_users is not None:
        plan.max_users = payload.max_users
    if payload.telemetry_retention_days is not None:
        plan.telemetry_retention_days = payload.telemetry_retention_days
    if payload.features is not None:
        existing = dict(plan.features or {})
        existing.update(payload.features)
        plan.features = existing
    if payload.is_active is not None:
        plan.is_active = payload.is_active
    db.commit()
    db.refresh(plan)
    return plan


def delete_plan(db: Session, plan: ServicePlan) -> None:
    plan.is_active = False
    db.commit()


# ── Tenant ───────────────────────────────────────────────────────────────────


def list_tenants(db: Session) -> list[Tenant]:
    return list(db.scalars(select(Tenant).order_by(Tenant.created_at.desc())).all())


def get_tenant(db: Session, tenant_id: uuid.UUID) -> Tenant | None:
    return db.scalar(select(Tenant).where(Tenant.id == tenant_id))


def get_tenant_by_slug(db: Session, slug: str) -> Tenant | None:
    return db.scalar(select(Tenant).where(Tenant.slug == slug))


def create_tenant(db: Session, payload: TenantCreate) -> Tenant:
    tenant = Tenant(name=payload.name, slug=payload.slug, plan_id=payload.plan_id)
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return tenant


def update_tenant(db: Session, tenant: Tenant, payload: TenantUpdate) -> Tenant:
    update_data = payload.model_dump(exclude_unset=True)
    if "name" in update_data:
        tenant.name = update_data["name"]
    if "slug" in update_data:
        tenant.slug = update_data["slug"]
    if "plan_id" in update_data:
        tenant.plan_id = update_data["plan_id"]
    if "is_active" in update_data:
        tenant.is_active = update_data["is_active"]
    db.commit()
    db.refresh(tenant)
    return tenant


def set_tenant_active(db: Session, tenant: Tenant, is_active: bool) -> Tenant:
    tenant.is_active = is_active
    if is_active:
        # Re-activate: restore all non-admin users that were deactivated
        # when this tenant was disabled.
        db.query(User).filter(
            User.tenant_id == tenant.id,
            User.role != "platform_admin",
        ).update({User.is_active: True})
    else:
        # Deactivate: also deactivate all non-admin users
        # to prevent login by orphaned tenant users.
        db.query(User).filter(
            User.tenant_id == tenant.id,
            User.role != "platform_admin",
        ).update({User.is_active: False})
    db.commit()
    db.refresh(tenant)
    return tenant


def count_tenant_devices(db: Session, tenant_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(TenantDeviceMapping)
            .join(Device, Device.id == TenantDeviceMapping.device_id)
            .where(TenantDeviceMapping.tenant_id == tenant_id, Device.status != "deleted")
        )
        or 0
    )


def count_tenant_users(db: Session, tenant_id: uuid.UUID) -> int:
    return db.scalar(select(func.count()).where(User.tenant_id == tenant_id)) or 0


# ── Feature overrides ────────────────────────────────────────────────────────


def get_tenant_overrides(db: Session, tenant_id: uuid.UUID) -> list[TenantFeatureOverride]:
    return list(
        db.scalars(
            select(TenantFeatureOverride).where(TenantFeatureOverride.tenant_id == tenant_id)
        ).all()
    )


def set_tenant_features(
    db: Session, tenant_id: uuid.UUID, payload: TenantFeaturesUpdate
) -> list[TenantFeatureOverride]:
    existing = {
        row.feature_name: row
        for row in db.scalars(
            select(TenantFeatureOverride).where(TenantFeatureOverride.tenant_id == tenant_id)
        ).all()
    }
    for item in payload.overrides:
        if item.feature_name not in FEATURE_KEYS:
            continue
        if item.feature_name in existing:
            existing[item.feature_name].is_enabled = item.is_enabled
        else:
            override = TenantFeatureOverride(
                tenant_id=tenant_id,
                feature_name=item.feature_name,
                is_enabled=item.is_enabled,
            )
            db.add(override)
    db.commit()
    return get_tenant_overrides(db, tenant_id)


# ── Device mappings ──────────────────────────────────────────────────────────


def list_tenant_devices(
    db: Session, tenant_id: uuid.UUID, project_id: uuid.UUID | None = None
) -> list[Device]:
    stmt = select(Device).where(Device.tenant_id == tenant_id)
    if project_id:
        stmt = stmt.where(Device.project_id == project_id)
    stmt = stmt.order_by(Device.created_at.desc())
    return list(db.scalars(stmt).all())


def get_tenant_device(db: Session, tenant_id: uuid.UUID, device_uid: str) -> Device | None:
    stmt = select(Device).where(
        Device.tenant_id == tenant_id,
        Device.device_uid == device_uid,
    )
    return db.scalar(stmt)


def assign_device(db: Session, tenant_id: uuid.UUID, device_id: uuid.UUID) -> TenantDeviceMapping:
    # Guard: one device -> one tenant only.  Assigning to a second tenant
    # would break isolation — tenant users would see each other's data.
    device = db.get(Device, device_id)
    if device is not None and device.tenant_id is not None and device.tenant_id != tenant_id:
        from fastapi import HTTPException, status as http_status

        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="Device is already assigned to another tenant",
        )
    other = db.scalar(
        select(TenantDeviceMapping).where(
            TenantDeviceMapping.device_id == device_id,
            TenantDeviceMapping.tenant_id != tenant_id,
        )
    )
    if other:
        from fastapi import HTTPException, status as http_status

        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="Device is already assigned to another tenant",
        )
    existing = db.scalar(
        select(TenantDeviceMapping).where(
            TenantDeviceMapping.tenant_id == tenant_id,
            TenantDeviceMapping.device_id == device_id,
        )
    )
    if existing:
        if device is not None and device.tenant_id is None:
            device.tenant_id = tenant_id
            db.commit()
        _ensure_small_project_capabilities(db, tenant_id=tenant_id, device_id=device_id)
        return existing
    mapping = TenantDeviceMapping(tenant_id=tenant_id, device_id=device_id)
    db.add(mapping)
    if device is not None:
        device.tenant_id = tenant_id
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        existing = db.scalar(
            select(TenantDeviceMapping).where(
                TenantDeviceMapping.tenant_id == tenant_id,
                TenantDeviceMapping.device_id == device_id,
            )
        )
        if existing:
            _ensure_small_project_capabilities(db, tenant_id=tenant_id, device_id=device_id)
            return existing
        from fastapi import HTTPException, status as http_status

        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail="Device is already assigned to another tenant",
        ) from exc
    _ensure_small_project_capabilities(db, tenant_id=tenant_id, device_id=device_id)
    return mapping


def remove_device(
    db: Session,
    tenant_id: uuid.UUID,
    device_id: uuid.UUID,
    deleted_by: uuid.UUID | None = None,
) -> bool:
    mapping = db.scalar(
        select(TenantDeviceMapping).where(
            TenantDeviceMapping.tenant_id == tenant_id,
            TenantDeviceMapping.device_id == device_id,
        )
    )
    if mapping is None:
        return False
    # Soft-delete the device record
    device = db.scalar(select(Device).where(Device.id == device_id))
    if device is not None and device.status != "deleted":
        device.status = "deleted"
        device.deleted_at = datetime.now(timezone.utc)
        device.deleted_by = deleted_by
    # Remove the tenant-device mapping
    db.delete(mapping)
    db.commit()
    return True


# ── Tenant users ─────────────────────────────────────────────────────────────


def list_tenant_users(db: Session, tenant_id: uuid.UUID) -> list[User]:
    return list(
        db.scalars(select(User).where(User.tenant_id == tenant_id, User.role.in_(["tenant_owner", "viewer"])).order_by(User.created_at)).all()
    )


def _ensure_small_project_capabilities(
    db: Session, tenant_id: uuid.UUID, device_id: uuid.UUID
) -> None:
    from app.modules.projects import repository as project_repository

    project_repository.ensure_small_project_capabilities(
        db,
        device_id=device_id,
        tenant_id=tenant_id,
    )
