"""Authorization helpers for platform operators accessing tenant-owned resources."""

from typing import NoReturn
from uuid import UUID

from fastapi import HTTPException, status


TENANT_READ_ONLY_DETAIL = "Platform administrators have read-only access to tenant resources"


def forbid_tenant_mutation(detail: str = TENANT_READ_ONLY_DETAIL) -> NoReturn:
    """Reject a platform-side mutation of customer-owned state."""

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def ensure_platform_owned(tenant_id: UUID | None) -> None:
    """Allow mutation only when the resource is owned by the platform."""

    if tenant_id is not None:
        forbid_tenant_mutation()
