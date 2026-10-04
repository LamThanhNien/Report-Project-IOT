"""Device Group ORM models."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class DeviceGroup(Base):
    __tablename__ = "device_groups"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_device_groups_tenant_name"),
        CheckConstraint(
            "group_type IN ('manual', 'dynamic', 'tag_based')",
            name="chk_device_groups_group_type",
        ),
        CheckConstraint("status IN ('active', 'archived')", name="chk_device_groups_status"),
        Index("idx_device_groups_tenant_id", "tenant_id"),
        Index("idx_device_groups_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    group_type: Mapped[str] = mapped_column(String(32), nullable=False, default="manual")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    tags: Mapped[list | None] = mapped_column(JSONB, server_default="[]")
    extra_metadata: Mapped[dict | None] = mapped_column(JSONB, server_default="{}")
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    members = relationship(
        "DeviceGroupMember", back_populates="group", cascade="all, delete-orphan"
    )


class DeviceGroupMember(Base):
    __tablename__ = "device_group_members"
    __table_args__ = (
        UniqueConstraint(
            "group_id",
            "device_id",
            name="uq_device_group_members_group_device",
        ),
        Index("idx_device_group_members_group_id", "group_id"),
        Index("idx_device_group_members_device_id", "device_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_groups.id", ondelete="CASCADE"),
        nullable=False,
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
    )
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    added_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    group = relationship("DeviceGroup", back_populates="members")
