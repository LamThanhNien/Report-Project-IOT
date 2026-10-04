"""Rule Engine ORM models."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class AutomationRule(Base):
    __tablename__ = "automation_rules"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    severity: Mapped[str] = mapped_column(String(32), nullable=False, default="warning")
    cooldown_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=300)
    trigger_type: Mapped[str] = mapped_column(String(64), nullable=False, default="telemetry")
    target_scope: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    condition_logic: Mapped[str] = mapped_column(String(8), nullable=False, default="and")
    conditions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    condition_config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    actions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    last_triggered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class TelemetryFieldDefinition(Base):
    __tablename__ = "telemetry_field_definitions"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "project_id",
            "device_type",
            "field_key",
            name="uq_telemetry_field_definition_scope",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True, index=True
    )
    device_type: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    field_key: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    data_type: Mapped[str] = mapped_column(String(32), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(32), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now
    )


class AutomationRuleExecution(Base):
    __tablename__ = "automation_rule_executions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("automation_rules.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    trigger_type: Mapped[str] = mapped_column(String(64), nullable=False)
    matched: Mapped[bool] = mapped_column(Boolean, nullable=False)
    event_payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    evaluated_fields: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    matched_conditions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    failed_conditions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    action_preview: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    executed_actions: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
