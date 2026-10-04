import logging

from prometheus_client import Counter, Gauge, Histogram, REGISTRY
from prometheus_client.core import GaugeMetricFamily
from prometheus_client.registry import Collector

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Helpers to safely register metrics (idempotent across test imports / reloads)
# ---------------------------------------------------------------------------


def _counter(name: str, doc: str, labels: list[str] | None = None) -> Counter:
    try:
        if labels:
            return Counter(name, doc, labels)
        return Counter(name, doc)
    except ValueError:
        # Already registered — retrieve from registry
        return REGISTRY._names_to_collectors.get(name)  # type: ignore[return-value]


def _histogram(name: str, doc: str, labels: list[str] | None = None, buckets=None) -> Histogram:
    kwargs: dict = {}
    if labels:
        kwargs["labelnames"] = labels
    if buckets:
        kwargs["buckets"] = buckets
    try:
        return Histogram(name, doc, **kwargs)
    except ValueError:
        return REGISTRY._names_to_collectors.get(name)  # type: ignore[return-value]


def _gauge(name: str, doc: str, labels: list[str] | None = None) -> Gauge:
    try:
        return Gauge(name, doc, labels or [])
    except ValueError:
        return REGISTRY._names_to_collectors.get(name)  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Telemetry / MQTT
# ---------------------------------------------------------------------------

TELEMETRY_INGESTED = _counter(
    "aifom_telemetry_ingested_total",
    "Total telemetry messages ingested from MQTT",
)

MQTT_MESSAGES = _counter(
    "aifom_mqtt_messages_total",
    "Total MQTT messages received by topic type",
    ["topic_type"],
)

# ---------------------------------------------------------------------------
# OTA
# ---------------------------------------------------------------------------

OTA_JOBS_CREATED = _counter(
    "aifom_ota_jobs_total",
    "Total OTA jobs created",
)

OTA_JOBS_BY_STATUS = _counter(
    "aifom_ota_jobs_by_status_total",
    "OTA jobs completed by final status",
    ["status"],
)

# ---------------------------------------------------------------------------
# Token cleanup
# ---------------------------------------------------------------------------

TOKEN_CLEANUP = _counter(
    "aifom_token_cleanup_total",
    "Total blacklisted token cleanup runs by outcome",
    ["outcome"],
)

LEGACY_REFRESH_TOKEN_ACCEPTED = _counter(
    "aifom_legacy_refresh_token_accepted_total",
    "Total legacy refresh tokens accepted during the bounded JWT migration window",
)

# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

AUDIT_LOG_EVENTS = _counter(
    "aifom_audit_log_events_total",
    "Total audit log events by outcome",
    ["outcome"],
)

AUDIT_REDACTION = _counter(
    "aifom_audit_redaction_total",
    "Total audit fields redacted",
)

AUDIT_TRUNCATION = _counter(
    "aifom_audit_truncation_total",
    "Total audit payloads truncated due to size limits",
)

# ---------------------------------------------------------------------------
# Readiness
# ---------------------------------------------------------------------------

READINESS_CHECKS = _counter(
    "aifom_readiness_checks_total",
    "Total readiness checks by outcome",
    ["outcome"],
)

READINESS_CACHE_HITS = _counter(
    "aifom_readiness_cache_hits_total",
    "Total readiness responses served from cache",
)

READINESS_TIMEOUTS = _counter(
    "aifom_readiness_timeouts_total",
    "Total readiness probe component timeouts",
    ["component"],
)

READINESS_COMPONENT_STATUS = _gauge(
    "aifom_readiness_component_up",
    "Current readiness state for each component (1=up, 0=down)",
    ["component"],
)

READINESS_DURATION = _histogram(
    "aifom_readiness_duration_seconds",
    "Overall readiness probe duration in seconds",
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
)

# ---------------------------------------------------------------------------
# Correlation ID
# ---------------------------------------------------------------------------

CORRELATION_ID_GENERATED = _counter(
    "aifom_correlation_id_generated_total",
    "Total correlation IDs generated (missing from request)",
)

CORRELATION_ID_INVALID = _counter(
    "aifom_correlation_id_invalid_total",
    "Total correlation IDs rejected as invalid (bad format/injection)",
)

# ---------------------------------------------------------------------------
# MQTT publishing
# ---------------------------------------------------------------------------

MQTT_PUBLISH_CORRELATION = _counter(
    "aifom_mqtt_publish_correlation_total",
    "Total MQTT messages published with correlation metadata by source",
    ["source"],
)


# ---------------------------------------------------------------------------
# Device status collector (custom gauge)
# ---------------------------------------------------------------------------


class _DeviceStatusCollector(Collector):
    """Queries DB on each Prometheus scrape to expose fresh device gauges."""

    def collect(self):
        from sqlalchemy import func, select

        from app.db.session import SessionLocal
        from app.modules.devices.model import Device

        total = online = 0
        db = SessionLocal()
        try:
            total = db.scalar(select(func.count()).select_from(Device)) or 0
            online = (
                db.scalar(select(func.count()).select_from(Device).where(Device.status == "online"))
                or 0
            )
            db.commit()
        except Exception:
            db.rollback()
            logger.warning("DeviceStatusCollector: DB query failed")
        finally:
            db.close()

        offline = total - online

        g = GaugeMetricFamily("aifom_devices_total", "Total registered devices")
        g.add_metric([], total)
        yield g

        g = GaugeMetricFamily("aifom_devices_online", "Devices currently online")
        g.add_metric([], online)
        yield g

        g = GaugeMetricFamily("aifom_devices_offline", "Devices currently offline")
        g.add_metric([], offline)
        yield g


def register_custom_collectors() -> None:
    try:
        REGISTRY.register(_DeviceStatusCollector())
    except ValueError:
        pass  # already registered (dev reload / test re-run)
