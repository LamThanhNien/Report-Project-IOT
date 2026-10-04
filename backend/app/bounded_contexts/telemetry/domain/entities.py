"""Telemetry domain entities — re-exports from modules/telemetry models.

These are the canonical ORM models for the telemetry bounded context.
Old import paths (app.modules.telemetry.model, app.modules.telemetry.model_extended)
remain valid for backward compatibility.
"""

from app.modules.telemetry.model import Telemetry
from app.modules.telemetry.model_extended import DeviceHealth, DeviceStatusEvent, TelemetrySchema

__all__ = [
    "Telemetry",
    "TelemetrySchema",
    "DeviceStatusEvent",
    "DeviceHealth",
]
