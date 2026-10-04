import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

FEATURE_KEYS: list[str] = [
    "device_management",
    "ota_update",
    "firmware_history",
    "telemetry_view",
    "advanced_monitoring",
    "alert_management",
    "api_access",
    "user_management",
    "audit_log",
]

PLAN_DEFAULTS: dict[str, dict[str, bool]] = {
    "trial": {
        "device_management": True,
        "ota_update": False,
        "firmware_history": False,
        "telemetry_view": True,
        "advanced_monitoring": False,
        "alert_management": True,
        "api_access": False,
        "user_management": True,
        "audit_log": False,
    },
    "basic": {
        "device_management": True,
        "ota_update": False,
        "firmware_history": True,
        "telemetry_view": True,
        "advanced_monitoring": True,
        "alert_management": True,
        "api_access": False,
        "user_management": True,
        "audit_log": False,
    },
    "pro": {
        "device_management": True,
        "ota_update": True,
        "firmware_history": True,
        "telemetry_view": True,
        "advanced_monitoring": True,
        "alert_management": True,
        "api_access": True,
        "user_management": True,
        "audit_log": True,
    },
    "enterprise": {k: True for k in FEATURE_KEYS},
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ServicePlan(Base):
    __tablename__ = "service_plans"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    max_devices: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    max_users: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    telemetry_retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    features: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    tenants: Mapped[list["Tenant"]] = relationship("Tenant", back_populates="plan")


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("service_plans.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )

    plan: Mapped["ServicePlan | None"] = relationship("ServicePlan", back_populates="tenants")
    feature_overrides: Mapped[list["TenantFeatureOverride"]] = relationship(
        "TenantFeatureOverride", back_populates="tenant", cascade="all, delete-orphan"
    )
    device_mappings: Mapped[list["TenantDeviceMapping"]] = relationship(
        "TenantDeviceMapping", back_populates="tenant", cascade="all, delete-orphan"
    )


class TenantFeatureOverride(Base):
    __tablename__ = "tenant_feature_overrides"
    __table_args__ = (UniqueConstraint("tenant_id", "feature_name", name="uq_tenant_feature"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    feature_name: Mapped[str] = mapped_column(String(64), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False)

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="feature_overrides")


class TenantDeviceMapping(Base):
    __tablename__ = "tenant_device_mappings"
    __table_args__ = (UniqueConstraint("device_id", name="uq_tenant_device_mappings_device_id"),)

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        primary_key=True,
    )
    device_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        primary_key=True,
    )

    tenant: Mapped["Tenant"] = relationship("Tenant", back_populates="device_mappings")
