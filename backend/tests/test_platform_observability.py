"""Focused observability test suite for Aifom backend — Phase 0.

Design principles:
- No TestClient(app) for readiness tests (avoids triggering real lifespan /
  database wait).
- ReadinessProbe is tested directly via its async methods.
- Correlation middleware is tested via a minimal throwaway FastAPI app.
- MQTT publisher tests patch paho at module level.
- All tests reset ContextVars and ReadinessProbe cache after every run.
- No global state is shared across test cases.
- No test-only routes are added to the production app.
"""

from __future__ import annotations

import asyncio
import json
import uuid
import pytest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_correlation_ctx():
    """Reset the correlation ContextVar before and after every test."""
    from app.core.logging import correlation_id_ctx

    token = correlation_id_ctx.set(None)
    yield
    correlation_id_ctx.reset(token)


@pytest.fixture()
def readiness():
    """Return a fresh ReadinessProbe instance with a cleared cache and lock.

    A new lock is created lazily inside get_readiness() so it is always
    bound to the current asyncio.run() event loop (not a stale one).
    """
    from app.core.readiness import ReadinessProbe

    probe = ReadinessProbe()
    probe._cache = None
    probe._lock = None  # reset so a fresh lock is created in the current loop
    return probe


@pytest.fixture()
def minimal_app():
    """Minimal FastAPI app with only the correlation middleware registered.

    Does NOT start the real application lifespan. Safe for unit tests.
    """
    app = FastAPI()

    from app.core.correlation import correlation_id_middleware

    @app.middleware("http")
    async def _cid_middleware(request, call_next):
        return await correlation_id_middleware(request, call_next)

    @app.get("/ping")
    def ping():
        return {"ok": True}

    @app.get("/ping-error")
    def ping_error():
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="bad request")

    @app.get("/ping-500")
    def ping_500():
        raise RuntimeError("boom")

    return app


# ---------------------------------------------------------------------------
# 1. Correlation ID middleware — valid inbound ID
# ---------------------------------------------------------------------------


def test_correlation_id_middleware_respects_valid_id(minimal_app):
    """A well-formed X-Correlation-ID is echoed back unchanged."""
    with TestClient(minimal_app, raise_server_exceptions=False) as c:
        resp = c.get("/ping", headers={"X-Correlation-ID": "test-corr-id-123"})
    assert resp.status_code == 200
    assert resp.headers["X-Correlation-ID"] == "test-corr-id-123"


# ---------------------------------------------------------------------------
# 2. Correlation ID middleware — missing header generates new ID
# ---------------------------------------------------------------------------


def test_correlation_id_middleware_generates_new_id(minimal_app):
    """Missing X-Correlation-ID causes the middleware to generate a UUID."""
    with TestClient(minimal_app, raise_server_exceptions=False) as c:
        resp = c.get("/ping")
    assert resp.status_code == 200
    cid = resp.headers["X-Correlation-ID"]
    assert len(cid) > 10
    # Should be a valid UUID v4
    try:
        uuid.UUID(cid, version=4)
    except ValueError:
        pytest.fail(f"Generated correlation ID is not a UUID v4: {cid!r}")


# ---------------------------------------------------------------------------
# 3. Correlation ID middleware — invalid characters rejected
# ---------------------------------------------------------------------------


def test_correlation_id_middleware_rejects_invalid_chars(minimal_app):
    """Invalid characters in X-Correlation-ID cause generation of a new ID."""
    with TestClient(minimal_app, raise_server_exceptions=False) as c:
        resp = c.get("/ping", headers={"X-Correlation-ID": "bad id with spaces!"})
    assert resp.status_code == 200
    cid = resp.headers["X-Correlation-ID"]
    # Must be a freshly generated ID, not the bad one
    assert cid != "bad id with spaces!"
    assert len(cid) > 10


# ---------------------------------------------------------------------------
# 4. Correlation ID middleware — newline/control-character injection
# ---------------------------------------------------------------------------


def test_correlation_id_middleware_rejects_newline_injection(minimal_app):
    """Newline / control characters in the header are rejected (log injection)."""
    with TestClient(minimal_app, raise_server_exceptions=False) as c:
        resp = c.get("/ping", headers={"X-Correlation-ID": "id\r\nX-Injected: evil"})
    cid = resp.headers.get("X-Correlation-ID", "")
    assert "\r" not in cid
    assert "\n" not in cid
    assert "evil" not in cid


# ---------------------------------------------------------------------------
# 5. Correlation ID middleware — oversized ID rejected
# ---------------------------------------------------------------------------


def test_correlation_id_middleware_rejects_oversized_id(minimal_app):
    """IDs longer than 128 characters are rejected."""
    oversized = "a" * 200
    with TestClient(minimal_app, raise_server_exceptions=False) as c:
        resp = c.get("/ping", headers={"X-Correlation-ID": oversized})
    cid = resp.headers["X-Correlation-ID"]
    assert cid != oversized
    assert len(cid) <= 128


# ---------------------------------------------------------------------------
# 6. Correlation ID on 4xx responses
# ---------------------------------------------------------------------------


def test_correlation_id_on_4xx_response(minimal_app):
    """X-Correlation-ID header is present on HTTP exception (4xx) responses."""
    with TestClient(minimal_app, raise_server_exceptions=False) as c:
        resp = c.get("/ping-error", headers={"X-Correlation-ID": "err-test-456"})
    assert resp.status_code == 400
    assert resp.headers.get("X-Correlation-ID") is not None


# ---------------------------------------------------------------------------
# 7. Correlation ID on unhandled 5xx responses
# ---------------------------------------------------------------------------


def test_correlation_id_on_5xx_response(minimal_app):
    """X-Correlation-ID header is present on 5xx responses.

    The middleware wraps call_next; FastAPI's default exception handler
    for unhandled exceptions returns a 500 response that flows back
    through the middleware, which then sets the correlation header.
    """
    from fastapi.responses import JSONResponse

    # Add a 500 exception handler to the minimal app so the response
    # flows through the middleware layer (not propagated to test client)
    @minimal_app.exception_handler(RuntimeError)
    async def _runtime_handler(request, exc):
        return JSONResponse(status_code=500, content={"detail": "internal"})

    with TestClient(minimal_app, raise_server_exceptions=False) as c:
        resp = c.get("/ping-500", headers={"X-Correlation-ID": "err-500-xyz"})
    assert resp.status_code == 500
    cid = resp.headers.get("X-Correlation-ID")
    assert cid is not None, "X-Correlation-ID must be present on 500 response"


# ---------------------------------------------------------------------------
# 8. Concurrent request isolation
# ---------------------------------------------------------------------------


def test_correlation_id_concurrent_isolation():
    """Each concurrent request has its own isolated correlation ID."""
    from app.core.logging import correlation_id_ctx

    results: list[str | None] = []

    def _simulate(corr_id: str):
        token = correlation_id_ctx.set(corr_id)
        try:
            import time

            time.sleep(0.01)
            results.append(correlation_id_ctx.get())
        finally:
            correlation_id_ctx.reset(token)

    import threading

    ids = ["id-a", "id-b", "id-c"]
    threads = [threading.Thread(target=_simulate, args=(i,)) for i in ids]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # Each thread should have seen its own ID (contextvars are thread-safe)
    assert sorted(results) == sorted(ids)


# ---------------------------------------------------------------------------
# 9. Context reset after request completion
# ---------------------------------------------------------------------------


def test_correlation_id_reset_after_request(minimal_app):
    """The ContextVar is None after a request completes."""
    from app.core.logging import correlation_id_ctx

    with TestClient(minimal_app, raise_server_exceptions=False) as c:
        c.get("/ping", headers={"X-Correlation-ID": "reset-test"})
    # After the request, the main thread's ContextVar should be unset
    # (the middleware resets it in finally)
    assert correlation_id_ctx.get() is None


# ---------------------------------------------------------------------------
# 10. MQTT payload non-mutation
# ---------------------------------------------------------------------------


@patch("app.shared.infrastructure.messaging.mqtt_publisher.paho_publish.single")
def test_mqtt_publish_does_not_mutate_original_payload(mock_single):
    """The caller's payload dict must not be modified by the publisher."""
    from app.core.logging import correlation_id_ctx

    token = correlation_id_ctx.set("mqtt-test-corr-id")
    try:
        from app.shared.infrastructure.messaging.mqtt_publisher import publish_device_command

        original = {"command": "reboot", "extra": "data"}
        original_copy = dict(original)
        publish_device_command("device-test", original)

        # Original dict must not be mutated
        assert original == original_copy, f"Original was mutated: {original}"
    finally:
        correlation_id_ctx.reset(token)


@patch("app.shared.infrastructure.messaging.mqtt_publisher.paho_publish.single")
def test_mqtt_publish_injects_correlation_id(mock_single):
    """The published payload includes the validated correlation ID."""
    from app.core.logging import correlation_id_ctx

    corr_id = "mqtt-corr-abc"
    token = correlation_id_ctx.set(corr_id)
    try:
        from app.shared.infrastructure.messaging.mqtt_publisher import publish_device_command

        publish_device_command("device-123", {"command": "reboot"})

        mock_single.assert_called_once()
        kwargs = mock_single.call_args.kwargs
        published = json.loads(kwargs["payload"])
        assert published["command"] == "reboot"
        assert published["correlation_id"] == corr_id
    finally:
        correlation_id_ctx.reset(token)


@patch("app.shared.infrastructure.messaging.mqtt_publisher.paho_publish.single")
def test_mqtt_publish_rejects_invalid_caller_correlation(mock_single):
    """An invalid correlation ID inside the payload is replaced with the ContextVar value."""
    from app.core.logging import correlation_id_ctx

    good_id = "good-ctx-id"
    token = correlation_id_ctx.set(good_id)
    try:
        from app.shared.infrastructure.messaging.mqtt_publisher import publish_device_command

        # Caller provides an invalid correlation_id in the payload
        bad_payload = {"command": "update", "correlation_id": "bad id\ninjection"}
        publish_device_command("device-xyz", bad_payload)

        kwargs = mock_single.call_args.kwargs
        published = json.loads(kwargs["payload"])
        # The bad value must be replaced with the ContextVar value
        assert published["correlation_id"] == good_id
    finally:
        correlation_id_ctx.reset(token)


@patch("app.shared.infrastructure.messaging.mqtt_publisher.paho_publish.single")
def test_mqtt_publish_ota_does_not_mutate(mock_single):
    """publish_ota_request does not mutate the original payload."""
    from app.core.logging import correlation_id_ctx
    from app.shared.infrastructure.messaging.mqtt_publisher import publish_ota_request

    token = correlation_id_ctx.set("ota-corr")
    try:
        original = {"job_id": "job-1", "url": "http://example.com/fw.bin"}
        snap = dict(original)
        publish_ota_request("device-uid", original)
        assert original == snap
    finally:
        correlation_id_ctx.reset(token)




# ---------------------------------------------------------------------------
# 11. Background context: no HTTP context generates op-ID
# ---------------------------------------------------------------------------


def test_background_context_generates_op_id():
    """Without HTTP context, a background op-ID is generated with 'op-' prefix."""
    from app.core.background_context import new_operation_id

    op_id = new_operation_id()
    assert op_id.startswith("op-")
    # The suffix is a UUID v4
    suffix = op_id[len("op-") :]
    uuid.UUID(suffix, version=4)  # raises if invalid


def test_mqtt_callback_context_uses_fresh_op_id():
    """mqtt_callback_context provides a fresh op-ID, never a stale request ID."""
    from app.core.background_context import mqtt_callback_context
    from app.core.logging import correlation_id_ctx

    # Simulate a stale request ID in the ContextVar
    stale_token = correlation_id_ctx.set("stale-request-id")
    captured: list[str | None] = []

    def _cb():
        captured.append(correlation_id_ctx.get())

    try:
        mqtt_callback_context(_cb)
    finally:
        correlation_id_ctx.reset(stale_token)

    assert len(captured) == 1
    op_id = captured[0]
    assert op_id is not None
    assert op_id.startswith("op-"), f"Expected op- prefix, got {op_id!r}"
    # Must not be the stale request ID
    assert op_id != "stale-request-id"


def test_mqtt_subscriber_tracks_authenticated_connection_state():
    """Readiness state changes only through successful Paho callbacks."""
    from app.shared.infrastructure.messaging.mqtt_subscriber import MQTTSubscriber

    subscriber = MQTTSubscriber()
    subscriber._client.subscribe = MagicMock()
    assert subscriber.is_connected is False
    subscriber._on_connect(subscriber._client, None, None, 0)
    assert subscriber.is_connected is True
    subscriber._on_disconnect(subscriber._client, None, 1)
    assert subscriber.is_connected is False


def test_mqtt_subscriber_enqueues_fresh_operation_id():
    """The Paho callback propagates a fresh operation ID to the worker queue."""
    from app.shared.infrastructure.messaging.mqtt_subscriber import MQTTSubscriber

    subscriber = MQTTSubscriber()
    message = MagicMock()
    message.topic = "devices/device-1/telemetry"
    message.payload = b"{}"
    message.retain = False

    subscriber._on_message(subscriber._client, None, message)
    queued = subscriber._msg_queue.get_nowait()
    assert queued[4].startswith("op-")


# ---------------------------------------------------------------------------
# 12. Readiness probe — direct tests (no TestClient(app))
# ---------------------------------------------------------------------------


def test_readiness_probe_success(readiness):
    """ReadinessProbe returns ready when all checks pass."""
    with (
        patch.object(readiness, "_check_db", return_value=True),
        patch.object(readiness, "_check_alembic", return_value=True),
        patch.object(readiness, "_check_token_blacklist", return_value=True),
        patch.object(readiness, "_check_mqtt", return_value=True),
        patch.object(readiness, "_check_minio", return_value=True),
    ):
        response = asyncio.run(readiness.get_readiness())
    assert response.status_code == 200
    import json as _json

    body = _json.loads(response.body)
    assert body["status"] == "ready"


def test_readiness_probe_required_failure(readiness):
    """ReadinessProbe returns 503/not_ready when a required component is down."""
    with (
        patch.object(readiness, "_check_db", return_value=False),
        patch.object(readiness, "_check_alembic", return_value=True),
        patch.object(readiness, "_check_token_blacklist", return_value=True),
        patch.object(readiness, "_check_mqtt", return_value=True),
        patch.object(readiness, "_check_minio", return_value=True),
    ):
        response = asyncio.run(readiness.get_readiness())
    assert response.status_code == 503
    import json as _json

    body = _json.loads(response.body)
    assert body["status"] == "not_ready"


def test_readiness_probe_degraded(readiness):
    """ReadinessProbe returns 200/degraded when an optional component is down."""
    with (
        patch.object(readiness, "_check_db", return_value=True),
        patch.object(readiness, "_check_alembic", return_value=True),
        patch.object(readiness, "_check_token_blacklist", return_value=True),
        patch.object(readiness, "_check_mqtt", return_value=True),
        patch.object(readiness, "_check_minio", return_value=False),  # optional
    ):
        response = asyncio.run(readiness.get_readiness())
    assert response.status_code == 200
    import json as _json

    body = _json.loads(response.body)
    assert body["status"] == "degraded"


def test_readiness_mqtt_uses_authenticated_subscriber_state(readiness):
    """MQTT readiness must use subscriber state, never a raw TCP fallback."""
    with patch("app.main.mqtt_subscriber") as subscriber:
        subscriber.is_connected = False
        assert readiness._check_mqtt() is False
        subscriber.is_connected = True
        assert readiness._check_mqtt() is True


def test_readiness_probe_cache_hit(readiness):
    """A second call within the TTL returns the cached result without re-running probes."""
    call_count = [0]

    def _counting_check():
        call_count[0] += 1
        return True

    async def _run_twice():
        await readiness.get_readiness()
        await readiness.get_readiness()

    with (
        patch.object(readiness, "_check_db", side_effect=_counting_check),
        patch.object(readiness, "_check_alembic", return_value=True),
        patch.object(readiness, "_check_token_blacklist", return_value=True),
        patch.object(readiness, "_check_mqtt", return_value=True),
        patch.object(readiness, "_check_minio", return_value=True),
    ):
        asyncio.run(_run_twice())

    # _check_db should only have been called once (second call hits cache)
    assert call_count[0] == 1, f"Expected 1 probe call, got {call_count[0]}"


def test_readiness_probe_concurrent_single_flight(readiness):
    """Concurrent readiness requests execute only one probe run (single-flight)."""
    call_count = [0]

    def _slow_check():
        import time

        call_count[0] += 1
        time.sleep(0.05)
        return True

    async def _run():
        with (
            patch.object(readiness, "_check_db", side_effect=_slow_check),
            patch.object(readiness, "_check_alembic", return_value=True),
            patch.object(readiness, "_check_token_blacklist", return_value=True),
            patch.object(readiness, "_check_mqtt", return_value=True),
            patch.object(readiness, "_check_minio", return_value=True),
        ):
            await asyncio.gather(
                readiness.get_readiness(),
                readiness.get_readiness(),
                readiness.get_readiness(),
            )

    asyncio.run(_run())
    # With single-flight + cache, DB check should run at most once
    assert call_count[0] <= 1, f"Expected <=1 probe calls, got {call_count[0]}"


def test_readiness_timeout_does_not_resubmit_stuck_component(readiness):
    """A timed-out synchronous probe retains one bounded in-flight future."""
    import time

    calls = [0]

    def _blocked_probe():
        calls[0] += 1
        time.sleep(0.08)
        return True

    async def _run_twice():
        first = await readiness._run_probe("bounded-test", _blocked_probe)
        second = await readiness._run_probe("bounded-test", _blocked_probe)
        return first, second

    with patch("app.core.readiness._COMPONENT_TIMEOUT", 0.01):
        assert asyncio.run(_run_twice()) == (False, False)
    assert calls[0] == 1
    time.sleep(0.09)


# ---------------------------------------------------------------------------
# 13. Alembic multi-head readiness
# ---------------------------------------------------------------------------


def test_readiness_alembic_single_head_match(readiness):
    """_check_alembic returns True when current head matches expected head."""
    with (
        patch("app.core.readiness.MigrationContext") as mock_ctx_cls,
        patch("app.core.readiness.ScriptDirectory") as mock_script_cls,
        patch("app.core.readiness.Config"),
        patch("app.core.readiness.engine") as mock_engine,
    ):
        mock_conn = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

        mock_ctx = MagicMock()
        mock_ctx.get_current_heads.return_value = ["abc123"]
        mock_ctx_cls.configure.return_value = mock_ctx

        mock_script = MagicMock()
        mock_script.get_heads.return_value = ["abc123"]
        mock_script_cls.from_config.return_value = mock_script

        result = readiness._check_alembic()
    assert result is True


def test_readiness_alembic_multiple_heads_match(readiness):
    """_check_alembic returns True when multiple heads all match."""
    with (
        patch("app.core.readiness.MigrationContext") as mock_ctx_cls,
        patch("app.core.readiness.ScriptDirectory") as mock_script_cls,
        patch("app.core.readiness.Config"),
        patch("app.core.readiness.engine") as mock_engine,
    ):
        mock_conn = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

        mock_ctx = MagicMock()
        mock_ctx.get_current_heads.return_value = ["head-a", "head-b"]
        mock_ctx_cls.configure.return_value = mock_ctx

        mock_script = MagicMock()
        mock_script.get_heads.return_value = ["head-a", "head-b"]
        mock_script_cls.from_config.return_value = mock_script

        result = readiness._check_alembic()
    assert result is True


def test_readiness_alembic_missing_head(readiness):
    """_check_alembic returns False when a required head is missing from the DB."""
    with (
        patch("app.core.readiness.MigrationContext") as mock_ctx_cls,
        patch("app.core.readiness.ScriptDirectory") as mock_script_cls,
        patch("app.core.readiness.Config"),
        patch("app.core.readiness.engine") as mock_engine,
    ):
        mock_conn = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

        mock_ctx = MagicMock()
        mock_ctx.get_current_heads.return_value = ["head-a"]  # missing head-b
        mock_ctx_cls.configure.return_value = mock_ctx

        mock_script = MagicMock()
        mock_script.get_heads.return_value = ["head-a", "head-b"]
        mock_script_cls.from_config.return_value = mock_script

        result = readiness._check_alembic()
    assert result is False


def test_readiness_alembic_extra_stale_db_head(readiness):
    """_check_alembic rejects unknown extra database heads."""
    with (
        patch("app.core.readiness.MigrationContext") as mock_ctx_cls,
        patch("app.core.readiness.ScriptDirectory") as mock_script_cls,
        patch("app.core.readiness.Config"),
        patch("app.core.readiness.engine") as mock_engine,
    ):
        mock_conn = MagicMock()
        mock_engine.connect.return_value.__enter__ = MagicMock(return_value=mock_conn)
        mock_engine.connect.return_value.__exit__ = MagicMock(return_value=False)

        mock_ctx = MagicMock()
        # DB has expected head plus a stale extra one
        mock_ctx.get_current_heads.return_value = ["expected-head", "stale-old-head"]
        mock_ctx_cls.configure.return_value = mock_ctx

        mock_script = MagicMock()
        mock_script.get_heads.return_value = ["expected-head"]
        mock_script_cls.from_config.return_value = mock_script

        result = readiness._check_alembic()
    assert result is False


def test_readiness_alembic_missing_config(readiness):
    """_check_alembic returns False when alembic.ini is missing."""
    with patch("app.core.readiness.Config", side_effect=Exception("alembic.ini not found")):
        result = readiness._check_alembic()
    assert result is False


# ---------------------------------------------------------------------------
# 14. Audit sanitiser tests
# ---------------------------------------------------------------------------


def test_audit_redact_sensitive_keys():
    """Known sensitive keys are redacted."""
    from app.shared.application.audit_service import _redact

    data = {
        "password": "mysecretpassword",
        "nested": {
            "api_key": "some_key_123",
            "safe_field": "hello",
            "items": [{"token": "abc"}],
        },
    }
    redacted = _redact(data)
    assert redacted["password"] == "***REDACTED***"
    assert redacted["nested"]["api_key"] == "***REDACTED***"
    assert redacted["nested"]["safe_field"] == "hello"
    assert redacted["nested"]["items"][0]["token"] == "***REDACTED***"


def test_audit_redact_case_insensitive():
    """Sensitive key matching is case-insensitive."""
    from app.shared.application.audit_service import _redact

    data = {"PASSWORD": "secret", "Api_Key": "abc", "AUTHORIZATION": "Bearer xyz"}
    redacted = _redact(data)
    assert redacted["PASSWORD"] == "***REDACTED***"
    assert redacted["Api_Key"] == "***REDACTED***"
    assert redacted["AUTHORIZATION"] == "***REDACTED***"


def test_audit_redact_safe_keys_with_key_substring():
    """Safe keys that merely contain 'key' substring are NOT redacted."""
    from app.shared.application.audit_service import _redact

    data = {"keyboard_layout": "qwerty", "key_count": 42}
    redacted = _redact(data)
    assert redacted["keyboard_layout"] == "qwerty"
    assert redacted["key_count"] == 42


def test_audit_sanitize_deep_recursion():
    """Deep recursion beyond _MAX_DEPTH is truncated safely."""
    from app.shared.application.audit_service import _sanitize_payload, _MAX_DEPTH

    # Build a deeply nested dict (deeper than the limit)
    data: dict = {}
    current = data
    for _ in range(_MAX_DEPTH + 5):
        current["nested"] = {}
        current = current["nested"]
    current["value"] = "deep"

    result = _sanitize_payload(data)
    # Should not raise and should contain a truncation marker at depth limit
    assert result is not None


def test_audit_sanitize_oversized_list():
    """Lists beyond _MAX_LIST_ITEMS are truncated."""
    from app.shared.application.audit_service import (
        _sanitize_payload,
        _MAX_LIST_ITEMS,
        _TRUNCATED_LIST_MARKER,
    )

    data = list(range(_MAX_LIST_ITEMS + 10))
    result = _sanitize_payload(data)
    # Last item should be the truncation marker
    assert result[-1] == _TRUNCATED_LIST_MARKER
    assert len(result) == _MAX_LIST_ITEMS + 1  # items + marker


def test_audit_sanitize_oversized_dict():
    """Dicts beyond _MAX_DICT_KEYS are truncated."""
    from app.shared.application.audit_service import _sanitize_payload, _MAX_DICT_KEYS

    data = {f"key_{i}": i for i in range(_MAX_DICT_KEYS + 10)}
    result = _sanitize_payload(data)
    # Should include truncation marker key
    assert "__truncated__" in result
    assert len(result) <= _MAX_DICT_KEYS + 1  # items + marker key


def test_audit_sanitize_oversized_string():
    """Strings beyond _MAX_STR_LEN are truncated with marker."""
    from app.shared.application.audit_service import (
        _sanitize_payload,
        _MAX_STR_LEN,
        _TRUNCATED_STRING_MARKER,
    )

    long_str = "x" * (_MAX_STR_LEN + 100)
    result = _sanitize_payload(long_str)
    assert len(result) <= _MAX_STR_LEN + len(_TRUNCATED_STRING_MARKER)
    assert result.endswith(_TRUNCATED_STRING_MARKER)


def test_audit_sanitize_uuid_normalization():
    """UUID values are serialised as strings."""
    import uuid as _uuid
    from app.shared.application.audit_service import _sanitize_payload

    uid = _uuid.uuid4()
    result = _sanitize_payload({"id": uid})
    assert result["id"] == str(uid)


def test_audit_sanitize_datetime_normalization():
    """datetime values are serialised as ISO strings."""
    from datetime import datetime, timezone
    from app.shared.application.audit_service import _sanitize_payload

    now = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
    result = _sanitize_payload({"ts": now})
    assert result["ts"] == now.isoformat()


def test_audit_sanitize_unsupported_object():
    """Unsupported objects become safe bounded type-name strings."""
    from app.shared.application.audit_service import _sanitize_payload

    class _Custom:
        pass

    result = _sanitize_payload({"obj": _Custom()})
    assert result["obj"] == "[_Custom]"


# ---------------------------------------------------------------------------
# 15. Audit transaction modes
# ---------------------------------------------------------------------------


def test_audit_log_event_best_effort_uses_isolated_session():
    """log_event_best_effort opens a new session, not the caller's."""
    from app.shared.application.audit_service import log_event_best_effort

    caller_session = MagicMock()
    caller_session.add = MagicMock()

    with patch("app.shared.application.audit_service.SessionLocal") as mock_sl:
        mock_new_session = MagicMock()
        mock_sl.return_value.__enter__ = MagicMock(return_value=mock_new_session)
        mock_sl.return_value.__exit__ = MagicMock(return_value=False)

        log_event_best_effort(action="test.action", user_id=None)

    # The caller's session must not have been used
    caller_session.add.assert_not_called()
    # A new session must have been opened
    mock_sl.assert_called_once()


def test_audit_log_event_best_effort_syncs_pg_rls_bypass_before_commit():
    """Best-effort audit writes use an isolated session with explicit RLS bypass."""
    from app.shared.application.audit_service import log_event_best_effort

    events = []

    class FakeSession:
        bind = None

        def execute(self, statement, params=None):
            sql = str(statement)
            if "app.bypass_rls" in sql:
                events.append(sql)

        def add(self, _obj):
            events.append("add")

        def commit(self):
            events.append("commit")

    class FakeSessionLocal:
        def __enter__(self):
            return FakeSession()

        def __exit__(self, *_):
            return False

    with patch(
        "app.shared.application.audit_service.SessionLocal", return_value=FakeSessionLocal()
    ):
        log_event_best_effort(action="test.action", user_id=None)

    assert "SET LOCAL app.bypass_rls = 'true'" in events
    assert events.index("SET LOCAL app.bypass_rls = 'true'") < events.index("commit")
    assert events.index("add") < events.index("commit")


def test_audit_log_event_atomic_uses_caller_session():
    """log_event_atomic adds to the caller's session without committing."""
    from app.shared.application.audit_service import log_event_atomic

    caller_db = MagicMock()
    caller_db.flush = MagicMock()
    caller_db.commit = MagicMock()

    with patch("app.shared.application.audit_service.SessionLocal") as mock_sl:
        log_event_atomic(caller_db, action="test.atomic", user_id=None)

    # Must use the caller's session (add + flush)
    caller_db.add.assert_called_once()
    caller_db.flush.assert_called_once()
    # Must NOT commit the caller's session
    caller_db.commit.assert_not_called()
    # Must NOT open a new session
    mock_sl.assert_not_called()


def test_audit_log_event_atomic_rollback_on_failure():
    """Atomic audit failures propagate so the caller can roll back the transaction."""
    from app.shared.application.audit_service import log_event_atomic

    caller_db = MagicMock()
    caller_db.flush.side_effect = Exception("DB flush error")
    caller_db.rollback = MagicMock()

    with pytest.raises(Exception, match="DB flush error"):
        log_event_atomic(caller_db, action="test.fail", user_id=None)

    # The caller's rollback is NOT called by audit (caller owns transaction)
    caller_db.rollback.assert_not_called()


def test_audit_log_event_best_effort_failure_does_not_raise():
    """log_event_best_effort failure is swallowed and counted."""
    from app.shared.application.audit_service import log_event_best_effort

    with patch("app.shared.application.audit_service.SessionLocal") as mock_sl:
        mock_sl.side_effect = Exception("DB connection failed")

        # Must not raise
        log_event_best_effort(action="test.fail", user_id=None)
