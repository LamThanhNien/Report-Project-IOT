"""Audit service for the Aifom backend.

Two explicit transaction modes:
- ``log_event_atomic(db, ...)``:  Adds the audit event to the *caller's*
  session and flushes it. The caller owns the commit / rollback.
  The audit event is rolled back if the business mutation fails.
  Use this when audit integrity must match business data integrity.

- ``log_event_best_effort(...)``: Opens a *separate* SessionLocal after the
  business operation, commits independently. Failure is logged and counted
  but never propagates to the caller.
  Use this for after-the-fact audit trails where a failed audit must not
  roll back committed business data.

- ``log_event(db, ...)`` (alias): Preserved for backward compatibility.
  Calls ``log_event_best_effort``. The ``db`` argument is silently ignored.
  Callers should migrate to the explicit forms.

Sanitisation contract:
- All detail payloads are passed through ``_sanitize_payload()`` before
  persisting. This function is bounded in all dimensions to prevent
  unbounded payloads reaching the database.
- Sensitive keys are matched case-insensitively using an explicit allowlist.
  Overly broad substring matching (e.g., every key containing "key") is
  deliberately avoided.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any

from sqlalchemy.orm import Session

from app.core.logging import get_correlation_id
from app.db.session import SessionLocal
from app.modules.audit.model import AuditLog

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Sanitisation limits
# ---------------------------------------------------------------------------
_MAX_DEPTH = 10  # maximum recursion depth
_MAX_DICT_KEYS = 100  # maximum dictionary keys at each level
_MAX_LIST_ITEMS = 100  # maximum list items at each level
_MAX_STR_LEN = 2048  # maximum string length (truncated with marker)
_MAX_PAYLOAD_BYTES = 65536  # 64 KB total serialised payload limit

_TRUNCATED_STRING_MARKER = "[TRUNCATED]"
_TRUNCATED_DICT_MARKER = "[DICT_TRUNCATED]"
_TRUNCATED_LIST_MARKER = "[LIST_TRUNCATED]"
_REDACTED_MARKER = "***REDACTED***"

# ---------------------------------------------------------------------------
# Sensitive key matching
# ---------------------------------------------------------------------------
# Explicit set of sensitive key names (case-insensitive, exact or suffix match).
# Deliberately NOT using broad substring matching (e.g., every key with "key").
_SENSITIVE_EXACT: frozenset[str] = frozenset(
    {
        "password",
        "passwd",
        "secret",
        "token",
        "access_token",
        "refresh_token",
        "id_token",
        "authorization",
        "cookie",
        "jwt",
        "private_key",
        "provisioning_secret",
        "device_provisioning_secret",
        "mqtt_password",
        "minio_secret_key",
        "signed_url",
        "download_url",
        "presigned_url",
        "api_key",
        "access_key",
        "secret_key",
        "client_secret",
    }
)

# Sensitive suffixes: any key *ending* with these strings is redacted.
_SENSITIVE_SUFFIXES: tuple[str, ...] = (
    "_password",
    "_secret",
    "_token",
    "_key",
    "_credential",
    "_authorization",
)

# Safe keys that happen to contain "key" but are NOT sensitive:
_SAFE_ALLOWLIST: frozenset[str] = frozenset(
    {
        "keyboard_layout",
        "monkey_patch",
        "key_count",
        "key_metrics",
        "donkey",
        "turkey",
        "hockey",
        "jockey",
    }
)


def _is_sensitive(key: str) -> bool:
    """Return True if *key* should be redacted."""
    normalized = key.lower().strip()
    if normalized in _SAFE_ALLOWLIST:
        return False
    if normalized in _SENSITIVE_EXACT:
        return True
    return normalized.endswith(_SENSITIVE_SUFFIXES)


# ---------------------------------------------------------------------------
# Safe type normalization
# ---------------------------------------------------------------------------


def _normalize_value(value: Any) -> Any:
    """Convert a value to a JSON-safe primitive."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        return value
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Enum):
        return value.value if isinstance(value.value, (str, int, float, bool)) else str(value.value)
    if value is None:
        return None
    # Unsupported type: safe bounded representation
    type_name = type(value).__name__[:64]
    return f"[{type_name}]"


# ---------------------------------------------------------------------------
# Bounded sanitiser
# ---------------------------------------------------------------------------


def _sanitize_payload(
    data: Any,
    *,
    _depth: int = 0,
    _redaction_counter: list[int] | None = None,
    _truncation_counter: list[int] | None = None,
) -> Any:
    """Recursively sanitise *data* within strict bounds.

    Tracks redaction and truncation via mutable counters for metrics.
    """
    if _redaction_counter is None:
        _redaction_counter = [0]
    if _truncation_counter is None:
        _truncation_counter = [0]

    if _depth > _MAX_DEPTH:
        _truncation_counter[0] += 1
        return _TRUNCATED_DICT_MARKER

    if isinstance(data, dict):
        result: dict = {}
        items = list(data.items())
        truncated = len(items) > _MAX_DICT_KEYS
        if truncated:
            items = items[:_MAX_DICT_KEYS]
            _truncation_counter[0] += 1
        for k, v in items:
            key_str = str(k)[:256]  # key length guard
            if _is_sensitive(key_str):
                result[key_str] = _REDACTED_MARKER
                _redaction_counter[0] += 1
            else:
                result[key_str] = _sanitize_payload(
                    v,
                    _depth=_depth + 1,
                    _redaction_counter=_redaction_counter,
                    _truncation_counter=_truncation_counter,
                )
        if truncated:
            result["__truncated__"] = _TRUNCATED_DICT_MARKER
        return result

    if isinstance(data, list):
        truncated = len(data) > _MAX_LIST_ITEMS
        items_list = data[:_MAX_LIST_ITEMS]
        result_list = [
            _sanitize_payload(
                item,
                _depth=_depth + 1,
                _redaction_counter=_redaction_counter,
                _truncation_counter=_truncation_counter,
            )
            for item in items_list
        ]
        if truncated:
            _truncation_counter[0] += 1
            result_list.append(_TRUNCATED_LIST_MARKER)
        return result_list

    if isinstance(data, str):
        if len(data) > _MAX_STR_LEN:
            _truncation_counter[0] += 1
            return data[:_MAX_STR_LEN] + _TRUNCATED_STRING_MARKER
        return data

    return _normalize_value(data)


def _redact(data: Any) -> Any:
    """Legacy public alias for ``_sanitize_payload``.

    Kept for backward compatibility with existing test imports.
    """
    return _sanitize_payload(data)


def _prepare_detail(
    detail: dict[str, Any] | None,
    corr_id: str | None,
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
    changed_fields: list[str] | None,
) -> dict[str, Any]:
    """Merge and sanitise the audit detail payload."""
    from app.core.metrics import AUDIT_REDACTION, AUDIT_TRUNCATION

    merged: dict[str, Any] = dict(detail) if detail else {}
    if corr_id:
        merged["correlation_id"] = corr_id
    if before is not None:
        merged["before"] = before
    if after is not None:
        merged["after"] = after
    if changed_fields is not None:
        merged["changed_fields"] = changed_fields

    redaction_counter: list[int] = [0]
    truncation_counter: list[int] = [0]
    sanitised = _sanitize_payload(
        merged,
        _redaction_counter=redaction_counter,
        _truncation_counter=truncation_counter,
    )

    if redaction_counter[0]:
        AUDIT_REDACTION.inc(redaction_counter[0])
    if truncation_counter[0]:
        AUDIT_TRUNCATION.inc(truncation_counter[0])

    # Total payload size guard
    import json as _json

    try:
        payload_bytes = len(_json.dumps(sanitised, default=str).encode("utf-8"))
        if payload_bytes > _MAX_PAYLOAD_BYTES:
            truncation_counter[0] += 1
            AUDIT_TRUNCATION.inc()
            sanitised = {"__truncated__": True, "correlation_id": corr_id}
    except Exception:
        sanitised = {"__error__": "payload_serialization_failed"}

    return sanitised  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Atomic audit (caller's transaction)
# ---------------------------------------------------------------------------


def log_event_atomic(
    db: Session,
    *,
    action: str,
    user_id: uuid.UUID | None = None,
    tenant_id: uuid.UUID | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    detail: dict[str, Any] | None = None,
    ip_address: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    changed_fields: list[str] | None = None,
    outcome: str | None = None,
) -> None:
    """Add an audit event to the *caller's* session (atomic mode).

    The caller owns the commit / rollback. The audit event is rolled back
    if the surrounding business mutation fails.

    This function does NOT commit. Call db.commit() / db.flush() yourself.
    """
    from app.core.metrics import AUDIT_LOG_EVENTS

    try:
        corr_id = get_correlation_id()
        detail_merged = dict(detail) if detail else {}
        if outcome:
            detail_merged["outcome"] = outcome
        sanitised = _prepare_detail(detail_merged, corr_id, before, after, changed_fields)

        from sqlalchemy import text

        valid_user_id = user_id
        valid_tenant_id = tenant_id
        if user_id is not None:
            exists_u = db.execute(
                text("SELECT 1 FROM users WHERE id = :uid"), {"uid": str(user_id)}
            ).first()
            if not exists_u:
                valid_user_id = None
                sanitised["synthetic_user_id"] = str(user_id)
        if tenant_id is not None:
            exists_t = db.execute(
                text("SELECT 1 FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)}
            ).first()
            if not exists_t:
                valid_tenant_id = None
                sanitised["synthetic_tenant_id"] = str(tenant_id)

        event = AuditLog(
            action=action,
            user_id=valid_user_id,
            tenant_id=valid_tenant_id,
            resource_type=resource_type,
            resource_id=resource_id,
            detail=sanitised,
            ip_address=ip_address,
        )
        db.add(event)
        # Flush so the row is visible in the same transaction for debugging.
        db.flush()
        AUDIT_LOG_EVENTS.labels(outcome="success").inc()
    except Exception:
        AUDIT_LOG_EVENTS.labels(outcome="failure").inc()
        logger.exception("[AUDIT] log_event_atomic failed action=%s", action)
        raise


# ---------------------------------------------------------------------------
# Best-effort audit (separate transaction)
# ---------------------------------------------------------------------------


def log_event_best_effort(
    db: Session | None = None,
    *,
    action: str,
    user_id: uuid.UUID | None = None,
    tenant_id: uuid.UUID | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    detail: dict[str, Any] | None = None,
    ip_address: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    changed_fields: list[str] | None = None,
    outcome: str | None = None,
) -> None:
    """Insert an audit event in an isolated transaction (best-effort mode).

    Failure is logged and counted but never propagates to the caller.
    Does NOT modify the caller's transaction.

    A new SessionLocal is opened, used, and closed within this function.
    The optional positional session is accepted only to simplify migration of
    legacy callers; it is deliberately never committed or rolled back here.
    """
    from app.core.metrics import AUDIT_LOG_EVENTS

    try:
        corr_id = get_correlation_id()
        detail_merged = dict(detail) if detail else {}
        if outcome:
            detail_merged["outcome"] = outcome
        sanitised = _prepare_detail(detail_merged, corr_id, before, after, changed_fields)

        from sqlalchemy import text
        from app.db.session import postgres_rls_bypass, sync_tenant_context_in_pg

        with SessionLocal() as new_db:
            with postgres_rls_bypass(new_db):
                sync_tenant_context_in_pg(new_db)
                valid_user_id = user_id
                valid_tenant_id = tenant_id
                if user_id is not None:
                    exists_u = new_db.execute(
                        text("SELECT 1 FROM users WHERE id = :uid"), {"uid": str(user_id)}
                    ).first()
                    if not exists_u:
                        valid_user_id = None
                        sanitised["synthetic_user_id"] = str(user_id)
                if tenant_id is not None:
                    exists_t = new_db.execute(
                        text("SELECT 1 FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)}
                    ).first()
                    if not exists_t:
                        valid_tenant_id = None
                        sanitised["synthetic_tenant_id"] = str(tenant_id)

                event = AuditLog(
                    action=action,
                    user_id=valid_user_id,
                    tenant_id=valid_tenant_id,
                    resource_type=resource_type,
                    resource_id=resource_id,
                    detail=sanitised,
                    ip_address=ip_address,
                )
                new_db.add(event)
                new_db.commit()

        AUDIT_LOG_EVENTS.labels(outcome="success").inc()
    except Exception as e:
        AUDIT_LOG_EVENTS.labels(outcome="failure").inc()
        logger.warning("Failed to write audit log: %s", e)


# ---------------------------------------------------------------------------
# Backward-compatible alias
# ---------------------------------------------------------------------------


def log_event(
    db: Session,  # silently ignored — kept for backward compatibility
    *,
    action: str,
    user_id: uuid.UUID | None = None,
    tenant_id: uuid.UUID | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    detail: dict[str, Any] | None = None,
    ip_address: str | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    changed_fields: list[str] | None = None,
    outcome: str | None = None,
) -> None:
    """Deprecated compatibility alias for ``log_event_best_effort``.

    The ``db`` argument is ignored. Existing callers need not be updated
    immediately, but should migrate to ``log_event_atomic`` or
    ``log_event_best_effort`` explicitly.
    """
    log_event_best_effort(
        db,
        action=action,
        user_id=user_id,
        tenant_id=tenant_id,
        resource_type=resource_type,
        resource_id=resource_id,
        detail=detail,
        ip_address=ip_address,
        before=before,
        after=after,
        changed_fields=changed_fields,
        outcome=outcome,
    )
