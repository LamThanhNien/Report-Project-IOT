import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_uid: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    hardware_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    mac_address: Mapped[str | None] = mapped_column(String(17), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    firmware_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="offline")
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    rssi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    free_heap: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uptime_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_status_payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    device_type_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_types.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    platform_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_platforms.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    device_model_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_models.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenant_projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    model_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    mqtt_username: Mapped[str | None] = mapped_column(
        String(128), unique=True, index=True, nullable=True
    )
    mqtt_password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    auth_token_hash: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )
    # NOTE: Python attr "metadata_" maps to DB column "metadata".
    # Do NOT rename to "metadata" — that is a reserved SQLAlchemy attribute.
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True, default=dict)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    offline_timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    tenant = relationship("Tenant", foreign_keys=[tenant_id], lazy="select")
    project = relationship("TenantProject", foreign_keys=[project_id], lazy="select")
    platform = relationship("DevicePlatform", foreign_keys=[platform_id], lazy="select")
    device_model = relationship("DeviceModel", foreign_keys=[device_model_id], lazy="select")

    telemetry_records = relationship(
        "Telemetry", back_populates="device", cascade="all, delete-orphan"
    )
