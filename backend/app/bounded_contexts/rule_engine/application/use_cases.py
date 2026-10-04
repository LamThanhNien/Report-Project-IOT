"""Rule Engine use cases."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.bounded_contexts.command_center.application.schemas import CommandDispatchRequest
from app.bounded_contexts.command_center.application.use_cases import CommandCenterUseCases
from app.bounded_contexts.device_groups.infrastructure.persistence.models import DeviceGroupMember
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
from app.bounded_contexts.rule_engine.application.schemas import (
    AutomationRuleCreate,
    AutomationRuleUpdate,
    FieldDefinitionCreate,
    RuleTemplateResponse,
    RuleTestResponse,
)
from app.bounded_contexts.rule_engine.domain.evaluator import (
    MISSING,
    evaluate_conditions,
    resolve_path,
)
from app.bounded_contexts.rule_engine.infrastructure.persistence.models import (
    AutomationRule,
    AutomationRuleExecution,
    TelemetryFieldDefinition,
)
from app.bounded_contexts.telemetry.infrastructure.persistence.alert_models import Alert
from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
    TenantDeviceMapping,
)
from app.modules.audit import service as audit_service


PLACEHOLDER_RE = re.compile(r"\{([^{}]+)\}")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class RuleEngineUseCases:
    def __init__(self, db: Session):
        self.db = db

    def _validate_rule_data(
        self, tenant_id: uuid.UUID, data: AutomationRuleCreate | AutomationRuleUpdate
    ) -> None:
        project_id = getattr(data, "project_id", None)
        if not project_id and getattr(data, "target_scope", None):
            project_id = data.target_scope.project_id
        if project_id:
            from app.bounded_contexts.project_dashboard.infrastructure.persistence.models import (
                TenantProject,
            )

            proj = (
                self.db.query(TenantProject)
                .filter(TenantProject.id == project_id, TenantProject.tenant_id == tenant_id)
                .first()
            )
            if not proj:
                raise ValueError("Project not found or not accessible")

        target_scope = getattr(data, "target_scope", None)
        if target_scope:
            if target_scope.device_id:
                from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
                    TenantDeviceMapping,
                )

                mapping = (
                    self.db.query(TenantDeviceMapping)
                    .filter(
                        TenantDeviceMapping.device_id == target_scope.device_id,
                        TenantDeviceMapping.tenant_id == tenant_id,
                    )
                    .first()
                )
                if not mapping:
                    raise ValueError("Device not found or not accessible")
            if target_scope.group_id:
                from app.bounded_contexts.device_groups.infrastructure.persistence.models import (
                    DeviceGroup,
                )

                group = (
                    self.db.query(DeviceGroup)
                    .filter(
                        DeviceGroup.id == target_scope.group_id, DeviceGroup.tenant_id == tenant_id
                    )
                    .first()
                )
                if not group:
                    raise ValueError("Device group not found or not accessible")
            if target_scope.project_id:
                from app.bounded_contexts.project_dashboard.infrastructure.persistence.models import (
                    TenantProject,
                )

                proj = (
                    self.db.query(TenantProject)
                    .filter(
                        TenantProject.id == target_scope.project_id,
                        TenantProject.tenant_id == tenant_id,
                    )
                    .first()
                )
                if not proj:
                    raise ValueError("Project not found or not accessible")

        actions = getattr(data, "actions", None)
        if actions:
            for action in actions:
                action_type = None
                config = {}
                if isinstance(action, dict):
                    action_type = action.get("type")
                    config = action.get("config") or {}
                else:
                    action_type = action.type
                    config = action.config or {}

                if action_type == "send_command":
                    target_device_id = config.get("target_device_id")
                    target_group_id = config.get("target_group_id")

                    if target_device_id:
                        try:
                            td_id = uuid.UUID(str(target_device_id))
                        except ValueError:
                            raise ValueError("Invalid target_device_id format")
                        from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
                            TenantDeviceMapping,
                        )

                        mapping = (
                            self.db.query(TenantDeviceMapping)
                            .filter(
                                TenantDeviceMapping.device_id == td_id,
                                TenantDeviceMapping.tenant_id == tenant_id,
                            )
                            .first()
                        )
                        if not mapping:
                            raise ValueError("Target device not found or not accessible")

                    if target_group_id:
                        try:
                            tg_id = uuid.UUID(str(target_group_id))
                        except ValueError:
                            raise ValueError("Invalid target_group_id format")
                        from app.bounded_contexts.device_groups.infrastructure.persistence.models import (
                            DeviceGroup,
                        )

                        group = (
                            self.db.query(DeviceGroup)
                            .filter(DeviceGroup.id == tg_id, DeviceGroup.tenant_id == tenant_id)
                            .first()
                        )
                        if not group:
                            raise ValueError("Target device group not found or not accessible")

    def create_rule(
        self, tenant_id: uuid.UUID, data: AutomationRuleCreate, created_by: uuid.UUID | None
    ) -> AutomationRule:
        self._validate_rule_data(tenant_id, data)
        rule = AutomationRule(
            tenant_id=tenant_id,
            project_id=data.project_id or data.target_scope.project_id,
            name=data.name,
            description=data.description,
            enabled=data.enabled,
            severity=data.severity,
            cooldown_seconds=data.cooldown_seconds,
            trigger_type=data.trigger_type,
            target_scope=data.target_scope.model_dump(mode="json"),
            condition_logic=data.condition_logic,
            conditions=[condition.model_dump(mode="json") for condition in data.conditions],
            condition_config=data.condition_config,
            actions=[action.model_dump(mode="json") for action in data.actions],
            created_by=created_by,
        )
        self.db.add(rule)
        self.db.commit()
        self.db.refresh(rule)
        return rule

    def update_rule(
        self, tenant_id: uuid.UUID, rule_id: uuid.UUID, data: AutomationRuleUpdate
    ) -> AutomationRule | None:
        rule = self.get_rule(tenant_id, rule_id)
        if rule is None:
            return None
        self._validate_rule_data(tenant_id, data)
        updates = data.model_dump(exclude_unset=True, mode="json")
        for key, value in updates.items():
            if key == "target_scope" and value is not None:
                setattr(rule, key, value)
            elif key == "conditions" and value is not None:
                setattr(rule, key, value)
            elif key == "actions" and value is not None:
                setattr(rule, key, value)
            else:
                setattr(rule, key, value)
        if data.target_scope is not None and data.project_id is None:
            rule.project_id = data.target_scope.project_id
        self.db.commit()
        self.db.refresh(rule)
        return rule

    def list_rules(
        self, tenant_id: uuid.UUID, project_id: uuid.UUID | None = None
    ) -> list[AutomationRule]:
        stmt = select(AutomationRule).where(AutomationRule.tenant_id == tenant_id)
        if project_id:
            stmt = stmt.where(AutomationRule.project_id == project_id)
        stmt = stmt.order_by(AutomationRule.created_at.desc())
        return self.db.execute(stmt).scalars().all()

    def get_rule(self, tenant_id: uuid.UUID, rule_id: uuid.UUID) -> AutomationRule | None:
        return self.db.scalar(
            select(AutomationRule).where(
                AutomationRule.id == rule_id,
                AutomationRule.tenant_id == tenant_id,
            )
        )

    def delete_rule(self, tenant_id: uuid.UUID, rule_id: uuid.UUID) -> bool:
        rule = self.get_rule(tenant_id, rule_id)
        if rule is None:
            return False
        self.db.delete(rule)
        self.db.commit()
        return True

    def set_rule_enabled(
        self, tenant_id: uuid.UUID, rule_id: uuid.UUID, enabled: bool
    ) -> AutomationRule | None:
        rule = self.get_rule(tenant_id, rule_id)
        if rule is None:
            return None
        rule.enabled = enabled
        self.db.commit()
        self.db.refresh(rule)
        return rule

    def duplicate_rule(
        self, tenant_id: uuid.UUID, rule_id: uuid.UUID, created_by: uuid.UUID | None
    ) -> AutomationRule | None:
        source = self.get_rule(tenant_id, rule_id)
        if source is None:
            return None
        copy = AutomationRule(
            tenant_id=tenant_id,
            project_id=source.project_id,
            name=f"{source.name} (copy)",
            description=source.description,
            enabled=False,
            severity=source.severity,
            cooldown_seconds=source.cooldown_seconds,
            trigger_type=source.trigger_type,
            target_scope=source.target_scope or {},
            condition_logic=source.condition_logic,
            conditions=source.conditions or [],
            condition_config=source.condition_config or {},
            actions=source.actions or [],
            created_by=created_by,
        )
        self.db.add(copy)
        self.db.commit()
        self.db.refresh(copy)
        return copy

    def list_executions(
        self, tenant_id: uuid.UUID, limit: int = 50, offset: int = 0
    ) -> list[AutomationRuleExecution]:
        return (
            self.db.execute(
                select(AutomationRuleExecution)
                .where(AutomationRuleExecution.tenant_id == tenant_id)
                .order_by(AutomationRuleExecution.created_at.desc())
                .offset(offset)
                .limit(limit)
            )
            .scalars()
            .all()
        )

    def stats(self, tenant_id: uuid.UUID) -> dict[str, int]:
        since = utc_now() - timedelta(hours=24)

        rule_stats = self.db.execute(
            select(
                func.count(AutomationRule.id).label("total"),
                func.count(AutomationRule.id)
                .filter(AutomationRule.enabled.is_(True))
                .label("enabled"),
            ).where(AutomationRule.tenant_id == tenant_id)
        ).first()

        exec_stats = self.db.execute(
            select(
                func.count(AutomationRuleExecution.id).label("total"),
                func.count(AutomationRuleExecution.id)
                .filter(AutomationRuleExecution.matched.is_(True))
                .label("matched"),
                func.count(AutomationRuleExecution.id)
                .filter(AutomationRuleExecution.error_message.is_not(None))
                .label("failed"),
            ).where(
                AutomationRuleExecution.tenant_id == tenant_id,
                AutomationRuleExecution.created_at >= since,
            )
        ).first()

        total_rules = rule_stats.total if rule_stats else 0
        enabled_rules = rule_stats.enabled if rule_stats else 0

        return {
            "total_rules": int(total_rules),
            "enabled_rules": int(enabled_rules),
            "disabled_rules": int(total_rules) - int(enabled_rules),
            "executions_24h": int(exec_stats.total if exec_stats else 0),
            "matched_24h": int(exec_stats.matched if exec_stats else 0),
            "failed_24h": int(exec_stats.failed if exec_stats else 0),
        }

    def templates(self) -> list[RuleTemplateResponse]:
        return [
            RuleTemplateResponse(
                id="generic-threshold-alert",
                name="Generic threshold alert",
                description="Editable example for comparing any tenant-defined field path to a threshold.",
                rule={
                    "name": "Generic threshold alert",
                    "description": "Example only. Replace field, threshold, and message before saving.",
                    "enabled": True,
                    "severity": "warning",
                    "cooldown_seconds": 300,
                    "trigger_type": "telemetry",
                    "target_scope": {"scope_type": "all_devices"},
                    "condition_logic": "and",
                    "conditions": [
                        {
                            "field": "custom.any_nested_field",
                            "operator": ">",
                            "value": 50,
                            "data_type": "number",
                        }
                    ],
                    "condition_config": {},
                    "actions": [
                        {
                            "type": "create_alert",
                            "config": {
                                "title": "{rule_name}",
                                "message": "Device {device_name} reported {field_value}",
                                "severity": "warning",
                            },
                        }
                    ],
                },
            ),
            RuleTemplateResponse(
                id="custom-command",
                name="Custom command automation",
                description="Editable example for sending a tenant-defined command with a custom payload.",
                rule={
                    "name": "Custom command automation",
                    "description": "Example only. Replace command and payload before saving.",
                    "enabled": True,
                    "severity": "warning",
                    "cooldown_seconds": 300,
                    "trigger_type": "telemetry",
                    "target_scope": {"scope_type": "all_devices"},
                    "condition_logic": "and",
                    "conditions": [
                        {
                            "field": "custom.any_nested_field",
                            "operator": "exists",
                            "value": None,
                            "data_type": "string",
                        }
                    ],
                    "condition_config": {},
                    "actions": [
                        {
                            "type": "send_command",
                            "config": {
                                "command": "custom_command_name",
                                "payload": {
                                    "source": "automation",
                                    "rule_id": "{rule_id}",
                                    "trigger_value": "{field_value}",
                                },
                            },
                        }
                    ],
                },
            ),
            RuleTemplateResponse(
                id="custom-mqtt-publish",
                name="Custom MQTT publish",
                description="Editable dry-run example for a tenant-namespaced MQTT publish action.",
                rule={
                    "name": "Custom MQTT publish",
                    "description": "Example only. Topic must stay under tenants/{tenant_id}/.",
                    "enabled": True,
                    "severity": "info",
                    "cooldown_seconds": 300,
                    "trigger_type": "telemetry",
                    "target_scope": {"scope_type": "all_devices"},
                    "condition_logic": "and",
                    "conditions": [
                        {
                            "field": "custom.any_nested_field",
                            "operator": "exists",
                            "value": None,
                            "data_type": "string",
                        }
                    ],
                    "condition_config": {},
                    "actions": [
                        {
                            "type": "mqtt_publish",
                            "config": {
                                "topic": "tenants/{tenant_id}/automation/events",
                                "payload": {"rule_id": "{rule_id}", "value": "{field_value}"},
                            },
                        }
                    ],
                },
            ),
            RuleTemplateResponse(
                id="command-result-notification",
                name="Command result notification",
                description="Create an alert when a device reports a successful command result.",
                rule={
                    "name": "Command result notification",
                    "description": "Notify when a project control command is confirmed by the device.",
                    "enabled": True,
                    "severity": "info",
                    "cooldown_seconds": 0,
                    "trigger_type": "device_event",
                    "target_scope": {"scope_type": "all_devices"},
                    "condition_logic": "and",
                    "conditions": [
                        {
                            "field": "event.event",
                            "operator": "==",
                            "value": "command_result",
                            "data_type": "string",
                        },
                        {
                            "field": "event.status",
                            "operator": "==",
                            "value": "success",
                            "data_type": "string",
                        },
                    ],
                    "condition_config": {},
                    "actions": [
                        {
                            "type": "create_alert",
                            "config": {
                                "title": "Device command confirmed",
                                "message": "Device {device_name} confirmed {event.type} on GPIO {event.gpio_pin}: {event.message}",
                                "severity": "info",
                            },
                        }
                    ],
                },
            ),
        ]

    def create_field_definition(
        self, tenant_id: uuid.UUID, data: FieldDefinitionCreate
    ) -> TelemetryFieldDefinition:
        field = TelemetryFieldDefinition(
            tenant_id=tenant_id,
            project_id=data.project_id,
            device_type=data.device_type,
            field_key=data.field_key,
            display_name=data.display_name,
            data_type=data.data_type,
            unit=data.unit,
            description=data.description,
        )
        self.db.add(field)
        self.db.commit()
        self.db.refresh(field)
        return field

    def list_field_definitions(self, tenant_id: uuid.UUID) -> list[TelemetryFieldDefinition]:
        return (
            self.db.execute(
                select(TelemetryFieldDefinition)
                .where(TelemetryFieldDefinition.tenant_id == tenant_id)
                .order_by(TelemetryFieldDefinition.field_key.asc())
            )
            .scalars()
            .all()
        )

    def suggest_fields(self, tenant_id: uuid.UUID, device_id: uuid.UUID | None = None) -> list[str]:
        stmt = (
            select(Device.last_status_payload)
            .join(TenantDeviceMapping, TenantDeviceMapping.device_id == Device.id)
            .where(TenantDeviceMapping.tenant_id == tenant_id)
            .where(Device.last_status_payload.is_not(None))
            .limit(100)
        )
        if device_id is not None:
            stmt = stmt.where(Device.id == device_id)
        keys: set[str] = set()
        for payload in self.db.execute(stmt).scalars().all():
            if isinstance(payload, dict):
                keys.update(_flatten_keys(payload))
        keys.update(field.field_key for field in self.list_field_definitions(tenant_id))
        return sorted(keys)

    def test_rule(self, tenant_id: uuid.UUID, data) -> RuleTestResponse:
        event = self._normalize_event(data.event)
        matched, passed, failed, evaluated = evaluate_conditions(
            event,
            [condition.model_dump(mode="json") for condition in data.rule.conditions],
            data.rule.condition_logic,
        )
        context = self._placeholder_context(
            tenant_id=tenant_id,
            rule=data.rule,
            event=event,
            evaluated=evaluated,
        )
        preview = [
            self._render_action(action.model_dump(mode="json"), context)
            for action in data.rule.actions
        ]
        return RuleTestResponse(
            matched=matched,
            evaluated_fields=evaluated,
            matched_conditions=[result.as_dict() for result in passed],
            failed_conditions=[result.as_dict() for result in failed],
            action_preview=preview,
            rendered_placeholders=context,
        )

    def evaluate_enabled_rules_for_telemetry(
        self,
        tenant_id: uuid.UUID,
        device: Device,
        payload: dict[str, Any],
    ) -> list[AutomationRuleExecution]:
        event = self._normalize_event(
            {
                **payload,
                "tenant_id": str(tenant_id),
                "device_id": str(device.id),
                "device_name": device.name,
                "device_uid": device.device_uid,
                "telemetry": payload,
                "event": payload,
            }
        )
        rules = (
            self.db.execute(
                select(AutomationRule).where(
                    AutomationRule.tenant_id == tenant_id,
                    AutomationRule.enabled.is_(True),
                    AutomationRule.trigger_type == "telemetry",
                )
            )
            .scalars()
            .all()
        )
        executions: list[AutomationRuleExecution] = []
        for rule in rules:
            if not self._rule_targets_device(rule, device):
                continue
            if self._is_in_cooldown(rule):
                continue
            execution = self._evaluate_rule(rule, event, tenant_id, device)
            executions.append(execution)
        if executions:
            self.db.commit()
        return executions

    def evaluate_enabled_rules_for_device_event(
        self,
        tenant_id: uuid.UUID,
        device: Device,
        payload: dict[str, Any],
    ) -> list[AutomationRuleExecution]:
        event = self._normalize_event(
            {
                **payload,
                "tenant_id": str(tenant_id),
                "device_id": str(device.id),
                "device_name": device.name,
                "device_uid": device.device_uid,
                "event": payload,
            }
        )
        rules = (
            self.db.execute(
                select(AutomationRule).where(
                    AutomationRule.tenant_id == tenant_id,
                    AutomationRule.enabled.is_(True),
                    AutomationRule.trigger_type == "device_event",
                )
            )
            .scalars()
            .all()
        )
        executions: list[AutomationRuleExecution] = []
        for rule in rules:
            if not self._rule_targets_device(rule, device):
                continue
            if self._is_in_cooldown(rule):
                continue
            execution = self._evaluate_rule(rule, event, tenant_id, device)
            executions.append(execution)
        if executions:
            self.db.commit()
        return executions

    def evaluate_enabled_rules_for_device_status(
        self,
        tenant_id: uuid.UUID,
        device: Device,
    ) -> list[AutomationRuleExecution]:
        event = self._normalize_event(
            {
                "tenant_id": str(tenant_id),
                "device_id": str(device.id),
                "device_name": device.name,
                "device_uid": device.device_uid,
                "status": device.status,
                "ip_address": device.ip_address,
                "firmware_version": device.firmware_version,
                "rssi": device.rssi,
                "event": {
                    "type": "device_status_changed",
                    "status": device.status,
                },
            }
        )
        rules = (
            self.db.execute(
                select(AutomationRule).where(
                    AutomationRule.tenant_id == tenant_id,
                    AutomationRule.enabled.is_(True),
                    AutomationRule.trigger_type == "device_status",
                )
            )
            .scalars()
            .all()
        )
        executions: list[AutomationRuleExecution] = []
        for rule in rules:
            if not self._rule_targets_device(rule, device):
                continue
            if self._is_in_cooldown(rule):
                continue
            execution = self._evaluate_rule(rule, event, tenant_id, device)
            executions.append(execution)
        if executions:
            self.db.commit()
        return executions

    def _evaluate_rule(
        self,
        rule: AutomationRule,
        event: dict[str, Any],
        tenant_id: uuid.UUID,
        device: Device | None,
    ) -> AutomationRuleExecution:
        matched, passed, failed, evaluated = evaluate_conditions(
            event, rule.conditions or [], rule.condition_logic
        )
        context = self._placeholder_context(
            tenant_id=tenant_id,
            rule=rule,
            event=event,
            evaluated=evaluated,
            device=device,
        )
        preview = [self._render_action(action, context) for action in (rule.actions or [])]
        executed: list[dict[str, Any]] = []
        error_message = None
        if matched:
            rule.last_triggered_at = utc_now()
            for action in preview:
                try:
                    executed.append(self._execute_action(tenant_id, action, rule, device))
                except Exception as exc:  # Keep evaluating other rules; record failure.
                    error_message = str(exc)
                    executed.append(
                        {"type": action.get("type"), "status": "failed", "error": str(exc)}
                    )
        execution = AutomationRuleExecution(
            rule_id=rule.id,
            tenant_id=tenant_id,
            device_id=device.id if device is not None else None,
            trigger_type=rule.trigger_type,
            matched=matched,
            event_payload=event,
            evaluated_fields=evaluated,
            matched_conditions=[result.as_dict() for result in passed],
            failed_conditions=[result.as_dict() for result in failed],
            action_preview=preview,
            executed_actions=executed,
            error_message=error_message,
        )
        self.db.add(execution)
        return execution

    def _execute_action(
        self,
        tenant_id: uuid.UUID,
        action: dict[str, Any],
        rule: AutomationRule,
        device: Device | None,
    ) -> dict[str, Any]:
        action_type = action.get("type")
        config = action.get("config") if isinstance(action.get("config"), dict) else {}
        if action_type == "create_alert":
            alert = Alert(
                tenant_id=tenant_id,
                device_id=device.id if device is not None else None,
                severity=str(config.get("severity") or rule.severity),
                source="automation_rule",
                code=f"automation.{rule.id}",
                title=str(config.get("title") or rule.name),
                message=str(config.get("message") or rule.description or rule.name),
                details={"rule_id": str(rule.id), "rule_name": rule.name, "action": config},
            )
            self.db.add(alert)
            self.db.flush()

            from app.shared.infrastructure.messaging.alert_events import alert_bus, AlertEvent

            event = AlertEvent(
                id=str(alert.id),
                tenant_id=str(tenant_id),
                device_id=str(device.id) if device is not None else None,
                severity=alert.severity,
                code=alert.code,
                title=alert.title,
                message=alert.message,
                timestamp=alert.created_at.isoformat() if alert.created_at else "",
            )
            alert_bus.publish(event)

            return {"type": action_type, "status": "queued", "alert_id": str(alert.id)}
        if action_type == "send_command":
            command = str(config.get("command") or config.get("command_type") or "").strip()
            if not command:
                raise ValueError("send_command action requires config.command")
            target_type = str(
                config.get("target_type") or ("device" if device is not None else "group")
            )
            request = CommandDispatchRequest(
                command_type=command,
                payload=config.get("payload") if isinstance(config.get("payload"), dict) else {},
                target_type=target_type,
                target_device_id=config.get("target_device_id")
                or (device.id if device is not None else None),
                target_group_id=config.get("target_group_id"),
            )
            dispatch = CommandCenterUseCases(self.db).dispatch_command(tenant_id, request)
            return {"type": action_type, "status": dispatch.status, "dispatch_id": str(dispatch.id)}
        if action_type == "mqtt_publish":
            topic = str(config.get("topic") or "")
            tenant_prefix = f"tenants/{tenant_id}/"
            if not topic.startswith(tenant_prefix):
                raise ValueError(f"mqtt_publish topic must start with {tenant_prefix}")

            try:
                from app.shared.infrastructure.messaging.mqtt_publisher import publish_custom_topic

                publish_custom_topic(topic, config.get("payload", {}))
                return {"type": action_type, "status": "published", "topic": topic}
            except Exception as exc:
                return {"type": action_type, "status": "failed", "topic": topic, "error": str(exc)}

        if action_type == "create_audit_event":
            audit_service.log_event_best_effort(
                self.db,
                action=str(config.get("action") or "automation_rule_triggered"),
                tenant_id=tenant_id,
                resource_type="automation_rule",
                resource_id=str(rule.id),
                detail=config.get("detail") if isinstance(config.get("detail"), dict) else config,
            )
            return {"type": action_type, "status": "logged"}

        if action_type == "call_webhook":
            url = str(config.get("url") or "")
            if not url:
                raise ValueError("call_webhook action requires config.url")

            try:
                import requests

                headers = config.get("headers") if isinstance(config.get("headers"), dict) else {}
                payload = config.get("payload") if isinstance(config.get("payload"), dict) else {}
                response = requests.post(url, json=payload, headers=headers, timeout=5)
                return {
                    "type": action_type,
                    "status": "called",
                    "url": url,
                    "status_code": response.status_code,
                }
            except Exception as exc:
                return {"type": action_type, "status": "failed", "url": url, "error": str(exc)}

        raise ValueError(f"Unsupported action type: {action_type}")

    def _rule_targets_device(self, rule: AutomationRule, device: Device) -> bool:
        scope = rule.target_scope or {}
        scope_type = scope.get("scope_type", "all_devices")
        if scope_type == "all_devices":
            return True
        if scope_type == "device":
            return str(scope.get("device_id")) == str(device.id)
        if scope_type == "device_type":
            return str(scope.get("device_type") or "") in {
                str(device.hardware_model or ""),
                str(device.device_type_id or ""),
            }
        if scope_type == "group" and scope.get("group_id"):
            return (
                self.db.query(DeviceGroupMember)
                .filter(
                    DeviceGroupMember.group_id == scope.get("group_id"),
                    DeviceGroupMember.device_id == device.id,
                )
                .first()
                is not None
            )
        return False

    def _is_in_cooldown(self, rule: AutomationRule) -> bool:
        if rule.cooldown_seconds <= 0 or rule.last_triggered_at is None:
            return False
        return utc_now() - rule.last_triggered_at < timedelta(seconds=rule.cooldown_seconds)

    def _normalize_event(self, event: dict[str, Any]) -> dict[str, Any]:
        payload = dict(event)
        telemetry = payload.get("telemetry")
        if not isinstance(telemetry, dict):
            telemetry = dict(event)
            payload["telemetry"] = telemetry
        if "event" not in payload or not isinstance(payload["event"], dict):
            payload["event"] = telemetry
        return payload

    def _placeholder_context(
        self,
        *,
        tenant_id: uuid.UUID,
        rule: Any,
        event: dict[str, Any],
        evaluated: dict[str, Any],
        device: Device | None = None,
    ) -> dict[str, Any]:
        first_value = next(iter(evaluated.values()), None)
        rule_id = getattr(rule, "id", None)
        return {
            "tenant_id": str(tenant_id),
            "device_id": str(event.get("device_id") or (device.id if device else "")),
            "device_name": str(event.get("device_name") or (device.name if device else "")),
            "rule_id": str(rule_id or ""),
            "rule_name": str(getattr(rule, "name", "")),
            "trigger_type": str(getattr(rule, "trigger_type", "")),
            "field_value": first_value,
            "telemetry": event.get("telemetry") if isinstance(event.get("telemetry"), dict) else {},
            "event": event.get("event") if isinstance(event.get("event"), dict) else event,
        }

    def _render_action(self, action: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        return _render_value(action, context)


def _flatten_keys(payload: dict[str, Any], prefix: str = "") -> list[str]:
    keys: list[str] = []
    for key, value in payload.items():
        if not isinstance(key, str):
            continue
        path = f"{prefix}.{key}" if prefix else key
        keys.append(path)
        if isinstance(value, dict):
            keys.extend(_flatten_keys(value, path))
    return keys


def _render_value(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, str):
        return PLACEHOLDER_RE.sub(
            lambda match: str(_resolve_placeholder(match.group(1), context)), value
        )
    if isinstance(value, list):
        return [_render_value(item, context) for item in value]
    if isinstance(value, dict):
        return {key: _render_value(item, context) for key, item in value.items()}
    return value


def _resolve_placeholder(path: str, context: dict[str, Any]) -> Any:
    direct = context.get(path)
    if direct is not None:
        return direct
    resolved = resolve_path(context, path)
    return "" if resolved is MISSING else resolved
