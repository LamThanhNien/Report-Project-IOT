import pytest
import uuid
from app.db.session import SessionLocal
from app.bounded_contexts.rule_engine.application.use_cases import RuleEngineUseCases
from app.bounded_contexts.rule_engine.infrastructure.persistence.models import AutomationRule
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device


@pytest.fixture
def db():
    from app.core.tenant_context import bypass_rls_context

    token = bypass_rls_context.set(True)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()
        bypass_rls_context.reset(token)


def test_device_status_rule_evaluation(db):
    from sqlalchemy import text

    tenant_id = uuid.uuid4()

    # Create the parent tenant record to satisfy foreign key constraints
    db.execute(
        text("INSERT INTO tenants (id, name, slug) VALUES (:id, 'Test Tenant', 'test-tenant')"),
        {"id": tenant_id},
    )

    device = Device(
        id=uuid.uuid4(),
        name="Test Device",
        device_uid="test-123",
        status="offline",
        tenant_id=tenant_id,
    )
    db.add(device)

    rule = AutomationRule(
        tenant_id=tenant_id,
        name="Offline Alert",
        trigger_type="device_status",
        enabled=True,
        conditions=[
            {"field": "status", "operator": "==", "value": "offline", "data_type": "string"}
        ],
        actions=[],
    )
    db.add(rule)
    db.flush()

    executions = RuleEngineUseCases(db).evaluate_enabled_rules_for_device_status(tenant_id, device)

    assert len(executions) == 1
    assert executions[0].matched is True
    assert executions[0].trigger_type == "device_status"
