"""Simple tenant module permissions.

This is intentionally small: roles provide default presets, and stored
permissions can customize non-owner tenant users.
"""

from collections.abc import Iterable
from typing import Any

from fastapi import Depends, HTTPException, status

OWNER_ROLE = "tenant_owner"
VIEWER_ROLE = "viewer"

PERMISSION_GROUPS: dict[str, tuple[str, ...]] = {
    "dashboard": ("dashboard.view", "dashboard.manage"),
    "devices": ("devices.view", "devices.manage"),
    "device_groups": ("device_groups.view", "device_groups.manage"),
    "projects": ("projects.view", "projects.manage"),
    "commands": (
        "commands.view",
        "commands.send",
        "command_templates.view",
        "command_templates.manage",
    ),
    "automation": ("automation.view", "automation.manage"),
    "firmware_ota": ("firmware.view", "firmware.manage", "ota.view", "ota.manage"),
    "monitoring": ("monitoring.view", "monitoring.manage"),
    "reports": ("reports.view", "reports.export"),
    "members": ("members.view", "members.manage"),
    "settings": ("settings.view", "settings.manage"),
    "ai": ("ai.view", "ai.manage", "anomaly.view"),
}

ALLOWED_PERMISSIONS: tuple[str, ...] = tuple(
    permission for permissions in PERMISSION_GROUPS.values() for permission in permissions
)
ALLOWED_PERMISSION_SET = set(ALLOWED_PERMISSIONS)
LEGACY_PERMISSION_ALIASES: dict[str, tuple[str, ...]] = {
    "alerts:acknowledge": ("monitoring.view", "monitoring.manage"),
    "commands:create": ("commands.view", "commands.send"),
    "devices:read": ("devices.view",),
    "telemetry:read": ("monitoring.view",),
}

OWNER_PERMISSIONS: tuple[str, ...] = ALLOWED_PERMISSIONS
VIEWER_PERMISSIONS: tuple[str, ...] = (
    "dashboard.view",
    "devices.view",
    "device_groups.view",
    "projects.view",
    "commands.view",
    "command_templates.view",
    "automation.view",
    "firmware.view",
    "ota.view",
    "monitoring.view",
    "reports.view",
    "members.view",
)

ROLE_PERMISSION_PRESETS: dict[str, tuple[str, ...]] = {
    OWNER_ROLE: OWNER_PERMISSIONS,
    VIEWER_ROLE: VIEWER_PERMISSIONS,
}

DEPENDENT_VIEW_PERMISSIONS: dict[str, str] = {
    "dashboard.manage": "dashboard.view",
    "devices.manage": "devices.view",
    "device_groups.manage": "device_groups.view",
    "projects.manage": "projects.view",
    "commands.send": "commands.view",
    "command_templates.manage": "command_templates.view",
    "automation.manage": "automation.view",
    "firmware.manage": "firmware.view",
    "ota.manage": "ota.view",
    "monitoring.manage": "monitoring.view",
    "reports.export": "reports.view",
    "members.manage": "members.view",
    "settings.manage": "settings.view",
    "ai.manage": "ai.view",
}


def normalize_permissions(permissions: Iterable[str] | None) -> list[str]:
    if not permissions:
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for permission in permissions:
        value = str(permission).strip()
        if value and value not in seen:
            normalized.append(value)
            seen.add(value)
    return normalized


def normalize_stored_permissions(permissions: Iterable[str] | None) -> list[str]:
    """Normalize persisted legacy aliases without accepting them in new API input."""
    normalized: list[str] = []
    seen: set[str] = set()
    for permission in normalize_permissions(permissions):
        values = LEGACY_PERMISSION_ALIASES.get(permission, (permission,))
        for value in values:
            if value and value not in seen:
                normalized.append(value)
                seen.add(value)
    return normalized


def validate_permissions(permissions: Iterable[str] | None) -> list[str]:
    normalized = normalize_permissions(permissions)
    unknown = [permission for permission in normalized if permission not in ALLOWED_PERMISSION_SET]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown permission(s): {', '.join(sorted(unknown))}",
        )
    return normalized


def validate_viewer_permissions(permissions: Iterable[str] | None) -> list[str]:
    normalized = validate_permissions(permissions)
    if any(permission not in VIEWER_PERMISSIONS for permission in normalized):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Viewer permissions must be read-only.",
        )
    return normalized


def default_permissions_for_role(role: str | None) -> list[str]:
    return list(ROLE_PERMISSION_PRESETS.get(role or "", ()))


def is_tenant_owner(user: Any) -> bool:
    return getattr(user, "role", None) == OWNER_ROLE


def get_effective_permissions(user: Any) -> list[str]:
    role = getattr(user, "role", None)
    if role == OWNER_ROLE:
        return list(OWNER_PERMISSIONS)
    if role != VIEWER_ROLE:
        return []
    stored = normalize_permissions(getattr(user, "permissions", None))
    if not stored:
        return list(VIEWER_PERMISSIONS)
    # Stored legacy grants never turn a Viewer or an unsupported role into a writer.
    return [
        permission for permission in normalize_stored_permissions(stored)
        if permission in VIEWER_PERMISSIONS
    ]


def has_permission(user: Any, permission: str) -> bool:
    return is_tenant_owner(user) or permission in set(get_effective_permissions(user))


def has_any_permission(user: Any, permissions: Iterable[str]) -> bool:
    return is_tenant_owner(user) or bool(
        set(get_effective_permissions(user)).intersection(permissions)
    )


def _permission_denied() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to perform this action.",
    )


def require_tenant_permission(permission: str):
    from app.core.tenant import get_current_tenant_user

    def _dep(current_user=Depends(get_current_tenant_user)):
        if not has_permission(current_user, permission):
            raise _permission_denied()
        return current_user

    return Depends(_dep)


def require_any_tenant_permission(permissions: list[str]):
    from app.core.tenant import get_current_tenant_user

    def _dep(current_user=Depends(get_current_tenant_user)):
        if not has_any_permission(current_user, permissions):
            raise _permission_denied()
        return current_user

    return Depends(_dep)
