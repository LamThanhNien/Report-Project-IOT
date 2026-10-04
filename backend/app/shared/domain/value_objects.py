"""Shared value objects.

Value objects are immutable and compared by their attributes, not identity.
These are framework-agnostic (no SQLAlchemy, Pydantic, or FastAPI imports).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DeviceUID:
    """Strongly-typed device unique identifier."""

    value: str

    def __post_init__(self) -> None:
        if not self.value or not self.value.strip():
            raise ValueError("DeviceUID must not be empty")

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class TenantSlug:
    """Strongly-typed tenant slug (URL-safe identifier)."""

    value: str

    def __post_init__(self) -> None:
        if not self.value or not self.value.strip():
            raise ValueError("TenantSlug must not be empty")
        if not self.value.replace("-", "").replace("_", "").isalnum():
            raise ValueError(f"TenantSlug must be URL-safe: {self.value}")

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class SemVer:
    """Semantic version (major.minor.patch)."""

    value: str

    def __post_init__(self) -> None:
        parts = self.value.split(".")
        if len(parts) != 3:
            raise ValueError(f"SemVer must have 3 parts: {self.value}")
        for p in parts:
            if not p.isdigit():
                raise ValueError(f"SemVer parts must be numeric: {self.value}")

    def __str__(self) -> str:
        return self.value


@dataclass(frozen=True)
class EmailAddress:
    """Strongly-typed email address."""

    value: str

    def __post_init__(self) -> None:
        if "@" not in self.value:
            raise ValueError(f"Invalid email: {self.value}")

    def __str__(self) -> str:
        return self.value
