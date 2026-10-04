"""Tenant management use cases.

Each use case encapsulates a single business operation.
They depend on the repository port (interface) and domain policies.
"""

from __future__ import annotations

import logging
from typing import Protocol
from uuid import UUID

from sqlalchemy.orm import Session

from app.modules.tenants.model import (
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
from app.modules.auth.model import User

logger = logging.getLogger(__name__)


# ── Repository Port (interface) ──────────────────────────────────────────────


class TenantRepositoryPort(Protocol):
    """Abstract interface for tenant persistence."""

    def list_plans(self, db: Session) -> list[ServicePlan]: ...
    def get_plan(self, db: Session, plan_id: UUID) -> ServicePlan | None: ...
    def get_plan_by_name(self, db: Session, name: str) -> ServicePlan | None: ...
    def create_plan(self, db: Session, payload: ServicePlanCreate) -> ServicePlan: ...
    def update_plan(
        self, db: Session, plan: ServicePlan, payload: ServicePlanUpdate
    ) -> ServicePlan: ...
    def delete_plan(self, db: Session, plan: ServicePlan) -> None: ...

    def list_tenants(self, db: Session) -> list[Tenant]: ...
    def get_tenant(self, db: Session, tenant_id: UUID) -> Tenant | None: ...
    def get_tenant_by_slug(self, db: Session, slug: str) -> Tenant | None: ...
    def create_tenant(self, db: Session, payload: TenantCreate) -> Tenant: ...
    def update_tenant(self, db: Session, tenant: Tenant, payload: TenantUpdate) -> Tenant: ...
    def set_tenant_active(self, db: Session, tenant: Tenant, is_active: bool) -> Tenant: ...
    def count_tenant_devices(self, db: Session, tenant_id: UUID) -> int: ...
    def count_tenant_users(self, db: Session, tenant_id: UUID) -> int: ...

    def get_tenant_overrides(self, db: Session, tenant_id: UUID) -> list[TenantFeatureOverride]: ...
    def set_tenant_features(
        self, db: Session, tenant_id: UUID, payload: TenantFeaturesUpdate
    ) -> list[TenantFeatureOverride]: ...

    def list_tenant_devices(self, db: Session, tenant_id: UUID) -> list: ...
    def get_tenant_device(self, db: Session, tenant_id: UUID, device_uid: str): ...
    def assign_device(
        self, db: Session, tenant_id: UUID, device_id: UUID
    ) -> TenantDeviceMapping: ...
    def remove_device(self, db: Session, tenant_id: UUID, device_id: UUID) -> bool: ...

    def list_tenant_users(self, db: Session, tenant_id: UUID) -> list[User]: ...


# ── Service Plan Use Cases ────────────────────────────────────────────────────


def list_service_plans(db: Session, repo: TenantRepositoryPort) -> list[ServicePlan]:
    return repo.list_plans(db)


def get_service_plan(db: Session, repo: TenantRepositoryPort, plan_id: UUID) -> ServicePlan | None:
    return repo.get_plan(db, plan_id)


def create_service_plan(
    db: Session, repo: TenantRepositoryPort, payload: ServicePlanCreate
) -> ServicePlan:
    if repo.get_plan_by_name(db, payload.name):
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_409_CONFLICT, detail="Plan name already exists")
    plan = repo.create_plan(db, payload)
    logger.info("[PLAN] create name=%s id=%s", plan.name, plan.id)
    return plan


def update_service_plan(
    db: Session,
    repo: TenantRepositoryPort,
    plan_id: UUID,
    payload: ServicePlanUpdate,
) -> ServicePlan:
    plan = repo.get_plan(db, plan_id)
    if plan is None:
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Plan not found")
    return repo.update_plan(db, plan, payload)


def delete_service_plan(db: Session, repo: TenantRepositoryPort, plan_id: UUID) -> None:
    plan = repo.get_plan(db, plan_id)
    if plan is None:
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Plan not found")
    repo.delete_plan(db, plan)


# ── Tenant Use Cases ─────────────────────────────────────────────────────────


def list_tenants(db: Session, repo: TenantRepositoryPort) -> list[Tenant]:
    return repo.list_tenants(db)


def get_tenant(db: Session, repo: TenantRepositoryPort, tenant_id: UUID) -> Tenant | None:
    return repo.get_tenant(db, tenant_id)


def create_tenant(db: Session, repo: TenantRepositoryPort, payload: TenantCreate) -> Tenant:
    if repo.get_tenant_by_slug(db, payload.slug):
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_409_CONFLICT, detail="Slug already in use")
    from sqlalchemy.exc import IntegrityError

    try:
        tenant = repo.create_tenant(db, payload)
    except IntegrityError:
        db.rollback()
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_409_CONFLICT, detail="Tenant slug conflict")
    logger.info("[TENANT] create name=%s slug=%s id=%s", tenant.name, tenant.slug, tenant.id)
    return tenant


def update_tenant(
    db: Session,
    repo: TenantRepositoryPort,
    tenant_id: UUID,
    payload: TenantUpdate,
) -> Tenant:
    tenant = repo.get_tenant(db, tenant_id)
    if tenant is None:
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return repo.update_tenant(db, tenant, payload)


def set_tenant_status(
    db: Session,
    repo: TenantRepositoryPort,
    tenant_id: UUID,
    is_active: bool,
) -> Tenant:
    tenant = repo.get_tenant(db, tenant_id)
    if tenant is None:
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    tenant = repo.set_tenant_active(db, tenant, is_active)
    logger.info("[TENANT] status_toggle slug=%s is_active=%s", tenant.slug, tenant.is_active)
    return tenant


# ── Feature Override Use Cases ────────────────────────────────────────────────


def get_tenant_features(db: Session, repo: TenantRepositoryPort, tenant_id: UUID) -> dict:
    from app.modules.tenants import service as tenant_service

    tenant = repo.get_tenant(db, tenant_id)
    if tenant is None:
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    plan_feats = tenant_service.plan_features_dict(tenant)
    overrides = {o.feature_name: o.is_enabled for o in repo.get_tenant_overrides(db, tenant_id)}
    effective = tenant_service.get_effective_features(db, tenant_id)
    return {
        "tenant_id": tenant_id,
        "plan_features": plan_feats,
        "overrides": overrides,
        "effective": effective,
    }


def set_tenant_features(
    db: Session,
    repo: TenantRepositoryPort,
    tenant_id: UUID,
    payload: TenantFeaturesUpdate,
) -> dict:
    from app.modules.tenants import service as tenant_service

    tenant = repo.get_tenant(db, tenant_id)
    if tenant is None:
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    repo.set_tenant_features(db, tenant_id, payload)
    plan_feats = tenant_service.plan_features_dict(tenant)
    overrides = {o.feature_name: o.is_enabled for o in repo.get_tenant_overrides(db, tenant_id)}
    effective = tenant_service.get_effective_features(db, tenant_id)
    logger.info("[FEATURE TOGGLE] tenant=%s", tenant.slug)
    return {
        "tenant_id": tenant_id,
        "plan_features": plan_feats,
        "overrides": overrides,
        "effective": effective,
    }


# ── Device Assignment Use Cases ──────────────────────────────────────────────


def list_tenant_devices(db: Session, repo: TenantRepositoryPort, tenant_id: UUID) -> list:
    return repo.list_tenant_devices(db, tenant_id)


def assign_device_to_tenant(
    db: Session,
    repo: TenantRepositoryPort,
    tenant_id: UUID,
    device_id: UUID,
) -> TenantDeviceMapping:
    from app.bounded_contexts.tenant_management.domain.policies import (
        ensure_device_not_assigned_elsewhere,
    )
    from sqlalchemy import select
    from app.modules.tenants.model import TenantDeviceMapping as TDM

    other = db.scalar(select(TDM).where(TDM.device_id == device_id, TDM.tenant_id != tenant_id))
    ensure_device_not_assigned_elsewhere(existing_other_tenant=other is not None)
    return repo.assign_device(db, tenant_id, device_id)


def remove_device_from_tenant(
    db: Session,
    repo: TenantRepositoryPort,
    tenant_id: UUID,
    device_id: UUID,
) -> bool:
    removed = repo.remove_device(db, tenant_id, device_id)
    if not removed:
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not assigned to this tenant")
    return True
