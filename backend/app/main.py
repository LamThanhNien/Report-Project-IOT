import base64
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
import json as _json
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.correlation import correlation_id_middleware
from app.shared.presentation.error_handlers import register_error_handlers
from app.core.auth_cookies import (
    ACCESS_TOKEN_COOKIE,
    REFRESH_TOKEN_COOKIE,
    csrf_tokens_match,
)
from app.core.logging import configure_logging
from app.core.metrics import register_custom_collectors
from app.db.session import SessionLocal
from app.core.tenant_context import (
    current_tenant_id_context,
    bypass_rls_context,
    current_user_role_context,
)

# Ensure all ORM models are imported so Alembic metadata is complete.
from app.bounded_contexts.device_registry.infrastructure.persistence import (  # noqa: F401
    device_type_models as _device_types_model,
)
from app.bounded_contexts.device_registry.infrastructure.persistence import models as _devices_model  # noqa: F401
from app.bounded_contexts.device_registry.infrastructure.persistence import (  # noqa: F401
    platform_models as _platform_models,
)
from app.bounded_contexts.firmware_ota.infrastructure.persistence import (  # noqa: F401
    firmware_models as _firmware_model,
)
from app.bounded_contexts.firmware_ota.infrastructure.persistence import (  # noqa: F401
    firmware_profile_models as _firmware_profiles_model,
)
from app.bounded_contexts.firmware_ota.infrastructure.persistence import (  # noqa: F401
    ota_campaign_models as _ota_campaigns_model,
)
from app.bounded_contexts.firmware_ota.infrastructure.persistence import ota_models as _ota_model  # noqa: F401
from app.bounded_contexts.identity.infrastructure.persistence import models as _auth_model  # noqa: F401
from app.bounded_contexts.identity.infrastructure.persistence import (
    token_blacklist as _token_blacklist_model,  # noqa: F401
)
from app.bounded_contexts.project_dashboard.infrastructure.persistence import (
    models as _projects_model,  # noqa: F401
)
from app.bounded_contexts.telemetry.infrastructure.persistence import alert_models as _alerts_model  # noqa: F401
from app.bounded_contexts.telemetry.infrastructure.persistence import (
    extended_models as _telemetry_extended_model,  # noqa: F401
)
from app.bounded_contexts.telemetry.infrastructure.persistence import models as _telemetry_model  # noqa: F401
from app.bounded_contexts.tenant_management.infrastructure.persistence import (
    models as _tenants_model,  # noqa: F401
)
# Historical feature models stay registered for Alembic compatibility only.
# Active ML, custom dashboard designer, and API-doc portal code has been removed.
from app.bounded_contexts.tinyml_model_management.infrastructure.persistence import (
    models as _anomaly_model,  # noqa: F401
)
from app.shared.infrastructure.persistence import audit_models as _audit_model  # noqa: F401
from app.shared.infrastructure.persistence import settings_models as _settings_model  # noqa: F401
import app.bounded_contexts.tinyml_model_management.infrastructure.sqlalchemy_models as _tinyml_models  # noqa: F401
from app.bounded_contexts.device_groups.infrastructure.persistence import (  # noqa: F401
    models as _device_groups_model,
)
from app.bounded_contexts.device_provisioning.infrastructure import (  # noqa: F401
    models as _device_provisioning_model,
)
from app.bounded_contexts.command_center.infrastructure import (  # noqa: F401
    models as _command_center_model,
)
from app.bounded_contexts.rule_engine.infrastructure.persistence import (  # noqa: F401
    models as _rule_engine_model,
)
from app.bounded_contexts.api_docs.infrastructure import models as _api_docs_model  # noqa: F401
from app.bounded_contexts.device_registry.infrastructure.device_presence_monitor import (
    DevicePresenceMonitor,
)
from app.bounded_contexts.device_registry.infrastructure import (
    repositories as device_repository,
)
from app.bounded_contexts.firmware_ota.infrastructure.storage import minio_client
from app.shared.infrastructure.messaging.mqtt_subscriber import MQTTSubscriber
from app.shared.infrastructure.messaging.mqtt_publisher import get_persistent_mqtt_client
from app.shared.infrastructure.messaging.mdns_service import MDNSService
from app.shared.infrastructure.messaging.device_status_events import device_status_bus
from app.shared.infrastructure.messaging.alert_events import alert_bus

from app.bounded_contexts.identity.infrastructure.token_cleanup import TokenCleanupTask

logger = logging.getLogger(__name__)
mqtt_subscriber = MQTTSubscriber()
token_cleanup_task = TokenCleanupTask()
mdns_service = MDNSService(port=settings.device_mqtt_port)
device_presence_monitor = DevicePresenceMonitor(
    check_interval_seconds=settings.device_presence_check_interval_seconds
)

_HEALTH_PATHS = frozenset(["/health", "/ready", "/metrics"])
_SKIP_PATHS = frozenset(["/api/v1/debug/log"])


def _jwt_role(request: Request) -> str:
    """Decode JWT payload (no verification) to extract role for logging."""
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return "anonymous"
    parts = auth.split(" ", 1)[1].split(".")
    if len(parts) != 3:
        return "anonymous"
    try:
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        claims = _json.loads(base64.urlsafe_b64decode(padded))
        return claims.get("role", "authenticated")
    except Exception:
        return "authenticated"


def _run_alembic_upgrade() -> bool:
    """Apply all pending Alembic migrations.

    This replaces the old ``Base.metadata.create_all`` + inline ALTER TABLE
    approach.  On a fresh database Alembic creates all tables via the initial
    migration.  On an existing database it applies only the delta.

    If Alembic fails, keep the process alive for logs/health inspection but do
    not report /ready as healthy. A stale schema can otherwise surface as 500s
    in normal API routes.
    """
    import subprocess
    import sys
    from pathlib import Path

    backend_dir = str(Path(__file__).resolve().parents[1])
    try:
        # Try alembic CLI first (works in Docker where python -m alembic may not)
        import shutil

        alembic_cmd = shutil.which("alembic")
        if alembic_cmd:
            cmd = [alembic_cmd, "upgrade", "head"]
        else:
            cmd = [sys.executable, "-m", "alembic", "upgrade", "head"]
        result = subprocess.run(
            cmd,
            cwd=backend_dir,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0:
            logger.info("[STARTUP] Alembic upgrade head succeeded")
            if result.stdout.strip():
                logger.debug("[STARTUP] Alembic stdout: %s", result.stdout.strip())
            return True
        else:
            logger.error(
                "[STARTUP] Alembic upgrade head failed (rc=%d): %s",
                result.returncode,
                result.stderr.strip(),
            )
            return False
    except subprocess.TimeoutExpired:
        logger.error("[STARTUP] Alembic upgrade head timed out after 30s")
        return False
    except Exception:
        logger.exception("[STARTUP] Alembic upgrade head raised an exception")
        return False


def _verify_token_blacklist_table() -> bool:
    """Fail readiness if JWT revocation storage is unavailable."""
    from app.bounded_contexts.identity.infrastructure.persistence.token_blacklist import (
        BlacklistedToken,
    )

    db = SessionLocal()
    try:
        db.execute(select(BlacklistedToken.id).limit(1))
        logger.info("[STARTUP] Token blacklist table verified")
        return True
    except Exception:
        db.rollback()
        logger.exception("[STARTUP] Token blacklist table is unavailable")
        return False
    finally:
        db.close()


def _update_plan_features() -> None:
    """Sync plan features in DB against PLAN_DEFAULTS (idempotent, safe to re-run)."""
    from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
        PLAN_DEFAULTS,
        ServicePlan,
    )  # local import to avoid circular deps

    plan_name_map = {"trial": "Trial", "basic": "Basic", "pro": "Pro", "enterprise": "Enterprise"}
    db = SessionLocal()
    try:
        for key, expected in PLAN_DEFAULTS.items():
            name = plan_name_map.get(key, key.capitalize())
            plan = db.scalar(select(ServicePlan).where(ServicePlan.name == name))
            if plan is None:
                continue
            if plan.features != expected:
                plan.features = expected
                db.commit()
                logger.info("[STARTUP] Synced features for plan '%s'", name)
    except Exception:
        db.rollback()
        logger.warning("[STARTUP] Plan feature sync skipped", exc_info=True)
    finally:
        db.close()


def _seed_device_types() -> None:
    """Seed default device types (idempotent, safe to re-run)."""
    from app.bounded_contexts.device_registry.infrastructure.persistence.device_type_models import (
        DeviceType,
    )

    default_types = [
        {
            "key": "esp32",
            "name": "ESP32",
            "description": "Espressif ESP32 dual-core Tensilica LX6",
            "default_hardware_model": "ESP32",
        },
        {
            "key": "esp32-s3",
            "name": "ESP32-S3",
            "description": "Espressif ESP32-S3 with AI acceleration",
            "default_hardware_model": "ESP32-S3",
        },
        {
            "key": "esp32-c3",
            "name": "ESP32-C3",
            "description": "Espressif ESP32-C3 RISC-V single-core",
            "default_hardware_model": "ESP32-C3",
        },
    ]
    db = SessionLocal()
    try:
        for dt in default_types:
            existing = db.scalar(select(DeviceType).where(DeviceType.key == dt["key"]))
            if existing is None:
                db.add(DeviceType(**dt))
                logger.info("[STARTUP] Seeded device type '%s'", dt["key"])
        db.commit()
    except Exception:
        db.rollback()
        logger.warning("[STARTUP] Device type seed skipped", exc_info=True)
    finally:
        db.close()


def _ensure_minio_bucket() -> None:
    """Create the firmware bucket in MinIO (with retry for slow container startup)."""
    import time as _time

    for attempt in range(3):
        try:
            minio_client.ensure_firmware_bucket()
            logger.info("[STARTUP] MinIO firmware bucket ensured")
            return
        except Exception:
            if attempt < 2:
                logger.info("[STARTUP] MinIO not ready, retrying in 3s (attempt %d/3)", attempt + 1)
                _time.sleep(3)
            else:
                logger.warning("[STARTUP] MinIO firmware bucket ensure failed after 3 attempts")


def _seed_startup_data() -> None:
    """Batch plan-feature sync + device-type seed into a single DB session."""
    from app.bounded_contexts.device_registry.infrastructure.persistence.device_type_models import (
        DeviceType,
    )
    from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
        PLAN_DEFAULTS,
        ServicePlan,
    )

    plan_name_map = {"trial": "Trial", "basic": "Basic", "pro": "Pro", "enterprise": "Enterprise"}
    default_device_types = [
        {
            "key": "esp32",
            "name": "ESP32",
            "description": "Espressif ESP32 dual-core Tensilica LX6",
            "default_hardware_model": "ESP32",
        },
        {
            "key": "esp32-s3",
            "name": "ESP32-S3",
            "description": "Espressif ESP32-S3 with AI acceleration",
            "default_hardware_model": "ESP32-S3",
        },
        {
            "key": "esp32-c3",
            "name": "ESP32-C3",
            "description": "Espressif ESP32-C3 RISC-V single-core",
            "default_hardware_model": "ESP32-C3",
        },
    ]

    db = SessionLocal()
    try:
        # Plan feature sync
        for key, expected in PLAN_DEFAULTS.items():
            name = plan_name_map.get(key, key.capitalize())
            plan = db.scalar(select(ServicePlan).where(ServicePlan.name == name))
            if plan is not None and plan.features != expected:
                plan.features = expected
                logger.info("[STARTUP] Synced features for plan '%s'", name)

        # Device type seeding
        for dt in default_device_types:
            existing = db.scalar(select(DeviceType).where(DeviceType.key == dt["key"]))
            if existing is None:
                db.add(DeviceType(**dt))
                logger.info("[STARTUP] Seeded device type '%s'", dt["key"])

        db.commit()
    except Exception:
        db.rollback()
        logger.warning("[STARTUP] Startup data seed skipped", exc_info=True)
    finally:
        db.close()


def _emit_startup_reconciled_events(db, devices) -> None:
    """Emit SSE events for devices marked offline during startup reconciliation."""
    from datetime import datetime, timezone

    from sqlalchemy import select

    from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
        TenantDeviceMapping,
    )
    from app.shared.infrastructure.messaging.device_status_events import DeviceStatusEvent

    now = datetime.now(timezone.utc).isoformat()
    for device in devices:
        mapping = db.scalar(
            select(TenantDeviceMapping).where(TenantDeviceMapping.device_id == device.id)
        )
        if mapping is None:
            continue
        event: DeviceStatusEvent = {
            "device_uid": device.device_uid,
            "tenant_id": str(mapping.tenant_id),
            "status": "offline",
            "last_seen_at": device.last_seen_at.isoformat() if device.last_seen_at else None,
            "timestamp": now,
        }
        device_status_bus.publish(event)


# Old _cleanup_expired_blacklisted_tokens deleted (responsibility moved to TokenCleanupTask background service)


_startup_complete = False

# ---------------------------------------------------------------------------
# DB readiness wait — handles DNS lag + Postgres not yet accepting connections
# ---------------------------------------------------------------------------

_DB_WAIT_TIMEOUT = 30  # seconds total
_DB_WAIT_INTERVAL = 2  # seconds between retries


def _wait_for_db() -> None:
    """Block until the database is reachable or timeout.

    Docker ``depends_on: condition: service_healthy`` should already guarantee
    this, but on Windows Docker Desktop DNS propagation between containers can
    lag behind the healthcheck.  A short retry loop prevents noisy Alembic/seed
    stack-traces caused by transient ``psycopg2.OperationalError``.
    """
    from sqlalchemy import text

    deadline = time.monotonic() + _DB_WAIT_TIMEOUT
    attempt = 0
    while True:
        attempt += 1
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            logger.info("[STARTUP] Database is reachable (attempt %d)", attempt)
            return
        except OperationalError as exc:
            db.rollback()
            # Covers: DNS failure, connection refused, auth not yet ready
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RuntimeError(
                    f"Database not reachable after {_DB_WAIT_TIMEOUT}s "
                    f"({_DB_WAIT_INTERVAL}s interval, last error: {exc})"
                ) from exc
            logger.info(
                "[STARTUP] Waiting for database… (%s) retrying in %ds (%.0fs left)",
                _summarise_operational_error(exc),
                _DB_WAIT_INTERVAL,
                remaining,
            )
            time.sleep(_DB_WAIT_INTERVAL)
        finally:
            db.close()


def _summarise_operational_error(exc: OperationalError) -> str:
    """Return a short one-line summary of a psycopg2 OperationalError."""
    orig = exc.orig
    if orig is not None:
        # psycopg2 errors have .pgcode and .pgerror; strerror on OSError
        msg = str(orig).split("\n")[0][:120]
        return msg
    return str(exc).split("\n")[0][:120]


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio as _asyncio

    global _startup_complete

    configure_logging()
    register_custom_collectors()

    # Wire the event bus to the running loop so MQTT worker threads can publish.
    device_status_bus.set_loop(_asyncio.get_running_loop())
    alert_bus.set_loop(_asyncio.get_running_loop())

    # Wait for the database to be reachable before running any DB operations.
    # This handles the Docker DNS / Postgres readiness race on Windows Desktop.
    await _asyncio.to_thread(_wait_for_db)

    # Apply schema migrations via Alembic — run in a thread so the event loop
    # is not blocked while migrations execute.
    migrations_ok = await _asyncio.to_thread(_run_alembic_upgrade)
    blacklist_ok = (
        await _asyncio.to_thread(_verify_token_blacklist_table) if migrations_ok else False
    )

    # Seed data (not schema — safe to re-run). Batch into one DB session.
    await _asyncio.to_thread(_seed_startup_data)

    # Start token cleanup background task (handles immediate run + periodic hourly runs)
    token_cleanup_task.start()

    # MinIO bucket creation — defer to background so startup is not blocked
    # if MinIO is slow to become ready.
    _asyncio.get_running_loop().run_in_executor(None, _ensure_minio_bucket)

    # Reconcile stale device statuses from previous runtime before accepting
    # new MQTT messages.  All devices that were "online" in the DB are marked
    # "offline" immediately.  They will return to "online" only after the
    # current runtime receives a fresh heartbeat / telemetry / status message.
    db = SessionLocal()
    try:
        reconciled = device_repository.reset_online_devices_on_startup_with_events(db)
        if reconciled:
            logger.info(
                "[STARTUP] Reconciled %d stale online device(s) to offline", len(reconciled)
            )
            _emit_startup_reconciled_events(db, reconciled)
        else:
            logger.info("[STARTUP] No stale online devices to reconcile")

        device_repository.sync_mosquitto_passwd(db)
        logger.info("[STARTUP] Mosquitto passwd file synchronized with device credentials")
    except Exception:
        db.rollback()
        logger.exception("[STARTUP] Device status reconciliation or passwd sync failed")
    finally:
        db.close()

    mdns_service.start()
    mqtt_subscriber.start()
    get_persistent_mqtt_client().start()
    device_presence_monitor.start()

    _startup_complete = migrations_ok and blacklist_ok
    if _startup_complete:
        logger.info("[STARTUP] All startup tasks completed — API is ready")
    else:
        logger.error("[STARTUP] Startup tasks completed but readiness checks failed")
    yield
    _startup_complete = False
    get_persistent_mqtt_client().stop()
    await token_cleanup_task.stop()
    device_status_bus.stop()
    alert_bus.stop()
    device_presence_monitor.stop()
    mqtt_subscriber.stop()
    mdns_service.stop()


limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.state.limiter = limiter

register_error_handlers(app)


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Please try again later."},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-CSRF-Token"],
)


_CSRF_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_CSRF_PUBLIC_PATHS = {"/api/v1/auth/login", "/api/v1/auth/register"}


@app.middleware("http")
async def _tenant_context_middleware(request: Request, call_next):
    import sys

    is_testing = "pytest" in sys.modules
    token_tenant = current_tenant_id_context.set(None)
    token_bypass = bypass_rls_context.set(is_testing)
    token_role = current_user_role_context.set("anonymous")
    try:
        response = await call_next(request)
        return response
    finally:
        current_tenant_id_context.reset(token_tenant)
        bypass_rls_context.reset(token_bypass)
        current_user_role_context.reset(token_role)


@app.middleware("http")
async def _csrf_middleware(request: Request, call_next):
    if request.method not in _CSRF_UNSAFE_METHODS or request.url.path in _CSRF_PUBLIC_PATHS:
        return await call_next(request)

    has_auth_cookie = bool(
        request.cookies.get(ACCESS_TOKEN_COOKIE) or request.cookies.get(REFRESH_TOKEN_COOKIE)
    )
    # Cookie credentials require CSRF verification even when a proxy strips
    # advisory browser headers such as Origin or Sec-Fetch-Site.
    if has_auth_cookie and not csrf_tokens_match(request):
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=403, content={"detail": "Invalid CSRF token"})

    return await call_next(request)


@app.middleware("http")
async def _enforce_https_middleware(request: Request, call_next):
    """Prevent fallback to HTTP for authentication routes in production."""
    if settings.app_env in {"production", "prod"}:
        # Auth routes handle sensitive credentials and cookies
        if request.url.path.startswith("/api/v1/auth/") and request.url.scheme != "https":
            from fastapi.responses import JSONResponse

            return JSONResponse(
                status_code=400,
                content={"detail": "Insecure connection: HTTPS required in production"},
            )

    return await call_next(request)


@app.middleware("http")
async def _security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    )
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
    )
    if settings.app_env in {"production", "prod"}:
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=63072000; includeSubDomains",
        )
    return response


@app.middleware("http")
async def _http_log_middleware(request: Request, call_next):
    path = request.url.path

    if request.method == "OPTIONS" or path in _SKIP_PATHS:
        return await call_next(request)

    is_health = path in _HEALTH_PATHS
    if is_health and not settings.log_healthchecks:
        return await call_next(request)

    if not settings.log_http:
        return await call_next(request)

    role = _jwt_role(request)
    start = time.perf_counter()
    response = await call_next(request)
    ms = int((time.perf_counter() - start) * 1000)

    code = response.status_code
    if code >= 500:
        logger.error("%s %s → %d %dms [%s]", request.method, path, code, ms, role)
    elif code >= 400:
        logger.warning("%s %s → %d %dms [%s]", request.method, path, code, ms, role)
    else:
        logger.info("%s %s → %d %dms [%s]", request.method, path, code, ms, role)
    return response


Instrumentator(
    should_group_status_codes=True,
    should_ignore_untemplated=True,
).instrument(app).expose(app, include_in_schema=False, tags=["Observability"])


@app.middleware("http")
async def _correlation_id_middleware(request: Request, call_next):
    """Inject or validate the X-Correlation-ID header.

    - Accepts: ^[A-Za-z0-9._:-]{1,128}$
    - Missing header  → generate UUID v4, count in CORRELATION_ID_GENERATED.
    - Invalid header  → generate UUID v4, count in CORRELATION_ID_INVALID.
                        The raw rejected value is NEVER logged.
    - Always resets the ContextVar in a finally block.
    - Adds X-Correlation-ID to the response (including 4xx and 5xx).

    Middleware ordering: this runs AFTER the CSRF and security-headers
    middleware (FastAPI processes middleware in reverse-addition order for
    the request phase). The correlation ID is available to all exception
    handlers and request loggers that run later in the chain.
    """
    return await correlation_id_middleware(request, call_next)


@app.middleware("http")
async def _restrict_metrics(request: Request, call_next):
    """Restrict /metrics to localhost in production."""
    if settings.app_env in {"production", "prod"} and request.url.path == "/metrics":
        client_host = request.client.host if request.client else ""
        if client_host not in ("127.0.0.1", "::1", "localhost"):
            from fastapi.responses import JSONResponse

            return JSONResponse(status_code=403, content={"detail": "Forbidden"})
    return await call_next(request)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "aifom-api"}


@app.get("/ready")
async def ready():
    from fastapi.responses import JSONResponse

    if not _startup_complete:
        return JSONResponse(
            status_code=503,
            content={"status": "starting", "service": "aifom-api"},
        )
    from app.core.readiness import readiness_probe

    return await readiness_probe.get_readiness()


# Trust reverse proxy headers (e.g. X-Forwarded-Proto) so request.url.scheme is correct.
# trusted_hosts="*" is used as the app is typically behind a Docker bridge/gateway.
# MUST be added last so it becomes the outermost middleware and runs first.

app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")

app.include_router(api_router, prefix="/api/v1")
