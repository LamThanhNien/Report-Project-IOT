# ruff: noqa: E402
import base64
import hashlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import subprocess

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Ensure backend directory is in path
sys.path.append(str(Path(__file__).resolve().parents[1]))

from sqlalchemy.ext.compiler import compiles
from sqlalchemy.dialects.postgresql import JSONB, UUID

compiles(JSONB, "sqlite")(lambda type_, compiler, **kw: "TEXT")
compiles(UUID, "sqlite")(lambda type_, compiler, **kw: "VARCHAR(36)")

from app.core.config import Settings, settings
from app.db.base import Base
from app.db.session import get_db
from app.bounded_contexts.device_registry.infrastructure import repositories as device_repo
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
from app.core import security as security_module
from app.bounded_contexts.identity.presentation import dependencies as identity_dependencies


# Helper to verify PBKDF2-HMAC-SHA512 hashes produced for Mosquitto
def verify_mqtt_password(password: str, hashed: str) -> bool:
    # Format: $7$71000$b64_salt$b64_hash
    parts = hashed.split("$")
    if len(parts) != 5 or parts[1] != "7" or parts[2] != "71000":
        return False
    b64_salt = parts[3]
    b64_hash = parts[4]
    salt = base64.b64decode(b64_salt.encode("utf-8"))
    expected_hash = base64.b64decode(b64_hash.encode("utf-8"))
    actual_hash = hashlib.pbkdf2_hmac("sha512", password.encode("utf-8"), salt, 71000, 64)
    return expected_hash == actual_hash


# SQLite session fixture for integration tests
@pytest.fixture(name="db_session")
def fixture_db_session(tmp_path, monkeypatch):
    db_file = tmp_path / "test.db"
    db_url = f"sqlite:///{db_file.as_posix()}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    import app.db.session

    monkeypatch.setattr(app.db.session, "SessionLocal", SessionLocal)
    monkeypatch.setattr(app.db.session, "engine", engine)

    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
        engine.dispose()


# Mock password file reads/writes fixture
@pytest.fixture(name="mock_passwd_io")
def fixture_mock_passwd_io(tmp_path, monkeypatch):
    temp_passwd = tmp_path / "passwd"
    monkeypatch.setattr(settings, "mosquitto_passwd_path", str(temp_passwd))

    with (
        patch(
            "app.bounded_contexts.device_registry.infrastructure.repositories.subprocess.run"
        ) as mock_run,
    ):
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )
        yield temp_passwd


# Client fixture configured with mock admin auth and SQLite database session overrides
@pytest.fixture(name="client")
def fixture_client(db_session):
    from app.main import app
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def dummy_lifespan(app):
        yield

    # Override get_db to return our in-memory SQLite session
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    # Save original lifespan and bypass it during TestClient tests
    original_lifespan = app.router.lifespan_context
    app.router.lifespan_context = dummy_lifespan

    # Stub authentication as admin
    fake_admin = SimpleNamespace(
        id=Device.id, email="admin@aifom.local", role="admin", is_active=True
    )
    app.dependency_overrides[security_module.get_current_user] = lambda: fake_admin
    app.dependency_overrides[security_module.require_admin] = lambda: fake_admin
    app.dependency_overrides[identity_dependencies.get_current_user] = lambda: fake_admin
    app.dependency_overrides[identity_dependencies.require_admin] = lambda: fake_admin

    try:
        from fastapi.testclient import TestClient

        with TestClient(app) as c:
            yield c
    finally:
        # Restore lifespan and dependency overrides
        app.router.lifespan_context = original_lifespan
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(security_module.get_current_user, None)
        app.dependency_overrides.pop(security_module.require_admin, None)
        app.dependency_overrides.pop(identity_dependencies.get_current_user, None)
        app.dependency_overrides.pop(identity_dependencies.require_admin, None)


# -------------------------------------------------------------------------
# 1. Device A cannot impersonate Device B (ACL parser & logic validation)
# -------------------------------------------------------------------------


def parse_acl_file(filepath: Path) -> list:
    rules = []
    current_user = None
    with open(filepath, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) >= 2 and parts[0] == "user":
                current_user = parts[1]
            elif len(parts) >= 3 and parts[0] == "topic":
                action = parts[1]
                topic = parts[2]
                rules.append(
                    {"type": "user", "user": current_user, "action": action, "pattern": topic}
                )
            elif len(parts) >= 3 and parts[0] == "pattern":
                action = parts[1]
                topic = parts[2]
                rules.append({"type": "pattern", "action": action, "pattern": topic})
    return rules


def match_topic(pattern: str, topic: str, username: str) -> bool:
    pattern = pattern.replace("%u", username)
    pattern_parts = pattern.split("/")
    topic_parts = topic.split("/")

    for i, p_part in enumerate(pattern_parts):
        if p_part == "#":
            return True
        if i >= len(topic_parts):
            return False
        t_part = topic_parts[i]
        if p_part == "+":
            continue
        if p_part != t_part:
            return False
    return len(pattern_parts) == len(topic_parts)


def check_permission(rules: list, username: str, topic: str, action: str) -> bool:
    for rule in rules:
        if rule["type"] == "user":
            if rule["user"] != username:
                continue
        # Check action compatibility
        rule_action = rule["action"]
        if action == "read" and rule_action not in ("read", "readwrite"):
            continue
        if action == "write" and rule_action not in ("write", "readwrite"):
            continue
        if match_topic(rule["pattern"], topic, username):
            return True
    return False


def test_acl_enforces_per_device_isolation():
    root_dir = Path(__file__).resolve().parents[2]
    acl_path = root_dir / "infrastructure" / "mosquitto" / "config" / "acl"
    acl_prod_path = root_dir / "infrastructure" / "mosquitto" / "config" / "acl.prod"

    assert acl_path.exists(), f"ACL file not found at {acl_path}"
    assert acl_prod_path.exists(), f"ACL.prod file not found at {acl_prod_path}"

    rules_dev = parse_acl_file(acl_path)
    rules_prod = parse_acl_file(acl_prod_path)

    # Test for Device A and Device B
    username_a = "device-a-uid"
    username_b = "device-b-uid"

    # 1. Device A should write to its own telemetry and read its own commands
    assert (
        check_permission(rules_dev, username_a, "devices/device-a-uid/telemetry", "write") is True
    )
    assert check_permission(rules_dev, username_a, "devices/device-a-uid/commands", "read") is True
    assert (
        check_permission(rules_prod, username_a, "devices/device-a-uid/telemetry", "write") is True
    )
    assert check_permission(rules_prod, username_a, "devices/device-a-uid/commands", "read") is True

    # 2. Device A CANNOT write to Device B's telemetry or read Device B's commands (Isolation check)
    assert (
        check_permission(rules_dev, username_a, "devices/device-b-uid/telemetry", "write") is False
    )
    assert check_permission(rules_dev, username_a, "devices/device-b-uid/commands", "read") is False
    assert (
        check_permission(rules_prod, username_a, "devices/device-b-uid/telemetry", "write") is False
    )
    assert (
        check_permission(rules_prod, username_a, "devices/device-b-uid/commands", "read") is False
    )

    # 3. Device B CANNOT write/read Device A's topics
    assert (
        check_permission(rules_prod, username_b, "devices/device-a-uid/telemetry", "write") is False
    )
    assert (
        check_permission(rules_prod, username_b, "devices/device-a-uid/commands", "read") is False
    )

    # 4. Backend (aifom_backend) can read/write everything
    assert (
        check_permission(rules_prod, "aifom_backend", "devices/device-a-uid/telemetry", "read")
        is True
    )
    assert (
        check_permission(rules_prod, "aifom_backend", "devices/device-a-uid/commands", "write")
        is True
    )


# -------------------------------------------------------------------------
# 2. Password Hash & Passwd File Sync
# -------------------------------------------------------------------------


def test_hash_mqtt_password_validity():
    password = "super-secure-device-password-123!"
    hashed = device_repo.hash_mqtt_password(password)

    # Check format $7$71000$salt$hash
    assert hashed.startswith("$7$71000$")
    assert verify_mqtt_password(password, hashed) is True
    assert verify_mqtt_password("wrong-password", hashed) is False


def test_sync_mosquitto_passwd_updates_correctly(db_session, mock_passwd_io):
    # Pre-populate passwd file with default non-device users
    with open(mock_passwd_io, "w") as f:
        f.write("aifom_backend:some_pre_existing_hash_value\n")
        f.write("aifom_device:some_shared_hash_value\n")

    # Create test devices in DB
    device_1 = Device(
        device_uid="device-1-uid",
        name="Device One",
        mqtt_username="device-1-uid",
        mqtt_password_hash=device_repo.hash_mqtt_password("pass1"),
        status="online",
    )
    device_2 = Device(
        device_uid="device-2-uid",
        name="Device Two",
        mqtt_username="device-2-uid",
        mqtt_password_hash=device_repo.hash_mqtt_password("pass2"),
        status="online",
    )
    db_session.add(device_1)
    db_session.add(device_2)
    db_session.commit()

    # Sync passwd file
    device_repo.sync_mosquitto_passwd(db_session)

    # Read back contents
    with open(mock_passwd_io, "r") as f:
        lines = f.read().splitlines()

    passwd_dict = {}
    for line in lines:
        if ":" in line:
            parts = line.split(":", 1)
            passwd_dict[parts[0]] = parts[1]

    # Check that:
    # 1. Device credentials are synchronized
    assert "device-1-uid" in passwd_dict
    assert "device-2-uid" in passwd_dict
    assert verify_mqtt_password("pass1", passwd_dict["device-1-uid"]) is True
    assert verify_mqtt_password("pass2", passwd_dict["device-2-uid"]) is True

    # 2. Existing backend user is preserved
    assert passwd_dict["aifom_backend"] == "some_pre_existing_hash_value"


# -------------------------------------------------------------------------
# 3. Register Endpoint Logic
# -------------------------------------------------------------------------


def test_register_endpoint_generates_and_saves_unique_creds(client, db_session, monkeypatch):
    token = "super_secure_provisioning_token_abc"
    monkeypatch.setattr(settings, "device_provisioning_secret", token)

    response = client.post(
        f"/api/v1/devices/register?provisioning_token={token}",
        json={
            "device_uid": "esp32-integration-001",
            "name": "Integration Device",
            "firmware_version": "1.2.3",
        },
    )

    assert response.status_code == 200, f"Failed registration: {response.text}"
    body = response.json()

    assert body["device_uid"] == "esp32-integration-001"
    assert "mqtt_username" in body
    assert "mqtt_password" in body
    assert body["mqtt_username"] == "esp32-integration-001"
    assert len(body["mqtt_password"]) > 0

    # Assert DB state
    db_device = (
        db_session.query(Device).filter(Device.device_uid == "esp32-integration-001").first()
    )
    assert db_device is not None
    assert db_device.mqtt_username == "esp32-integration-001"
    assert db_device.mqtt_password_hash is not None

    # Verify DB hash matches returned raw password
    assert verify_mqtt_password(body["mqtt_password"], db_device.mqtt_password_hash) is True


# -------------------------------------------------------------------------
# 4. Rotation, Revocation, and Perms Retention
# -------------------------------------------------------------------------


def test_rotation_and_revocation_lifecycle(client, db_session, mock_passwd_io):
    # Pre-populate passwd with aifom_backend
    with open(mock_passwd_io, "w") as f:
        f.write("aifom_backend:some_hash\n")

    # Create a device in DB
    dev_uid = "esp32-lifecycle-device"
    device = Device(
        device_uid=dev_uid,
        name="Lifecycle Node",
        mqtt_username=dev_uid,
        mqtt_password_hash=device_repo.hash_mqtt_password("initial_pass"),
        status="online",
    )
    db_session.add(device)
    db_session.commit()

    # Pre-sync to write the initial credential to mock passwd file
    device_repo.sync_mosquitto_passwd(db_session)

    with open(mock_passwd_io, "r") as f:
        initial_passwd = f.read()
    assert dev_uid in initial_passwd

    # 1. Rotate credentials
    # Call endpoint, set publish_to_device=False so it doesn't try to send MQTT msg
    rotate_resp = client.post(
        f"/api/v1/devices/{dev_uid}/rotate-mqtt-creds?publish_to_device=false"
    )
    assert rotate_resp.status_code == 200
    r_body = rotate_resp.json()

    new_raw_pwd = r_body["mqtt_password"]
    assert new_raw_pwd != "initial_pass"
    assert r_body["mqtt_username"] == dev_uid

    # Check DB is not promoted until a matching ACK is received.
    db_session.expire_all()
    rotated_device = db_session.query(Device).filter(Device.device_uid == dev_uid).first()
    assert rotated_device.mqtt_username == dev_uid
    assert verify_mqtt_password("initial_pass", rotated_device.mqtt_password_hash) is True
    assert "pending_mqtt_creds" in rotated_device.metadata_
    pending = rotated_device.metadata_["pending_mqtt_creds"]
    assert pending["username"] == dev_uid
    assert "raw_password" not in pending

    # Check passwd file still contains the current active credential.
    with open(mock_passwd_io, "r") as f:
        rotated_passwd_content = f.read()

    # Retrieve the new hash from passwd file
    passwd_dict = {}
    for line in rotated_passwd_content.splitlines():
        if ":" in line:
            parts = line.split(":", 1)
            passwd_dict[parts[0]] = parts[1]

    assert dev_uid in passwd_dict
    assert verify_mqtt_password("initial_pass", passwd_dict[dev_uid]) is True
    assert passwd_dict["aifom_backend"] == "some_hash"

    # Verify that the topic structure or permissions for this username were NOT expanded
    # The topic rules in the configuration file still apply standard pattern rules for %u
    root_dir = Path(__file__).resolve().parents[2]
    acl_path = root_dir / "infrastructure" / "mosquitto" / "config" / "acl"
    rules = parse_acl_file(acl_path)
    # The permissions after rotation remain unchanged (device can only access its own topics)
    assert check_permission(rules, dev_uid, f"devices/{dev_uid}/telemetry", "write") is True
    assert check_permission(rules, dev_uid, "devices/other-device/telemetry", "write") is False

    # 2. Revoke credentials
    revoke_resp = client.post(f"/api/v1/devices/{dev_uid}/revoke-mqtt-creds")
    assert revoke_resp.status_code == 200

    # Check DB cleared
    db_session.expire_all()
    revoked_device = db_session.query(Device).filter(Device.device_uid == dev_uid).first()
    assert revoked_device.mqtt_username is None
    assert revoked_device.mqtt_password_hash is None
    assert "pending_mqtt_creds" not in (revoked_device.metadata_ or {})

    # Check passwd file cleared
    with open(mock_passwd_io, "r") as f:
        revoked_passwd_content = f.read()

    assert dev_uid not in revoked_passwd_content
    # aifom_backend remains
    assert "aifom_backend:some_hash" in revoked_passwd_content


# -------------------------------------------------------------------------
# 5. Shared Credential Rejected in Production
# -------------------------------------------------------------------------


def test_shared_credential_rejected_in_production(monkeypatch):
    # Mock OS environment for Settings validation
    prod_env = {
        "APP_ENV": "production",
        "JWT_SECRET": "0123456789abcdef" * 4,
        "JWT_REFRESH_SECRET": "fedcba9876543210" * 4,
        "OTA_TOKEN_SECRET": "00112233445566778899aabbccddeeff" * 2,
        "MQTT_USERNAME": "prod-mqtt-user",
        "MQTT_PASSWORD": "prod-mqtt-password-strong",
        "MQTT_TLS_ENABLED": "true",
        "MINIO_SECURE": "true",
        "AUTH_COOKIE_SECURE": "true",
        "AUTH_LEGACY_TOKEN_RESPONSE": "false",
        "MQTT_DEVICE_USER": "aifom_device",
    }

    with patch.dict(os.environ, prod_env):
        with pytest.raises((ValueError, ValidationError)) as excinfo:
            Settings()

        assert "mqtt_device_user cannot be 'aifom_device' in production" in str(excinfo.value)


# -------------------------------------------------------------------------
# 6. Pending Credential and ACK Rotation Flow Test
# -------------------------------------------------------------------------


def test_mqtt_credentials_rotation_pending_and_ack_flow(
    client, db_session, mock_passwd_io, monkeypatch
):
    # Setup mock passwd file
    with open(mock_passwd_io, "w") as f:
        f.write("aifom_backend:some_hash\n")

    # Create device in DB
    dev_uid = "rotation-test-device"
    device = Device(
        device_uid=dev_uid,
        name="Rotation Test Device",
        mqtt_username=dev_uid,
        mqtt_password_hash=device_repo.hash_mqtt_password("old-password"),
        status="online",
    )
    db_session.add(device)
    db_session.commit()

    # Capture command payload
    published_payloads = []

    def fake_publish(device_uid, payload):
        published_payloads.append(payload)

    from app.shared.infrastructure.messaging import mqtt_publisher

    monkeypatch.setattr(mqtt_publisher, "publish_device_command", fake_publish)

    # 1. Rotate credentials
    resp = client.post(f"/api/v1/devices/{dev_uid}/rotate-mqtt-creds")
    assert resp.status_code == 200
    body = resp.json()
    raw_password = body["mqtt_password"]
    assert raw_password != "old-password"

    # Verify DB: active credentials should STILL be "old-password"!
    db_session.expire_all()
    db_device = db_session.query(Device).filter(Device.device_uid == dev_uid).first()
    assert db_device.mqtt_username == dev_uid
    assert verify_mqtt_password("old-password", db_device.mqtt_password_hash) is True

    # Verify DB metadata contains pending credentials but NO raw password
    assert "pending_mqtt_creds" in db_device.metadata_
    pending = db_device.metadata_["pending_mqtt_creds"]
    assert pending["username"] == dev_uid
    assert "password_hash" in pending
    assert "raw_password" not in pending
    command_id = pending["command_id"]
    assert len(command_id) > 0

    # Verify command published contains both schemas
    assert len(published_payloads) == 1
    published = published_payloads[0]
    assert published["command_id"] == command_id
    assert published["username"] == dev_uid
    assert published["password"] == raw_password
    assert published["mqtt_username"] == dev_uid
    assert published["mqtt_password"] == raw_password

    # 2. ACK with wrong command_id should NOT promote
    from app.bounded_contexts.command_center.infrastructure.ack_handler import CommandAckHandler

    handler = CommandAckHandler(db_session)
    handler.handle_event(
        device_uid=dev_uid,
        event_type="command_result",
        payload={
            "command_id": "wrong-command-id",
            "type": "rotate_mqtt_creds",
            "status": "success",
        },
    )
    db_session.expire_all()
    db_device = db_session.query(Device).filter(Device.device_uid == dev_uid).first()
    # Still old-password
    assert verify_mqtt_password("old-password", db_device.mqtt_password_hash) is True
    assert "pending_mqtt_creds" in db_device.metadata_

    # 3. ACK with expired pending should NOT promote
    from datetime import datetime, timezone, timedelta

    db_device.metadata_["pending_mqtt_creds"]["expires_at"] = (
        datetime.now(timezone.utc) - timedelta(minutes=1)
    ).isoformat()
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(db_device, "metadata_")
    db_session.commit()

    handler.handle_event(
        device_uid=dev_uid,
        event_type="command_result",
        payload={
            "command_id": command_id,
            "type": "rotate_mqtt_creds",
            "status": "success",
        },
    )
    db_session.expire_all()
    db_device = db_session.query(Device).filter(Device.device_uid == dev_uid).first()
    # Still old-password since it expired
    assert verify_mqtt_password("old-password", db_device.mqtt_password_hash) is True
    assert "pending_mqtt_creds" in db_device.metadata_

    # 4. ACK with valid command_id and not expired should promote!
    db_device.metadata_["pending_mqtt_creds"]["expires_at"] = (
        datetime.now(timezone.utc) + timedelta(minutes=15)
    ).isoformat()
    flag_modified(db_device, "metadata_")
    db_session.commit()

    handler.handle_event(
        device_uid=dev_uid,
        event_type="command_result",
        payload={
            "command_id": command_id,
            "type": "rotate_mqtt_creds",
            "status": "success",
        },
    )
    db_session.expire_all()
    db_device = db_session.query(Device).filter(Device.device_uid == dev_uid).first()
    # Should be promoted to new raw password!
    assert verify_mqtt_password(raw_password, db_device.mqtt_password_hash) is True
    # pending_mqtt_creds should be deleted
    assert "pending_mqtt_creds" not in db_device.metadata_
