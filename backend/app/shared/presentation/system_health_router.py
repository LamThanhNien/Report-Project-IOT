"""System health endpoint with per-component status checks.

Provides a single endpoint that checks the health of all infrastructure
components: API, PostgreSQL, MQTT broker, and MinIO storage.

Used by the frontend System Health page to show real-time component status.
Requires admin authentication to prevent infrastructure reconnaissance.
"""

from __future__ import annotations

import logging
import socket
import time
from dataclasses import dataclass, asdict
from enum import Enum

from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.core.config import settings
from app.core.security import require_admin
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)
router = APIRouter()


class ComponentStatus(str, Enum):
    HEALTHY = "healthy"
    DEGRADED = "degraded"
    DOWN = "down"
    UNKNOWN = "unknown"


@dataclass
class ComponentHealth:
    status: ComponentStatus
    latency_ms: int | None = None
    detail: str | None = None


@dataclass
class SystemHealthResponse:
    api: ComponentHealth
    database: ComponentHealth
    mqtt: ComponentHealth
    storage: ComponentHealth
    overall: ComponentStatus
    timestamp: str

    def to_dict(self) -> dict:
        from datetime import datetime, timezone

        return {
            "api": asdict(self.api),
            "database": asdict(self.database),
            "mqtt": asdict(self.mqtt),
            "storage": asdict(self.storage),
            "overall": self.overall.value,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }


def _check_api() -> ComponentHealth:
    """API is healthy if this endpoint is reachable."""
    return ComponentHealth(status=ComponentStatus.HEALTHY, detail="FastAPI responding")


def _check_database() -> ComponentHealth:
    """Check PostgreSQL connectivity with a simple query."""
    start = time.monotonic()
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        latency = int((time.monotonic() - start) * 1000)
        return ComponentHealth(
            status=ComponentStatus.HEALTHY,
            latency_ms=latency,
            detail="PostgreSQL + TimescaleDB connected",
        )
    except Exception as exc:
        db.rollback()
        logger.warning("[HEALTH] Database check failed: %s", exc)
        return ComponentHealth(
            status=ComponentStatus.DOWN,
            detail=f"Connection failed: {type(exc).__name__}",
        )
    finally:
        db.close()


def _check_mqtt() -> ComponentHealth:
    """Check MQTT broker connectivity via TCP socket probe."""
    host = settings.mqtt_host
    port = settings.mqtt_port
    try:
        start = time.monotonic()
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        try:
            sock.connect((host, port))
            latency = int((time.monotonic() - start) * 1000)
            return ComponentHealth(
                status=ComponentStatus.HEALTHY,
                latency_ms=latency,
                detail=f"MQTT broker reachable at {host}:{port}",
            )
        finally:
            sock.close()
    except (socket.timeout, ConnectionRefusedError, OSError) as exc:
        logger.warning("[HEALTH] MQTT check failed: %s", exc)
        return ComponentHealth(
            status=ComponentStatus.DOWN,
            detail=f"Broker unreachable at {host}:{port}",
        )


def _check_storage() -> ComponentHealth:
    """Check MinIO storage connectivity."""
    try:
        from minio import Minio
        import urllib3

        start = time.monotonic()
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
        bucket = settings.minio_bucket_firmware
        exists = client.bucket_exists(bucket)
        latency = int((time.monotonic() - start) * 1000)
        if exists:
            return ComponentHealth(
                status=ComponentStatus.HEALTHY,
                latency_ms=latency,
                detail=f"MinIO connected, bucket '{bucket}' exists",
            )
        else:
            return ComponentHealth(
                status=ComponentStatus.DEGRADED,
                latency_ms=latency,
                detail=f"MinIO connected but bucket '{bucket}' missing",
            )
    except Exception as exc:
        logger.warning("[HEALTH] Storage check failed: %s", exc)
        return ComponentHealth(
            status=ComponentStatus.DOWN,
            detail=f"MinIO connection failed: {type(exc).__name__}",
        )


def _overall_status(components: list[ComponentHealth]) -> ComponentStatus:
    """Determine overall status from component statuses."""
    statuses = {c.status for c in components}
    if ComponentStatus.DOWN in statuses:
        return ComponentStatus.DOWN
    if ComponentStatus.DEGRADED in statuses:
        return ComponentStatus.DEGRADED
    if statuses == {ComponentStatus.HEALTHY}:
        return ComponentStatus.HEALTHY
    return ComponentStatus.UNKNOWN


@router.get("/system-health", dependencies=[Depends(require_admin)])
def get_system_health() -> dict:
    """Check health of all infrastructure components.

    Returns per-component status with latency measurements.
    Used by the frontend System Health page.
    Requires admin authentication to prevent infrastructure reconnaissance.
    """
    api = _check_api()
    database = _check_database()
    mqtt = _check_mqtt()
    storage = _check_storage()

    overall = _overall_status([api, database, mqtt, storage])

    response = SystemHealthResponse(
        api=api,
        database=database,
        mqtt=mqtt,
        storage=storage,
        overall=overall,
        timestamp="",
    )
    return response.to_dict()
