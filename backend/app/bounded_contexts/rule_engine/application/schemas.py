"""Rule Engine API schemas."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


DataType = Literal["number", "string", "boolean", "enum"]
TriggerType = Literal[
    "telemetry",
    "device_event",
    "device_status",
    "ota",
    "model_inference",
    "schedule",
]
ActionType = Literal[
    "create_alert", "send_command", "mqtt_publish", "call_webhook", "create_audit_event"
]


class RuleCondition(BaseModel):
    field: str = Field(..., min_length=1, max_length=255)
    operator: str = Field(..., min_length=1, max_length=32)
    value: Any = None
    data_type: DataType = "number"


class RuleAction(BaseModel):
    type: ActionType
    config: dict[str, Any] = Field(default_factory=dict)


class RuleTargetScope(BaseModel):
    scope_type: Literal["all_devices", "device", "group", "device_type"] = "all_devices"
    device_id: UUID | None = None
    group_id: UUID | None = None
    device_type: str | None = None
    project_id: UUID | None = None


class AutomationRuleBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    enabled: bool = True
    severity: Literal["info", "warning", "critical"] = "warning"
    cooldown_seconds: int = Field(default=300, ge=0, le=86400)
    trigger_type: TriggerType = "telemetry"
    target_scope: RuleTargetScope = Field(default_factory=RuleTargetScope)
    condition_logic: Literal["and", "or"] = "and"
    conditions: list[RuleCondition] = Field(default_factory=list)
    condition_config: dict[str, Any] = Field(default_factory=dict)
    actions: list[RuleAction] = Field(default_factory=list)
    project_id: UUID | None = None

    @field_validator("conditions")
    @classmethod
    def validate_conditions(cls, value: list[RuleCondition]) -> list[RuleCondition]:
        if len(value) > 50:
            raise ValueError("A rule can contain at most 50 conditions")
        return value

    @field_validator("actions")
    @classmethod
    def validate_actions(cls, value: list[RuleAction]) -> list[RuleAction]:
        if len(value) > 20:
            raise ValueError("A rule can contain at most 20 actions")
        return value


class AutomationRuleCreate(AutomationRuleBase):
    pass


class AutomationRuleUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    enabled: bool | None = None
    severity: Literal["info", "warning", "critical"] | None = None
    cooldown_seconds: int | None = Field(default=None, ge=0, le=86400)
    trigger_type: TriggerType | None = None
    target_scope: RuleTargetScope | None = None
    condition_logic: Literal["and", "or"] | None = None
    conditions: list[RuleCondition] | None = None
    condition_config: dict[str, Any] | None = None
    actions: list[RuleAction] | None = None
    project_id: UUID | None = None


class AutomationRuleResponse(AutomationRuleBase):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    last_triggered_at: datetime | None
    created_at: datetime
    updated_at: datetime


class FieldDefinitionCreate(BaseModel):
    project_id: UUID | None = None
    device_type: str | None = Field(default=None, max_length=128)
    field_key: str = Field(..., min_length=1, max_length=255)
    display_name: str = Field(..., min_length=1, max_length=255)
    data_type: DataType
    unit: str | None = Field(default=None, max_length=32)
    description: str | None = None


class FieldDefinitionResponse(FieldDefinitionCreate):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tenant_id: UUID
    created_at: datetime
    updated_at: datetime


class RuleTestRequest(BaseModel):
    rule: AutomationRuleBase
    event: dict[str, Any] = Field(default_factory=dict)


class RuleTestResponse(BaseModel):
    matched: bool
    evaluated_fields: dict[str, Any]
    matched_conditions: list[dict[str, Any]]
    failed_conditions: list[dict[str, Any]]
    action_preview: list[dict[str, Any]]
    rendered_placeholders: dict[str, Any]


class RuleExecutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    rule_id: UUID | None
    tenant_id: UUID
    device_id: UUID | None
    trigger_type: str
    matched: bool
    event_payload: dict[str, Any]
    evaluated_fields: dict[str, Any]
    matched_conditions: list[dict[str, Any]]
    failed_conditions: list[dict[str, Any]]
    action_preview: list[dict[str, Any]]
    executed_actions: list[dict[str, Any]]
    error_message: str | None
    created_at: datetime


class RuleStatsResponse(BaseModel):
    total_rules: int
    enabled_rules: int
    disabled_rules: int
    executions_24h: int
    matched_24h: int
    failed_24h: int


class RuleTemplateResponse(BaseModel):
    id: str
    name: str
    description: str
    rule: AutomationRuleBase
