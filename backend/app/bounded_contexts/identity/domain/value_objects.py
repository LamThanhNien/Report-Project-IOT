"""Identity domain — role value object and constants."""

from enum import Enum


class Role(str, Enum):
    """Allowed user roles in the AIFOM platform."""

    ADMIN = "admin"
    TENANT_OWNER = "tenant_owner"
    VIEWER = "viewer"

    @classmethod
    def tenant_roles(cls) -> set[str]:
        """Roles that belong to a tenant (have tenant_id)."""
        return {cls.TENANT_OWNER, cls.VIEWER}


# Convenience constants for dependency checks
TENANT_ROLES = Role.tenant_roles()


SUPPORTED_ROLES = frozenset(role.value for role in Role)


def is_supported_role(role: object) -> bool:
    """Reject retired and unknown roles without assigning a replacement role."""
    return isinstance(role, str) and role in SUPPORTED_ROLES
