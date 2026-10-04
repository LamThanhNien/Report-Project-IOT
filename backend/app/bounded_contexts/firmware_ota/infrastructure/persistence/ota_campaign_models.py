import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


CAMPAIGN_STATUS_DRAFT = "draft"
CAMPAIGN_STATUS_SCHEDULED = "scheduled"
CAMPAIGN_STATUS_RUNNING = "running"
CAMPAIGN_STATUS_PAUSED = "paused"
CAMPAIGN_STATUS_COMPLETED = "completed"
CAMPAIGN_STATUS_FAILED = "failed"
CAMPAIGN_STATUS_CANCELLED = "cancelled"

CAMPAIGN_STATUS_VALUES = {
    CAMPAIGN_STATUS_DRAFT,
    CAMPAIGN_STATUS_SCHEDULED,
    CAMPAIGN_STATUS_RUNNING,
    CAMPAIGN_STATUS_PAUSED,
    CAMPAIGN_STATUS_COMPLETED,
    CAMPAIGN_STATUS_FAILED,
    CAMPAIGN_STATUS_CANCELLED,
}

CAMPAIGN_TERMINAL_STATUSES = {
    CAMPAIGN_STATUS_COMPLETED,
    CAMPAIGN_STATUS_FAILED,
    CAMPAIGN_STATUS_CANCELLED,
}

TARGET_STATUS_PENDING = "pending"
TARGET_STATUS_NOTIFIED = "notified"
TARGET_STATUS_DOWNLOADING = "downloading"
TARGET_STATUS_SUCCESS = "success"
TARGET_STATUS_FAILED = "failed"
TARGET_STATUS_SKIPPED = "skipped"

TARGET_STATUS_VALUES = {
    TARGET_STATUS_PENDING,
    TARGET_STATUS_NOTIFIED,
    TARGET_STATUS_DOWNLOADING,
    TARGET_STATUS_SUCCESS,
    TARGET_STATUS_FAILED,
    TARGET_STATUS_SKIPPED,
}


class OtaCampaign(Base):
    __tablename__ = "ota_campaigns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenant_projects.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    firmware_version_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("firmware_versions.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_type: Mapped[str] = mapped_column(String(32), nullable=False, default="devices")
    target_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    strategy: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    rollout_percentages: Mapped[list] = mapped_column(JSONB, nullable=False, default=lambda: [100])
    current_phase: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=CAMPAIGN_STATUS_DRAFT)
    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    total_targets: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    success_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_concurrent_updates: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    retry_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    rollback_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    maintenance_window_start: Mapped[str | None] = mapped_column(String(5), nullable=True)
    maintenance_window_end: Mapped[str | None] = mapped_column(String(5), nullable=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    targets = relationship(
        "OtaCampaignTarget", back_populates="campaign", cascade="all, delete-orphan"
    )


class OtaCampaignTarget(Base):
    __tablename__ = "ota_campaign_targets"
    __table_args__ = (UniqueConstraint("campaign_id", "device_id", name="uq_campaign_device"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ota_campaigns.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
    )
    ota_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ota_jobs.id", ondelete="SET NULL"),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=TARGET_STATUS_PENDING)
    phase: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    campaign = relationship("OtaCampaign", back_populates="targets")


class OtaJobEvent(Base):
    __tablename__ = "ota_job_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ota_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("ota_jobs.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    old_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    new_status: Mapped[str] = mapped_column(String(32), nullable=False)
    progress: Mapped[int | None] = mapped_column(nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
