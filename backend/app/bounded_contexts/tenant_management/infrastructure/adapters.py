"""Tenant management infrastructure adapters.

Wraps the existing modules.tenants.repository functions
behind the TenantRepositoryPort interface.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.modules.auth.model import User
from app.modules.devices.model import Device
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
from app.modules.tenants import repository as _repo


class SqlAlchemyTenantRepository:
    """SQLAlchemy-backed implementation of TenantRepositoryPort."""

    # ── Service Plans ───────────────────────────────────────────────────

    def list_plans(self, db: Session) -> list[ServicePlan]:
        return _repo.list_plans(db)

    def get_plan(self, db: Session, plan_id: UUID) -> ServicePlan | None:
        return _repo.get_plan(db, plan_id)

    def get_plan_by_name(self, db: Session, name: str) -> ServicePlan | None:
        return _repo.get_plan_by_name(db, name)

    def create_plan(self, db: Session, payload: ServicePlanCreate) -> ServicePlan:
        return _repo.create_plan(db, payload)

    def update_plan(
        self, db: Session, plan: ServicePlan, payload: ServicePlanUpdate
    ) -> ServicePlan:
        return _repo.update_plan(db, plan, payload)

    def delete_plan(self, db: Session, plan: ServicePlan) -> None:
        _repo.delete_plan(db, plan)

    # ── Tenants ─────────────────────────────────────────────────────────

    def list_tenants(self, db: Session) -> list[Tenant]:
        return _repo.list_tenants(db)

    def get_tenant(self, db: Session, tenant_id: UUID) -> Tenant | None:
        return _repo.get_tenant(db, tenant_id)

    def get_tenant_by_slug(self, db: Session, slug: str) -> Tenant | None:
        return _repo.get_tenant_by_slug(db, slug)

    def create_tenant(self, db: Session, payload: TenantCreate) -> Tenant:
        return _repo.create_tenant(db, payload)

    def update_tenant(self, db: Session, tenant: Tenant, payload: TenantUpdate) -> Tenant:
        return _repo.update_tenant(db, tenant, payload)

    def set_tenant_active(self, db: Session, tenant: Tenant, is_active: bool) -> Tenant:
        return _repo.set_tenant_active(db, tenant, is_active)

    def count_tenant_devices(self, db: Session, tenant_id: UUID) -> int:
        return _repo.count_tenant_devices(db, tenant_id)

    def count_tenant_users(self, db: Session, tenant_id: UUID) -> int:
        return _repo.count_tenant_users(db, tenant_id)

    # ── Feature Overrides ───────────────────────────────────────────────

    def get_tenant_overrides(self, db: Session, tenant_id: UUID) -> list[TenantFeatureOverride]:
        return _repo.get_tenant_overrides(db, tenant_id)

    def set_tenant_features(
        self, db: Session, tenant_id: UUID, payload: TenantFeaturesUpdate
    ) -> list[TenantFeatureOverride]:
        return _repo.set_tenant_features(db, tenant_id, payload)

    # ── Device Mappings ─────────────────────────────────────────────────

    def list_tenant_devices(self, db: Session, tenant_id: UUID) -> list[Device]:
        return _repo.list_tenant_devices(db, tenant_id)

    def get_tenant_device(self, db: Session, tenant_id: UUID, device_uid: str) -> Device | None:
        return _repo.get_tenant_device(db, tenant_id, device_uid)

    def assign_device(self, db: Session, tenant_id: UUID, device_id: UUID) -> TenantDeviceMapping:
        return _repo.assign_device(db, tenant_id, device_id)

    def remove_device(self, db: Session, tenant_id: UUID, device_id: UUID) -> bool:
        return _repo.remove_device(db, tenant_id, device_id)

    # ── Tenant Users ────────────────────────────────────────────────────

    def list_tenant_users(self, db: Session, tenant_id: UUID) -> list[User]:
        return _repo.list_tenant_users(db, tenant_id)
