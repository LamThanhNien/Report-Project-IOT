"""Readiness probe for the Aifom backend.

Design principles:
- Per-component timeouts: each probe is wrapped in asyncio.wait_for so a
  hung dependency cannot block the overall readiness check indefinitely.
- Overall timeout: the full probe suite has an additional outer timeout.
- Single-flight + short cache: concurrent /ready requests share one probe
  execution; results are cached for CACHE_TTL seconds.
- Cache stores immutable data (tuples/dicts), never mutable response objects.
- Alembic multi-head: compares get_current_heads() vs get_heads() as sets.
- MQTT: prefers application client connection state over raw TCP reachability.
- MinIO: strictly bounded timeout via urllib3; configurable required/optional.

Operator notes:
- A blocked DB / MinIO / socket does NOT hold the readiness lock indefinitely.
- If a component times out, the lock is released and the probe returns a safe
  degraded/not_ready status.
- Required components: database, alembic, token_store.
- Optional (configurable): mqtt, minio.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import logging
import time
from pathlib import Path
from typing import Any, Dict, Tuple

from fastapi.responses import JSONResponse

from app.core.config import settings

# Alembic imports at module level so tests can patch app.core.readiness.X
try:
    from alembic.config import Config
    from alembic.migration import MigrationContext
    from alembic.script import ScriptDirectory
except ImportError:  # pragma: no cover
    Config = None  # type: ignore[misc,assignment]
    MigrationContext = None  # type: ignore[misc,assignment]
    ScriptDirectory = None  # type: ignore[misc,assignment]

# SQLAlchemy engine at module level for patching
try:
    from app.db.session import engine
except Exception:  # pragma: no cover
    engine = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Timeout configuration (seconds)
# ---------------------------------------------------------------------------
# Per-component timeouts — a stuck probe releases within this many seconds.
_COMPONENT_TIMEOUT = settings.readiness_component_timeout_seconds
# Overall readiness budget (all components combined).
_OVERALL_TIMEOUT = settings.readiness_overall_timeout_seconds
# Cache TTL: avoid hammering dependencies on every Kubernetes liveness ping.
_CACHE_TTL = settings.readiness_cache_ttl_seconds

_PROBE_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=6,
    thread_name_prefix="readiness",
)


class ReadinessProbe:
    def __init__(self) -> None:
        # _cache stores (timestamp, (status_code, content_dict))
        self._cache: Tuple[float, Tuple[int, Dict[str, Any]]] | None = None
        self._cache_ttl = _CACHE_TTL
        # _lock is lazily initialised in get_readiness() so it is always
        # bound to the current running event loop. This avoids "attached to a
        # different loop" errors when tests use asyncio.run() (which creates a
        # new loop) after the probe was originally instantiated.
        self._lock: asyncio.Lock | None = None
        self._sync_futures: dict[str, concurrent.futures.Future[bool]] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_readiness(self) -> JSONResponse:
        from app.core.metrics import READINESS_CACHE_HITS

        # Lazily create the lock in the current running event loop.
        if self._lock is None:
            self._lock = asyncio.Lock()

        now = time.monotonic()
        # Fast path — no lock required for cache reads
        if self._cache and (now - self._cache[0]) < self._cache_ttl:
            READINESS_CACHE_HITS.inc()
            status_code, content = self._cache[1]
            return JSONResponse(status_code=status_code, content=content)

        async with self._lock:
            # Double-check after acquiring the lock (another request may have
            # just populated the cache while we were waiting).
            now = time.monotonic()
            if self._cache and (now - self._cache[0]) < self._cache_ttl:
                READINESS_CACHE_HITS.inc()
                status_code, content = self._cache[1]
                return JSONResponse(status_code=status_code, content=content)

            try:
                status_code, content = await asyncio.wait_for(
                    self._run_all_probes_async(),
                    timeout=_OVERALL_TIMEOUT,
                )
            except asyncio.TimeoutError:
                logger.error(
                    "[READINESS] Overall probe timed out after %.0fs — returning not_ready",
                    _OVERALL_TIMEOUT,
                )
                status_code, content = (
                    503,
                    {
                        "status": "not_ready",
                        "components": {"error": "timeout"},
                    },
                )

            # Store immutable result data
            self._cache = (time.monotonic(), (status_code, content))
            return JSONResponse(status_code=status_code, content=content)

    # ------------------------------------------------------------------
    # Internal probe runner
    # ------------------------------------------------------------------

    async def _run_all_probes_async(self) -> Tuple[int, Dict[str, Any]]:
        from app.core.metrics import (
            READINESS_CHECKS,
            READINESS_COMPONENT_STATUS,
            READINESS_DURATION,
        )

        start = time.monotonic()

        # Run each probe with a per-component timeout.
        db_ok = await self._run_probe("database", self._check_db)
        alembic_ok = await self._run_probe("alembic", self._check_alembic)
        token_ok = await self._run_probe("token_store", self._check_token_blacklist)
        mqtt_ok = await self._run_probe("mqtt", self._check_mqtt)
        minio_ok = await self._run_probe("minio", self._check_minio)

        checks: Dict[str, str] = {
            "database": "ok" if db_ok else "down",
            "alembic": "ok" if alembic_ok else "down",
            "token_store": "ok" if token_ok else "down",
            "mqtt": "ok" if mqtt_ok else "down",
            "minio": "ok" if minio_ok else "down",
        }

        # Record per-component status metrics
        for component, component_status in checks.items():
            READINESS_COMPONENT_STATUS.labels(component=component).set(
                1 if component_status == "ok" else 0
            )

        required_down = False
        if not db_ok or not alembic_ok or not token_ok:
            required_down = True
        if settings.require_mqtt_for_readiness and not mqtt_ok:
            required_down = True
        if settings.require_minio_for_readiness and not minio_ok:
            required_down = True

        status_code = 503 if required_down else 200
        overall = (
            "not_ready" if required_down else ("degraded" if "down" in checks.values() else "ready")
        )

        READINESS_CHECKS.labels(outcome=overall).inc()
        READINESS_DURATION.observe(time.monotonic() - start)

        return status_code, {"status": overall, "components": checks}

    async def _run_probe(self, name: str, fn) -> bool:
        """Run a single probe with a per-component timeout.

        Returns False on timeout or exception; never raises.
        """
        from app.core.metrics import READINESS_TIMEOUTS

        existing = self._sync_futures.get(name)
        if existing is not None and not existing.done():
            logger.warning("[READINESS] Component '%s' still running after prior timeout", name)
            READINESS_TIMEOUTS.labels(component=name).inc()
            return False
        if existing is not None:
            self._sync_futures.pop(name, None)

        future = _PROBE_EXECUTOR.submit(fn)
        self._sync_futures[name] = future
        try:
            result = await asyncio.wait_for(
                asyncio.wrap_future(future),
                timeout=_COMPONENT_TIMEOUT,
            )
            self._sync_futures.pop(name, None)
            return bool(result)
        except asyncio.TimeoutError:
            logger.warning(
                "[READINESS] Component '%s' timed out after %.0fs",
                name,
                _COMPONENT_TIMEOUT,
            )
            READINESS_TIMEOUTS.labels(component=name).inc()
            return False
        except Exception:
            logger.warning(
                "[READINESS] Component '%s' probe raised unexpectedly", name, exc_info=True
            )
            return False

    # ------------------------------------------------------------------
    # Individual probe implementations
    # ------------------------------------------------------------------

    def _check_db(self) -> bool:
        """Check database reachability with SELECT 1."""
        from sqlalchemy import text

        from app.db.session import SessionLocal

        try:
            with SessionLocal() as db:
                db.execute(text("SELECT 1"))
            return True
        except Exception as e:
            logger.warning("[READINESS] DB check failed: %s", type(e).__name__)
            return False

    def _check_alembic(self) -> bool:
        """Verify the database schema is at the expected Alembic revision(s).

        Supports multiple heads (e.g., merge migrations). Compares
        get_current_heads() (DB) vs get_heads() (scripts) as sets.
        Resolves alembic.ini relative to the backend directory.
        """
        # Uses module-level imports (Config, MigrationContext, ScriptDirectory, engine)
        # so tests can patch them as app.core.readiness.X

        try:
            # Resolve alembic.ini from the backend directory, not process cwd.
            backend_dir = Path(__file__).resolve().parents[2]
            alembic_ini = backend_dir / "alembic.ini"

            with engine.connect() as conn:
                context = MigrationContext.configure(conn)
                current_heads: set = set(context.get_current_heads())

            config = Config(str(alembic_ini))
            # Ensure Alembic finds migration scripts relative to the ini file.
            config.set_main_option("script_location", str(backend_dir / "alembic"))
            script = ScriptDirectory.from_config(config)
            expected_heads: set = set(script.get_heads())

            if not expected_heads:
                logger.warning("[READINESS] Alembic: no expected heads found in script directory")
                return False

            if current_heads == expected_heads:
                return True
            logger.warning(
                "[READINESS] Alembic heads mismatch: expected=%s current=%s",
                sorted(expected_heads),
                sorted(current_heads),
            )
            return False
        except Exception as e:
            logger.warning("[READINESS] Alembic check failed: %s", type(e).__name__)
            return False

    def _check_token_blacklist(self) -> bool:
        """Verify the token_blacklist table is accessible."""
        from sqlalchemy import text

        from app.db.session import SessionLocal

        try:
            with SessionLocal() as db:
                db.execute(text("SELECT 1 FROM blacklisted_tokens LIMIT 1"))
            return True
        except Exception as e:
            logger.warning("[READINESS] Token blacklist check failed: %s", type(e).__name__)
            return False

    def _check_mqtt(self) -> bool:
        """Check MQTT health.

        Prefers the application MQTT client connection state (authenticated).
        Falls back to TCP reachability (exposed internally as tcp_reachable)
        if the application client is not yet initialised.

        Public readiness output contains only safe status codes (ok / down).
        """
        # The subscriber flips this state only after Paho's authenticated
        # on_connect callback succeeds. TCP reachability alone is insufficient.
        try:
            from app.main import mqtt_subscriber

            return mqtt_subscriber.is_connected
        except Exception as e:
            logger.warning("[READINESS] MQTT application-state check failed: %s", type(e).__name__)
            return False

    def _check_minio(self) -> bool:
        """Check MinIO bucket existence with a strict timeout."""
        try:
            import urllib3
            from minio import Minio

            client = Minio(
                settings.minio_endpoint,
                access_key=settings.minio_access_key,
                secret_key=settings.minio_secret_key,
                secure=settings.minio_secure,
                http_client=urllib3.PoolManager(
                    timeout=urllib3.Timeout(connect=1.0, read=2.0),
                    retries=False,
                ),
            )
            return client.bucket_exists(settings.minio_bucket_firmware)
        except Exception as e:
            logger.warning("[READINESS] MinIO check failed: %s", type(e).__name__)
            return False



readiness_probe = ReadinessProbe()
