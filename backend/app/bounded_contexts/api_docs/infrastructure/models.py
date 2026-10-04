import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ApiDocOverride(Base):
    __tablename__ = "api_doc_overrides"
    __table_args__ = (
        UniqueConstraint("operation_id", name="uq_api_doc_overrides_operation_id"),
        CheckConstraint(
            "method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')",
            name="ck_api_doc_overrides_method",
        ),
        CheckConstraint(
            "api_status in ('active', 'deprecated', 'experimental')",
            name="ck_api_doc_overrides_api_status",
        ),
        CheckConstraint(
            "access_level in ('public', 'user', 'admin')",
            name="ck_api_doc_overrides_access_level",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    operation_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    method: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    path: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description_override: Mapped[str | None] = mapped_column(Text, nullable=True)
    api_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="active", index=True
    )
    access_level: Mapped[str] = mapped_column(
        String(32), nullable=False, default="user", index=True
    )
    owner: Mapped[str | None] = mapped_column(String(120), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )
