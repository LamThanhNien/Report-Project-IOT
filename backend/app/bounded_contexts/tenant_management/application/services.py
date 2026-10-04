import uuid

from sqlalchemy.orm import Session

from app.modules.tenants.model import FEATURE_KEYS, Tenant
from app.modules.tenants.repository import get_tenant_overrides


def get_effective_features(db: Session, tenant_id: uuid.UUID) -> dict[str, bool]:
    """Resolve effective feature flags: plan defaults + tenant-level overrides."""
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        return {k: False for k in FEATURE_KEYS}

    # Start from plan defaults
    plan_features: dict[str, bool] = {}
    if tenant.plan is not None and isinstance(tenant.plan.features, dict):
        plan_features = {k: bool(tenant.plan.features.get(k, False)) for k in FEATURE_KEYS}
    else:
        plan_features = {k: False for k in FEATURE_KEYS}

    # Apply tenant-level overrides
    overrides = get_tenant_overrides(db, tenant_id)
    effective = dict(plan_features)
    for override in overrides:
        if override.feature_name in FEATURE_KEYS:
            effective[override.feature_name] = override.is_enabled

    return effective


def plan_features_dict(tenant: Tenant) -> dict[str, bool]:
    if tenant.plan is None:
        return {k: False for k in FEATURE_KEYS}
    raw = tenant.plan.features or {}
    return {k: bool(raw.get(k, False)) for k in FEATURE_KEYS}
