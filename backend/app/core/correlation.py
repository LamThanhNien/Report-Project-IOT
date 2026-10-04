"""Request correlation ID validation and middleware implementation."""

from __future__ import annotations

import re
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response

from app.core.logging import correlation_id_ctx
from app.core.metrics import CORRELATION_ID_GENERATED, CORRELATION_ID_INVALID

CORRELATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


def is_valid_correlation_id(value: str | None) -> bool:
    """Return whether *value* is safe to propagate through logs and protocols."""
    return bool(value and CORRELATION_ID_PATTERN.fullmatch(value))


async def correlation_id_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    """Set a request-scoped correlation ID and echo it on every handled response."""
    raw = request.headers.get("x-correlation-id")
    if raw is None or raw == "":
        correlation_id = str(uuid.uuid4())
        CORRELATION_ID_GENERATED.inc()
    elif not is_valid_correlation_id(raw):
        correlation_id = str(uuid.uuid4())
        CORRELATION_ID_INVALID.inc()
    else:
        correlation_id = raw

    token = correlation_id_ctx.set(correlation_id)
    try:
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = correlation_id
        return response
    finally:
        correlation_id_ctx.reset(token)
