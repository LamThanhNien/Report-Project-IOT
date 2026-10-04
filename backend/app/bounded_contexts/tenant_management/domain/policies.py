"""Tenant isolation policy — domain-level enforcement rules.

These rules are the single source of truth for tenant data access.
All application-layer use cases must call these before returning data.
"""

from __future__ import annotations

from uuid import UUID

from app.shared.domain.exceptions import (
    AuthorizationError,
    BusinessRuleViolationError,
    DuplicateEntityError,
    TenantIsolationError,
)


def ensure_tenant_access(
    *,
    user_tenant_id: UUID | None,
    resource_tenant_id: UUID | None,
    require_match: bool = True,
) -> None:
    """Verify that a user's tenant matches the resource's tenant.

    Args:
        user_tenant_id: The tenant_id from the authenticated user (JWT).
        resource_tenant_id: The tenant_id on the resource being accessed.
        require_match: If True, the two must be equal. If False, only check
                       that the user has *some* tenant.

    Raises:
        TenantIsolationError: If the check fails.
    """
    if user_tenant_id is None:
        raise TenantIsolationError("User has no tenant context")

    if require_match and resource_tenant_id is not None:
        if user_tenant_id != resource_tenant_id:
            raise TenantIsolationError("Access denied: resource belongs to a different tenant")


def ensure_not_viewer(role: str) -> None:
    """Raise if the user is a viewer (read-only role)."""
    if role == "viewer":
        raise AuthorizationError("Viewer role cannot perform write operations")


def ensure_tenant_owner_role(role: str) -> None:
    """Raise if the user is not a tenant_owner."""
    if role != "tenant_owner":
        raise AuthorizationError("Tenant owner role required")


def ensure_within_plan_limits(
    *,
    current_count: int,
    max_allowed: int,
    resource_name: str,
) -> None:
    """Raise if the tenant has reached the plan limit for a resource."""
    if current_count >= max_allowed:
        raise BusinessRuleViolationError(
            f"{resource_name} limit reached ({max_allowed}). Upgrade your plan."
        )


def ensure_firmware_accessible(
    *,
    firmware_tenant_id: UUID | None,
    user_tenant_id: UUID,
) -> None:
    """Verify firmware belongs to the tenant or is admin-global."""
    if firmware_tenant_id is not None and firmware_tenant_id != user_tenant_id:
        raise AuthorizationError("Firmware not accessible to your tenant")


def ensure_device_not_assigned_elsewhere(
    *,
    existing_other_tenant: bool,
) -> None:
    """Raise if a device is already assigned to a different tenant."""
    if existing_other_tenant:
        raise DuplicateEntityError("Device", "device_id", "assigned_to_another_tenant")
