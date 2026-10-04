"""Firmware OTA application schemas.

Re-exports Pydantic schemas from legacy modules.
"""

from app.modules.firmware.schema import (
    FirmwareCreate,
    FirmwareFromSourceRequest,
    FirmwareRead,
)
from app.modules.ota.schema import OtaJobCreate, OtaJobCreateResponse, OtaJobRead

__all__ = [
    "FirmwareCreate",
    "FirmwareFromSourceRequest",
    "FirmwareRead",
    "OtaJobCreate",
    "OtaJobCreateResponse",
    "OtaJobRead",
]
