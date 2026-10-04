"""Idempotent development demo. Own IDs only; never reset unrelated accounts/data."""

from __future__ import annotations

import os
import secrets
import sys
import uuid
from pathlib import Path

from dotenv import dotenv_values, set_key
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import app.main  # noqa: F401 -- register all ORM mappings
from app.bounded_contexts.identity.infrastructure.persistence.models import (
    User,
)
from app.bounded_contexts.project_dashboard.infrastructure.persistence.models import (
    ProjectMember,
    TenantProject,
)
from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
    ServicePlan,
    Tenant,
)
from app.core.config import settings
from app.db.session import postgres_rls_bypass
from app.modules.auth.service import hash_password, verify_password

ACCOUNTS = {
    "ADMIN": ("demo-admin@aifom.local", "admin", "Demo Admin"),
    "TENANT": ("demo-owner@aifom.local", "tenant_owner", "Demo Tenant Owner"),
    "VIEWER": ("demo-viewer@aifom.local", "viewer", "Demo Viewer"),
}


def demo_id(name: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, "aifom/local-demo/v1/" + name)


def configured(value: str | None) -> bool:
    return bool(value and not value.startswith(("REPLACE_", "Configure ")))


def local_config() -> dict[str, str]:
    values = dict(dotenv_values(ROOT / ".env"))
    for label, (email, _, _) in ACCOUNTS.items():
        # Dedicated addresses: do not copy the real administrator into Vite env.
        key = f"VITE_DEMO_{label}_EMAIL"
        if configured(values.get(key)) and values[key] != email:
            raise ValueError(f"{key} must use the dedicated address {email}")
        values[key] = email
        password_key = f"VITE_DEMO_{label}_PASSWORD"
        if not configured(values.get(password_key)):
            values[password_key] = secrets.token_urlsafe(18)
        if not 12 <= len(values[password_key].encode()) <= 72:
            raise ValueError(f"{password_key} must contain 12-72 bytes")
        values[f"VITE_DEMO_{label}_PASSWORD_HINT"] = values[password_key]
    return values


def owned(db: Session, model, seed_key: str, **fields):
    item = db.get(model, demo_id(seed_key))
    if item is None:
        item = model(id=demo_id(seed_key), **fields)
        db.add(item)
        db.flush()
    return item


def seed(db: Session, config: dict[str, str]) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext('aifom.local-demo.seed'))"))
    # Preflight every natural-key collision before writing anything.
    for label, (email, role, _) in ACCOUNTS.items():
        user = db.scalar(select(User).where(User.email == email))
        if user and (user.id != demo_id("user-" + label) or user.role != role):
            raise ValueError(f"Refusing to overwrite existing account {email}")
    for model, column, value, name in [
        (Tenant, Tenant.slug, "aifom-local-demo", "tenant"),
        (ServicePlan, ServicePlan.name, "AIFOM Local Demo", "plan"),
    ]:
        existing = db.scalar(select(model).where(column == value))
        if existing and existing.id != demo_id(name):
            raise ValueError(f"Refusing natural-key collision: {value}")
    plan = owned(
        db,
        ServicePlan,
        "plan",
        name="AIFOM Local Demo",
        max_devices=10,
        max_users=10,
        telemetry_retention_days=30,
        features={
            k: True
            for k in (
                "device_management",
                "ota_update",
                "firmware_history",
                "telemetry_view",
                "alert_management",
                "api_access",
                "user_management",
                "audit_log",
            )
        },
    )
    tenant = owned(
        db,
        Tenant,
        "tenant",
        name="AIFOM Demo Lab",
        slug="aifom-local-demo",
        plan_id=plan.id,
    )
    project = owned(
        db,
        TenantProject,
        "project",
        tenant_id=tenant.id,
        name="Demo Workspace",
        description="Local workspace for dedicated demo accounts.",
    )
    for label, (email, role, full_name) in ACCOUNTS.items():
        tenant_id = tenant.id if role in ("tenant_owner", "viewer") else None
        user = owned(
            db,
            User,
            "user-" + label,
            email=email,
            role=role,
            full_name=full_name,
            tenant_id=tenant_id,
            hashed_password=hash_password(config[f"VITE_DEMO_{label}_PASSWORD"]),
            permissions=None,
        )
        assert user.tenant_id == tenant_id, (
            "Demo account tenant ownership changed; manual review required"
        )
        if not verify_password(
            config[f"VITE_DEMO_{label}_PASSWORD"], user.hashed_password
        ):
            user.hashed_password = hash_password(config[f"VITE_DEMO_{label}_PASSWORD"])
        user.is_active = True
        if tenant_id:
            owned(
                db,
                ProjectMember,
                "member-" + label,
                project_id=project.id,
                user_id=user.id,
                role="project_owner" if role == "tenant_owner" else "project_viewer",
            )


def main() -> None:
    if os.getenv("APP_ENV", "development") != "development":
        raise SystemExit("Demo seeding is available only in development")
    config = local_config()
    with Session(create_engine(settings.database_url)) as db, postgres_rls_bypass(db):
        seed(db, config)
        db.commit()
    # Persist only dedicated local demo credentials; never print their values.
    for key, value in config.items():
        if key.startswith("VITE_DEMO_"):
            set_key(str(ROOT / ".env"), key, str(value), quote_mode="never")
    frontend = ROOT / "frontend" / ".env"
    frontend.touch(exist_ok=True)
    for key, value in config.items():
        if key.startswith("VITE_DEMO_"):
            set_key(str(frontend), key, str(value), quote_mode="never")
    print(
        "[seed_demo] Ready: 3 dedicated demo accounts and 1 tenant/project."
    )
    print(
        "[seed_demo] Demo credentials are available on the development login page. Existing accounts/data were preserved."
    )


if __name__ == "__main__":
    main()
