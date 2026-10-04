import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class FirmwareVersion(Base):
    __tablename__ = "firmware_versions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    version: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_device_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_platform_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_platforms.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    target_model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_models.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    object_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checksum_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    release_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # "binary" | "ino_source" | "ino_compiled"
    source_type: Mapped[str] = mapped_column(String(20), nullable=False, default="binary")
    source_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    board_fqbn: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # NULL = uploaded by admin (platform-wide); non-NULL = tenant-owned firmware
    uploaded_by_tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="uploaded")
    release_channel: Mapped[str | None] = mapped_column(String(32), nullable=True)
    signature: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_alg: Mapped[str | None] = mapped_column(String(32), nullable=True)
    signature_payload: Mapped[str | None] = mapped_column(String(64), nullable=True)
    signing_key_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    signing_public_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    quarantined_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)

    platform = relationship("DevicePlatform", foreign_keys=[target_platform_id], lazy="select")
    device_model = relationship("DeviceModel", foreign_keys=[target_model_id], lazy="select")


class TenantFirmware(Base):
    __tablename__ = "tenant_firmwares"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    version: Mapped[str] = mapped_column(String(32), nullable=False)
    hardware_model: Mapped[str] = mapped_column(String(64), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ProjectFirmwareReference(Base):
    __tablename__ = "project_firmware_references"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenant_projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    firmware_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenant_firmwares.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
