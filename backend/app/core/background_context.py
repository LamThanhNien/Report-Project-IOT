"""Background context helpers for explicit correlation ID propagation.

Provides utilities for running background operations with an explicit
correlation or operation ID when no HTTP request context exists.

Policy:
- HTTP requests: correlation ID is set by the middleware and reset in finally.
- Background callbacks (MQTT, thread pools): a new operation ID is generated
  at entry and reset at exit. It is never inherited from stale request contexts.
- Explicit propagation: use run_with_correlation() to copy the current
  context into a thread boundary (e.g., asyncio executor calls).
"""

from __future__ import annotations

import contextvars
import uuid
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")


def new_operation_id() -> str:
    """Generate a new background operation ID (UUID v4, prefixed with 'op-').

    A new ID is created — never propagated from an HTTP request context.
    """
    return f"op-{uuid.uuid4()}"


def run_with_correlation(
    fn: Callable[[], T],
    *,
    correlation_id: str | None = None,
) -> T:
    """Run ``fn`` in the current thread with an explicit correlation ID.

    Copies the current contextvars context, overrides the correlation_id,
    and executes ``fn`` inside that context. The caller's context is not
    modified.

    When ``correlation_id`` is ``None``, the current value is preserved
    (standard context copy behaviour). Pass an explicit value to override.

    This is useful for executor/thread boundaries where ContextVar
    propagation is not guaranteed.
    """
    from app.core.logging import correlation_id_ctx

    ctx = contextvars.copy_context()

    def _wrapped() -> T:
        if correlation_id is not None:
            correlation_id_ctx.set(correlation_id)
        return fn()

    return ctx.run(_wrapped)


def mqtt_callback_context(fn: Callable[[], T]) -> T:
    """Execute an MQTT subscriber callback with a fresh operation ID.

    MQTT callbacks run on Paho worker threads that do not inherit HTTP
    ContextVars. This helper:
    1. Sets a fresh operation ID (never a stale request ID).
    2. Resets the context after the callback returns.

    Usage::

        def on_message(client, userdata, msg):
            mqtt_callback_context(lambda: _handle_message(msg))
    """
    from app.core.logging import correlation_id_ctx

    op_id = new_operation_id()
    token = correlation_id_ctx.set(op_id)
    try:
        return fn()
    finally:
        correlation_id_ctx.reset(token)
