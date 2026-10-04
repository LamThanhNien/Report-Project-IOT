import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TelemetrySchema(Base):
    __tablename__ = "telemetry_schemas"
    __table_args__ = (
        UniqueConstraint("device_type_id", "schema_version", name="uq_telemetry_schema_version"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_type_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_types.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    schema_version: Mapped[str] = mapped_column(String(64), nullable=False)
    fields: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    device_type = relationship("DeviceType", back_populates="telemetry_schemas")


class DeviceStatusEvent(Base):
    """Time-series record of device status transitions.

    This table may be converted to a TimescaleDB hypertable in production.
    It has no database-level primary key — this is intentional for hypertable
    compatibility.  SQLAlchemy needs a PK hint for ORM operations, so we use
    a composite of (time, device_id).
    """

    __tablename__ = "device_status_events"
    __table_args__ = {"comment": "Time-series device status transitions (may be hypertable)"}

    # Hypertable-compatible: no DB-level PK, but SQLAlchemy needs a PK hint.
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        primary_key=True,
    )
    device_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    firmware_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)


class DeviceHealth(Base):
    """Time-series device health metrics.

    This table may be converted to a TimescaleDB hypertable in production.
    It has no database-level primary key — this is intentional for hypertable
    compatibility.  SQLAlchemy needs a PK hint for ORM operations, so we use
    a composite of (time, device_id).
    """

    __tablename__ = "device_health"
    __table_args__ = {"comment": "Time-series device health metrics (may be hypertable)"}

    # Hypertable-compatible: no DB-level PK, but SQLAlchemy needs a PK hint.
    time: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        primary_key=True,
    )
    device_uid: Mapped[str] = mapped_column(String(128), nullable=False)
    free_heap: Mapped[int | None] = mapped_column(nullable=True)
    uptime_ms: Mapped[int | None] = mapped_column(nullable=True)
    wifi_rssi: Mapped[int | None] = mapped_column(nullable=True)
    cpu_temp: Mapped[float | None] = mapped_column(nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
