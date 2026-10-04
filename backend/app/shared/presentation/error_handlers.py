"""Shared FastAPI error handlers.

Translates domain and application exceptions into HTTP responses.
Register these handlers on the FastAPI app instance.

Usage:
    from shared.presentation.error_handlers import register_error_handlers
    register_error_handlers(app)

All error responses include the X-Correlation-ID header sourced from the
current ContextVar so correlation is maintained across 4xx and 5xx responses.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.shared.domain.exceptions import (
    AuthorizationError,
    BusinessRuleViolationError,
    DomainError,
    DuplicateEntityError,
    EntityNotFoundError,
    TenantIsolationError,
)

logger = logging.getLogger(__name__)


def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    from app.core.logging import get_correlation_id

    headers: dict[str, str] = {}
    corr_id = get_correlation_id()
    if corr_id:
        headers["X-Correlation-ID"] = corr_id

    return JSONResponse(
        status_code=status_code,
        content={"detail": message, "code": code},
        headers=headers if headers else None,
    )


async def handle_entity_not_found(request: Request, exc: EntityNotFoundError) -> JSONResponse:
    return _error_response(404, exc.code, exc.message)


async def handle_duplicate_entity(request: Request, exc: DuplicateEntityError) -> JSONResponse:
    return _error_response(409, exc.code, exc.message)


async def handle_business_rule_violation(
    request: Request, exc: BusinessRuleViolationError
) -> JSONResponse:
    return _error_response(422, exc.code, exc.message)


async def handle_tenant_isolation(request: Request, exc: TenantIsolationError) -> JSONResponse:
    return _error_response(403, exc.code, exc.message)


async def handle_authorization(request: Request, exc: AuthorizationError) -> JSONResponse:
    return _error_response(403, exc.code, exc.message)


async def handle_domain_error(request: Request, exc: DomainError) -> JSONResponse:
    return _error_response(400, exc.code, exc.message)


async def handle_generic_exception(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all for unhandled exceptions — log and return sanitized 500.

    Exception message is never exposed to the caller. Only a generic message
    is returned to avoid leaking internal details.
    """
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return _error_response(500, "internal_error", "An unexpected error occurred")


def register_error_handlers(app: FastAPI) -> None:
    """Register all domain error handlers on the FastAPI app."""
    app.add_exception_handler(EntityNotFoundError, handle_entity_not_found)  # type: ignore[arg-type]
    app.add_exception_handler(DuplicateEntityError, handle_duplicate_entity)  # type: ignore[arg-type]
    app.add_exception_handler(BusinessRuleViolationError, handle_business_rule_violation)  # type: ignore[arg-type]
    app.add_exception_handler(TenantIsolationError, handle_tenant_isolation)  # type: ignore[arg-type]
    app.add_exception_handler(AuthorizationError, handle_authorization)  # type: ignore[arg-type]
    app.add_exception_handler(DomainError, handle_domain_error)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, handle_generic_exception)
