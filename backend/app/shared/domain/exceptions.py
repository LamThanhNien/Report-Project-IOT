"""Shared domain exceptions.

These exceptions represent business rule violations that can occur in any
bounded context.  They are framework-agnostic (no FastAPI/HTTP imports).

Infrastructure adapters (FastAPI routers) catch these and translate to
HTTP responses.
"""

from __future__ import annotations


class DomainError(Exception):
    """Base class for all domain/business errors."""

    def __init__(self, message: str, code: str = "DOMAIN_ERROR") -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class EntityNotFoundError(DomainError):
    """Raised when a requested entity does not exist."""

    def __init__(self, entity: str, identifier: str) -> None:
        super().__init__(
            message=f"{entity} not found: {identifier}",
            code="ENTITY_NOT_FOUND",
        )
        self.entity = entity
        self.identifier = identifier


class DuplicateEntityError(DomainError):
    """Raised when an entity with the same unique key already exists."""

    def __init__(self, entity: str, key: str, value: str) -> None:
        super().__init__(
            message=f"{entity} with {key}={value} already exists",
            code="DUPLICATE_ENTITY",
        )
        self.entity = entity
        self.key = key
        self.value = value


class BusinessRuleViolationError(DomainError):
    """Raised when a business rule is violated."""

    def __init__(self, message: str) -> None:
        super().__init__(message=message, code="BUSINESS_RULE_VIOLATION")


class TenantIsolationError(DomainError):
    """Raised when an operation violates tenant isolation."""

    def __init__(self, message: str = "Operation violates tenant isolation") -> None:
        super().__init__(message=message, code="TENANT_ISOLATION_VIOLATION")


class AuthorizationError(DomainError):
    """Raised when a user lacks permission for an operation."""

    def __init__(self, message: str = "Insufficient permissions") -> None:
        super().__init__(message=message, code="AUTHORIZATION_ERROR")
