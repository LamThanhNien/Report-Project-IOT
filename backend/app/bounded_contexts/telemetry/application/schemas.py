"""Telemetry application schemas — re-exports from modules/telemetry/schema.

These are the Pydantic schemas for the telemetry bounded context.
Old import paths (app.modules.telemetry.schema) remain valid for backward compatibility.
"""

from app.modules.telemetry.schema import TelemetryCreate, TelemetryRead

__all__ = [
    "TelemetryCreate",
    "TelemetryRead",
]
