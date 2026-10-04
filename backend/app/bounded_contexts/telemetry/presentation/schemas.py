from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TelemetryCreate(BaseModel):
    device_uid: str = Field(min_length=1, max_length=128)
    timestamp: datetime
    metric_name: str = Field(min_length=1, max_length=128)
    metric_value: float
    unit: str | None = Field(default=None, max_length=32)
    raw_payload: dict | None = None

    @field_validator("timestamp")
    @classmethod
    def reject_future_timestamp(cls, v: datetime) -> datetime:
        """Reject timestamps more than 5 minutes in the future."""
        now = datetime.now(timezone.utc)
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        if v > now:
            from datetime import timedelta

            if (v - now) > timedelta(minutes=5):
                raise ValueError("Timestamp cannot be more than 5 minutes in the future")
        return v


class TelemetryRead(BaseModel):
    id: UUID
    device_id: UUID
    device_uid: str
    timestamp: datetime
    metric_name: str
    metric_value: float
    unit: str | None
    raw_payload: dict | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
