from pathlib import Path
import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app import main as app_main
from app.bounded_contexts.identity.presentation import dependencies as identity_dependencies
from app.bounded_contexts.rule_engine.application import use_cases as rule_use_cases
from app.bounded_contexts.rule_engine.presentation import router as rule_router
from app.bounded_contexts.telemetry.infrastructure.persistence.alert_models import Alert
from app.core import security as security_module
from app.core import tenant as tenant_module
from app.shared.infrastructure.messaging import mqtt_subscriber as mqtt_subscriber_module


_TENANT_ID = uuid4()
_TENANT_USER = SimpleNamespace(
    id=uuid4(),
    email="tenant@test.local",
    role="tenant_owner",
    tenant_id=_TENANT_ID,
    is_active=True,
)


def _override_dependencies():
    app_main.app.dependency_overrides[security_module.get_current_user] = lambda: _TENANT_USER
    app_main.app.dependency_overrides[tenant_module.get_current_tenant_user] = lambda: _TENANT_USER
    app_main.app.dependency_overrides[identity_dependencies.get_current_user] = lambda: _TENANT_USER
    app_main.app.dependency_overrides[identity_dependencies.get_current_tenant_user] = lambda: (
        _TENANT_USER
    )
    app_main.app.dependency_overrides[rule_router.get_db] = lambda: object()


def test_tenant_automation_collection_endpoints_do_not_404(monkeypatch) -> None:
    _override_dependencies()
    monkeypatch.setattr(
        rule_use_cases.RuleEngineUseCases, "list_rules", lambda self, tid, **kwargs: []
    )
    monkeypatch.setattr(
        rule_use_cases.RuleEngineUseCases, "suggest_fields", lambda self, tid, device_id=None: []
    )
    monkeypatch.setattr(
        rule_use_cases.RuleEngineUseCases,
        "stats",
        lambda self, tid: {
            "total_rules": 0,
            "enabled_rules": 0,
            "disabled_rules": 0,
            "executions_24h": 0,
            "matched_24h": 0,
            "failed_24h": 0,
        },
    )

    client = TestClient(app_main.app)

    assert client.get("/api/v1/client/automation/rules").status_code == 200
    assert client.get("/api/v1/client/automation/field-suggestions").status_code == 200
    assert client.get("/api/v1/client/automation/stats").status_code == 200
    templates = client.get("/api/v1/client/automation/templates")
    assert templates.status_code == 200
    assert isinstance(templates.json(), list)
    assert any(item["rule"]["trigger_type"] == "device_event" for item in templates.json())


def test_tenant_automation_rules_serialize_seed_compatible_shapes(monkeypatch) -> None:
    _override_dependencies()
    now = datetime.now(timezone.utc)
    rules = [
        SimpleNamespace(
            id=uuid4(),
            tenant_id=_TENANT_ID,
            project_id=None,
            name="Audit relay state",
            description="Demo audit event rule",
            enabled=True,
            severity="info",
            cooldown_seconds=300,
            trigger_type="telemetry",
            target_scope={"scope_type": "device", "device_id": str(uuid4())},
            condition_logic="and",
            conditions=[
                {"field": "relay_state", "operator": "==", "value": True, "data_type": "boolean"}
            ],
            condition_config={"is_demo": True},
            actions=[
                {
                    "type": "create_audit_event",
                    "config": {"action": "automation_relay_state_on", "detail": {"source": "test"}},
                }
            ],
            last_triggered_at=None,
            created_at=now,
            updated_at=now,
        ),
        SimpleNamespace(
            id=uuid4(),
            tenant_id=_TENANT_ID,
            project_id=None,
            name="Scheduled command",
            description="Demo schedule command rule",
            enabled=False,
            severity="info",
            cooldown_seconds=300,
            trigger_type="schedule",
            target_scope={"scope_type": "device", "device_id": str(uuid4())},
            condition_logic="and",
            conditions=[
                {
                    "field": "schedule.cron",
                    "operator": "==",
                    "value": "0 18 * * *",
                    "data_type": "string",
                }
            ],
            condition_config={"is_demo": True},
            actions=[
                {
                    "type": "send_command",
                    "config": {
                        "command": "set_output",
                        "payload": {"target": "relay_1", "value": True},
                    },
                }
            ],
            last_triggered_at=None,
            created_at=now,
            updated_at=now,
        ),
        SimpleNamespace(
            id=uuid4(),
            tenant_id=_TENANT_ID,
            project_id=None,
            name="OTA alert",
            description="Demo OTA alert rule",
            enabled=True,
            severity="info",
            cooldown_seconds=300,
            trigger_type="ota",
            target_scope={"scope_type": "group", "group_id": str(uuid4())},
            condition_logic="and",
            conditions=[
                {
                    "field": "firmware_version",
                    "operator": "<",
                    "value": "1.2.0",
                    "data_type": "string",
                }
            ],
            condition_config={"is_demo": True},
            actions=[
                {
                    "type": "create_alert",
                    "config": {
                        "title": "Firmware update suggested",
                        "message": "Device firmware is older than 1.2.0",
                        "severity": "info",
                    },
                }
            ],
            last_triggered_at=None,
            created_at=now,
            updated_at=now,
        ),
    ]
    monkeypatch.setattr(
        rule_use_cases.RuleEngineUseCases, "list_rules", lambda self, tid, project_id=None: rules
    )

    response = TestClient(app_main.app).get("/api/v1/client/automation/rules")

    assert response.status_code == 200, response.text
    assert [rule["trigger_type"] for rule in response.json()] == ["telemetry", "schedule", "ota"]


class _ScalarResult:
    def __init__(self, items):
        self._items = items

    def scalars(self):
        return self

    def all(self):
        return self._items


class _FakeRuleDb:
    def __init__(self, rules):
        self.rules = rules
        self.added = []
        self.commits = 0

    def execute(self, _stmt):
        return _ScalarResult(self.rules)

    def add(self, item):
        self.added.append(item)

    def flush(self):
        return None

    def commit(self):
        self.commits += 1


def test_device_event_rule_creates_automation_alert() -> None:
    tenant_id = uuid4()
    device = SimpleNamespace(
        id=uuid4(),
        name="Relay Device",
        device_uid="relay-001",
        hardware_model="esp32",
        device_type_id=None,
    )
    rule = SimpleNamespace(
        id=uuid4(),
        tenant_id=tenant_id,
        name="Relay changed",
        description="Notify on relay command",
        enabled=True,
        severity="info",
        cooldown_seconds=0,
        last_triggered_at=None,
        trigger_type="device_event",
        target_scope={"scope_type": "all_devices"},
        condition_logic="and",
        conditions=[
            {
                "field": "event.event",
                "operator": "==",
                "value": "command_result",
                "data_type": "string",
            },
            {"field": "event.status", "operator": "==", "value": "success", "data_type": "string"},
        ],
        actions=[
            {
                "type": "create_alert",
                "config": {
                    "title": "Relay confirmed",
                    "message": "Device {device_name} changed GPIO {event.gpio_pin}",
                    "severity": "info",
                },
            }
        ],
    )
    db = _FakeRuleDb([rule])

    executions = rule_use_cases.RuleEngineUseCases(db).evaluate_enabled_rules_for_device_event(
        tenant_id,
        device,
        {
            "event": "command_result",
            "status": "success",
            "type": "set_output",
            "gpio_pin": 2,
            "message": "gpio_2 set to True",
        },
    )

    alerts = [item for item in db.added if isinstance(item, Alert)]
    assert len(executions) == 1
    assert executions[0].matched is True
    assert len(alerts) == 1
    assert alerts[0].source == "automation_rule"
    assert alerts[0].title == "Relay confirmed"
    assert "Relay Device" in alerts[0].message


def test_mqtt_command_result_invokes_ack_and_device_event_rules(monkeypatch) -> None:
    tenant_id = uuid4()
    device = SimpleNamespace(
        id=uuid4(),
        device_uid="relay-001",
        name="Relay Device",
        status="online",
        last_seen_at=None,
    )
    mapping = SimpleNamespace(tenant_id=tenant_id, tenant=SimpleNamespace(is_active=True))
    calls = {"ack": [], "rules": []}

    class _Db:
        def scalar(self, _stmt):
            return mapping

    def fake_touch_device(_db, device_uid, **_kwargs):
        assert device_uid == device.device_uid
        return device

    def fake_get_device_by_uid(_db, device_uid):
        assert device_uid == device.device_uid
        return device

    def fake_ack(self, device_uid, event_type, payload):
        calls["ack"].append((device_uid, event_type, payload))

    def fake_rules(self, rule_tenant_id, rule_device, payload):
        calls["rules"].append((rule_tenant_id, rule_device, payload))
        return []

    monkeypatch.setattr(
        mqtt_subscriber_module.device_repository,
        "get_device_by_uid",
        fake_get_device_by_uid,
    )
    monkeypatch.setattr(
        mqtt_subscriber_module.device_repository,
        "touch_device",
        fake_touch_device,
    )
    monkeypatch.setattr(
        "app.bounded_contexts.command_center.infrastructure.ack_handler.CommandAckHandler.handle_event",
        fake_ack,
    )
    monkeypatch.setattr(
        rule_use_cases.RuleEngineUseCases,
        "evaluate_enabled_rules_for_device_event",
        fake_rules,
    )

    mqtt_subscriber_module.MQTTSubscriber()._handle_events(
        _Db(),
        device.device_uid,
        {"event": "command_result", "status": "success", "command_id": str(uuid4())},
    )

    assert calls["ack"][0][0:2] == (device.device_uid, "command_result")
    assert calls["rules"][0][0] == tenant_id
    assert calls["rules"][0][1] is device


def test_client_alerts_include_automation_alert(monkeypatch) -> None:
    from app.bounded_contexts.tenant_management.presentation import router_client

    tenant_id = uuid4()
    device_id = uuid4()
    now = datetime.now(timezone.utc)
    device = SimpleNamespace(id=device_id, device_uid="relay-001")
    alert = SimpleNamespace(
        id=uuid4(),
        tenant_id=tenant_id,
        device_id=device_id,
        severity="info",
        status="open",
        source="automation_rule",
        title="Relay confirmed",
        message="Relay Device confirmed set_output",
        details={"rule_id": "rule-1"},
        last_seen_at=now,
        created_at=now,
    )

    class _Db:
        def __init__(self):
            self.calls = 0

        def scalars(self, _stmt):
            self.calls += 1
            return _ScalarResult([alert])

    monkeypatch.setattr(
        router_client.repository,
        "list_tenant_devices",
        lambda _db, _tenant_id, **kwargs: [device],
    )

    items = router_client.client_alerts(
        current_user=SimpleNamespace(tenant_id=tenant_id),
        db=_Db(),
        limit=10,
    )

    assert len(items) == 1
    assert items[0]["source"] == "automation_rule"
    assert items[0]["title"] == "Relay confirmed"
    assert items[0]["device_uid"] == "relay-001"
