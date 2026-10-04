#!/usr/bin/env python3
"""
Seed missing standard service-plan defaults without resetting existing data.
Standard plans: Trial, Basic, Pro, Enterprise.
Usage (inside api container or host with DB access):
    python scripts/reset_service_plans.py
"""

import sys
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

_backend_dir = str(Path(__file__).resolve().parent.parent / "backend")
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
    PLAN_DEFAULTS,
    ServicePlan,
)
from app.core.tenant_context import bypass_rls_context
from app.db.session import SessionLocal

STANDARD_PLANS = [
    {
        "name": "Trial",
        "max_devices": 5,
        "max_users": 3,
        "telemetry_retention_days": 7,
        "features": PLAN_DEFAULTS["trial"],
        "is_active": True,
    },
    {
        "name": "Basic",
        "max_devices": 20,
        "max_users": 10,
        "telemetry_retention_days": 30,
        "features": PLAN_DEFAULTS["basic"],
        "is_active": True,
    },
    {
        "name": "Pro",
        "max_devices": 100,
        "max_users": 25,
        "telemetry_retention_days": 90,
        "features": PLAN_DEFAULTS["pro"],
        "is_active": True,
    },
    {
        "name": "Enterprise",
        "max_devices": 1000,
        "max_users": 100,
        "telemetry_retention_days": 365,
        "features": PLAN_DEFAULTS["enterprise"],
        "is_active": True,
    },
]


def main() -> None:
    db = SessionLocal()
    bypass_token = bypass_rls_context.set(True)
    try:
        existing_names = {plan.name for plan in db.query(ServicePlan).all()}
        for plan_data in STANDARD_PLANS:
            if plan_data["name"] in existing_names:
                continue
            plan = ServicePlan(**plan_data)
            db.add(plan)
            db.flush()
            print(f"[seed_service_plans] Created default plan: '{plan.name}'")

        db.commit()
        print(
            "[seed_service_plans] Defaults available; existing plans and tenant bindings preserved."
        )
    except SQLAlchemyError as e:
        db.rollback()
        print(f"[seed_service_plans] Error seeding defaults: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()
        bypass_rls_context.reset(bypass_token)


if __name__ == "__main__":
    main()
