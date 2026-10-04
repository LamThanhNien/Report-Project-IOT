import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


JOB_STATUS_PENDING = "pending"
JOB_STATUS_SENT = "sent"
JOB_STATUS_STARTED = "started"
JOB_STATUS_ACCEPTED = "accepted"
JOB_STATUS_DOWNLOADING = "downloading"
JOB_STATUS_FLASHING = "flashing"
JOB_STATUS_APPLYING = "applying"
JOB_STATUS_REBOOTING = "rebooting"
JOB_STATUS_SUCCESS = "success"
JOB_STATUS_FAILED = "failed"

JOB_STATUS_VALUES = {
    JOB_STATUS_PENDING,
    JOB_STATUS_SENT,
    JOB_STATUS_STARTED,
    JOB_STATUS_ACCEPTED,
    JOB_STATUS_DOWNLOADING,
    JOB_STATUS_FLASHING,
    JOB_STATUS_APPLYING,
    JOB_STATUS_REBOOTING,
    JOB_STATUS_SUCCESS,
    JOB_STATUS_FAILED,
}

JOB_TERMINAL_STATUSES = {JOB_STATUS_SUCCESS, JOB_STATUS_FAILED}


class OtaJob(Base):
    __tablename__ = "ota_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    firmware_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("firmware_versions.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ota_campaigns.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    previous_firmware_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=JOB_STATUS_PENDING)
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    progress: Mapped[int | None] = mapped_column(nullable=True)
    last_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    device = relationship("Device")
    firmware_version = relationship("FirmwareVersion")


class UsedOtaToken(Base):
    __tablename__ = "used_ota_tokens"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    jti: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    device_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
