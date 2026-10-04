import hashlib
import sys
from pathlib import Path
from types import SimpleNamespace
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Ensure backend directory is in path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
from app.core import security as security_module
from app.bounded_contexts.identity.presentation import dependencies as identity_dependencies

compiles(JSONB, "sqlite")(lambda type_, compiler, **kw: "TEXT")
compiles(UUID, "sqlite")(lambda type_, compiler, **kw: "VARCHAR(36)")


@pytest.fixture(name="db_session")
def fixture_db_session(tmp_path, monkeypatch):
    db_file = tmp_path / "test_webhooks.db"
    db_url = f"sqlite:///{db_file.as_posix()}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    import app.db.session
    import app.shared.infrastructure.messaging.mqtt_subscriber

    monkeypatch.setattr(app.db.session, "SessionLocal", SessionLocal)
    monkeypatch.setattr(app.db.session, "engine", engine)
    monkeypatch.setattr(
        app.shared.infrastructure.messaging.mqtt_subscriber, "SessionLocal", SessionLocal
    )

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


@pytest.fixture(name="client")
def fixture_client(db_session, monkeypatch):
    from app.main import app
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def dummy_lifespan(app):
        yield

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    original_lifespan = app.router.lifespan_context
    app.router.lifespan_context = dummy_lifespan

    # Set mock settings
    monkeypatch.setattr(settings, "mqtt_password", "super-secret-mqtt-pw")

    fake_admin = SimpleNamespace(
        id=Device.id, email="admin@aifom.local", role="admin", is_active=True
    )
    app.dependency_overrides[security_module.get_current_user] = lambda: fake_admin
    app.dependency_overrides[identity_dependencies.get_current_user] = lambda: fake_admin

    try:
        from fastapi.testclient import TestClient

        with TestClient(app) as c:
            yield c
    finally:
        app.router.lifespan_context = original_lifespan
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(security_module.get_current_user, None)
        app.dependency_overrides.pop(identity_dependencies.get_current_user, None)


def test_mqtt_auth_superuser(client):
    # Valid Superuser
    response = client.post(
        "/api/v1/mqtt/auth",
        data={
            "username": "aifom-api",
            "password": "super-secret-mqtt-pw",
            "clientid": "backend-client",
        },
    )
    assert response.status_code == 200

    # Invalid Superuser password
    response = client.post(
        "/api/v1/mqtt/auth",
        data={"username": "aifom-api", "password": "wrong-password", "clientid": "backend-client"},
    )
    assert response.status_code == 401


def test_mqtt_auth_device(client, db_session):
    # Register device with token
    device_token = "device-secret-token"
    token_hash = hashlib.sha256(device_token.encode("utf-8")).hexdigest()

    device = Device(
        device_uid="esp32-001", name="ESP32 Unit 001", auth_token_hash=token_hash, status="online"
    )
    db_session.add(device)
    db_session.commit()

    # Valid Device Authentication using form fields
    response = client.post(
        "/api/v1/mqtt/auth",
        data={"username": device_token, "password": "", "clientid": "esp32-001"},
    )
    assert response.status_code == 200

    # Valid Device Authentication using JSON payload
    response = client.post(
        "/api/v1/mqtt/auth",
        json={"username": device_token, "password": "", "clientid": "esp32-001"},
    )
    assert response.status_code == 200

    # Invalid Device token
    response = client.post(
        "/api/v1/mqtt/auth",
        data={"username": "invalid-token", "password": "", "clientid": "esp32-001"},
    )
    assert response.status_code == 401


def test_mqtt_superuser(client):
    # Valid
    response = client.post("/api/v1/mqtt/superuser", data={"username": "aifom-api"})
    assert response.status_code == 200

    # Invalid
    response = client.post("/api/v1/mqtt/superuser", data={"username": "not-superuser"})
    assert response.status_code == 400


def test_mqtt_acl(client, db_session):
    device_token = "dev-token-999"
    token_hash = hashlib.sha256(device_token.encode("utf-8")).hexdigest()

    device = Device(
        device_uid="esp32-999", name="ESP32 Unit 999", auth_token_hash=token_hash, status="online"
    )
    db_session.add(device)
    db_session.commit()

    # 1. Superuser can do anything
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": "aifom-api",
            "clientid": "backend",
            "topic": "devices/esp32-999/commands",
            "acc": 2,
        },
    )
    assert response.status_code == 200

    # 2. Device can subscribe to its own commands
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": device_token,
            "clientid": "esp32-999",
            "topic": "devices/esp32-999/commands",
            "acc": 1,
        },
    )
    assert response.status_code == 200

    # 3. Device can subscribe to its own virtual commands channel
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": device_token,
            "clientid": "esp32-999",
            "topic": "devices/esp32-999/commands/ch_1",
            "acc": 1,
        },
    )
    assert response.status_code == 200

    # 4. Device can publish to its own telemetry/status/heartbeat/events
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": device_token,
            "clientid": "esp32-999",
            "topic": "devices/esp32-999/telemetry/ch_1",
            "acc": 2,
        },
    )
    assert response.status_code == 200

    # 5. Device CANNOT subscribe to other device's topics
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": device_token,
            "clientid": "esp32-999",
            "topic": "devices/esp32-888/commands",
            "acc": 1,
        },
    )
    assert response.status_code == 403

    # 6. Device CANNOT publish to commands
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": device_token,
            "clientid": "esp32-999",
            "topic": "devices/esp32-999/commands",
            "acc": 2,
        },
    )
    assert response.status_code == 403

    # 7. Device CANNOT subscribe to telemetry
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": device_token,
            "clientid": "esp32-999",
            "topic": "devices/esp32-999/telemetry",
            "acc": 1,
        },
    )
    assert response.status_code == 403


    # Removed ML topics cannot be used by authenticated devices.
    for suffix, access in (("ml/deploy", 1), ("ml/status", 2), ("ml/deploy/ack", 2)):
        response = client.post(
            "/api/v1/mqtt/acl",
            data={
                "username": device_token,
                "clientid": "esp32-999",
                "topic": f"devices/esp32-999/{suffix}",
                "acc": access,
            },
        )
        assert response.status_code == 403


def test_mqtt_auth_dynamic_validation(client, db_session):
    # Register device A
    token_a = "token-device-a"
    hash_a = hashlib.sha256(token_a.encode("utf-8")).hexdigest()
    device_a = Device(
        device_uid="esp32-a", name="ESP32 Unit A", auth_token_hash=hash_a, status="online"
    )
    db_session.add(device_a)

    # Register device B
    token_b = "token-device-b"
    hash_b = hashlib.sha256(token_b.encode("utf-8")).hexdigest()
    device_b = Device(
        device_uid="esp32-b", name="ESP32 Unit B", auth_token_hash=hash_b, status="online"
    )
    db_session.add(device_b)

    # Register a deleted device
    token_deleted = "token-device-deleted"
    hash_deleted = hashlib.sha256(token_deleted.encode("utf-8")).hexdigest()
    device_deleted = Device(
        device_uid="esp32-deleted",
        name="ESP32 Unit Deleted",
        auth_token_hash=hash_deleted,
        status="deleted",
    )
    db_session.add(device_deleted)

    # Register a device with deleted_at set
    import datetime

    token_deleted_at = "token-device-deleted-at"
    hash_deleted_at = hashlib.sha256(token_deleted_at.encode("utf-8")).hexdigest()
    device_deleted_at = Device(
        device_uid="esp32-deleted-at",
        name="ESP32 Unit Deleted At",
        auth_token_hash=hash_deleted_at,
        status="online",
        deleted_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db_session.add(device_deleted_at)

    db_session.commit()

    # Valid lookup for Device A
    response = client.post(
        "/api/v1/mqtt/auth", data={"username": token_a, "password": "", "clientid": "esp32-a"}
    )
    assert response.status_code == 200

    # Valid lookup for Device B
    response = client.post(
        "/api/v1/mqtt/auth", data={"username": token_b, "password": "", "clientid": "esp32-b"}
    )
    assert response.status_code == 200

    # Invalid token lookup
    response = client.post(
        "/api/v1/mqtt/auth", data={"username": "wrong-token", "password": "", "clientid": "esp32-a"}
    )
    assert response.status_code == 401

    # Deleted device status lookup (status="deleted")
    response = client.post(
        "/api/v1/mqtt/auth",
        data={"username": token_deleted, "password": "", "clientid": "esp32-deleted"},
    )
    assert response.status_code == 401

    # Deleted device with deleted_at set lookup
    response = client.post(
        "/api/v1/mqtt/auth",
        data={"username": token_deleted_at, "password": "", "clientid": "esp32-deleted-at"},
    )
    assert response.status_code == 401


def test_mqtt_acl_dynamic_validation(client, db_session):
    token_a = "token-device-a"
    hash_a = hashlib.sha256(token_a.encode("utf-8")).hexdigest()
    device_a = Device(
        device_uid="esp32-a", name="ESP32 Unit A", auth_token_hash=hash_a, status="online"
    )
    db_session.add(device_a)

    token_b = "token-device-b"
    hash_b = hashlib.sha256(token_b.encode("utf-8")).hexdigest()
    device_b = Device(
        device_uid="esp32-b", name="ESP32 Unit B", auth_token_hash=hash_b, status="online"
    )
    db_session.add(device_b)
    db_session.commit()

    # 1. Device A can subscribe to its own virtual commands channel
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": token_a,
            "clientid": "esp32-a",
            "topic": "devices/esp32-a/commands/ch_1",
            "acc": 1,
        },
    )
    assert response.status_code == 200

    # 2. Device A can publish to its own virtual telemetry channel
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": token_a,
            "clientid": "esp32-a",
            "topic": "devices/esp32-a/telemetry/ch_5",
            "acc": 2,
        },
    )
    assert response.status_code == 200

    # 3. Device A CANNOT subscribe to Device B's virtual commands channel
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": token_a,
            "clientid": "esp32-a",
            "topic": "devices/esp32-b/commands/ch_1",
            "acc": 1,
        },
    )
    assert response.status_code == 403

    # 4. Device A CANNOT publish to Device B's virtual telemetry channel
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": token_a,
            "clientid": "esp32-a",
            "topic": "devices/esp32-b/telemetry/ch_5",
            "acc": 2,
        },
    )
    assert response.status_code == 403

    # 5. Device A CANNOT publish to its own command channel
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": token_a,
            "clientid": "esp32-a",
            "topic": "devices/esp32-a/commands/ch_1",
            "acc": 2,
        },
    )
    assert response.status_code == 403

    # 6. Device A CANNOT subscribe to its own telemetry channel
    response = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": token_a,
            "clientid": "esp32-a",
            "topic": "devices/esp32-a/telemetry/ch_5",
            "acc": 1,
        },
    )
    assert response.status_code == 403


def test_mqtt_telemetry_subscriber_ingestion(db_session, monkeypatch):
    from app.shared.infrastructure.messaging.mqtt_subscriber import MQTTSubscriber

    device_uid = "esp32-telemetry-test"
    device = Device(device_uid=device_uid, name="ESP32 Telemetry Test Unit", status="offline")
    db_session.add(device)
    db_session.commit()

    sub = MQTTSubscriber()

    # Process correct virtual channel telemetry message
    msg = SimpleNamespace(topic=f"devices/{device_uid}/telemetry/ch_sensor", payload=b"25.4")
    sub.process_message_sync(msg)

    # Verify telemetry record in DB
    from app.bounded_contexts.telemetry.infrastructure.persistence.models import Telemetry

    records = db_session.query(Telemetry).filter(Telemetry.device_id == device.id).all()
    assert len(records) == 1
    assert records[0].metric_name == "ch_sensor"
    assert records[0].metric_value == 25.4

    db_session.refresh(device)
    assert device.status == "online"

    # Process invalid non-numeric payload
    msg_invalid = SimpleNamespace(
        topic=f"devices/{device_uid}/telemetry/ch_3", payload=b"invalid-payload"
    )
    sub.process_message_sync(msg_invalid)

    # Verify no new telemetry records were created
    records2 = db_session.query(Telemetry).filter(Telemetry.device_id == device.id).all()
    assert len(records2) == 1


def test_mqtt_command_publisher(monkeypatch):
    from app.shared.infrastructure.messaging import mqtt_publisher
    from unittest.mock import MagicMock

    # Mock paho_publish.single
    mock_single = MagicMock()
    monkeypatch.setattr(mqtt_publisher.paho_publish, "single", mock_single)

    # Test target directly maps to virtual channel ch_
    mqtt_publisher.publish_device_command("esp32-pub-test", {"target": "ch_5", "value": 42})

    mock_single.assert_called_once()
    args, kwargs = mock_single.call_args
    assert args[0] == "devices/esp32-pub-test/commands/ch_5"
    assert kwargs.get("payload") == "42"
    assert kwargs.get("qos") == 1
    assert kwargs.get("retain") is False

    mock_single.reset_mock()

    # Test params contains channel ch_
    mqtt_publisher.publish_device_command(
        "esp32-pub-test", {"target": "some_action", "params": {"channel": "ch_3"}, "value": True}
    )

    mock_single.assert_called_once()
    args, kwargs = mock_single.call_args
    assert args[0] == "devices/esp32-pub-test/commands/ch_3"
    assert kwargs.get("payload") == "1"

    mock_single.reset_mock()

    # Test target is not virtual channel, should fall back to default commands topic
    monkeypatch.setattr(mqtt_publisher, "_inject_correlation_id", lambda x: x)

    mqtt_publisher.publish_device_command(
        "esp32-pub-test", {"target": "reboot", "params": {"force": True}}
    )

    mock_single.assert_called_once()
    args, kwargs = mock_single.call_args
    assert args[0] == "devices/esp32-pub-test/commands"


def test_delayed_registration_and_webhook_integration(client, db_session):
    import uuid
    from app.bounded_contexts.tenant_management.infrastructure.persistence.models import (
        Tenant,
        ServicePlan,
    )
    from app.bounded_contexts.identity.infrastructure.persistence.models import User
    from app.bounded_contexts.tenant_management.presentation.dependencies import (
        get_current_tenant_user,
    )
    from app.core.security import get_current_user
    from app.bounded_contexts.identity.presentation.dependencies import (
        get_current_tenant_user as identity_get_current_tenant_user,
    )
    from app.core.tenant import get_current_tenant_user as core_get_current_tenant_user

    # 1. Create a service plan with device_management feature enabled
    plan = ServicePlan(
        id=uuid.uuid4(),
        name="Webhook Integration Test Plan",
        features={"device_management": True},
        is_active=True,
        max_devices=10,
    )
    db_session.add(plan)
    db_session.flush()

    # 2. Create a tenant using that plan
    tenant_id = uuid.uuid4()
    tenant = Tenant(
        id=tenant_id,
        name="Webhook Integration Tenant",
        slug="webhook-integration-tenant",
        is_active=True,
        plan_id=plan.id,
    )
    db_session.add(tenant)

    # 3. Create a tenant user with tenant_owner role
    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email="test-owner-webhook-integration@test.local",
        hashed_password="fake-password-hash",
        role="tenant_owner",
        tenant_id=tenant_id,
        is_active=True,
    )
    db_session.add(user)
    db_session.commit()

    # 4. Set dependency overrides to authenticate as the tenant user
    saved_overrides = dict(client.app.dependency_overrides)
    client.app.dependency_overrides[get_current_user] = lambda: user
    client.app.dependency_overrides[get_current_tenant_user] = lambda: user
    client.app.dependency_overrides[identity_get_current_tenant_user] = lambda: user
    client.app.dependency_overrides[core_get_current_tenant_user] = lambda: user

    try:
        # Step A: GET /api/v1/client/devices/generate-token
        resp_token = client.get("/api/v1/client/devices/generate-token")
        assert resp_token.status_code == 200
        token_data = resp_token.json()
        raw_token = token_data["raw_token"]
        token_hash = token_data["token_hash"]

        # Step B: POST /api/v1/client/devices with auth_token_hash
        device_uid = "esp32-delayed-webhook-integration"
        resp_reg = client.post(
            "/api/v1/client/devices",
            json={
                "device_uid": device_uid,
                "name": "Delayed Webhook ESP32",
                "auth_token_hash": token_hash,
            },
        )
        assert resp_reg.status_code == 201

        # Verify the device is registered with the correct hash
        registered_data = resp_reg.json()
        assert registered_data["device_uid"] == device_uid
    finally:
        # Restore dependency overrides
        client.app.dependency_overrides = saved_overrides

    # Step C: Verify subsequent MQTT Webhook Auth passes using the raw token
    resp_auth = client.post(
        "/api/v1/mqtt/auth", json={"username": raw_token, "password": "", "clientid": device_uid}
    )
    assert resp_auth.status_code == 200

    # Step D: Verify subsequent MQTT Webhook ACL checks pass
    # 1. Device can subscribe to its own command channel
    resp_acl_sub = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": raw_token,
            "clientid": device_uid,
            "topic": f"devices/{device_uid}/commands/ch_1",
            "acc": 1,
        },
    )
    assert resp_acl_sub.status_code == 200

    # 2. Device can publish to its own telemetry channel
    resp_acl_pub = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": raw_token,
            "clientid": device_uid,
            "topic": f"devices/{device_uid}/telemetry/ch_2",
            "acc": 2,
        },
    )
    assert resp_acl_pub.status_code == 200

    # 3. Device cannot subscribe/publish to other devices
    resp_acl_other = client.post(
        "/api/v1/mqtt/acl",
        data={
            "username": raw_token,
            "clientid": device_uid,
            "topic": "devices/esp32-other/commands",
            "acc": 1,
        },
    )
    assert resp_acl_other.status_code == 403
