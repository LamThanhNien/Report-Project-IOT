"""Shared FastAPI dependencies.

Common dependency injection functions used across bounded contexts.
These wrap the existing app.core.security and app.core.tenant modules.

Presentation adapters in bounded contexts should import from here
rather than directly from app.core.
"""

from __future__ import annotations


from app.core.security import get_current_user, require_admin
from app.core.tenant import (
    get_current_tenant_user,
    require_feature,
    require_tenant_owner,
    require_tenant_write,
)
from app.db.session import get_db

# Re-export for convenience
__all__ = [
    "get_current_user",
    "require_admin",
    "get_current_tenant_user",
    "require_tenant_owner",
    "require_tenant_write",
    "require_feature",
    "get_db",
]
