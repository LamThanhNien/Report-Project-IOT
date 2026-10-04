from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    organization_name: Mapped[str] = mapped_column(String(255), nullable=False, default="AIFOM Lab")
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Ho_Chi_Minh")
    default_locale: Mapped[str] = mapped_column(String(16), nullable=False, default="vi")
    email_notifications_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    auto_update_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    maintenance_window_start: Mapped[str] = mapped_column(
        String(5), nullable=False, default="02:00"
    )
    maintenance_window_end: Mapped[str] = mapped_column(String(5), nullable=False, default="05:00")
    rollback_threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    max_concurrent_updates: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    ota_retry_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    allowed_release_channels: Mapped[list] = mapped_column(
        JSON, nullable=False, default=lambda: ["dev", "staging", "stable"]
    )
    require_signed_stable_firmware: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    firmware_retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=180)
    firmware_min_versions_per_target: Mapped[int] = mapped_column(
        Integer, nullable=False, default=3
    )
    public_site_config: Mapped[dict] = mapped_column(
        JSON, nullable=False, default=dict, server_default="{}"
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
