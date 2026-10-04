"""Firmware OTA domain entities.

Re-exports ORM models from the legacy modules so the bounded context
can reference them through a single import path.
"""

from app.modules.firmware.model import FirmwareVersion
from app.modules.firmware.model_profiles import FirmwareProfile
from app.modules.ota.model import OtaJob
from app.modules.ota.model_campaigns import OtaCampaign, OtaCampaignTarget, OtaJobEvent

__all__ = [
    "FirmwareVersion",
    "FirmwareProfile",
    "OtaJob",
    "OtaCampaign",
    "OtaCampaignTarget",
    "OtaJobEvent",
]
