#!/usr/bin/env python3
"""
Seed a default admin user for local development.
Skips creation if the user already exists.

Usage (inside the api container):
    python /workspace/scripts/seed_admin.py

Environment variables:
    ADMIN_SEED_EMAIL     (default: admin@aifom.local)
    ADMIN_SEED_PASSWORD  (default: admin123)
    ADMIN_SEED_FULLNAME  (default: AIFOM Admin)
"""

import os
import sys
from pathlib import Path

# Portable path: works both inside Docker (/workspace) and on the host
_backend_dir = str(Path(__file__).resolve().parent.parent / "backend")
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from app.db.session import SessionLocal  # noqa: E402
from app.core.tenant_context import bypass_rls_context  # noqa: E402
bypass_rls_context.set(True)

from app.modules.auth import repository, service  # noqa: E402
from app.modules.tenants import model as _tenants_model  # noqa: F401, E402


def main() -> None:
    email = os.getenv("ADMIN_SEED_EMAIL", "admin@aifom.local")
    password = os.getenv("ADMIN_SEED_PASSWORD", "admin123")
    full_name = os.getenv("ADMIN_SEED_FULLNAME", "AIFOM Admin")

    db = SessionLocal()
    try:
        existing = repository.get_user_by_email(db, email)
        if existing:
            print(f"[seed_admin] user already exists: {email}")
            return
        hashed = service.hash_password(password)
        user = repository.create_user(
            db, email=email, hashed_password=hashed, full_name=full_name, role="admin"
        )
        print(f"[seed_admin] created admin user: {user.email}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
