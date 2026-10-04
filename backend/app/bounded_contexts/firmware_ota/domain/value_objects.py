"""Firmware OTA domain value objects."""

from enum import Enum


class OtaJobStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    STARTED = "started"
    ACCEPTED = "accepted"
    DOWNLOADING = "downloading"
    FLASHING = "flashing"
    APPLYING = "applying"
    REBOOTING = "rebooting"
    SUCCESS = "success"
    FAILED = "failed"

    @property
    def is_terminal(self) -> bool:
        return self in {OtaJobStatus.SUCCESS, OtaJobStatus.FAILED}


class CampaignStatus(str, Enum):
    DRAFT = "draft"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

    @property
    def is_terminal(self) -> bool:
        return self in {
            CampaignStatus.COMPLETED,
            CampaignStatus.FAILED,
            CampaignStatus.CANCELLED,
        }


class CampaignTargetStatus(str, Enum):
    PENDING = "pending"
    NOTIFIED = "notified"
    DOWNLOADING = "downloading"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


class FirmwareSourceType(str, Enum):
    BINARY = "binary"
    INO_SOURCE = "ino_source"
    INO_COMPILED = "ino_compiled"


class FirmwareStatus(str, Enum):
    UPLOADED = "uploaded"
    VALIDATING = "validating"
    APPROVED = "approved"
    PRODUCTION = "production"
    DEPRECATED = "deprecated"
    QUARANTINED = "quarantined"
