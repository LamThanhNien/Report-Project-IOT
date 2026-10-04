"""Tenant management application-layer schemas.

Re-exports from the existing modules.tenants.schema module.
This is the canonical import path for the bounded context.
"""

from app.modules.tenants.schema import (
    ClientDashboardRead,
    ClientMeRead,
    ClientPlanRead,
    FeatureOverrideItem,
    ServicePlanCreate,
    ServicePlanRead,
    ServicePlanUpdate,
    TenantCreate,
    TenantDeviceAssign,
    TenantFeaturesRead,
    TenantFeaturesUpdate,
    TenantRead,
    TenantStatusUpdate,
    TenantUpdate,
    TenantUserCreate,
)

__all__ = [
    "ClientDashboardRead",
    "ClientMeRead",
    "ClientPlanRead",
    "FeatureOverrideItem",
    "ServicePlanCreate",
    "ServicePlanRead",
    "ServicePlanUpdate",
    "TenantCreate",
    "TenantDeviceAssign",
    "TenantFeaturesRead",
    "TenantFeaturesUpdate",
    "TenantRead",
    "TenantStatusUpdate",
    "TenantUpdate",
    "TenantUserCreate",
]
