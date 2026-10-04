"""Shared metrics.

Re-exports from app.core.metrics for use within the shared/infrastructure layer.
"""

from app.core.metrics import (
    MQTT_MESSAGES,
    OTA_JOBS_BY_STATUS,
    OTA_JOBS_CREATED,
    TELEMETRY_INGESTED,
    register_custom_collectors,
)

__all__ = [
    "MQTT_MESSAGES",
    "OTA_JOBS_BY_STATUS",
    "OTA_JOBS_CREATED",
    "TELEMETRY_INGESTED",
    "register_custom_collectors",
]
