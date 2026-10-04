from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class OtaCampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    firmware_id: UUID
    tenant_id: UUID | None = None
    target_scope: str = Field(pattern="^(all|device_group|device_model|selected_devices)$")
    target_ids: list[str] = Field(default_factory=list)
    rollout_strategy: str = Field(pattern="^(all_at_once|phased|canary)$")
    rollout_percentages: list[int] | None = None
    max_concurrent_updates: int | None = Field(default=None, ge=1, le=1000)
    retry_limit: int | None = Field(default=None, ge=0, le=10)
    rollback_threshold: int | None = Field(default=None, ge=1, le=100)
    maintenance_window_start: str | None = Field(
        default=None, pattern="^(?:[01]\\d|2[0-3]):[0-5]\\d$"
    )
    maintenance_window_end: str | None = Field(
        default=None, pattern="^(?:[01]\\d|2[0-3]):[0-5]\\d$"
    )
    scheduled_at: datetime | None = None

    @field_validator("rollout_percentages")
    @classmethod
    def validate_rollout(cls, value: list[int] | None) -> list[int] | None:
        if value is None:
            return None
        if not value or value[-1] != 100 or value != sorted(set(value)):
            raise ValueError("rollout_percentages must be unique, ascending, and end at 100")
        if any(item < 1 or item > 100 for item in value):
            raise ValueError("rollout percentages must be between 1 and 100")
        return value

    @model_validator(mode="after")
    def validate_targets(self):
        if self.target_scope != "all" and not self.target_ids:
            raise ValueError("target_ids are required for this target_scope")
        return self


class OtaCampaignUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    max_concurrent_updates: int | None = Field(default=None, ge=1, le=1000)
    retry_limit: int | None = Field(default=None, ge=0, le=10)
    rollback_threshold: int | None = Field(default=None, ge=1, le=100)
    maintenance_window_start: str | None = Field(
        default=None, pattern="^(?:[01]\\d|2[0-3]):[0-5]\\d$"
    )
    maintenance_window_end: str | None = Field(
        default=None, pattern="^(?:[01]\\d|2[0-3]):[0-5]\\d$"
    )
    scheduled_at: datetime | None = None


class OtaCampaignRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID | None
    name: str
    firmware_id: UUID
    firmware_version: str
    target_scope: str
    target_ids: list[str]
    rollout_strategy: str
    rollout_percentages: list[int]
    current_phase: int
    status: str
    max_concurrent_updates: int
    retry_limit: int
    rollback_threshold: int
    maintenance_window_start: str | None
    maintenance_window_end: str | None
    scheduled_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    total_targets: int
    pending_count: int
    running_count: int
    success_count: int
    failed_count: int
    skipped_count: int
    failure_rate: float
    last_error: str | None
