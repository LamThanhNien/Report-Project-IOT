import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Double,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TenantProject(Base):
    __tablename__ = "tenant_projects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    pages: Mapped[list["ProjectPage"]] = relationship(
        "ProjectPage",
        back_populates="project",
        cascade="all, delete-orphan",
        order_by="ProjectPage.sort_order",
    )


class ProjectPage(Base):
    __tablename__ = "project_pages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenant_projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, default="main")
    sort_order: Mapped[int] = mapped_column(default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    project: Mapped["TenantProject"] = relationship("TenantProject", back_populates="pages")
    widgets: Mapped[list["ProjectWidget"]] = relationship(
        "ProjectWidget",
        back_populates="page",
        cascade="all, delete-orphan",
        order_by="ProjectWidget.sort_order",
    )


class ProjectWidget(Base):
    __tablename__ = "project_widgets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("project_pages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    widget_type: Mapped[str] = mapped_column(String(32), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    sort_order: Mapped[int] = mapped_column(default=0, nullable=False)
    layout: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    binding: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    page: Mapped["ProjectPage"] = relationship("ProjectPage", back_populates="widgets")


class DeviceCapability(Base):
    __tablename__ = "device_capabilities"
    __table_args__ = (
        UniqueConstraint("device_id", "capability_key", name="uq_device_capability_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    capability_key: Mapped[str] = mapped_column(String(128), nullable=False)
    capability_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    gpio_pin: Mapped[int | None] = mapped_column(Integer, nullable=True)
    channel: Mapped[str | None] = mapped_column(String(64), nullable=True)
    command_name: Mapped[str] = mapped_column(String(64), nullable=False)
    telemetry_state_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_bindable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    config_json: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_project_member"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenant_projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="project_viewer")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class TenantDatastream(Base):
    """Virtual Pin (Datastream) cấu hình cho mỗi Project.

    Mỗi Datastream đại diện cho một kênh dữ liệu ảo (V0-V255)
    dùng để giao tiếp giữa Web Dashboard và thiết bị ESP32.
    """

    __tablename__ = "tenant_datastreams"
    __table_args__ = (UniqueConstraint("project_id", "pin", name="uq_project_datastream_pin"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("tenant_projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    alias: Mapped[str] = mapped_column(String(255), nullable=False)
    pin: Mapped[int] = mapped_column(Integer, nullable=False)  # 0-255 = V0-V255
    data_type: Mapped[str] = mapped_column(
        String(64), nullable=False, default="double"
    )  # integer | double | string
    direction: Mapped[str] = mapped_column(String(16), nullable=False, default="bidirectional")
    unit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    min_value: Mapped[float | None] = mapped_column(Double, nullable=True)
    max_value: Mapped[float | None] = mapped_column(Double, nullable=True)
    default_value: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_custom: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class DatastreamTemplateCompatibility(Base):
    """Bảng map tương thích giữa Datastream (Virtual Pin) và Bo mạch (DeviceModel)."""

    __tablename__ = "datastream_template_compatibilities"
    __table_args__ = (
        UniqueConstraint(
            "datastream_id", "device_model_id", name="uq_datastream_model_compatibility"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    datastream_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("tenant_datastreams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_model_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("device_models.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    channel: Mapped[str] = mapped_column(String(64), nullable=False)  # e.g., "v3"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
