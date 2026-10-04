import contextvars
import uuid
from collections.abc import Generator
from contextlib import contextmanager

import os
import sys

# ContextVars to isolate tenant context across concurrent requests / asyncio tasks
current_tenant_id_context: contextvars.ContextVar[uuid.UUID | None] = contextvars.ContextVar(
    "current_tenant_id", default=None
)

# Default to bypassing RLS during testing for standard setup/fixtures running outside HTTP middleware
default_bypass = "pytest" in sys.modules or os.getenv("APP_ENV") == "test"
bypass_rls_context: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "bypass_rls", default=default_bypass
)
current_user_role_context: contextvars.ContextVar[str] = contextvars.ContextVar(
    "current_user_role", default="anonymous"
)


@contextmanager
def tenant_context(
    tenant_id: uuid.UUID | None = None,
    bypass_rls: bool = False,
    role: str = "anonymous",
) -> Generator[None, None, None]:
    """Context manager to set and revert tenant context for the current execution flow.

    Mainly used in background workers, migrations, or tests to override tenant scopes.
    """
    token_tenant = current_tenant_id_context.set(tenant_id)
    token_bypass = bypass_rls_context.set(bypass_rls)
    token_role = current_user_role_context.set(role)
    try:
        yield
    finally:
        current_tenant_id_context.reset(token_tenant)
        bypass_rls_context.reset(token_bypass)
        current_user_role_context.reset(token_role)
