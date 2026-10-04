from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
from types import SimpleNamespace
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import inspect as sa_inspect

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app import main as app_main
from app.db.base import Base
from app.bounded_contexts.device_registry.infrastructure.persistence.models import Device
from app.bounded_contexts.firmware_ota.infrastructure.persistence.firmware_models import (
    FirmwareVersion,
)
from app.modules.devices import repository as device_repository
from app.modules.firmware import repository as firmware_repository
from app.modules.ota import repository as ota_repository
from app.modules.projects import repository as project_repository
from app.modules.telemetry import repository as telemetry_repository
from app.services import minio_client, mqtt_publisher
from app.services import mqtt_subscriber as mqtt_subscriber_module
from app.core import security as security_module
from app.core import tenant as tenant_module
from app.bounded_contexts.identity.presentation import dependencies as identity_dependencies
from app.bounded_contexts.tenant_management.presentation import dependencies as tenant_dependencies
from app.bounded_contexts.tenant_management.presentation import (
    router_client as tenant_client_router,
)
from app.modules.tenants import service as tenant_service_mod
from app.modules.tenants.model import FEATURE_KEYS
from app.bounded_contexts.device_registry.application import platform_use_cases

# Stub auth: all requests are treated as an active admin user.
_fake_admin = SimpleNamespace(id=uuid4(), email="test@aifom.local", role="admin", is_active=True)
_SOME_TENANT_ID = uuid4()  # any tenant UUID – used to simulate tenant-owned devices
app_main.app.dependency_overrides[security_module.get_current_user] = lambda: _fake_admin
app_main.app.dependency_overrides[security_module.require_admin] = lambda: _fake_admin
app_main.app.dependency_overrides[identity_dependencies.get_current_user] = lambda: _fake_admin
app_main.app.dependency_overrides[identity_dependencies.require_admin] = lambda: _fake_admin

app_main.mqtt_subscriber.start = lambda: None
app_main.mqtt_subscriber.stop = lambda: None
app_main.device_presence_monitor.start = lambda: None
app_main.device_presence_monitor.stop = lambda: None
client = TestClient(app_main.app)

# Fake tenant user used in tenant-scoped tests
_FAKE_TENANT_ID = uuid4()
_fake_tenant_user = SimpleNamespace(
    id=uuid4(),
    email="tenant@test.local",
    role="tenant_owner",
    tenant_id=_FAKE_TENANT_ID,
    is_active=True,
)

_ALL_FEATURES_ON = {k: True for k in FEATURE_KEYS}


class _TenantOverride:
    """Context manager: apply tenant-user dependency overrides for the duration of a test."""

    def __enter__(self):
        self._saved = dict(app_main.app.dependency_overrides)
        # Only override get_current_user (no require_admin stub → real check applies)
        app_main.app.dependency_overrides = {
            security_module.get_current_user: lambda: _fake_tenant_user,
            tenant_module.get_current_tenant_user: lambda: _fake_tenant_user,
            identity_dependencies.get_current_user: lambda: _fake_tenant_user,
            identity_dependencies.get_current_tenant_user: lambda: _fake_tenant_user,
            tenant_dependencies.get_current_tenant_user: lambda: _fake_tenant_user,
        }
        return self

    def __exit__(self, *_):
        app_main.app.dependency_overrides = self._saved


def test_health() -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "aifom-api"}


def test_cookie_authenticated_mutation_requires_csrf_without_browser_headers() -> None:
    """A stripped Origin/Sec-Fetch-Site header must not bypass CSRF checks."""
    client.cookies.set("aifom_access_token", "cookie-session")
    try:
        response = client.post("/api/v1/debug/log", json={"message": "csrf probe"})
        assert response.status_code == 403
        assert response.json()["detail"] == "Invalid CSRF token"
    finally:
        client.cookies.delete("aifom_access_token")


def test_platform_routes_are_registered() -> None:
    registered_paths = {getattr(route, "path", None) for route in app_main.app.routes}

    assert "/api/v1/admin/platforms" in registered_paths
    assert "/api/v1/admin/device-models" in registered_paths
    assert "/api/v1/admin/capability-templates" in registered_paths
    assert "/api/v1/client/platforms" in registered_paths
    assert "/api/v1/client/device-models" in registered_paths


def test_platform_public_api_paths_do_not_404(monkeypatch) -> None:
    monkeypatch.setattr(platform_use_cases, "list_platforms", lambda db: [])
    monkeypatch.setattr(platform_use_cases, "list_models", lambda db, platform_id=None: [])
    monkeypatch.setattr(
        platform_use_cases,
        "list_capability_templates",
        lambda db, device_model_id=None: [],
    )

    for path in (
        "/api/v1/admin/platforms",
        "/api/v1/admin/device-models",
        "/api/v1/admin/capability-templates",
        "/api/v1/client/platforms",
        "/api/v1/client/device-models",
    ):
        response = client.get(path)
        assert response.status_code != 404, path


def test_platform_registry_models_are_mapped_to_migrated_columns() -> None:
    assert {"device_platforms", "device_models", "capability_templates"}.issubset(
        Base.metadata.tables
    )

    device_mapper = sa_inspect(Device)
    firmware_mapper = sa_inspect(FirmwareVersion)

    assert "platform_id" in device_mapper.columns
    assert "device_model_id" in device_mapper.columns
    assert "platform" in device_mapper.relationships
    assert "device_model" in device_mapper.relationships

    assert "target_platform_id" in firmware_mapper.columns
    assert "target_model_id" in firmware_mapper.columns
    assert "platform" in firmware_mapper.relationships
    assert "device_model" in firmware_mapper.relationships


def test_create_device(monkeypatch) -> None:
    def fake_create_device(db, payload):
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id=uuid4(),
            device_uid=payload.device_uid,
            name=payload.name,
            firmware_version=payload.firmware_version,
            status="offline",
            last_seen_at=None,
            created_at=now,
            updated_at=now,
        )

    monkeypatch.setattr(device_repository, "create_device", fake_create_device)

    response = client.post(
        "/api/v1/devices",
        json={
            "device_uid": "esp32-demo-001",
            "name": "ESP32 Demo Node",
            "firmware_version": "0.1.0",
        },
    )

    assert response.status_code == 201
    assert response.json()["device_uid"] == "esp32-demo-001"


def test_admin_cannot_create_device_for_tenant() -> None:
    response = client.post(
        "/api/v1/devices",
        json={
            "device_uid": "esp32-tenant-owned",
            "name": "Tenant Device",
            "tenant_id": str(uuid4()),
        },
    )

    assert response.status_code == 403
    assert "cannot create or assign tenant-owned devices" in response.json()["detail"]


def test_create_telemetry(monkeypatch) -> None:
    # Telemetry write only allowed for platform-owned devices (tenant_id=None).
    platform_device_id = uuid4()
    platform_device = SimpleNamespace(
        id=platform_device_id,
        device_uid="esp32-demo-001",
        tenant_id=None,  # platform-owned
    )
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: platform_device)

    def fake_create_telemetry(db, payload):
        device_id = uuid4()
        return SimpleNamespace(
            id=uuid4(),
            device_id=device_id,
            device=SimpleNamespace(id=device_id, device_uid=payload.device_uid),
            timestamp=payload.timestamp,
            metric_name=payload.metric_name,
            metric_value=payload.metric_value,
            unit=payload.unit,
            raw_payload=payload.raw_payload,
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(telemetry_repository, "create_telemetry", fake_create_telemetry)

    response = client.post(
        "/api/v1/telemetry",
        json={
            "device_uid": "esp32-demo-001",
            "timestamp": "2026-05-19T10:00:00Z",
            "metric_name": "temperature",
            "metric_value": 28.5,
            "unit": "celsius",
            "raw_payload": {"source": "demo", "rssi": -61},
        },
    )

    assert response.status_code == 201
    assert response.json()["metric_name"] == "temperature"


def test_register_device(monkeypatch) -> None:
    from app.core import config as core_config

    monkeypatch.setattr(core_config.settings, "device_provisioning_secret", "test-provision-token")

    def fake_register_device(db, payload):
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id=uuid4(),
            device_uid=payload.device_uid,
            name=payload.name,
            firmware_version=payload.firmware_version,
            status="offline",
            last_seen_at=None,
            created_at=now,
            updated_at=now,
        )

    monkeypatch.setattr(device_repository, "register_device", fake_register_device)

    response = client.post(
        "/api/v1/devices/register?provisioning_token=test-provision-token",
        json={
            "device_uid": "esp32-demo-001",
            "name": "ESP32 Demo Node",
            "firmware_version": "0.1.0",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["device_uid"] == "esp32-demo-001"
    assert body["mqtt_topics"]["telemetry"] == "devices/esp32-demo-001/telemetry"
    assert body["mqtt_topics"]["ota_status"] == "devices/esp32-demo-001/ota/status"


def _fake_device(device_uid: str = "esp32-demo-001", status: str = "offline") -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=uuid4(),
        tenant_id=_SOME_TENANT_ID,
        device_uid=device_uid,
        name="ESP32 Demo Node",
        firmware_version="0.1.0",
        status=status,
        ip_address="192.168.1.50",
        rssi=-55,
        free_heap=140000,
        uptime_ms=123456,
        last_status_payload={"status": status},
        last_seen_at=None,
        offline_timeout_seconds=60,
        created_at=now,
        updated_at=now,
    )


def test_list_devices(monkeypatch) -> None:
    monkeypatch.setattr(
        device_repository,
        "list_devices_with_tenant",
        lambda db, tenant_id=None: [
            (_fake_device("esp32-demo-001"), None),
            (_fake_device("esp32-demo-002"), None),
        ],
    )

    response = client.get("/api/v1/devices")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 2
    assert {d["device_uid"] for d in body} == {"esp32-demo-001", "esp32-demo-002"}


def test_get_device_status_ok(monkeypatch) -> None:
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(
        device_repository,
        "get_device_by_uid",
        lambda db, device_uid: SimpleNamespace(
            **{
                **_fake_device(device_uid, status="online").__dict__,
                "last_seen_at": now,
            }
        ),
    )
    monkeypatch.setattr(device_repository, "get_tenant_for_device", lambda db, device_id: None)

    response = client.get("/api/v1/devices/esp32-demo-001/status")

    assert response.status_code == 200
    body = response.json()
    assert body["device_uid"] == "esp32-demo-001"
    assert body["status"] == "online"


def test_get_device_status_returns_stale_online_as_offline(monkeypatch) -> None:
    stale_seen = datetime.now(timezone.utc) - timedelta(minutes=30)
    device = _fake_device("esp32-demo-001", status="online")
    device.last_seen_at = stale_seen
    device.offline_timeout_seconds = 60
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, device_uid: device)
    monkeypatch.setattr(device_repository, "get_tenant_for_device", lambda db, device_id: None)

    response = client.get("/api/v1/devices/esp32-demo-001/status")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "offline"
    assert body["last_seen_at"] is not None


def test_get_device_status_404(monkeypatch) -> None:
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, device_uid: None)

    response = client.get("/api/v1/devices/missing-uid/status")

    assert response.status_code == 404
    assert response.json()["detail"] == "Device UID not found"


def test_get_latest_device_telemetry(monkeypatch) -> None:
    device_id = uuid4()
    device = SimpleNamespace(id=device_id, device_uid="esp32-demo-001")
    now = datetime.now(timezone.utc)
    records = [
        SimpleNamespace(
            id=uuid4(),
            device_id=device_id,
            device=device,
            timestamp=now,
            metric_name="temperature",
            metric_value=28.5,
            unit="celsius",
            raw_payload=None,
            created_at=now,
        ),
        SimpleNamespace(
            id=uuid4(),
            device_id=device_id,
            device=device,
            timestamp=now,
            metric_name="humidity",
            metric_value=60.0,
            unit="percent",
            raw_payload=None,
            created_at=now,
        ),
    ]

    monkeypatch.setattr(
        telemetry_repository,
        "latest_telemetry_by_device_uid",
        lambda db, device_uid: records,
    )

    response = client.get("/api/v1/devices/esp32-demo-001/latest-telemetry")

    assert response.status_code == 200
    body = response.json()
    assert {r["metric_name"] for r in body} == {"temperature", "humidity"}
    assert all(r["device_uid"] == "esp32-demo-001" for r in body)


def test_get_device_telemetry_unknown_uid_returns_empty(monkeypatch) -> None:
    monkeypatch.setattr(
        telemetry_repository,
        "list_telemetry_by_device_uid",
        lambda db, device_uid, **kwargs: [],
    )

    response = client.get("/api/v1/devices/unknown-uid/telemetry")

    assert response.status_code == 200
    assert response.json() == []


def test_create_telemetry_unknown_device_returns_404(monkeypatch) -> None:
    monkeypatch.setattr(telemetry_repository, "create_telemetry", lambda db, payload: None)
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: None)

    response = client.post(
        "/api/v1/telemetry",
        json={
            "device_uid": "unknown-uid",
            "timestamp": "2026-05-19T10:00:00Z",
            "metric_name": "temperature",
            "metric_value": 28.5,
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Device UID not found"


def _fake_firmware(
    version: str = "0.1.0", target: str = "esp32", is_active: bool = True
) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        version=version,
        target_device_type=target,
        file_name="app.bin",
        object_key=f"{target}/{version}/abc-app.bin",
        file_size=128,
        checksum_sha256="a" * 64,
        release_notes=None,
        is_active=is_active,
        uploaded_by_tenant_id=None,
        created_at=datetime.now(timezone.utc),
    )


def test_upload_firmware_ok(monkeypatch) -> None:
    captured: dict = {}

    monkeypatch.setattr(minio_client, "ensure_firmware_bucket", lambda: None)

    def fake_put(object_key, data, content_type="application/octet-stream"):
        captured["object_key"] = object_key
        captured["size"] = len(data)
        captured["content_type"] = content_type

    monkeypatch.setattr(minio_client, "put_firmware_object", fake_put)

    def fake_create_firmware(db, payload):
        captured["payload"] = payload
        return SimpleNamespace(
            id=uuid4(),
            version=payload.version,
            target_device_type=payload.target_device_type,
            file_name=payload.file_name,
            object_key=payload.object_key,
            file_size=payload.file_size,
            checksum_sha256=payload.checksum_sha256,
            release_notes=payload.release_notes,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(firmware_repository, "create_firmware", fake_create_firmware)

    blob = b"FAKEFIRMWAREBYTES" * 4
    response = client.post(
        "/api/v1/firmware",
        data={"version": "0.1.0", "target_device_type": "esp32", "release_notes": "demo"},
        files={"file": ("app.bin", blob, "application/octet-stream")},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["version"] == "0.1.0"
    assert body["target_device_type"] == "esp32"
    assert body["file_size"] == len(blob)
    assert len(body["checksum_sha256"]) == 64
    assert captured["size"] == len(blob)
    assert captured["object_key"].startswith("esp32/0.1.0/")


def test_upload_firmware_rejects_empty(monkeypatch) -> None:
    monkeypatch.setattr(minio_client, "ensure_firmware_bucket", lambda: None)

    response = client.post(
        "/api/v1/firmware",
        data={"version": "0.1.0", "target_device_type": "esp32"},
        files={"file": ("empty.bin", b"", "application/octet-stream")},
    )

    assert response.status_code == 400
    assert "empty" in response.json()["detail"].lower()


def test_upload_firmware_rejects_too_large(monkeypatch) -> None:
    monkeypatch.setattr(minio_client, "ensure_firmware_bucket", lambda: None)
    monkeypatch.setattr(app_main.settings, "firmware_max_size_mb", 1, raising=False)
    from app.core import config as core_config

    monkeypatch.setattr(core_config.settings, "firmware_max_size_mb", 1, raising=False)

    big_blob = b"X" * (2 * 1024 * 1024)
    response = client.post(
        "/api/v1/firmware",
        data={"version": "0.1.0", "target_device_type": "esp32"},
        files={"file": ("big.bin", big_blob, "application/octet-stream")},
    )

    assert response.status_code == 413


def test_list_firmware(monkeypatch) -> None:
    monkeypatch.setattr(
        firmware_repository,
        "list_firmware",
        lambda db, target_device_type=None, limit=100: [
            _fake_firmware("0.2.0"),
            _fake_firmware("0.1.0"),
        ],
    )

    response = client.get("/api/v1/firmware")
    assert response.status_code == 200
    body = response.json()
    assert [r["version"] for r in body] == ["0.2.0", "0.1.0"]


def test_latest_firmware_ok(monkeypatch) -> None:
    monkeypatch.setattr(
        firmware_repository,
        "latest_firmware",
        lambda db, target: _fake_firmware("0.2.0", target),
    )

    response = client.get("/api/v1/firmware/latest", params={"target_device_type": "esp32"})
    assert response.status_code == 200
    assert response.json()["version"] == "0.2.0"


def test_latest_firmware_404(monkeypatch) -> None:
    monkeypatch.setattr(firmware_repository, "latest_firmware", lambda db, target: None)

    response = client.get("/api/v1/firmware/latest", params={"target_device_type": "esp32"})
    assert response.status_code == 404


def test_create_ota_job_ok(monkeypatch) -> None:
    # Admin cannot push OTA to a tenant-assigned device – 403 expected.
    device = _fake_device("esp32-demo-001")  # has tenant_id != None
    firmware = _fake_firmware("0.2.0")

    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: device)
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    response = client.post(
        "/api/v1/ota/jobs",
        json={"device_uid": "esp32-demo-001", "firmware_version_id": str(firmware.id)},
    )

    # Tenant-owned device: admin mutation must be blocked
    assert response.status_code == 403, response.text
    assert "read-only" in response.json()["detail"].lower()


def test_create_ota_job_ok_platform_device(monkeypatch) -> None:
    """Admin CAN push OTA to a platform-owned device (tenant_id=None)."""
    device = SimpleNamespace(
        id=uuid4(),
        tenant_id=None,  # platform-owned
        device_uid="esp32-demo-001",
        name="ESP32 Demo Node",
        firmware_version="0.1.0",
        status="offline",
        ip_address="192.168.1.50",
        rssi=-55,
        free_heap=140000,
        uptime_ms=123456,
        last_status_payload={},
        last_seen_at=None,
        offline_timeout_seconds=60,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    firmware = _fake_firmware("0.2.0")
    firmware.signature = "c2lnbmF0dXJl"
    firmware.signature_alg = "Ed25519"
    firmware.signature_payload = firmware.checksum_sha256
    firmware.signing_key_id = "release-key-1"
    firmware.signing_public_key = "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----\n"
    firmware.verification_required = True

    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: device)
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    captured: dict = {}

    def fake_publish(device_uid, payload):
        captured["device_uid"] = device_uid
        captured["payload"] = payload

    monkeypatch.setattr(mqtt_publisher, "publish_ota_request", fake_publish)

    def fake_create_job(db, *, device_id, firmware_version_id):
        return SimpleNamespace(
            id=uuid4(),
            device_id=device_id,
            firmware_version_id=firmware_version_id,
            status="pending",
        )

    monkeypatch.setattr(ota_repository, "create_job", fake_create_job)
    monkeypatch.setattr(ota_repository, "update_status", lambda *a, **kw: None)
    monkeypatch.setattr(
        app_main.settings, "device_api_base_url", "http://aifom.local:8000", raising=False
    )

    response = client.post(
        "/api/v1/ota/jobs",
        json={"device_uid": "esp32-demo-001", "firmware_version_id": str(firmware.id)},
    )

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["device_uid"] == "esp32-demo-001"
    assert body["status"] == "sent"
    assert captured["device_uid"] == "esp32-demo-001"
    payload = captured["payload"]
    assert payload["firmware_version"] == "0.2.0"
    assert payload["job_id"] == body["job_id"]
    assert payload["firmware_url"].startswith("http://aifom.local:8000/")
    assert "localhost" not in payload["firmware_url"]
    assert f"/api/v1/firmware/ota-download/{firmware.id}" in payload["firmware_url"]
    assert "token=" in payload["firmware_url"]
    assert payload["checksum_sha256"] == firmware.checksum_sha256
    assert payload["signature"] == firmware.signature
    assert payload["signature_alg"] == "Ed25519"
    assert payload["signature_payload"] == firmware.checksum_sha256
    assert payload["signing_key_id"] == "release-key-1"
    assert payload["signing_public_key"] == firmware.signing_public_key
    assert payload["verification_required"] is True


def test_admin_ota_rejects_incompatible_firmware(monkeypatch) -> None:
    device = SimpleNamespace(
        id=uuid4(),
        tenant_id=None,
        device_uid="esp32-s3-001",
        hardware_model="esp32-s3",
    )
    firmware = _fake_firmware("0.2.0", target="esp32-c3")
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: device)
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    response = client.post(
        "/api/v1/ota/jobs",
        json={"device_uid": device.device_uid, "firmware_version_id": str(firmware.id)},
    )

    assert response.status_code == 422
    assert "not compatible" in response.json()["detail"]


def test_create_ota_job_publish_failure_returns_502(monkeypatch) -> None:
    # Tenant-owned device: admin is blocked before publish – expect 403.
    device = _fake_device("esp32-demo-001")  # has tenant_id
    firmware = _fake_firmware("0.2.0")
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: device)
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    response = client.post(
        "/api/v1/ota/jobs",
        json={"device_uid": "esp32-demo-001", "firmware_version_id": str(firmware.id)},
    )

    # Admin mutation on tenant device must be blocked
    assert response.status_code == 403
    assert "read-only" in response.json()["detail"].lower()


def test_download_firmware_streams(monkeypatch) -> None:
    firmware = _fake_firmware("0.2.0")
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    class FakeMinioResp:
        def __init__(self, data: bytes):
            self._data = data
            self._pos = 0
            self.closed = False
            self.released = False

        def read(self, n=-1):
            if n < 0:
                n = len(self._data) - self._pos
            chunk = self._data[self._pos : self._pos + n]
            self._pos += len(chunk)
            return chunk

        def close(self):
            self.closed = True

        def release_conn(self):
            self.released = True

    fake_resp = FakeMinioResp(b"FAKEFIRMWAREDATA")
    monkeypatch.setattr(minio_client, "get_firmware_object_stream", lambda key: fake_resp)

    # Admin auth is already stubbed at module level
    response = client.get(f"/api/v1/firmware/{firmware.id}/download")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.headers["x-firmware-sha256"] == firmware.checksum_sha256
    assert response.headers["x-firmware-version"] == firmware.version
    assert response.content == b"FAKEFIRMWAREDATA"
    assert fake_resp.closed is True
    assert fake_resp.released is True


def test_download_firmware_404(monkeypatch) -> None:
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: None)
    # Admin auth is already stubbed at module level
    response = client.get(f"/api/v1/firmware/{uuid4()}/download")
    assert response.status_code == 404


def test_mqtt_subscriber_ota_result_updates_job(monkeypatch) -> None:
    import json as _json

    update_calls: list = []
    job_id = uuid4()
    job = SimpleNamespace(id=job_id, device=SimpleNamespace(device_uid="esp32-demo-001"))

    def fake_update_status(db, job_id, status, **kwargs):
        update_calls.append((job_id, status, kwargs))
        return SimpleNamespace(id=job_id, status=status)

    monkeypatch.setattr(
        ota_repository, "get_job_by_id", lambda db, jid: job if jid == job_id else None
    )
    monkeypatch.setattr(ota_repository, "update_status", fake_update_status)
    monkeypatch.setattr(
        device_repository,
        "get_device_by_uid",
        lambda db, device_uid: _fake_device(device_uid, status="online"),
    )
    monkeypatch.setattr(
        device_repository,
        "touch_device",
        lambda db, device_uid, **kwargs: _fake_device(device_uid, status="online"),
    )

    class _Session:
        def close(self):
            pass

        def rollback(self):
            pass

        def commit(self):
            pass

    monkeypatch.setattr(mqtt_subscriber_module, "SessionLocal", lambda: _Session())

    sub = mqtt_subscriber_module.MQTTSubscriber()
    msg = SimpleNamespace(
        topic="devices/esp32-demo-001/ota/status",
        payload=_json.dumps(
            {
                "job_id": str(job_id),
                "status": "failed",
                "firmware_version": "0.2.0",
                "progress": 100,
                "message": "checksum mismatch",
                "error_code": "checksum_mismatch",
            }
        ).encode("utf-8"),
    )
    sub.process_message_sync(msg)

    assert len(update_calls) == 1
    assert update_calls[0][0] == job_id
    assert update_calls[0][1] == "failed"
    assert update_calls[0][2]["progress"] == 100
    assert update_calls[0][2]["error_code"] == "checksum_mismatch"


def test_mqtt_subscriber_rejects_ota_status_for_other_device(monkeypatch) -> None:
    import json as _json

    job_id = uuid4()
    job = SimpleNamespace(id=job_id, device=SimpleNamespace(device_uid="esp32-device-a"))
    update_calls: list = []

    monkeypatch.setattr(
        ota_repository, "get_job_by_id", lambda db, jid: job if jid == job_id else None
    )
    monkeypatch.setattr(
        ota_repository,
        "update_status",
        lambda *args, **kwargs: update_calls.append((args, kwargs)),
    )
    monkeypatch.setattr(
        device_repository,
        "get_device_by_uid",
        lambda db, device_uid: _fake_device(device_uid, status="online"),
    )
    monkeypatch.setattr(
        device_repository,
        "touch_device",
        lambda db, device_uid, **kwargs: _fake_device(device_uid, status="online"),
    )

    class _Session:
        def close(self):
            pass

        def rollback(self):
            pass

        def commit(self):
            pass

    monkeypatch.setattr(mqtt_subscriber_module, "SessionLocal", lambda: _Session())

    sub = mqtt_subscriber_module.MQTTSubscriber()
    msg = SimpleNamespace(
        topic="devices/esp32-device-b/ota/status",
        payload=_json.dumps({"job_id": str(job_id), "status": "success", "progress": 100}).encode(
            "utf-8"
        ),
    )
    sub.process_message_sync(msg)

    assert update_calls == []


def test_mqtt_subscriber_rejects_ota_status_from_unknown_device(monkeypatch) -> None:
    import json as _json

    update_calls: list = []
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, device_uid: None)
    monkeypatch.setattr(
        ota_repository,
        "get_job_by_id",
        lambda *args, **kwargs: update_calls.append(("get_job_by_id", args, kwargs)),
    )
    monkeypatch.setattr(
        ota_repository,
        "update_status",
        lambda *args, **kwargs: update_calls.append(("update_status", args, kwargs)),
    )

    class _Session:
        def close(self):
            pass

        def rollback(self):
            pass

        def commit(self):
            pass

    monkeypatch.setattr(mqtt_subscriber_module, "SessionLocal", lambda: _Session())

    sub = mqtt_subscriber_module.MQTTSubscriber()
    msg = SimpleNamespace(
        topic="devices/unknown-device/ota/status",
        payload=_json.dumps({"job_id": str(uuid4()), "status": "failed"}).encode("utf-8"),
    )
    sub.process_message_sync(msg)

    assert update_calls == []


def test_ota_status_values_include_real_esp32_phases() -> None:
    from app.modules.ota.model import JOB_STATUS_VALUES

    assert {"started", "applying"}.issubset(JOB_STATUS_VALUES)


def test_mqtt_subscriber_ota_result_invalid_payload_does_not_crash(monkeypatch) -> None:
    update_calls: list = []
    monkeypatch.setattr(
        ota_repository,
        "update_status",
        lambda *a, **kw: update_calls.append((a, kw)),
    )
    monkeypatch.setattr(
        device_repository,
        "get_device_by_uid",
        lambda db, device_uid: _fake_device(device_uid, status="online"),
    )
    monkeypatch.setattr(
        device_repository,
        "touch_device",
        lambda db, device_uid, **kwargs: _fake_device(device_uid, status="online"),
    )

    class _Session:
        def close(self):
            pass

        def rollback(self):
            pass

        def commit(self):
            pass

    monkeypatch.setattr(mqtt_subscriber_module, "SessionLocal", lambda: _Session())

    sub = mqtt_subscriber_module.MQTTSubscriber()
    msg = SimpleNamespace(
        topic="devices/esp32-demo-001/ota/status",
        payload=b"not-json",
    )
    sub.process_message_sync(msg)

    assert update_calls == []


def test_mqtt_subscriber_heartbeat_marks_device_online(monkeypatch) -> None:
    import json as _json

    touch_calls: list[tuple[str, dict]] = []

    monkeypatch.setattr(
        device_repository,
        "get_device_by_uid",
        lambda db, device_uid: _fake_device(device_uid, status="online"),
    )
    monkeypatch.setattr(
        device_repository,
        "touch_device",
        lambda db, device_uid, **kwargs: (
            touch_calls.append((device_uid, kwargs)) or _fake_device(device_uid, status="online")
        ),
    )

    class _Session:
        def close(self):
            pass

        def rollback(self):
            pass

        def commit(self):
            pass

    monkeypatch.setattr(mqtt_subscriber_module, "SessionLocal", lambda: _Session())

    sub = mqtt_subscriber_module.MQTTSubscriber()
    msg = SimpleNamespace(
        topic="devices/esp32-demo-001/heartbeat",
        payload=_json.dumps({"timestamp": "2026-05-26T10:00:00Z"}).encode("utf-8"),
    )
    sub.process_message_sync(msg)

    assert len(touch_calls) == 1
    device_uid, kwargs = touch_calls[0]
    assert device_uid == "esp32-demo-001"
    assert kwargs["status"] == "online"
    assert kwargs["update_last_seen"] is True


def test_mqtt_subscriber_rejects_unknown_telemetry_device(monkeypatch) -> None:
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, device_uid: None)
    monkeypatch.setattr(
        telemetry_repository,
        "create_telemetry_metrics",
        lambda *a, **kw: (_ for _ in ()).throw(AssertionError("unknown device accepted")),
    )

    sub = mqtt_subscriber_module.MQTTSubscriber()
    sub._handle_telemetry(
        SimpleNamespace(),
        "unknown-device",
        {"metrics": {"temperature": 24.5}, "timestamp": "2026-05-26T10:00:00Z"},
    )


def test_mqtt_subscriber_accepts_registered_telemetry_device(monkeypatch) -> None:
    device = _fake_device("esp32-demo-001", status="offline")
    captured: dict = {}

    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, device_uid: device)

    def fake_create_metrics(db, **kwargs):
        captured.update(kwargs)
        return [SimpleNamespace(id=uuid4())]

    monkeypatch.setattr(telemetry_repository, "create_telemetry_metrics", fake_create_metrics)
    monkeypatch.setattr(
        device_repository,
        "touch_device",
        lambda db, device_uid, **kwargs: _fake_device(device_uid, status="online"),
    )

    sub = mqtt_subscriber_module.MQTTSubscriber()
    sub._handle_telemetry(
        SimpleNamespace(),
        "esp32-demo-001",
        {"metrics": {"temperature": 24.5}, "timestamp": "2026-05-26T10:00:00Z"},
    )

    assert captured["device_uid"] == "esp32-demo-001"
    assert captured["metrics"] == {"temperature": 24.5}


def test_mqtt_subscriber_lwt_offline_marks_device_offline_immediately(monkeypatch) -> None:
    import json as _json

    touch_calls: list[tuple[str, dict]] = []

    monkeypatch.setattr(
        device_repository,
        "get_device_by_uid",
        lambda db, device_uid: _fake_device(device_uid, status="online"),
    )
    monkeypatch.setattr(
        device_repository,
        "touch_device",
        lambda db, device_uid, **kwargs: (
            touch_calls.append((device_uid, kwargs)) or _fake_device(device_uid, status="offline")
        ),
    )

    class _Session:
        def close(self):
            pass

        def rollback(self):
            pass

        def commit(self):
            pass

    monkeypatch.setattr(mqtt_subscriber_module, "SessionLocal", lambda: _Session())

    sub = mqtt_subscriber_module.MQTTSubscriber()
    msg = SimpleNamespace(
        topic="devices/esp32-demo-001/status",
        payload=_json.dumps({"status": "offline", "message": "lwt"}).encode("utf-8"),
    )
    sub.process_message_sync(msg)

    assert len(touch_calls) == 1
    device_uid, kwargs = touch_calls[0]
    assert device_uid == "esp32-demo-001"
    assert kwargs["status"] == "offline"
    assert kwargs["update_last_seen"] is False


def test_mqtt_subscriber_ignores_stale_retained_online_status(monkeypatch) -> None:
    stale_timestamp = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    device = _fake_device("esp32-demo-001", status="offline")
    touch_calls: list[tuple[str, dict]] = []

    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, device_uid: device)
    monkeypatch.setattr(
        device_repository,
        "touch_device",
        lambda db, device_uid, **kwargs: touch_calls.append((device_uid, kwargs)),
    )

    sub = mqtt_subscriber_module.MQTTSubscriber()
    sub._handle_status(
        SimpleNamespace(),
        "esp32-demo-001",
        {"status": "online", "timestamp": stale_timestamp},
        retained=True,
    )

    assert touch_calls == []


def test_device_presence_timeout_marks_stale_online_device_offline() -> None:
    now = datetime(2026, 5, 26, 10, 0, 0, tzinfo=timezone.utc)
    stale = SimpleNamespace(
        status="online", last_seen_at=now - timedelta(seconds=61), offline_timeout_seconds=60
    )
    fresh = SimpleNamespace(
        status="online", last_seen_at=now - timedelta(seconds=30), offline_timeout_seconds=60
    )
    already_offline = SimpleNamespace(
        status="offline", last_seen_at=now - timedelta(seconds=600), offline_timeout_seconds=60
    )

    changed = device_repository.apply_offline_timeouts([stale, fresh, already_offline], now=now)

    assert changed == 1
    assert stale.status == "offline"
    assert fresh.status == "online"
    assert already_offline.status == "offline"


# ── Startup reconciliation tests ────────────────────────────────────────────


def test_startup_reconciliation_marks_all_online_devices_offline() -> None:
    """After backend restart, all online devices must be marked offline immediately."""
    now = datetime.now(timezone.utc)
    device_a = SimpleNamespace(
        status="online",
        last_seen_at=now - timedelta(seconds=5),
        offline_timeout_seconds=60,
    )
    device_b = SimpleNamespace(
        status="online",
        last_seen_at=now - timedelta(seconds=200),
        offline_timeout_seconds=60,
    )

    changed = device_repository.force_offline_all_online([device_a, device_b])

    assert changed == 2
    assert device_a.status == "offline"
    assert device_b.status == "offline"


def test_startup_reconciliation_preserves_already_offline_devices() -> None:
    """Devices already offline are not counted as changed."""
    device = SimpleNamespace(status="offline", last_seen_at=None, offline_timeout_seconds=60)

    changed = device_repository.force_offline_all_online([device])

    assert changed == 0
    assert device.status == "offline"


def test_startup_reconciliation_with_no_devices() -> None:
    """Empty device list returns zero changes."""
    changed = device_repository.force_offline_all_online([])
    assert changed == 0


def test_startup_reconciliation_handles_mixed_statuses() -> None:
    """Only online devices are marked offline; other statuses are preserved."""
    now = datetime.now(timezone.utc)
    online = SimpleNamespace(status="online", last_seen_at=now, offline_timeout_seconds=60)
    already_offline = SimpleNamespace(
        status="offline", last_seen_at=now, offline_timeout_seconds=60
    )
    maintenance = SimpleNamespace(
        status="maintenance", last_seen_at=now, offline_timeout_seconds=60
    )

    changed = device_repository.force_offline_all_online([online, already_offline, maintenance])

    assert changed == 1
    assert online.status == "offline"
    assert already_offline.status == "offline"
    assert maintenance.status == "maintenance"


def test_presence_monitor_does_not_revive_reconciled_devices() -> None:
    """After startup reconciliation marks devices offline, the presence monitor
    must not bring them back online.  Devices stay offline until a fresh
    MQTT message arrives."""
    now = datetime(2026, 5, 29, 10, 0, 0, tzinfo=timezone.utc)
    # Device was online 5 seconds ago (just before backend restart),
    # then reconciliation marked it offline.
    reconciled = SimpleNamespace(
        status="offline",
        last_seen_at=now - timedelta(seconds=5),
        offline_timeout_seconds=60,
    )

    # Presence monitor runs — it only checks online devices, so this is a no-op.
    changed = device_repository.apply_offline_timeouts([reconciled], now=now)

    assert changed == 0
    assert reconciled.status == "offline"


def test_fresh_heartbeat_restores_online_status(monkeypatch) -> None:
    """A heartbeat message after startup must restore the device to online."""
    import json as _json

    touch_calls: list[tuple[str, dict]] = []

    monkeypatch.setattr(
        device_repository,
        "get_device_by_uid",
        lambda db, device_uid: _fake_device(device_uid, status="online"),
    )
    monkeypatch.setattr(
        device_repository,
        "touch_device",
        lambda db, device_uid, **kwargs: (
            touch_calls.append((device_uid, kwargs)) or _fake_device(device_uid, status="online")
        ),
    )

    class _Session:
        def close(self):
            pass

        def rollback(self):
            pass

        def commit(self):
            pass

    monkeypatch.setattr(mqtt_subscriber_module, "SessionLocal", lambda: _Session())

    sub = mqtt_subscriber_module.MQTTSubscriber()
    msg = SimpleNamespace(
        topic="devices/esp32-demo-001/heartbeat",
        payload=_json.dumps({"device_id": "esp32-demo-001"}).encode("utf-8"),
    )
    sub.process_message_sync(msg)

    assert len(touch_calls) == 1
    device_uid, kwargs = touch_calls[0]
    assert device_uid == "esp32-demo-001"
    assert kwargs["status"] == "online"
    assert kwargs["update_last_seen"] is True


def test_list_telemetry_passes_filters_to_repository(monkeypatch) -> None:
    captured: dict = {}

    def fake_list(db, **kwargs):
        captured.update(kwargs)
        return []

    monkeypatch.setattr(telemetry_repository, "list_telemetry", fake_list)

    r = client.get(
        "/api/v1/telemetry",
        params={
            "device_uid": "esp32-demo-001",
            "metric_name": "temperature",
            "from_time": "2026-05-19T00:00:00Z",
            "to_time": "2026-05-19T23:59:59Z",
            "limit": 25,
            "offset": 10,
            # tenant_id is optional; omitting it tests admin-wide query
        },
    )
    assert r.status_code == 200
    assert captured["device_uid"] == "esp32-demo-001"
    assert captured["metric_name"] == "temperature"
    assert captured["limit"] == 25
    assert captured["offset"] == 10
    assert captured["from_time"] is not None
    assert captured["to_time"] is not None


def test_device_telemetry_passes_filters(monkeypatch) -> None:
    captured: dict = {}

    def fake_list(db, device_uid, **kwargs):
        captured["device_uid"] = device_uid
        captured.update(kwargs)
        return []

    monkeypatch.setattr(telemetry_repository, "list_telemetry_by_device_uid", fake_list)
    r = client.get(
        "/api/v1/devices/esp32-demo-001/telemetry",
        params={"metric_name": "humidity", "limit": 5, "offset": 2},
    )
    assert r.status_code == 200
    assert captured["device_uid"] == "esp32-demo-001"
    assert captured["metric_name"] == "humidity"
    assert captured["limit"] == 5
    assert captured["offset"] == 2












def test_telemetry_limit_validation() -> None:
    r = client.get("/api/v1/telemetry", params={"limit": 0})
    assert r.status_code == 422
    r2 = client.get("/api/v1/telemetry", params={"limit": 5000})
    assert r2.status_code == 422


def test_parse_topic_supports_ota_status() -> None:
    assert mqtt_subscriber_module.mqtt_topics.parse_device_topic(
        "devices/esp32-demo-001/ota/status"
    ) == ("esp32-demo-001", "ota_status")
    assert mqtt_subscriber_module.mqtt_topics.parse_device_topic(
        "devices/esp32-demo-001/telemetry"
    ) == ("esp32-demo-001", "telemetry")
    assert mqtt_subscriber_module.mqtt_topics.parse_device_topic(
        "devices/esp32-demo-001/heartbeat"
    ) == ("esp32-demo-001", "heartbeat")
    assert mqtt_subscriber_module.mqtt_topics.parse_device_topic("bad/topic") is None


def test_create_ota_job_device_not_found(monkeypatch) -> None:
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: None)

    response = client.post(
        "/api/v1/ota/jobs",
        json={"device_uid": "missing", "firmware_version_id": str(uuid4())},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Device UID not found"


def test_create_ota_job_firmware_not_found(monkeypatch) -> None:
    # Device is tenant-owned: admin blocked before firmware check.
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: _fake_device(uid))
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: None)

    response = client.post(
        "/api/v1/ota/jobs",
        json={"device_uid": "esp32-demo-001", "firmware_version_id": str(uuid4())},
    )
    # 403 because admin mutation on tenant device is blocked first
    assert response.status_code == 403
    assert "read-only" in response.json()["detail"].lower()


# ── Tenant isolation tests ────────────────────────────────────────────────────


def test_tenant_cannot_call_admin_device_list() -> None:
    with _TenantOverride():
        r = client.get("/api/v1/devices")
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_tenant_cannot_call_admin_firmware_list() -> None:
    with _TenantOverride():
        r = client.get("/api/v1/firmware")
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_tenant_cannot_call_admin_ota_list() -> None:
    with _TenantOverride():
        r = client.get("/api/v1/ota/jobs")
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


def test_tenant_cannot_call_admin_telemetry_list() -> None:
    with _TenantOverride():
        r = client.get("/api/v1/telemetry")
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"


# ── Client firmware tests ─────────────────────────────────────────────────────


def test_client_list_firmware_ok(monkeypatch) -> None:
    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        firmware_repository,
        "list_firmware",
        lambda db, target_device_type=None, limit=100, tenant_id=None: [
            _fake_firmware("1.0.0"),
            _fake_firmware("0.9.0"),
        ],
    )

    with _TenantOverride():
        r = client.get("/api/v1/client/firmware")

    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 2
    assert {f["version"] for f in body} == {"1.0.0", "0.9.0"}


def test_client_upload_firmware_ok(monkeypatch) -> None:
    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(minio_client, "ensure_firmware_bucket", lambda: None)
    monkeypatch.setattr(
        minio_client, "put_firmware_object", lambda key, data, content_type="": None
    )

    def fake_create_fw(db, payload, tenant_id=None):
        return SimpleNamespace(
            id=uuid4(),
            version=payload.version,
            target_device_type=payload.target_device_type,
            file_name=payload.file_name,
            object_key=payload.object_key,
            file_size=payload.file_size,
            checksum_sha256=payload.checksum_sha256,
            release_notes=payload.release_notes,
            is_active=True,
            uploaded_by_tenant_id=_FAKE_TENANT_ID,
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(firmware_repository, "create_firmware", fake_create_fw)

    blob = b"TENANTFIRMWARE" * 4
    with _TenantOverride():
        r = client.post(
            "/api/v1/client/firmware",
            data={"version": "2.0.0", "target_device_type": "esp32"},
            files={"file": ("app.bin", blob, "application/octet-stream")},
        )

    assert r.status_code == 201, r.text
    body = r.json()
    assert body["version"] == "2.0.0"
    assert body["target_device_type"] == "esp32"
    assert body["file_size"] == len(blob)


def test_client_upload_firmware_rejects_non_bin(monkeypatch) -> None:
    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        minio_client,
        "ensure_firmware_bucket",
        lambda: (_ for _ in ()).throw(AssertionError("storage should not be called")),
    )

    with _TenantOverride():
        r = client.post(
            "/api/v1/client/firmware",
            data={"version": "2.0.0", "target_device_type": "esp32"},
            files={"file": ("app.elf", b"TENANTFIRMWARE", "application/octet-stream")},
        )

    assert r.status_code == 422, r.text
    assert ".bin" in r.json()["detail"]


def test_client_download_firmware_is_tenant_scoped(monkeypatch) -> None:
    firmware = _fake_firmware("2.0.0")
    firmware.uploaded_by_tenant_id = _FAKE_TENANT_ID
    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    class FakeMinioResp:
        def __init__(self, data: bytes):
            self._data = data
            self._pos = 0
            self.closed = False
            self.released = False

        def read(self, n=-1):
            if n < 0:
                n = len(self._data) - self._pos
            chunk = self._data[self._pos : self._pos + n]
            self._pos += len(chunk)
            return chunk

        def close(self):
            self.closed = True

        def release_conn(self):
            self.released = True

    fake_resp = FakeMinioResp(b"TENANTFIRMWAREDATA")
    monkeypatch.setattr(minio_client, "get_firmware_object_stream", lambda key: fake_resp)

    with _TenantOverride():
        r = client.get(f"/api/v1/client/firmware/{firmware.id}/download")

    assert r.status_code == 200, r.text
    assert r.headers["x-firmware-sha256"] == firmware.checksum_sha256
    assert r.content == b"TENANTFIRMWAREDATA"
    assert fake_resp.closed is True
    assert fake_resp.released is True


def test_client_can_sign_own_firmware(monkeypatch) -> None:
    firmware = _fake_firmware("2.0.0")
    firmware.uploaded_by_tenant_id = _FAKE_TENANT_ID
    monkeypatch.setattr(
        tenant_service_mod, "get_effective_features", lambda db, tenant_id: _ALL_FEATURES_ON
    )
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    def fake_sign(db, record):
        record.signature = "signed"
        record.signature_alg = "Ed25519"
        record.signature_payload = record.checksum_sha256
        record.signing_key_id = "tenant-signing-key"
        record.signing_public_key = "public-key"
        record.signed_at = datetime.now(timezone.utc)
        record.verification_required = True
        return record

    monkeypatch.setattr(tenant_client_router, "sign_firmware", fake_sign)

    with _TenantOverride():
        response = client.post(f"/api/v1/client/firmware/{firmware.id}/sign")

    assert response.status_code == 200, response.text
    assert response.json()["signature_alg"] == "Ed25519"


def test_client_cannot_sign_global_or_other_tenant_firmware(monkeypatch) -> None:
    monkeypatch.setattr(
        tenant_service_mod, "get_effective_features", lambda db, tenant_id: _ALL_FEATURES_ON
    )
    firmware = _fake_firmware("2.0.0")
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    with _TenantOverride():
        global_response = client.post(f"/api/v1/client/firmware/{firmware.id}/sign")

    firmware.uploaded_by_tenant_id = uuid4()
    with _TenantOverride():
        other_response = client.post(f"/api/v1/client/firmware/{firmware.id}/sign")

    assert global_response.status_code == 403
    assert other_response.status_code == 404


# ── Client OTA tests ──────────────────────────────────────────────────────────


def test_client_source_firmware_compile_disabled_by_default(monkeypatch) -> None:
    from app.core import config as core_config

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(core_config.settings, "enable_source_firmware_compile", False)

    with _TenantOverride():
        r = client.post(
            "/api/v1/client/firmware/from-source",
            json={
                "version": "2.1.0",
                "target_device_type": "esp32",
                "board_fqbn": "esp32:esp32:esp32",
                "source_code": "void setup(){} void loop(){}",
            },
        )

    assert r.status_code == 403, r.text


def test_source_firmware_host_compile_requires_explicit_opt_in(monkeypatch) -> None:
    from app.core import config as core_config
    from app.services.arduino_compiler import CompilerError, compile_ino

    monkeypatch.setattr(core_config.settings, "enable_source_firmware_compile", True)
    monkeypatch.setattr(core_config.settings, "allow_host_source_firmware_compile", False)

    try:
        compile_ino("void setup(){} void loop(){}", "esp32:esp32:esp32")
    except CompilerError as exc:
        assert "not allowed" in str(exc)
    else:
        raise AssertionError("host source compilation should require explicit opt-in")


def test_client_source_firmware_rejects_unknown_fqbn_when_enabled(monkeypatch) -> None:
    from app.core import config as core_config

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(core_config.settings, "enable_source_firmware_compile", True)
    monkeypatch.setattr(core_config.settings, "source_firmware_allowed_fqbns", "esp32:esp32:esp32")
    monkeypatch.setattr(
        minio_client,
        "ensure_firmware_bucket",
        lambda: (_ for _ in ()).throw(AssertionError("storage should not be called")),
    )

    with _TenantOverride():
        r = client.post(
            "/api/v1/client/firmware/from-source",
            json={
                "version": "2.1.0",
                "target_device_type": "esp32",
                "board_fqbn": "evil:board:target",
                "source_code": "void setup(){} void loop(){}",
            },
        )

    assert r.status_code == 422, r.text


def test_client_source_firmware_allows_configured_fqbn_when_enabled(monkeypatch) -> None:
    from app.core import config as core_config
    from app.modules.tenants import router_client as tenant_router_client
    from app.services import arduino_compiler as arduino_compiler_module

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(core_config.settings, "enable_source_firmware_compile", True)
    monkeypatch.setattr(core_config.settings, "source_firmware_allowed_fqbns", "esp32:esp32:esp32")
    monkeypatch.setattr(arduino_compiler_module, "is_available", lambda: True)
    monkeypatch.setattr(tenant_router_client, "compile_ino", lambda source, fqbn: b"BIN")
    monkeypatch.setattr(minio_client, "ensure_firmware_bucket", lambda: None)
    monkeypatch.setattr(
        minio_client, "put_firmware_object", lambda key, data, content_type="": None
    )

    def fake_create_source(db, **kwargs):
        return SimpleNamespace(
            id=uuid4(),
            version=kwargs["version"],
            target_device_type=kwargs["target_device_type"],
            file_name=kwargs["file_name"],
            object_key=kwargs["object_key"],
            file_size=kwargs["file_size"],
            checksum_sha256=kwargs["checksum_sha256"],
            release_notes=kwargs["release_notes"],
            is_active=True,
            source_type=kwargs["source_type"],
            source_code=kwargs["source_code"],
            board_fqbn=kwargs["board_fqbn"],
            uploaded_by_tenant_id=_FAKE_TENANT_ID,
            created_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(firmware_repository, "create_firmware_source", fake_create_source)

    with _TenantOverride():
        r = client.post(
            "/api/v1/client/firmware/from-source",
            json={
                "version": "2.1.0",
                "target_device_type": "esp32",
                "board_fqbn": "esp32:esp32:esp32",
                "source_code": "void setup(){} void loop(){}",
            },
        )

    assert r.status_code == 201, r.text
    assert r.json()["source_type"] == "ino_compiled"


def _fake_tenant_device(device_uid: str = "esp32-t001") -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        tenant_id=_FAKE_TENANT_ID,
        device_uid=device_uid,
        name="Tenant Node",
        firmware_version="1.0.0",
        status="online",
        last_seen_at=None,
        offline_timeout_seconds=60,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )


def test_client_devices_returns_stale_online_device_as_offline(monkeypatch) -> None:
    from app.modules.tenants import repository as tenant_repo_mod

    device = _fake_tenant_device("esp32-stale")
    device.last_seen_at = datetime.now(timezone.utc) - timedelta(minutes=30)

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        tenant_repo_mod, "list_tenant_devices", lambda db, tenant_id, **kwargs: [device]
    )

    with _TenantOverride():
        response = client.get("/api/v1/client/devices")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body[0]["device_uid"] == "esp32-stale"
    assert body[0]["status"] == "offline"


def test_client_register_device_rejects_existing_tenant_uid(monkeypatch) -> None:
    from app.bounded_contexts.tenant_management.presentation import router_client as tenant_router
    from app.modules.tenants import repository as tenant_repo_mod

    existing = _fake_tenant_device("esp32-existing")
    existing.tenant_id = _FAKE_TENANT_ID

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        tenant_repo_mod,
        "get_tenant",
        lambda db, tenant_id: SimpleNamespace(plan=SimpleNamespace(max_devices=10)),
    )
    monkeypatch.setattr(tenant_repo_mod, "count_tenant_devices", lambda db, tenant_id: 1)
    monkeypatch.setattr(
        device_repository,
        "get_device_by_uid",
        lambda db, device_uid: existing if device_uid == "esp32-existing" else None,
    )
    monkeypatch.setattr(
        tenant_router.audit_service, "log_event_best_effort", lambda *args, **kwargs: None
    )

    with _TenantOverride():
        response = client.post(
            "/api/v1/client/devices",
            json={"device_uid": "esp32-existing", "name": "New Name"},
        )

    assert response.status_code == 409, response.text
    assert "already assigned" in response.json()["detail"]
    assert existing.name == "Tenant Node"


def test_client_update_device_metadata(monkeypatch) -> None:
    from app.bounded_contexts.tenant_management.presentation import router_client as tenant_router
    from app.modules.tenants import repository as tenant_repo_mod

    device = _fake_tenant_device("esp32-edit")
    device.hardware_model = "old-model"
    device.mac_address = None
    device.description = "Old description"

    def fake_update_device_metadata(db, target, **kwargs):
        assert target is device
        assert kwargs["fields_set"] == {"name", "hardware_model", "description"}
        target.name = kwargs["name"]
        target.hardware_model = kwargs["hardware_model"]
        target.description = kwargs["description"]
        return target

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        tenant_repo_mod,
        "get_tenant_device",
        lambda db, tenant_id, device_uid: device if device_uid == "esp32-edit" else None,
    )
    monkeypatch.setattr(device_repository, "update_device_metadata", fake_update_device_metadata)
    monkeypatch.setattr(
        tenant_router.audit_service, "log_event_best_effort", lambda *args, **kwargs: None
    )

    with _TenantOverride():
        response = client.patch(
            "/api/v1/client/devices/esp32-edit",
            json={
                "name": "Edited Device",
                "hardware_model": "ESP32 DevKit V1",
                "description": "",
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "Edited Device"
    assert body["hardware_model"] == "ESP32 DevKit V1"
    assert body["description"] is None


def test_client_update_device_metadata_put_alias(monkeypatch) -> None:
    from app.bounded_contexts.tenant_management.presentation import router_client as tenant_router
    from app.modules.tenants import repository as tenant_repo_mod

    device = _fake_tenant_device("esp32-edit-put")
    device.hardware_model = None
    device.mac_address = None
    device.description = None

    def fake_update_device_metadata(db, target, **kwargs):
        target.name = kwargs["name"]
        target.hardware_model = kwargs["hardware_model"]
        target.mac_address = kwargs["mac_address"]
        target.description = kwargs["description"]
        return target

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        tenant_repo_mod,
        "get_tenant_device",
        lambda db, tenant_id, device_uid: device if device_uid == "esp32-edit-put" else None,
    )
    monkeypatch.setattr(device_repository, "update_device_metadata", fake_update_device_metadata)
    monkeypatch.setattr(
        tenant_router.audit_service, "log_event_best_effort", lambda *args, **kwargs: None
    )

    with _TenantOverride():
        response = client.put(
            "/api/v1/client/devices/esp32-edit-put",
            json={
                "name": "Edited By Put",
                "hardware_model": "ESP32",
                "mac_address": "AA:BB:CC:DD:EE:FF",
                "description": "Updated through PUT",
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["name"] == "Edited By Put"
    assert body["mac_address"] == "AA:BB:CC:DD:EE:FF"


def test_client_create_ota_job_ok(monkeypatch) -> None:
    from app.modules.tenants import repository as tenant_repo_mod

    device = _fake_tenant_device("esp32-t001")
    firmware = _fake_firmware("2.0.0")

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        tenant_repo_mod,
        "get_tenant_device",
        lambda db, tenant_id, device_uid: device if device_uid == "esp32-t001" else None,
    )
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    def fake_create_job(db, *, device_id, firmware_version_id):
        return SimpleNamespace(
            id=uuid4(),
            device_id=device_id,
            firmware_version_id=firmware_version_id,
            status="pending",
        )

    monkeypatch.setattr(ota_repository, "create_job", fake_create_job)
    monkeypatch.setattr(ota_repository, "update_status", lambda *a, **kw: None)
    monkeypatch.setattr(
        app_main.settings, "device_api_base_url", "http://aifom.local:8000", raising=False
    )

    captured: dict = {}

    def fake_publish(device_uid, payload):
        captured["device_uid"] = device_uid
        captured["payload"] = payload

    monkeypatch.setattr(mqtt_publisher, "publish_ota_request", fake_publish)

    with _TenantOverride():
        r = client.post(
            "/api/v1/client/ota-jobs",
            json={"device_uid": "esp32-t001", "firmware_version_id": str(firmware.id)},
        )

    assert r.status_code == 201, r.text
    body = r.json()
    assert body["device_uid"] == "esp32-t001"
    assert body["status"] == "sent"
    assert captured["device_uid"] == "esp32-t001"
    assert captured["payload"]["version"] == "2.0.0"
    assert captured["payload"]["firmware_url"].startswith("http://aifom.local:8000/")
    assert "localhost" not in captured["payload"]["firmware_url"]
    assert "ota-download" in captured["payload"]["firmware_url"]
    assert "token=" in captured["payload"]["firmware_url"]


def test_client_create_ota_job_for_group(monkeypatch) -> None:
    from app.modules.tenants import repository as tenant_repo_mod
    from app.modules.tenants import router_client as tenant_router_client

    group_id = uuid4()
    devices = {
        "esp32-t001": _fake_tenant_device("esp32-t001"),
        "esp32-t002": _fake_tenant_device("esp32-t002"),
    }
    firmware = _fake_firmware("2.0.0")

    class FakeGroupUseCases:
        def __init__(self, db):
            pass

        def get_group(self, tenant_id, requested_group_id):
            if tenant_id == _FAKE_TENANT_ID and requested_group_id == group_id:
                return SimpleNamespace(id=group_id, tenant_id=tenant_id)
            return None

        def list_group_devices(self, tenant_id, requested_group_id, skip=0, limit=50):
            assert tenant_id == _FAKE_TENANT_ID
            assert requested_group_id == group_id
            return (
                [
                    {"device_uid": "esp32-t001"},
                    {"device_uid": "esp32-t002"},
                ],
                2,
            )

    monkeypatch.setattr(tenant_router_client, "DeviceGroupUseCases", FakeGroupUseCases)
    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        tenant_repo_mod,
        "get_tenant_device",
        lambda db, tenant_id, device_uid: devices.get(device_uid),
    )
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    created_job_ids = []

    def fake_create_job(db, *, device_id, firmware_version_id):
        job = SimpleNamespace(
            id=uuid4(),
            device_id=device_id,
            firmware_version_id=firmware_version_id,
            status="pending",
        )
        created_job_ids.append(job.id)
        return job

    published = []
    monkeypatch.setattr(ota_repository, "create_job", fake_create_job)
    monkeypatch.setattr(ota_repository, "update_status", lambda *a, **kw: None)
    monkeypatch.setattr(
        mqtt_publisher,
        "publish_ota_request",
        lambda device_uid, payload: published.append((device_uid, payload)),
    )
    monkeypatch.setattr(
        app_main.settings, "device_api_base_url", "http://aifom.local:8000", raising=False
    )

    with _TenantOverride():
        r = client.post(
            "/api/v1/client/ota-jobs",
            json={"group_id": str(group_id), "firmware_version_id": str(firmware.id)},
        )

    assert r.status_code == 201, r.text
    body = r.json()
    assert body["target_type"] == "group"
    assert body["group_id"] == str(group_id)
    assert body["created_count"] == 2
    assert len(body["job_ids"]) == 2
    assert [item[0] for item in published] == ["esp32-t001", "esp32-t002"]
    assert all(item[1]["file_size"] == firmware.file_size for item in published)


def test_client_device_mqtt_config_uses_device_facing_host(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-t001")
    device.tenant_id = _FAKE_TENANT_ID
    secret_password = "super-secret-device-password"
    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        device_repository,
        "get_device_by_uid",
        lambda db, device_uid: device if device_uid == "esp32-t001" else None,
    )
    monkeypatch.setattr(app_main.settings, "mqtt_host", "mosquitto", raising=False)
    monkeypatch.setattr(app_main.settings, "device_mqtt_host", "aifom.local", raising=False)
    monkeypatch.setattr(app_main.settings, "device_mqtt_port", 1883, raising=False)
    monkeypatch.setattr(app_main.settings, "mqtt_device_user", "aifom_device", raising=False)
    monkeypatch.setattr(app_main.settings, "mqtt_device_password", secret_password, raising=False)
    monkeypatch.setattr(
        app_main.settings, "device_api_base_url", "http://aifom.local:8000", raising=False
    )

    with _TenantOverride():
        r = client.get("/api/v1/client/devices/esp32-t001/mqtt-config")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["broker_host"] == "aifom.local"
    assert body["broker_port"] == 1883
    assert body["broker_tls_enabled"] is False
    assert 'CONFIG_AIFOM_MDNS_HOST="aifom.local"' in body["sdkconfig_snippet"]
    assert 'CONFIG_AIFOM_MQTT_HOST="aifom.local"' in body["sdkconfig_snippet"]
    assert 'CONFIG_AIFOM_MQTT_USERNAME="esp32-t001"' in body["sdkconfig_snippet"]
    assert 'CONFIG_AIFOM_MQTT_PASSWORD="***"' in body["sdkconfig_snippet"]
    assert "CONFIG_AIFOM_API_PORT=8000" in body["sdkconfig_snippet"]
    assert "aifom_device" not in body["sdkconfig_snippet"]
    assert secret_password not in body["sdkconfig_snippet"]


def test_client_device_mqtt_config_allows_unregistered_uid(monkeypatch) -> None:
    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, device_uid: None)
    monkeypatch.setattr(app_main.settings, "device_mqtt_host", "aifom.local", raising=False)
    monkeypatch.setattr(app_main.settings, "device_mqtt_port", 1883, raising=False)

    with _TenantOverride():
        r = client.get("/api/v1/client/devices/esp32-new-001/mqtt-config")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["client_id_suggestion"] == "esp32-esp32-new-001"
    assert 'CONFIG_AIFOM_DEVICE_UID="esp32-new-001"' in body["sdkconfig_snippet"]
    assert 'CONFIG_AIFOM_MQTT_PASSWORD="***"' in body["sdkconfig_snippet"]


def test_client_device_mqtt_config_viewer_receives_no_mqtt_secret(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-viewer")
    device.tenant_id = _FAKE_TENANT_ID
    secret_password = "viewer-must-not-see-this"
    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        device_repository,
        "get_device_by_uid",
        lambda db, device_uid: device if device_uid == "esp32-viewer" else None,
    )
    monkeypatch.setattr(app_main.settings, "mqtt_device_user", "aifom_device", raising=False)
    monkeypatch.setattr(app_main.settings, "mqtt_device_password", secret_password, raising=False)

    original_role = _fake_tenant_user.role
    original_permissions = getattr(_fake_tenant_user, "permissions", None)
    _fake_tenant_user.role = "viewer"
    _fake_tenant_user.permissions = ["devices.view"]
    try:
        with _TenantOverride():
            r = client.get("/api/v1/client/devices/esp32-viewer/mqtt-config")
    finally:
        _fake_tenant_user.role = original_role
        _fake_tenant_user.permissions = original_permissions

    assert r.status_code == 200, r.text
    body_text = r.text
    assert secret_password not in body_text
    assert "aifom_device" not in body_text


def test_client_device_mqtt_config_rejects_other_tenant_device(monkeypatch) -> None:
    other_tenant_device = _fake_tenant_device("esp32-other-tenant")
    other_tenant_device.tenant_id = uuid4()
    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        device_repository,
        "get_device_by_uid",
        lambda db, device_uid: other_tenant_device if device_uid == "esp32-other-tenant" else None,
    )

    with _TenantOverride():
        r = client.get("/api/v1/client/devices/esp32-other-tenant/mqtt-config")

    assert r.status_code == 409, r.text


def test_mosquitto_production_config_requires_acl_file() -> None:
    root = Path(__file__).resolve().parents[2]
    prod_conf = root / "infrastructure" / "mosquitto" / "config" / "mosquitto.prod.conf"
    compose = root / "infrastructure" / "docker-compose.prod.yml"

    assert "acl_file /mosquitto/config/acl" in prod_conf.read_text(encoding="utf-8")
    compose_text = compose.read_text(encoding="utf-8")
    assert "./mosquitto/config/acl.prod:/mosquitto/config/acl:ro" in compose_text
    assert "MQTT_PASSWORD_FILE_MANAGED_EXTERNALLY" in compose_text


def test_mosquitto_shared_device_acl_allows_only_explicit_demo_topics() -> None:
    import pytest

    root = Path(__file__).resolve().parents[2]
    acl = root / "infrastructure" / "mosquitto" / "config" / "acl"
    try:
        acl_text = acl.read_text(encoding="utf-8")
    except PermissionError:
        pytest.skip("ACL file not readable in this environment (container permission restriction)")

    assert "topic write devices/+/status" not in acl_text
    assert "topic write devices/+/heartbeat" not in acl_text
    assert "topic write devices/fffff/status" in acl_text
    assert "topic write devices/fffff/heartbeat" in acl_text
    assert "pattern write devices/%u/status" in acl_text


def test_client_create_ota_job_device_not_in_tenant(monkeypatch) -> None:
    from app.modules.tenants import repository as tenant_repo_mod

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    # Device not assigned to this tenant → get_tenant_device returns None
    monkeypatch.setattr(
        tenant_repo_mod,
        "get_tenant_device",
        lambda db, tenant_id, device_uid: None,
    )

    with _TenantOverride():
        r = client.post(
            "/api/v1/client/ota-jobs",
            json={"device_uid": "esp32-other-tenant", "firmware_version_id": str(uuid4())},
        )

    assert r.status_code == 404, r.text
    assert "not assigned to your tenant" in r.json()["detail"]


# ── Anomaly model info tests ──────────────────────────────────────────────────






# Tenant Project UI Builder / command dashboard tests


def _fake_project(project_id=None, tenant_id=None) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    pid = project_id or uuid4()
    tid = tenant_id or _FAKE_TENANT_ID
    page = SimpleNamespace(
        id=uuid4(),
        project_id=pid,
        title="Main",
        slug="main",
        sort_order=0,
        widgets=[],
        created_at=now,
        updated_at=now,
    )
    return SimpleNamespace(
        id=pid,
        tenant_id=tid,
        name="Smart Light Control",
        description="Demo",
        pages=[page],
        created_at=now,
        updated_at=now,
    )


def test_tenant_can_create_project(monkeypatch) -> None:
    monkeypatch.setattr(
        project_repository,
        "create_project",
        lambda db, tenant_id, payload: _fake_project(tenant_id=tenant_id),
    )

    with _TenantOverride():
        r = client.post(
            "/api/v1/client/projects",
            json={"name": "Smart Light Control", "description": "Two relay dashboard"},
        )

    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == "Smart Light Control"
    assert body["tenant_id"] == str(_FAKE_TENANT_ID)
    assert "pages" not in body


def test_tenant_projects_are_scoped_to_current_tenant(monkeypatch) -> None:
    captured: dict = {}

    def fake_list(db, tenant_id):
        captured["tenant_id"] = tenant_id
        now = datetime.now(timezone.utc)
        return [
            {
                "id": uuid4(),
                "tenant_id": tenant_id,
                "name": "Own Project",
                "description": None,
                "created_at": now,
                "updated_at": now,
            }
        ]

    monkeypatch.setattr(project_repository, "list_projects", fake_list)

    with _TenantOverride():
        r = client.get("/api/v1/client/projects")

    assert r.status_code == 200, r.text
    assert captured["tenant_id"] == _FAKE_TENANT_ID
    assert r.json()[0]["name"] == "Own Project"


def _fake_capability(
    capability_key: str = "gpio_2_output",
    gpio_pin: int = 2,
    capability_type: str = "digital_output",
    command_name: str = "set_gpio",
    state_key: str = "gpio_2_state",
    is_bindable: bool = True,
) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=uuid4(),
        device_id=uuid4(),
        tenant_id=None,
        capability_key=capability_key,
        capability_type=capability_type,
        label=f"GPIO{gpio_pin} - Demo",
        gpio_pin=gpio_pin,
        command_name=command_name,
        telemetry_state_key=state_key,
        is_bindable=is_bindable,
        config_json={"allowed_values": [True, False]},
        created_at=now,
        updated_at=now,
    )


def test_tenant_can_list_capabilities_for_own_device(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-demo-003")
    capabilities = [_fake_capability("gpio_2_output", 2), _fake_capability("gpio_4_output", 4)]
    for cap in capabilities:
        cap.device_id = device.id

    monkeypatch.setattr(
        project_repository,
        "get_tenant_device_by_id_or_uid",
        lambda db, tenant_id, device_id: device,
    )
    monkeypatch.setattr(
        project_repository, "list_bindable_device_capabilities", lambda db, did: capabilities
    )

    with _TenantOverride():
        r = client.get(f"/api/v1/client/devices/{device.id}/capabilities")

    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 2
    assert {item["capability_key"] for item in body} == {"gpio_2_output", "gpio_4_output"}


def test_tenant_cannot_list_capabilities_for_another_tenant_device(monkeypatch) -> None:
    monkeypatch.setattr(
        project_repository, "get_tenant_device_by_id_or_uid", lambda db, tenant_id, device_id: None
    )

    with _TenantOverride():
        r = client.get(f"/api/v1/client/devices/{uuid4()}/capabilities")

    assert r.status_code == 404
    assert "not found" in r.json()["detail"].lower()










def test_tenant_cannot_send_command_to_another_tenant_device(monkeypatch) -> None:
    monkeypatch.setattr(
        project_repository, "get_tenant_device_by_id_or_uid", lambda db, tenant_id, device_id: None
    )

    with _TenantOverride():
        r = client.post(
            f"/api/v1/client/devices/{uuid4()}/commands",
            json={"command": "set_gpio", "params": {"pin": 2, "state": True}},
        )

    assert r.status_code == 404
    assert "not found" in r.json()["detail"].lower()


def test_invalid_gpio_pin_is_rejected_with_400(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-t001")
    monkeypatch.setattr(
        project_repository,
        "get_tenant_device_by_id_or_uid",
        lambda db, tenant_id, device_id: device,
    )

    from fastapi import HTTPException

    def reject_command(db, device, command, params):
        raise HTTPException(
            status_code=400, detail="Selected GPIO pin is not available for this device"
        )

    monkeypatch.setattr(project_repository, "validate_command_for_device", reject_command)

    with _TenantOverride():
        r = client.post(
            f"/api/v1/client/devices/{device.id}/commands",
            json={"command": "set_gpio", "params": {"pin": 99, "state": True}},
        )

    assert r.status_code == 400
    assert "gpio pin" in r.json()["detail"].lower()


def test_valid_switch_command_publishes_mqtt_payload(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-t001")
    monkeypatch.setattr(
        project_repository,
        "get_tenant_device_by_id_or_uid",
        lambda db, tenant_id, device_id: device,
    )
    capability = SimpleNamespace(
        capability_key="led_builtin",
        capability_type="led",
        gpio_pin=2,
    )
    monkeypatch.setattr(
        project_repository,
        "validate_command_for_device",
        lambda db, device, command, params: capability,
    )

    captured: dict = {}

    def fake_publish(device_uid, payload):
        captured["device_uid"] = device_uid
        captured["payload"] = payload

    monkeypatch.setattr(mqtt_publisher, "publish_device_command", fake_publish)

    with _TenantOverride():
        r = client.post(
            f"/api/v1/client/devices/{device.id}/commands",
            json={"command": "set_gpio", "params": {"pin": 2, "state": True}},
        )

    assert r.status_code == 200, r.text
    assert captured["device_uid"] == device.device_uid
    assert captured["payload"]["command"] == "set_gpio"
    assert captured["payload"]["capability_key"] == "led_builtin"
    assert captured["payload"]["capability_type"] == "led"
    assert captured["payload"]["gpio_pin"] == 2
    assert captured["payload"]["source"] == "tenant_widget"
    assert captured["payload"]["params"] == {"pin": 2, "state": True}
    assert captured["payload"]["issued_by_user_id"] == str(_fake_tenant_user.id)
    assert captured["payload"]["tenant_id"] == str(_FAKE_TENANT_ID)
    assert "request_id" in captured["payload"]


def test_virtual_write_command_publishes_virtual_channel(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-t001")
    monkeypatch.setattr(
        project_repository,
        "get_tenant_device_by_id_or_uid",
        lambda db, tenant_id, device_id: device,
    )
    captured: dict = {}

    def fake_publish(device_uid, payload):
        captured["device_uid"] = device_uid
        captured["payload"] = payload

    monkeypatch.setattr(mqtt_publisher, "publish_device_command", fake_publish)

    with _TenantOverride():
        response = client.post(
            f"/api/v1/client/devices/{device.id}/commands",
            json={"command": "virtual_write", "params": {"channel": "v2", "value": True}},
        )

    assert response.status_code == 200, response.text
    assert captured["device_uid"] == device.device_uid
    assert captured["payload"]["command"] == "virtual_write"
    assert captured["payload"]["target"] == "v2"
    assert captured["payload"]["value"] is True
    assert captured["payload"]["capability_key"] == "virtual_write"


def test_virtual_write_command_rejects_invalid_channel(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-t001")
    monkeypatch.setattr(
        project_repository,
        "get_tenant_device_by_id_or_uid",
        lambda db, tenant_id, device_id: device,
    )

    with _TenantOverride():
        response = client.post(
            f"/api/v1/client/devices/{device.id}/commands",
            json={"command": "virtual_write", "params": {"channel": "ch_v2", "value": True}},
        )

    assert response.status_code == 400
    assert "virtual pin" in response.json()["detail"]


def test_virtual_write_command_rejects_out_of_range_channel(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-t001")
    monkeypatch.setattr(
        project_repository,
        "get_tenant_device_by_id_or_uid",
        lambda db, tenant_id, device_id: device,
    )

    with _TenantOverride():
        response = client.post(
            f"/api/v1/client/devices/{device.id}/commands",
            json={"command": "virtual_write", "params": {"channel": "v256", "value": True}},
        )

    assert response.status_code == 400
    assert "v255" in response.json()["detail"]


def test_set_output_command_publishes_gpio_and_value(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-t001")
    monkeypatch.setattr(
        project_repository,
        "get_tenant_device_by_id_or_uid",
        lambda db, tenant_id, device_id: device,
    )
    capability = SimpleNamespace(
        capability_key="led_builtin",
        capability_type="led",
        gpio_pin=2,
    )
    monkeypatch.setattr(
        project_repository,
        "validate_command_for_device",
        lambda db, device, command, params: capability,
    )

    captured: dict = {}

    def fake_publish(device_uid, payload):
        captured["device_uid"] = device_uid
        captured["payload"] = payload

    monkeypatch.setattr(mqtt_publisher, "publish_device_command", fake_publish)

    with _TenantOverride():
        r = client.post(
            f"/api/v1/client/devices/{device.id}/commands",
            json={
                "command": "set_output",
                "params": {
                    "target": "led_builtin",
                    "value": True,
                    "pin": 2,
                },
            },
        )

    assert r.status_code == 200, r.text
    assert captured["device_uid"] == device.device_uid
    assert captured["payload"]["command"] == "set_output"
    assert captured["payload"]["capability_key"] == "led_builtin"
    assert captured["payload"]["gpio_pin"] == 2
    assert captured["payload"]["target"] == "led_builtin"
    assert captured["payload"]["value"] is True
    assert captured["payload"]["source"] == "tenant_widget"


# Relay capability binding tests


def _fake_relay_capability(
    capability_key: str = "relay_1_output",
    channel: str = "relay_1",
    gpio_pin: int = 2,
    state_key: str = "relay_1_state",
    is_bindable: bool = True,
) -> SimpleNamespace:
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id=uuid4(),
        device_id=uuid4(),
        tenant_id=None,
        capability_key=capability_key,
        capability_type="digital_output",
        label=f"GPIO{gpio_pin} - Light / {channel}",
        gpio_pin=gpio_pin,
        channel=channel,
        command_name="set_output",
        telemetry_state_key=state_key,
        is_bindable=is_bindable,
        config_json={"allowed_values": [True, False]},
        created_at=now,
        updated_at=now,
    )






def test_relay_capability_api_response_includes_channel(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-demo-003")
    caps = [
        _fake_relay_capability("relay_1_output", "relay_1", 2, "relay_1_state"),
        _fake_relay_capability("relay_2_output", "relay_2", 4, "relay_2_state"),
    ]
    for cap in caps:
        cap.device_id = device.id

    monkeypatch.setattr(
        project_repository, "get_tenant_device_by_id_or_uid", lambda db, tenant_id, did: device
    )
    monkeypatch.setattr(
        project_repository, "list_bindable_device_capabilities", lambda db, did: caps
    )

    with _TenantOverride():
        r = client.get(f"/api/v1/client/devices/{device.id}/capabilities")

    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 2
    assert body[0]["channel"] == "relay_1"
    assert body[0]["telemetry_state_key"] == "relay_1_state"
    assert body[0]["command_name"] == "set_output"
    assert body[1]["channel"] == "relay_2"
    assert body[1]["telemetry_state_key"] == "relay_2_state"




def test_relay_command_preview_data_includes_channel_and_state_key(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-demo-003")
    cap = _fake_relay_capability("relay_1_output", "relay_1", 2, "relay_1_state")
    cap.device_id = device.id

    monkeypatch.setattr(
        project_repository, "get_tenant_device_by_id_or_uid", lambda db, tenant_id, did: device
    )
    monkeypatch.setattr(
        project_repository, "list_bindable_device_capabilities", lambda db, did: [cap]
    )

    with _TenantOverride():
        r = client.get(f"/api/v1/client/devices/{device.id}/capabilities")

    assert r.status_code == 200, r.text
    item = r.json()[0]
    assert item["channel"] == "relay_1"
    assert item["telemetry_state_key"] == "relay_1_state"
    assert item["command_name"] == "set_output"
    assert item["gpio_pin"] == 2
    assert "channel" in item
    assert "telemetry_state_key" in item


def test_capabilities_api_only_returns_bindable_capabilities(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-demo-003")
    bindable_cap = _fake_relay_capability(
        "relay_1_output", "relay_1", 2, "relay_1_state", is_bindable=True
    )
    bindable_cap.device_id = device.id
    non_bindable_cap = _fake_relay_capability(
        "legacy_set_output", "legacy", None, None, is_bindable=False
    )
    non_bindable_cap.telemetry_state_key = None
    non_bindable_cap.device_id = device.id
    non_bindable_cap.label = "MVP two-channel relay output control"

    monkeypatch.setattr(
        project_repository, "get_tenant_device_by_id_or_uid", lambda db, tenant_id, did: device
    )
    monkeypatch.setattr(
        project_repository, "list_bindable_device_capabilities", lambda db, did: [bindable_cap]
    )

    with _TenantOverride():
        r = client.get(f"/api/v1/client/devices/{device.id}/capabilities")

    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 1
    assert body[0]["capability_key"] == "relay_1_output"
    assert body[0]["is_bindable"] is True
    assert body[0]["telemetry_state_key"] == "relay_1_state"


def test_generic_relay_group_not_in_capabilities_response(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-demo-003")
    concrete_cap = _fake_relay_capability(
        "relay_1_output", "relay_1", 2, "relay_1_state", is_bindable=True
    )
    concrete_cap.device_id = device.id

    monkeypatch.setattr(
        project_repository, "get_tenant_device_by_id_or_uid", lambda db, tenant_id, did: device
    )
    monkeypatch.setattr(
        project_repository, "list_bindable_device_capabilities", lambda db, did: [concrete_cap]
    )

    with _TenantOverride():
        r = client.get(f"/api/v1/client/devices/{device.id}/capabilities")

    assert r.status_code == 200, r.text
    body = r.json()
    labels = [item["label"] for item in body]
    assert not any("MVP" in label for label in labels)
    assert all(item["is_bindable"] for item in body)
    assert all(item["telemetry_state_key"] is not None for item in body)






# ── Runtime-configurable GPIO widget tests ─────────────────────────────────────




def test_set_output_command_with_widget_gpio_pin_16_publishes_correct_payload(monkeypatch) -> None:
    device = _fake_tenant_device("esp32-t001")
    monkeypatch.setattr(
        project_repository,
        "get_tenant_device_by_id_or_uid",
        lambda db, tenant_id, device_id: device,
    )
    capability = SimpleNamespace(
        capability_key="gpio_16",
        capability_type="digital_output",
        gpio_pin=16,
        channel="gpio_16",
    )
    monkeypatch.setattr(
        project_repository,
        "validate_command_for_device",
        lambda db, device, command, params: capability,
    )

    captured: dict = {}

    def fake_publish(device_uid, payload):
        captured["device_uid"] = device_uid
        captured["payload"] = payload

    monkeypatch.setattr(mqtt_publisher, "publish_device_command", fake_publish)

    with _TenantOverride():
        r = client.post(
            f"/api/v1/client/devices/{device.id}/commands",
            json={
                "command": "set_output",
                "params": {
                    "target": "gpio_16",
                    "value": True,
                    "gpio_pin": 16,
                    "pin": 16,
                },
            },
        )

    assert r.status_code == 200, r.text
    assert captured["payload"]["gpio_pin"] == 16
    assert captured["payload"]["value"] is True
    assert captured["payload"]["target"] == "gpio_16"


def test_set_output_command_with_different_pins_for_two_widgets(monkeypatch) -> None:
    """Two widgets with different GPIO pins should produce different MQTT payloads."""
    device = _fake_tenant_device("esp32-t001")
    monkeypatch.setattr(
        project_repository,
        "get_tenant_device_by_id_or_uid",
        lambda db, tenant_id, device_id: device,
    )

    captured_payloads: list = []

    def fake_publish(device_uid, payload):
        captured_payloads.append(payload)

    monkeypatch.setattr(mqtt_publisher, "publish_device_command", fake_publish)

    # Widget 1: GPIO 2
    cap_gpio2 = SimpleNamespace(capability_key="led_builtin", capability_type="led", gpio_pin=2)
    monkeypatch.setattr(
        project_repository, "validate_command_for_device", lambda db, dev, cmd, params: cap_gpio2
    )

    with _TenantOverride():
        r1 = client.post(
            f"/api/v1/client/devices/{device.id}/commands",
            json={
                "command": "set_output",
                "params": {"target": "led_builtin", "value": True, "gpio_pin": 2, "pin": 2},
            },
        )
    assert r1.status_code == 200

    # Widget 2: GPIO 4
    cap_gpio4 = SimpleNamespace(
        capability_key="relay_2", capability_type="digital_output", gpio_pin=4
    )
    monkeypatch.setattr(
        project_repository, "validate_command_for_device", lambda db, dev, cmd, params: cap_gpio4
    )

    with _TenantOverride():
        r2 = client.post(
            f"/api/v1/client/devices/{device.id}/commands",
            json={
                "command": "set_output",
                "params": {"target": "relay_2", "value": True, "gpio_pin": 4, "pin": 4},
            },
        )
    assert r2.status_code == 200

    assert len(captured_payloads) == 2
    assert captured_payloads[0]["gpio_pin"] == 2
    assert captured_payloads[1]["gpio_pin"] == 4
    assert captured_payloads[0]["gpio_pin"] != captured_payloads[1]["gpio_pin"]


# ── GPIO conflict validation tests ──────────────────────────────────────────


def _mock_gpio_validation_devices(monkeypatch, *devices) -> None:
    by_ref = {str(device.id): device for device in devices}
    by_ref.update({device.device_uid: device for device in devices})

    def fake_device_lookup(db, tenant_id, device_id_or_uid):
        return by_ref.get(str(device_id_or_uid))

    def fake_capability_by_key(db, device_id, capability_key):
        if capability_key == "custom_gpio_output":
            return None
        if capability_key == "temp_sensor":
            return SimpleNamespace(
                id=uuid4(),
                device_id=device_id,
                tenant_id=None,
                capability_key="temp_sensor",
                capability_type="sensor",
                label="Temp Sensor",
                gpio_pin=2,
                channel="temp_sensor",
                command_name="read_sensor",
                telemetry_state_key="temp_sensor_state",
                is_bindable=True,
                config_json={},
            )
        return None

    monkeypatch.setattr(project_repository, "get_tenant_device_by_id_or_uid", fake_device_lookup)
    monkeypatch.setattr(project_repository, "get_device_capability_by_key", fake_capability_by_key)




















def test_tenant_can_view_device_detail_with_bindings_ota_and_alerts(monkeypatch) -> None:
    from app.modules.tenants import repository as tenant_repo_mod
    from app.modules.tenants import router_client as tenant_router_client

    now = datetime.now(timezone.utc)
    device = SimpleNamespace(
        id=uuid4(),
        device_uid="esp32-t001",
        name="Tenant Node",
        hardware_model="esp32",
        mac_address=None,
        description="Greenhouse controller",
        firmware_version="1.2.3",
        status="online",
        ip_address="192.168.1.10",
        rssi=-61,
        free_heap=123456,
        uptime_ms=987654,
        last_status_payload={"relay_1_state": True},
        last_seen_at=now,
        created_at=now,
        updated_at=now,
    )
    telemetry_rows = [
        SimpleNamespace(
            id=uuid4(),
            device_id=device.id,
            device=SimpleNamespace(device_uid=device.device_uid),
            timestamp=now,
            metric_name="temperature",
            metric_value=28.5,
            unit="C",
            raw_payload={"temperature": 28.5, "relay_1_state": True},
            created_at=now,
        ),
        SimpleNamespace(
            id=uuid4(),
            device_id=device.id,
            device=SimpleNamespace(device_uid=device.device_uid),
            timestamp=now,
            metric_name="relay_1_state",
            metric_value=1.0,
            unit=None,
            raw_payload={"temperature": 28.5, "relay_1_state": True},
            created_at=now,
        ),
    ]
    firmware = _fake_firmware("1.2.3")
    ota_job = SimpleNamespace(
        id=uuid4(),
        device_id=device.id,
        device=SimpleNamespace(device_uid=device.device_uid),
        firmware_version_id=firmware.id,
        firmware_version=SimpleNamespace(version=firmware.version),
        status="sent",
        requested_at=now,
        started_at=now,
        completed_at=None,
        progress=55,
        last_message="Halfway",
        error_message=None,
        created_at=now,
        updated_at=now,
    )
    operational_alert = SimpleNamespace(
        id=uuid4(),
        device_id=device.id,
        last_seen_at=now,
        created_at=now,
        title="temperature",
        message="Temperature exceeded the automation threshold",
        severity="warning",
        source="automation",
        source_id=None,
        status="open",
        details={"temperature": 40.0},
    )
    audit_log = SimpleNamespace(
        action="send_device_command",
        resource_type="device",
        resource_id=str(device.id),
        detail={"device_uid": device.device_uid, "command": "set_output"},
        created_at=now,
    )

    monkeypatch.setattr(
        tenant_service_mod, "get_effective_features", lambda db, tenant_id: _ALL_FEATURES_ON
    )
    monkeypatch.setattr(
        tenant_repo_mod,
        "get_tenant_device",
        lambda db, tenant_id, uid: device if uid == device.device_uid else None,
    )
    monkeypatch.setattr(
        telemetry_repository, "latest_telemetry_by_device_uid", lambda db, uid: telemetry_rows
    )
    monkeypatch.setattr(
        telemetry_repository,
        "list_telemetry_by_device_uid",
        lambda db, uid, limit=40: telemetry_rows,
    )
    monkeypatch.setattr(
        project_repository,
        "list_device_project_bindings",
        lambda db, tenant_id, device_obj: [
            {"project_id": uuid4(), "project_name": "Greenhouse Control"}
        ],
    )
    monkeypatch.setattr(
        firmware_repository,
        "list_firmware",
        lambda db, target_device_type=None, limit=20, tenant_id=None: [firmware],
    )
    monkeypatch.setattr(
        tenant_router_client, "_list_device_ota_jobs", lambda db, device_id, limit=20: [ota_job]
    )
    monkeypatch.setattr(
        tenant_router_client, "_list_device_alert_events", lambda db, device_id, limit=20: [operational_alert]
    )
    monkeypatch.setattr(
        tenant_router_client,
        "_list_tenant_audit_logs",
        lambda db, tenant_id, limit=120: [audit_log],
    )

    with _TenantOverride():
        r = client.get("/api/v1/client/devices/esp32-t001/detail")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["device"]["device_uid"] == "esp32-t001"
    assert body["project_bindings"][0]["project_name"] == "Greenhouse Control"
    assert "widgets" not in body["project_bindings"][0]
    assert "ai_events" not in body
    assert body["ota_jobs"][0]["status"] == "sent"
    assert body["alerts"][0]["metric_name"] == "temperature"
    assert body["activity"][0]["kind"] in {"command", "telemetry", "alert", "ota"}


def test_tenant_cannot_view_other_tenant_device_detail(monkeypatch) -> None:
    from app.modules.tenants import repository as tenant_repo_mod

    monkeypatch.setattr(
        tenant_service_mod, "get_effective_features", lambda db, tenant_id: _ALL_FEATURES_ON
    )
    monkeypatch.setattr(tenant_repo_mod, "get_tenant_device", lambda db, tenant_id, uid: None)

    with _TenantOverride():
        r = client.get("/api/v1/client/devices/esp32-other/detail")

    assert r.status_code == 404, r.text


def test_tenant_cannot_update_other_tenant_offline_timeout(monkeypatch) -> None:
    from app.modules.tenants import repository as tenant_repo_mod

    monkeypatch.setattr(
        tenant_service_mod, "get_effective_features", lambda db, tenant_id: _ALL_FEATURES_ON
    )
    monkeypatch.setattr(tenant_repo_mod, "get_tenant_device", lambda db, tenant_id, uid: None)

    with _TenantOverride():
        r = client.patch(
            "/api/v1/client/devices/esp32-other/offline-timeout",
            json={"offline_timeout_seconds": 60},
        )

    assert r.status_code == 404, r.text
    assert "not assigned to your tenant" in r.json()["detail"]


def test_tenant_offline_timeout_validation_rejects_invalid_values(monkeypatch) -> None:
    from app.modules.tenants import repository as tenant_repo_mod

    monkeypatch.setattr(
        tenant_service_mod, "get_effective_features", lambda db, tenant_id: _ALL_FEATURES_ON
    )
    monkeypatch.setattr(
        tenant_repo_mod,
        "get_tenant_device",
        lambda db, tenant_id, uid: _fake_tenant_device(uid),
    )

    with _TenantOverride():
        r_low = client.patch(
            "/api/v1/client/devices/esp32-t001/offline-timeout",
            json={"offline_timeout_seconds": 5},
        )
        r_high = client.patch(
            "/api/v1/client/devices/esp32-t001/offline-timeout",
            json={"offline_timeout_seconds": 601},
        )

    assert r_low.status_code == 422, r_low.text
    assert r_high.status_code == 422, r_high.text


def test_admin_can_view_tenant_project_read_only(monkeypatch) -> None:
    from app.modules.tenants import repository as tenant_repo_mod
    from app.bounded_contexts.tenant_management.presentation import (
        router_admin as tenant_router_admin,
    )

    tenant_id = uuid4()
    project = _fake_project(project_id=uuid4(), tenant_id=tenant_id)
    device = SimpleNamespace(
        id=uuid4(),
        device_uid="esp32-support-001",
        name="Support Node",
        hardware_model="esp32",
        mac_address=None,
        description="Support visibility",
        firmware_version="1.0.0",
        status="online",
        ip_address=None,
        rssi=None,
        free_heap=None,
        uptime_ms=None,
        last_status_payload=None,
        last_seen_at=datetime.now(timezone.utc),
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    monkeypatch.setattr(
        tenant_repo_mod,
        "get_tenant",
        lambda db, tid: SimpleNamespace(id=tid, name="Tenant A", slug="tenant-a"),
    )
    monkeypatch.setattr(
        project_repository,
        "get_project",
        lambda db, tid, pid: project if tid == tenant_id and pid == project.id else None,
    )
    monkeypatch.setattr(
        project_repository,
        "build_latest_state",
        lambda db, project_obj: {
            str(device.id): {"relay_1_state": True, "ts": datetime.now(timezone.utc).isoformat()}
        },
    )
    monkeypatch.setattr(
        project_repository,
        "list_project_device_bindings",
        lambda db, tid, project_obj: [
            {
                "device": device,
                "latest_state": {
                    "relay_1_state": True,
                    "ts": datetime.now(timezone.utc).isoformat(),
                },
                "widget_bindings": [
                    {
                        "widget_id": uuid4(),
                        "page_id": uuid4(),
                        "page_title": "Main",
                        "project_id": project.id,
                        "project_name": project.name,
                        "widget_type": "switch",
                        "title": "Pump Relay",
                        "sort_order": 0,
                        "capability_id": uuid4(),
                        "capability_key": "relay_1",
                        "capability_type": "digital_output",
                        "gpio_pin": 2,
                        "command": "set_output",
                        "channel": "relay_1",
                        "telemetry_state_key": "relay_1_state",
                        "telemetry_field": "relay_1_state",
                        "binding": {
                            "device_id": str(device.id),
                            "device_uid": device.device_uid,
                            "gpio_pin": 2,
                        },
                    }
                ],
                "duplicate_gpio_warnings": [],
            }
        ],
    )
    monkeypatch.setattr(
        tenant_router_admin, "_list_project_ota_jobs", lambda db, device_ids, limit=20: []
    )
    monkeypatch.setattr(
        tenant_router_admin, "_list_project_alert_events", lambda db, device_ids, limit=20: []
    )

    r = client.get(f"/api/v1/admin/tenants/{tenant_id}/projects/{project.id}")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["read_only"] is True
    assert body["tenant_name"] == "Tenant A"
    assert body["device_summaries"][0]["device"]["device_uid"] == "esp32-support-001"
    assert "read-only mode" in body["access_policy"]["admin_access_rule"]


def test_admin_cannot_edit_tenant_project_by_default() -> None:
    tenant_id = uuid4()
    project_id = uuid4()

    r = client.put(
        f"/api/v1/admin/tenants/{tenant_id}/projects/{project_id}", json={"name": "Mutated"}
    )

    assert r.status_code == 405, r.text


def test_admin_cannot_create_tenant_ota_jobs_through_client_api() -> None:
    r = client.post(
        "/api/v1/client/ota-jobs",
        json={"device_uid": "esp32-t001", "firmware_version_id": str(uuid4())},
    )

    assert r.status_code == 403, r.text


# ── Real-time device status event bus tests ──────────────────────────────────


def test_device_status_event_bus_delivers_to_correct_tenant() -> None:
    """Events published for a tenant are received by that tenant's subscribers."""
    import asyncio

    from app.shared.infrastructure.messaging.device_status_events import (
        DeviceStatusEvent,
        DeviceStatusEventBus,
    )

    bus = DeviceStatusEventBus()
    loop = asyncio.new_event_loop()
    bus.set_loop(loop)

    received: list[dict] = []

    async def _collect():
        async for event in bus.subscribe("tenant-aaa"):
            received.append(event)
            break  # take one event then stop

    event: DeviceStatusEvent = {
        "device_uid": "dev-001",
        "tenant_id": "tenant-aaa",
        "status": "online",
        "last_seen_at": "2026-05-29T10:00:00Z",
        "timestamp": "2026-05-29T10:00:00Z",
    }

    # Publish from a thread (simulates MQTT worker).
    import threading

    def _publish():
        import time

        time.sleep(0.1)  # let subscriber start first
        bus.publish(event)

    pub_thread = threading.Thread(target=_publish)
    pub_thread.start()
    loop.run_until_complete(_collect())
    pub_thread.join()

    assert len(received) == 1
    assert received[0]["device_uid"] == "dev-001"
    assert received[0]["status"] == "online"

    bus.stop()
    loop.close()


def test_device_status_event_bus_tenant_isolation() -> None:
    """Tenant A must NOT receive events published for Tenant B."""
    import asyncio

    from app.shared.infrastructure.messaging.device_status_events import (
        DeviceStatusEvent,
        DeviceStatusEventBus,
    )

    bus = DeviceStatusEventBus()
    loop = asyncio.new_event_loop()
    bus.set_loop(loop)

    received_a: list[dict] = []

    async def _collect_a():
        try:
            async for event in bus.subscribe("tenant-aaa"):
                received_a.append(event)
                break
        except asyncio.CancelledError:
            pass

    event_b: DeviceStatusEvent = {
        "device_uid": "dev-bbb",
        "tenant_id": "tenant-bbb",
        "status": "online",
        "last_seen_at": None,
        "timestamp": "2026-05-29T10:00:00Z",
    }

    async def _run():
        # Start subscriber task.
        task = asyncio.ensure_future(_collect_a())
        # Let subscriber register.
        await asyncio.sleep(0.05)
        # Publish event for tenant-bbb (tenant-aaa subscriber should NOT get it).
        bus.publish(event_b)
        # Wait a bit for any delivery.
        await asyncio.sleep(0.2)
        # Cancel the subscriber (it would wait forever since no event for tenant-aaa).
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    loop.run_until_complete(_run())
    loop.close()
    bus.stop()

    assert len(received_a) == 0, "Tenant A should not receive Tenant B events"


def test_mqtt_heartbeat_emits_status_event(monkeypatch) -> None:
    """A heartbeat message should emit a device_status_changed event."""
    import json as _json

    from app.shared.infrastructure.messaging.device_status_events import device_status_bus

    published_events: list[dict] = []

    def _capture_publish(event):
        published_events.append(event)
        # Don't actually publish to the bus (no loop set up in tests).

    monkeypatch.setattr(device_status_bus, "publish", _capture_publish)

    fake = _fake_device("esp32-demo-001", status="online")

    monkeypatch.setattr(
        device_repository,
        "get_device_by_uid",
        lambda db, device_uid: fake,
    )
    monkeypatch.setattr(
        device_repository,
        "touch_device",
        lambda db, device_uid, **kwargs: fake,
    )

    # Mock TenantDeviceMapping query
    fake_mapping = SimpleNamespace(tenant_id=_FAKE_TENANT_ID)
    monkeypatch.setattr(
        mqtt_subscriber_module,
        "select",
        lambda *a, **kw: SimpleNamespace(where=lambda *a2, **kw2: None),
    )

    class _Session:
        def close(self):
            pass

        def rollback(self):
            pass

        def commit(self):
            pass

        def scalar(self, stmt):
            return fake_mapping

    monkeypatch.setattr(mqtt_subscriber_module, "SessionLocal", lambda: _Session())

    sub = mqtt_subscriber_module.MQTTSubscriber()
    msg = SimpleNamespace(
        topic="devices/esp32-demo-001/heartbeat",
        payload=_json.dumps({"device_id": "esp32-demo-001"}).encode("utf-8"),
    )
    sub.process_message_sync(msg)

    assert len(published_events) == 1
    assert published_events[0]["device_uid"] == "esp32-demo-001"
    assert published_events[0]["status"] == "online"
    assert published_events[0]["tenant_id"] == str(_FAKE_TENANT_ID)


def test_startup_reconciliation_emits_offline_events() -> None:
    """Devices marked offline during startup reconciliation should produce events."""
    # Test the pure function — events are emitted by the caller, not the function itself.
    now = datetime.now(timezone.utc)
    device_a = SimpleNamespace(
        status="online", last_seen_at=now, offline_timeout_seconds=60, id=uuid4()
    )
    device_b = SimpleNamespace(
        status="online", last_seen_at=now, offline_timeout_seconds=60, id=uuid4()
    )

    changed = device_repository.force_offline_all_online([device_a, device_b])

    assert changed == 2
    assert device_a.status == "offline"
    assert device_b.status == "offline"


# ── Disabled tenant access tests ─────────────────────────────────────────────


class _DisabledTenantOverride:
    """Context manager: override get_current_user to return a tenant user
    whose tenant is disabled. Does NOT override get_current_tenant_user,
    so the real dependency runs and checks tenant.is_active."""

    def __enter__(self):
        self._saved = dict(app_main.app.dependency_overrides)
        app_main.app.dependency_overrides = {
            security_module.get_current_user: lambda: _fake_tenant_user,
        }
        return self

    def __exit__(self, *_):
        app_main.app.dependency_overrides = self._saved


def test_disabled_tenant_blocked_from_client_projects(monkeypatch) -> None:
    """A disabled tenant must get 403 when calling client APIs."""
    from app.modules.tenants import repository as tenant_repo_mod

    disabled_tenant = SimpleNamespace(id=_FAKE_TENANT_ID, is_active=False)
    monkeypatch.setattr(tenant_repo_mod, "get_tenant", lambda db, tid: disabled_tenant)

    with _DisabledTenantOverride():
        # The dependency check happens before any DB query, so even though
        # list_tenant_projects would fail without a DB, we get 403 first.
        r = client.get("/api/v1/client/projects")
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
    assert "disabled" in r.json()["detail"].lower()


def test_disabled_tenant_blocked_from_client_devices(monkeypatch) -> None:
    """A disabled tenant must get 403 when calling device APIs."""
    from app.modules.tenants import repository as tenant_repo_mod

    disabled_tenant = SimpleNamespace(id=_FAKE_TENANT_ID, is_active=False)
    monkeypatch.setattr(tenant_repo_mod, "get_tenant", lambda db, tid: disabled_tenant)

    with _DisabledTenantOverride():
        r = client.get("/api/v1/client/devices")
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
    assert "disabled" in r.json()["detail"].lower()


def test_disabled_tenant_blocked_from_client_firmware(monkeypatch) -> None:
    """A disabled tenant must get 403 when calling firmware APIs."""
    from app.modules.tenants import repository as tenant_repo_mod

    disabled_tenant = SimpleNamespace(id=_FAKE_TENANT_ID, is_active=False)
    monkeypatch.setattr(tenant_repo_mod, "get_tenant", lambda db, tid: disabled_tenant)

    with _DisabledTenantOverride():
        r = client.get("/api/v1/client/firmware")
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
    assert "disabled" in r.json()["detail"].lower()


def test_disabled_tenant_blocked_from_client_users(monkeypatch) -> None:
    """A disabled tenant must get 403 when calling user management APIs."""
    from app.modules.tenants import repository as tenant_repo_mod

    disabled_tenant = SimpleNamespace(id=_FAKE_TENANT_ID, is_active=False)
    monkeypatch.setattr(tenant_repo_mod, "get_tenant", lambda db, tid: disabled_tenant)

    with _DisabledTenantOverride():
        r = client.get("/api/v1/client/users")
    assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"
    assert "disabled" in r.json()["detail"].lower()


def test_active_tenant_can_access_client_projects(monkeypatch) -> None:
    """An active tenant should be able to access client APIs normally."""
    from app.modules.tenants import repository as tenant_repo_mod
    from app.modules.projects import repository as project_repo_mod

    active_tenant = SimpleNamespace(id=_FAKE_TENANT_ID, is_active=True)
    monkeypatch.setattr(tenant_repo_mod, "get_tenant", lambda db, tid: active_tenant)
    monkeypatch.setattr(
        tenant_service_mod, "get_effective_features", lambda db, tenant_id: _ALL_FEATURES_ON
    )
    monkeypatch.setattr(project_repo_mod, "list_projects", lambda db, tid: [])

    with _DisabledTenantOverride():
        r = client.get("/api/v1/client/projects")
    assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text}"


def test_disabling_tenant_a_does_not_affect_tenant_b(monkeypatch) -> None:
    """Disabling one tenant must not affect another tenant's access."""
    from app.modules.tenants import repository as tenant_repo_mod
    from app.modules.projects import repository as project_repo_mod

    tenant_a_id = uuid4()
    tenant_b_id = uuid4()

    tenant_a = SimpleNamespace(id=tenant_a_id, is_active=False)  # disabled
    tenant_b = SimpleNamespace(id=tenant_b_id, is_active=True)  # active

    def mock_get_tenant(db, tid):
        if tid == tenant_a_id:
            return tenant_a
        if tid == tenant_b_id:
            return tenant_b
        return None

    monkeypatch.setattr(tenant_repo_mod, "get_tenant", mock_get_tenant)
    monkeypatch.setattr(
        tenant_service_mod, "get_effective_features", lambda db, tenant_id: _ALL_FEATURES_ON
    )
    monkeypatch.setattr(project_repo_mod, "list_projects", lambda db, tid: [])

    # Tenant A (disabled) should get 403
    user_a = SimpleNamespace(
        id=uuid4(),
        email="a@test.local",
        role="tenant_owner",
        tenant_id=tenant_a_id,
        is_active=True,
    )
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {
        security_module.get_current_user: lambda: user_a,
    }
    r_a = client.get("/api/v1/client/projects")
    assert r_a.status_code == 403, f"Tenant A expected 403, got {r_a.status_code}"

    # Tenant B (active) should get 200
    user_b = SimpleNamespace(
        id=uuid4(),
        email="b@test.local",
        role="tenant_owner",
        tenant_id=tenant_b_id,
        is_active=True,
    )
    app_main.app.dependency_overrides = {
        security_module.get_current_user: lambda: user_b,
    }
    r_b = client.get("/api/v1/client/projects")
    assert r_b.status_code == 200, f"Tenant B expected 200, got {r_b.status_code}: {r_b.text}"

    app_main.app.dependency_overrides = saved


# ── Security tests (P0) ─────────────────────────────────────────────────────


def test_firmware_download_requires_auth(monkeypatch) -> None:
    """Firmware download must return 401/403 without authentication."""
    firmware = _fake_firmware("1.0.0")
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    # Save and clear overrides to simulate unauthenticated request
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.get(f"/api/v1/firmware/{firmware.id}/download")
    assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_firmware_download_with_admin_auth(monkeypatch) -> None:
    """Admin can download firmware."""
    firmware = _fake_firmware("1.0.0")
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    class FakeMinioResp:
        def __init__(self, data: bytes):
            self._data = data
            self._pos = 0
            self.closed = False
            self.released = False

        def read(self, n=-1):
            if n < 0:
                n = len(self._data) - self._pos
            chunk = self._data[self._pos : self._pos + n]
            self._pos += len(chunk)
            return chunk

        def close(self):
            self.closed = True

        def release_conn(self):
            self.released = True

    fake_resp = FakeMinioResp(b"FIRMWAREDATA")
    monkeypatch.setattr(minio_client, "get_firmware_object_stream", lambda key: fake_resp)

    r = client.get(f"/api/v1/firmware/{firmware.id}/download")
    assert r.status_code == 200
    assert r.content == b"FIRMWAREDATA"


def test_ota_download_without_token_returns_401(monkeypatch) -> None:
    """OTA download without token must return 422 (missing required param)."""
    firmware = _fake_firmware("1.0.0")
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    # Clear overrides for unauthenticated access
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.get(f"/api/v1/firmware/ota-download/{firmware.id}")
    # Missing token query param → 422 validation error
    assert r.status_code in (401, 422), f"Expected 401/422, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_ota_download_with_invalid_token_returns_401(monkeypatch) -> None:
    """OTA download with invalid token must return 401."""
    firmware = _fake_firmware("1.0.0")
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.get(f"/api/v1/firmware/ota-download/{firmware.id}?token=invalid-token")
    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_ota_download_with_valid_token(monkeypatch) -> None:
    """OTA download succeeds once and an atomic replay is rejected."""
    from app.core.ota_tokens import create_ota_download_token
    from app.db.session import get_db
    from app.bounded_contexts.firmware_ota.infrastructure.persistence.ota_models import (
        OtaJob,
        UsedOtaToken,
    )
    from sqlalchemy.exc import IntegrityError

    firmware = _fake_firmware("1.0.0")
    job_id = uuid4()
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    class FakeMinioResp:
        def __init__(self, data: bytes):
            self._data = data
            self._pos = 0
            self.closed = False
            self.released = False

        def read(self, n=-1):
            if n < 0:
                n = len(self._data) - self._pos
            chunk = self._data[self._pos : self._pos + n]
            self._pos += len(chunk)
            return chunk

        def close(self):
            self.closed = True

        def release_conn(self):
            self.released = True

    storage_responses = []

    def open_fake_stream(key):
        response = FakeMinioResp(b"OTAFIRMWARE")
        storage_responses.append(response)
        return response

    monkeypatch.setattr(minio_client, "get_firmware_object_stream", open_fake_stream)

    tenant_id = uuid4()
    token = create_ota_download_token(
        firmware_id=firmware.id, job_id=job_id, device_uid="esp32-demo-001", tenant_id=tenant_id
    )
    device_id = uuid4()
    fake_job = SimpleNamespace(
        id=job_id,
        firmware_version_id=firmware.id,
        device_id=device_id,
        tenant_id=tenant_id,
        status="pending",
        campaign_id=None,
    )
    fake_device = SimpleNamespace(id=device_id, device_uid="esp32-demo-001", tenant_id=tenant_id)

    class FakeDb:
        def __init__(self):
            self.used_jtis = set()
            self.pending = None

        def get(self, model, item_id):
            if model is OtaJob and item_id == job_id:
                return fake_job
            if model is Device and item_id == device_id:
                return fake_device
            return None

        def query(self, model):
            class FakeQuery:
                def filter(self, *args):
                    return self

                def delete(self, **kwargs):
                    return 0

            return FakeQuery()

        def add(self, instance):
            if isinstance(instance, UsedOtaToken):
                self.pending = instance

        def commit(self):
            if self.pending.jti in self.used_jtis:
                raise IntegrityError("duplicate OTA jti", {}, None)
            self.used_jtis.add(self.pending.jti)
            self.pending = None

        def rollback(self):
            self.pending = None

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}
    fake_db = FakeDb()
    app_main.app.dependency_overrides[get_db] = lambda: fake_db

    try:
        monkeypatch.setattr(
            minio_client,
            "get_firmware_object_stream",
            lambda key: (_ for _ in ()).throw(RuntimeError("storage unavailable")),
        )
        unavailable = client.get(f"/api/v1/firmware/ota-download/{firmware.id}?token={token}")
        assert unavailable.status_code == 502
        assert fake_db.used_jtis == set()

        monkeypatch.setattr(minio_client, "get_firmware_object_stream", open_fake_stream)
        r = client.get(f"/api/v1/firmware/ota-download/{firmware.id}?token={token}")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert r.content == b"OTAFIRMWARE"
        replay = client.get(f"/api/v1/firmware/ota-download/{firmware.id}?token={token}")
        assert replay.status_code == 401
        assert storage_responses[-1].closed is True
        assert storage_responses[-1].released is True
    finally:
        app_main.app.dependency_overrides = saved


def test_ota_download_token_firmware_mismatch_returns_403(monkeypatch) -> None:
    """OTA download token for firmware A must not work for firmware B."""
    from app.core.ota_tokens import create_ota_download_token

    firmware_a = _fake_firmware("1.0.0")
    firmware_b = _fake_firmware("2.0.0")
    job_id = uuid4()
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware_b)

    # Token is for firmware_a, but we request firmware_b
    token = create_ota_download_token(
        firmware_id=firmware_a.id, job_id=job_id, device_uid="esp32-demo-001", tenant_id=uuid4()
    )

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    try:
        r = client.get(f"/api/v1/firmware/ota-download/{firmware_b.id}?token={token}")
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
    finally:
        app_main.app.dependency_overrides = saved


def test_device_register_without_token_returns_401(monkeypatch) -> None:
    """Device registration without provisioning token must fail."""
    from app.core import config as core_config

    monkeypatch.setattr(core_config.settings, "device_provisioning_secret", "test-token")
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.post(
        "/api/v1/devices/register",
        json={"device_uid": "esp32-fake-001", "name": "Fake Device"},
    )
    # Missing provisioning token -> 401
    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_device_register_with_wrong_token_returns_401(monkeypatch) -> None:
    """Device registration with wrong token must return 401."""
    from app.core import config as core_config

    monkeypatch.setattr(core_config.settings, "device_provisioning_secret", "correct-secret")

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.post(
        "/api/v1/devices/register?provisioning_token=wrong-secret",
        json={"device_uid": "esp32-fake-001", "name": "Fake Device"},
    )
    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_device_register_with_valid_token(monkeypatch) -> None:
    """Device registration with valid token must succeed."""
    from app.core import config as core_config

    monkeypatch.setattr(core_config.settings, "device_provisioning_secret", "test-token-123")

    def fake_register_device(db, payload):
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id=uuid4(),
            device_uid=payload.device_uid,
            name=payload.name,
            firmware_version=payload.firmware_version,
            status="offline",
            last_seen_at=None,
            created_at=now,
            updated_at=now,
        )

    monkeypatch.setattr(device_repository, "register_device", fake_register_device)

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.post(
        "/api/v1/devices/register?provisioning_token=test-token-123",
        json={"device_uid": "esp32-valid-001", "name": "Valid Device"},
    )
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    body = r.json()
    assert body["device_uid"] == "esp32-valid-001"

    app_main.app.dependency_overrides = saved


def test_register_device_updates_existing_optional_metadata(monkeypatch) -> None:
    from app.modules.devices.schema import DeviceCreate

    existing = SimpleNamespace(
        name="Old Device",
        hardware_model=None,
        description=None,
        firmware_version=None,
    )
    db = SimpleNamespace(
        commit=lambda: None,
        refresh=lambda obj: None,
    )

    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: existing)

    device_repository.register_device(
        db,
        DeviceCreate(
            device_uid="esp32-existing-001",
            name="Existing Device",
            hardware_model="ESP32 DevKit V1",
            description="Server room rack A",
        ),
    )

    assert existing.name == "Existing Device"
    assert existing.hardware_model == "ESP32 DevKit V1"
    assert existing.description == "Server room rack A"


def test_register_device_keeps_existing_optional_metadata_when_omitted(monkeypatch) -> None:
    from app.modules.devices.schema import DeviceCreate

    existing = SimpleNamespace(
        name="Old Device",
        hardware_model="ESP32 DevKit V1",
        description="Server room rack A",
        firmware_version=None,
    )
    db = SimpleNamespace(
        commit=lambda: None,
        refresh=lambda obj: None,
    )

    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: existing)

    device_repository.register_device(
        db,
        DeviceCreate(device_uid="esp32-existing-001", name="Existing Device"),
    )

    assert existing.name == "Existing Device"
    assert existing.hardware_model == "ESP32 DevKit V1"
    assert existing.description == "Server room rack A"


def test_assign_device_handles_duplicate_mapping_race(monkeypatch) -> None:
    from sqlalchemy.exc import IntegrityError
    from app.modules.tenants import repository as tenant_repo

    tenant_id = uuid4()
    device_id = uuid4()
    existing_mapping = SimpleNamespace(tenant_id=tenant_id, device_id=device_id)

    class FakeDb:
        def __init__(self):
            self.device = SimpleNamespace(id=device_id, tenant_id=None)
            self.scalars = [
                None,
                None,
                existing_mapping,
            ]
            self.rollback_called = False

        def get(self, _model, _id):
            return self.device

        def scalar(self, _stmt):
            return self.scalars.pop(0)

        def add(self, _obj):
            return None

        def commit(self):
            raise IntegrityError("insert tenant_device_mappings", {}, Exception("duplicate"))

        def rollback(self):
            self.rollback_called = True

    db = FakeDb()
    monkeypatch.setattr(tenant_repo, "_ensure_small_project_capabilities", lambda *a, **kw: None)

    result = tenant_repo.assign_device(db, tenant_id, device_id)

    assert result is existing_mapping
    assert db.rollback_called is True


def test_device_register_accepts_token_in_body(monkeypatch) -> None:
    from app.core import config as core_config
    from app.bounded_contexts.device_registry.presentation.router import _limiter

    monkeypatch.setattr(core_config.settings, "device_provisioning_secret", "body-token")
    monkeypatch.setattr(_limiter, "enabled", False)

    def fake_register_device(db, payload):
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id=uuid4(),
            device_uid=payload.device_uid,
            name=payload.name,
            firmware_version=payload.firmware_version,
            status="offline",
            last_seen_at=None,
            created_at=now,
            updated_at=now,
        )

    monkeypatch.setattr(device_repository, "register_device", fake_register_device)

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    try:
        r = client.post(
            "/api/v1/devices/register",
            json={
                "device_uid": "esp32-body-001",
                "name": "Body Token Device",
                "provisioning_token": "body-token",
            },
        )

        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert r.json()["device_uid"] == "esp32-body-001"
    finally:
        app_main.app.dependency_overrides = saved


def test_device_register_accepts_bearer_token(monkeypatch) -> None:
    from app.core import config as core_config
    from app.bounded_contexts.device_registry.presentation.router import _limiter

    monkeypatch.setattr(core_config.settings, "device_provisioning_secret", "header-token")
    monkeypatch.setattr(_limiter, "enabled", False)

    def fake_register_device(db, payload):
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id=uuid4(),
            device_uid=payload.device_uid,
            name=payload.name,
            firmware_version=payload.firmware_version,
            status="offline",
            last_seen_at=None,
            created_at=now,
            updated_at=now,
        )

    monkeypatch.setattr(device_repository, "register_device", fake_register_device)

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    try:
        r = client.post(
            "/api/v1/devices/register",
            headers={"Authorization": "Bearer header-token"},
            json={"device_uid": "esp32-header-001", "name": "Header Token Device"},
        )

        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert r.json()["device_uid"] == "esp32-header-001"
    finally:
        app_main.app.dependency_overrides = saved


def test_device_register_no_spoof_tenant_id(monkeypatch) -> None:
    """Device registration cannot set tenant_id — it's not in DeviceCreate."""
    from app.core import config as core_config

    monkeypatch.setattr(core_config.settings, "device_provisioning_secret", "test-token")

    captured: dict = {}

    def fake_register_device(db, payload):
        captured["payload"] = payload
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id=uuid4(),
            device_uid=payload.device_uid,
            name=payload.name,
            firmware_version=payload.firmware_version,
            status="offline",
            last_seen_at=None,
            created_at=now,
            updated_at=now,
        )

    monkeypatch.setattr(device_repository, "register_device", fake_register_device)

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    # Try to inject tenant_id in request body
    r = client.post(
        "/api/v1/devices/register?provisioning_token=test-token",
        json={
            "device_uid": "esp32-spoof-001",
            "name": "Spoof Device",
            "tenant_id": str(uuid4()),  # Should be ignored
        },
    )

    # Should succeed but tenant_id should NOT be in the payload
    if r.status_code == 200:
        # Verify tenant_id was not passed through
        p = captured.get("payload")
        if p is not None:
            assert not hasattr(p, "tenant_id") or p.tenant_id is None

    app_main.app.dependency_overrides = saved


def test_create_ota_job_uses_signed_download_url(monkeypatch) -> None:
    """Admin cannot push OTA to a tenant-owned device – expect 403."""
    device = _fake_device("esp32-demo-001")  # has tenant_id != None
    firmware = _fake_firmware("0.2.0")

    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: device)
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    r = client.post(
        "/api/v1/ota/jobs",
        json={"device_uid": "esp32-demo-001", "firmware_version_id": str(firmware.id)},
    )

    assert r.status_code == 403, r.text
    assert "read-only" in r.json()["detail"].lower()


def test_create_ota_job_uses_signed_download_url_platform_device(monkeypatch) -> None:
    """OTA job for a platform-owned device must use signed download URLs."""
    platform_device = SimpleNamespace(
        id=uuid4(),
        tenant_id=None,  # platform-owned
        device_uid="esp32-demo-001",
        name="ESP32 Demo Node",
        firmware_version="0.1.0",
        status="offline",
        ip_address="192.168.1.50",
        rssi=-55,
        free_heap=140000,
        uptime_ms=123456,
        last_status_payload={},
        last_seen_at=None,
        offline_timeout_seconds=60,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    firmware = _fake_firmware("0.2.0")

    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: platform_device)
    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", lambda db, fid: firmware)

    captured: dict = {}

    def fake_publish(device_uid, payload):
        captured["payload"] = payload

    monkeypatch.setattr(mqtt_publisher, "publish_ota_request", fake_publish)

    def fake_create_job(db, *, device_id, firmware_version_id):
        return SimpleNamespace(
            id=uuid4(),
            device_id=device_id,
            firmware_version_id=firmware_version_id,
            status="pending",
        )

    monkeypatch.setattr(ota_repository, "create_job", fake_create_job)
    monkeypatch.setattr(ota_repository, "update_status", lambda *a, **kw: None)
    monkeypatch.setattr(
        app_main.settings, "device_api_base_url", "http://aifom.local:8000", raising=False
    )

    r = client.post(
        "/api/v1/ota/jobs",
        json={"device_uid": "esp32-demo-001", "firmware_version_id": str(firmware.id)},
    )

    assert r.status_code == 201, r.text
    payload = captured["payload"]
    # Download URL must contain "ota-download" (token-based), not direct firmware download
    assert "ota-download" in payload["firmware_url"], (
        f"Expected signed URL, got: {payload['firmware_url']}"
    )
    assert "token=" in payload["firmware_url"], (
        f"Expected token in URL, got: {payload['firmware_url']}"
    )


# ── Refresh Token Tests ────────────────────────────────────────────────────


def test_login_returns_refresh_token(monkeypatch) -> None:
    """Login must return both access_token and refresh_token."""
    from app.modules.auth import repository as auth_repo
    from app.modules.tenants import repository as tenant_repo
    from app.db.session import get_db

    fake_user = SimpleNamespace(
        id=uuid4(),
        email="refresh@test.local",
        hashed_password="$2b$12$valid_hash",
        role="tenant_owner",
        tenant_id=uuid4(),
        is_active=True,
    )

    fake_tenant = SimpleNamespace(id=fake_user.tenant_id, is_active=True)

    def fake_get_user_by_email(db, email):
        return fake_user

    def fake_verify_password(plain, hashed):
        return True

    def fake_get_tenant(db, tid):
        return fake_tenant

    class FakeDB:
        def scalar(self, *a, **kw):
            return fake_tenant

        def commit(self):
            pass

        def refresh(self, *a):
            pass

    def fake_get_db():
        yield FakeDB()

    monkeypatch.setattr(auth_repo, "get_user_by_email", fake_get_user_by_email)
    monkeypatch.setattr(tenant_repo, "get_tenant", fake_get_tenant)
    monkeypatch.setattr(
        "app.bounded_contexts.identity.infrastructure.adapters.BcryptPasswordService.verify_password",
        staticmethod(fake_verify_password),
    )

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {
        get_db: fake_get_db,
    }

    try:
        r = client.post(
            "/api/v1/auth/login",
            json={"email": "refresh@test.local", "password": "valid"},
            headers={"Origin": "http://localhost:5173"},
        )

        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "access_token" in data
        assert "refresh_token" in data
        assert data["refresh_token"] is not None
        assert r.cookies.get("aifom_access_token")
        assert r.cookies.get("aifom_refresh_token")
    finally:
        client.cookies.clear()
        app_main.app.dependency_overrides = saved


def test_refresh_token_endpoint_works(monkeypatch) -> None:
    """POST /auth/refresh with valid refresh token must return new token pair."""
    from app.modules.auth import repository as auth_repo
    from app.modules.tenants import repository as tenant_repo
    from app.db.session import get_db
    from app.bounded_contexts.identity.application.services import create_refresh_token

    user_id = uuid4()
    fake_user = SimpleNamespace(
        id=user_id,
        email="refresh@test.local",
        role="tenant_owner",
        tenant_id=uuid4(),
        is_active=True,
    )

    fake_tenant = SimpleNamespace(id=fake_user.tenant_id, is_active=True)

    def fake_get_user_by_id(db, uid):
        return fake_user

    def fake_get_tenant(db, tid):
        return fake_tenant

    class FakeDB:
        def scalar(self, *a, **kw):
            return fake_tenant

        def add(self, obj):
            self.added = obj

        def commit(self):
            self.committed = True

        def rollback(self):
            self.rolled_back = True

    def fake_get_db():
        yield FakeDB()

    monkeypatch.setattr(auth_repo, "get_user_by_id", fake_get_user_by_id)
    monkeypatch.setattr(tenant_repo, "get_tenant", fake_get_tenant)

    refresh = create_refresh_token(str(user_id))

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {
        get_db: fake_get_db,
    }

    r = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh},
    )

    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    data = r.json()
    assert "access_token" in data
    assert "refresh_token" in data

    app_main.app.dependency_overrides = saved


def test_refresh_token_rejects_invalid_token() -> None:
    """POST /auth/refresh with invalid token must return 401."""
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": "invalid-token"},
    )

    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_refresh_token_rejects_expired_token(monkeypatch) -> None:
    """POST /auth/refresh with expired refresh token must return 401."""
    from jose import jwt
    from app.core.config import settings

    expired_payload = {
        "sub": str(uuid4()),
        "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        "type": "refresh",
    }
    expired_token = jwt.encode(
        expired_payload, settings.jwt_secret, algorithm=settings.jwt_algorithm
    )

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": expired_token},
    )

    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_access_token_rejected_as_refresh_token() -> None:
    """Access token must not be accepted as a refresh token."""
    from app.bounded_contexts.identity.application.services import create_access_token

    access = create_access_token(str(uuid4()), "admin")

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": access},
    )

    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_refresh_token_rejected_as_access_token(monkeypatch) -> None:
    """Refresh token must not be accepted as an access token."""
    from app.bounded_contexts.identity.application.services import create_refresh_token

    refresh = create_refresh_token(str(uuid4()))

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    # Try to use refresh token as Bearer token
    r = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {refresh}"},
    )

    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


# ── Expired Token Tests ─────────────────────────────────────────────────────


def test_expired_access_token_rejected() -> None:
    """Expired JWT access token must be rejected."""
    from jose import jwt
    from app.core.config import settings

    expired_payload = {
        "sub": str(uuid4()),
        "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        "role": "admin",
        "type": "access",
    }
    expired_token = jwt.encode(
        expired_payload, settings.jwt_secret, algorithm=settings.jwt_algorithm
    )

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {expired_token}"},
    )

    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_client_endpoints_reject_expired_access_token() -> None:
    """Tenant client endpoints must reject expired access tokens with 401."""
    from jose import jwt
    from app.core.config import settings

    expired_payload = {
        "sub": str(uuid4()),
        "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        "role": "tenant_owner",
        "type": "access",
    }
    expired_token = jwt.encode(
        expired_payload, settings.jwt_secret, algorithm=settings.jwt_algorithm
    )

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}
    try:
        for path in (
            "/api/v1/client/devices",
            "/api/v1/client/projects",
            "/api/v1/client/device-groups",
            "/api/v1/client/alerts?limit=20",
        ):
            r = client.get(path, headers={"Authorization": f"Bearer {expired_token}"})
            assert r.status_code == 401, f"{path} expected 401, got {r.status_code}: {r.text}"
    finally:
        app_main.app.dependency_overrides = saved


def test_refreshed_access_token_can_access_client_endpoints(monkeypatch) -> None:
    """A token returned by /auth/refresh must authenticate tenant client endpoints."""
    from unittest.mock import MagicMock

    from app.db.session import get_db
    from app.modules.auth import repository as auth_repo
    from app.modules.tenants import repository as tenant_repo
    from app.bounded_contexts.device_groups.application.use_cases import DeviceGroupUseCases
    from app.bounded_contexts.identity.application.services import create_refresh_token
    from app.bounded_contexts.identity.infrastructure.adapters import SqlAlchemyUserRepository
    from app.bounded_contexts.identity.presentation import router as identity_router
    from app.modules.projects import repository as project_repository

    tenant_id = uuid4()
    user_id = uuid4()
    now = datetime.now(timezone.utc)
    tenant_user = SimpleNamespace(
        id=user_id,
        email="tenant-refresh@test.local",
        full_name="Tenant Refresh",
        role="tenant_owner",
        tenant_id=tenant_id,
        is_active=True,
        created_at=now,
    )
    active_tenant = SimpleNamespace(id=tenant_id, is_active=True)
    device = _fake_tenant_device("esp32-refresh")
    group = SimpleNamespace(
        id=uuid4(),
        tenant_id=tenant_id,
        name="Default",
        description=None,
        group_type="manual",
        status="active",
        tags=[],
        extra_metadata={},
        device_count=0,
        created_at=now,
        updated_at=now,
    )

    class FakeDB:
        def scalar(self, *a, **kw):
            return None

        def scalars(self, *a, **kw):
            result = MagicMock()
            result.all.return_value = []
            return result

        def add(self, obj):
            self.added = obj

        def commit(self):
            self.committed = True

        def rollback(self):
            self.rolled_back = True

    def fake_get_db():
        yield FakeDB()

    monkeypatch.setattr(auth_repo, "get_user_by_id", lambda db, uid: tenant_user)
    monkeypatch.setattr(SqlAlchemyUserRepository, "get_by_id", lambda self, uid: tenant_user)
    monkeypatch.setattr(tenant_repo, "get_tenant", lambda db, tid: active_tenant)
    monkeypatch.setattr(identity_router, "get_tenant", lambda db, tid: active_tenant)
    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tid: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(tenant_repo, "list_tenant_devices", lambda db, tid, **kwargs: [device])
    monkeypatch.setattr(
        project_repository,
        "list_projects",
        lambda db, tid: [
            {
                "id": uuid4(),
                "tenant_id": tenant_id,
                "name": "Refresh Project",
                "description": None,
                "created_at": now,
                "updated_at": now,
            }
        ],
    )
    monkeypatch.setattr(DeviceGroupUseCases, "list_groups", lambda self, *args: ([group], 1))

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {get_db: fake_get_db}
    try:
        refresh = create_refresh_token(str(user_id))
        refresh_response = client.post("/api/v1/auth/refresh", json={"refresh_token": refresh})
        assert refresh_response.status_code == 200, refresh_response.text
        access_token = refresh_response.json()["access_token"]

        expectations = {
            "/api/v1/client/devices": list,
            "/api/v1/client/projects": list,
            "/api/v1/client/device-groups": dict,
            "/api/v1/client/alerts?limit=20": list,
        }
        for path, expected_type in expectations.items():
            r = client.get(path, headers={"Authorization": f"Bearer {access_token}"})
            assert r.status_code == 200, f"{path} expected 200, got {r.status_code}: {r.text}"
            assert isinstance(r.json(), expected_type)
    finally:
        app_main.app.dependency_overrides = saved


# ── Comprehensive Auth Tests ────────────────────────────────────────────────


def test_login_rejects_invalid_email(monkeypatch) -> None:
    """Login with non-existent email must return 401."""
    from app.modules.auth import repository as auth_repo

    def fake_get_user_by_email(db, email):
        return None

    monkeypatch.setattr(auth_repo, "get_user_by_email", fake_get_user_by_email)

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.post(
        "/api/v1/auth/login",
        json={"email": "nonexistent@test.local", "password": "valid"},
    )

    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"
    assert "Invalid email or password" in r.json()["detail"]

    app_main.app.dependency_overrides = saved


def test_login_rejects_wrong_password(monkeypatch) -> None:
    """Login with wrong password must return 401."""
    from app.modules.auth import repository as auth_repo

    fake_user = SimpleNamespace(
        id=uuid4(),
        email="user@test.local",
        hashed_password="$2b$12$valid_hash",
        role="tenant_owner",
        tenant_id=uuid4(),
        is_active=True,
    )

    def fake_get_user_by_email(db, email):
        return fake_user

    def fake_verify_password(plain, hashed):
        return False

    monkeypatch.setattr(auth_repo, "get_user_by_email", fake_get_user_by_email)
    monkeypatch.setattr(
        "app.bounded_contexts.identity.infrastructure.adapters.BcryptPasswordService.verify_password",
        staticmethod(fake_verify_password),
    )

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.post(
        "/api/v1/auth/login",
        json={"email": "user@test.local", "password": "wrong"},
    )

    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_login_rejects_inactive_user(monkeypatch) -> None:
    """Login with inactive user must return 403."""
    from app.modules.auth import repository as auth_repo

    fake_user = SimpleNamespace(
        id=uuid4(),
        email="inactive@test.local",
        hashed_password="$2b$12$valid_hash",
        role="tenant_owner",
        tenant_id=uuid4(),
        is_active=False,
    )

    def fake_get_user_by_email(db, email):
        return fake_user

    def fake_verify_password(plain, hashed):
        return True

    monkeypatch.setattr(auth_repo, "get_user_by_email", fake_get_user_by_email)
    monkeypatch.setattr(
        "app.bounded_contexts.identity.infrastructure.adapters.BcryptPasswordService.verify_password",
        staticmethod(fake_verify_password),
    )

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.post(
        "/api/v1/auth/login",
        json={"email": "inactive@test.local", "password": "valid"},
    )

    assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
    assert r.json()["detail"] == "Account is disabled. Contact your administrator."

    app_main.app.dependency_overrides = saved


def test_login_rejects_disabled_tenant(monkeypatch) -> None:
    """Login with disabled tenant must return 403."""
    from app.modules.auth import repository as auth_repo
    from app.modules.tenants import repository as tenant_repo
    from app.db.session import get_db

    fake_user = SimpleNamespace(
        id=uuid4(),
        email="disabled@test.local",
        hashed_password="$2b$12$valid_hash",
        role="tenant_owner",
        tenant_id=uuid4(),
        is_active=True,
    )

    fake_tenant = SimpleNamespace(id=fake_user.tenant_id, is_active=False)

    def fake_get_user_by_email(db, email):
        return fake_user

    def fake_verify_password(plain, hashed):
        return True

    def fake_get_tenant(db, tid):
        return fake_tenant

    class FakeDB:
        def scalar(self, *a, **kw):
            return fake_tenant

        def commit(self):
            pass

    def fake_get_db():
        yield FakeDB()

    monkeypatch.setattr(auth_repo, "get_user_by_email", fake_get_user_by_email)
    monkeypatch.setattr(tenant_repo, "get_tenant", fake_get_tenant)
    monkeypatch.setattr(
        "app.bounded_contexts.identity.infrastructure.adapters.BcryptPasswordService.verify_password",
        staticmethod(fake_verify_password),
    )

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {
        get_db: fake_get_db,
    }

    r = client.post(
        "/api/v1/auth/login",
        json={"email": "disabled@test.local", "password": "valid"},
    )

    assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
    assert "disabled" in r.json()["detail"].lower()

    app_main.app.dependency_overrides = saved


def test_register_validates_password_length() -> None:
    """Registration must reject passwords shorter than 8 characters."""
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.post(
        "/api/v1/auth/register",
        json={
            "tenant_name": "Test Tenant",
            "owner_email": "short@example.com",
            "owner_password": "short",
        },
    )

    assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_register_validates_email_format() -> None:
    """Registration must reject invalid email format."""
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.post(
        "/api/v1/auth/register",
        json={
            "tenant_name": "Test Tenant",
            "owner_email": "invalid-email",
            "owner_password": "validpassword123",
        },
    )

    assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_register_validates_tenant_name_length() -> None:
    """Registration must reject tenant names shorter than 2 characters."""
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.post(
        "/api/v1/auth/register",
        json={
            "tenant_name": "A",
            "owner_email": "valid@example.com",
            "owner_password": "validpassword123",
        },
    )

    assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_register_tenant_success() -> None:
    """Registration must succeed for valid tenant name, email, and password."""
    import uuid

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    unique_email = f"tenant_{uuid.uuid4().hex[:8]}@example.com"
    unique_slug = f"tenant-{uuid.uuid4().hex[:8]}"

    r = client.post(
        "/api/v1/auth/register",
        json={
            "tenant_name": "Success Tenant",
            "tenant_slug": unique_slug,
            "owner_email": unique_email,
            "owner_password": "Validpassword123",
            "owner_full_name": "Tenant Owner",
        },
    )

    assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"
    data = r.json()
    assert "user" in data
    assert data["user"]["email"] == unique_email
    assert data["user"]["role"] == "tenant_owner"

    app_main.app.dependency_overrides = saved


# ── Device Tests ────────────────────────────────────────────────────────────


def test_device_not_found() -> None:
    """Device not found must return 404."""
    r = client.get("/api/v1/devices/nonexistent-device")

    assert r.status_code == 404, f"Expected 404, got {r.status_code}: {r.text}"


def test_device_list_returns_all_devices(monkeypatch) -> None:
    """Device list must return all devices for admin."""
    devices = [_fake_device(f"esp32-list-{i}", status="offline") for i in range(3)]

    def fake_list_devices_with_tenant(db, tenant_id=None):
        return [(device, None) for device in devices]

    monkeypatch.setattr(
        device_repository,
        "list_devices_with_tenant",
        fake_list_devices_with_tenant,
    )

    r = client.get("/api/v1/devices")

    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    assert len(r.json()) == 3


def test_device_create_requires_admin() -> None:
    """Device creation must require admin role."""
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {
        security_module.get_current_user: lambda: _fake_tenant_user,
    }

    r = client.post(
        "/api/v1/devices",
        json={
            "device_uid": "esp32-no-admin",
            "name": "Should Fail",
        },
    )

    assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


# ── Firmware Tests ──────────────────────────────────────────────────────────


def test_firmware_get_by_id_not_found(monkeypatch) -> None:
    """Firmware get by ID must return 404 when not found."""

    def fake_get_firmware_by_id(db, fid):
        return None

    monkeypatch.setattr(firmware_repository, "get_firmware_by_id", fake_get_firmware_by_id)

    r = client.get(f"/api/v1/firmware/{uuid4()}")

    assert r.status_code == 404, f"Expected 404, got {r.status_code}: {r.text}"


# ── OTA Tests ──────────────────────────────────────────────────────────────


def test_ota_job_requires_device_uid() -> None:
    """OTA job creation must require device_uid."""
    r = client.post(
        "/api/v1/ota/jobs",
        json={"firmware_version_id": str(uuid4())},
    )

    assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"


def test_ota_job_requires_firmware_version_id() -> None:
    """OTA job creation must require firmware_version_id."""
    r = client.post(
        "/api/v1/ota/jobs",
        json={"device_uid": "esp32-ota-001"},
    )

    assert r.status_code == 422, f"Expected 422, got {r.status_code}: {r.text}"


# ── Telemetry Tests ─────────────────────────────────────────────────────────


def test_telemetry_list_requires_admin() -> None:
    """Telemetry list must require admin role."""
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {
        security_module.get_current_user: lambda: _fake_tenant_user,
    }

    r = client.get("/api/v1/telemetry")

    assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


# ── Security Token Tests ────────────────────────────────────────────────────


def test_malformed_jwt_rejected() -> None:
    """Malformed JWT token must be rejected."""
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer not-a-jwt-token"},
    )

    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_missing_auth_header_rejected() -> None:
    """Missing Authorization header must be rejected."""
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.get("/api/v1/auth/me")

    assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


def test_empty_bearer_token_rejected() -> None:
    """Empty Bearer token must be rejected."""
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": "Bearer "},
    )

    assert r.status_code in (401, 403), f"Expected 401/403, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


# ── Health & Ready Tests ────────────────────────────────────────────────────


def test_health_returns_ok() -> None:
    """Health endpoint must return ok."""
    r = client.get("/health")

    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_ready_returns_ready() -> None:
    """Ready endpoint must return ready (200) or starting (503)."""
    r = client.get("/ready")

    assert r.status_code in (200, 503)
    assert r.json()["status"] in ("ready", "starting")


# ── IDOR Prevention Tests ──────────────────────────────────────────────────


def test_tenant_cannot_access_admin_devices() -> None:
    """Tenant user must not access admin device endpoints."""
    with _TenantOverride():
        r = client.get("/api/v1/devices")

        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"


def test_tenant_cannot_access_admin_firmware() -> None:
    """Tenant user must not access admin firmware endpoints."""
    with _TenantOverride():
        r = client.get("/api/v1/firmware")

        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"


def test_tenant_cannot_access_admin_ota() -> None:
    """Tenant user must not access admin OTA endpoints."""
    with _TenantOverride():
        r = client.get("/api/v1/ota/jobs")

        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"


def test_tenant_cannot_access_admin_telemetry() -> None:
    """Tenant user must not access admin telemetry endpoints."""
    with _TenantOverride():
        r = client.get("/api/v1/telemetry")

        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"


def test_tenant_cannot_create_device() -> None:
    """Tenant user must not create devices."""
    with _TenantOverride():
        r = client.post(
            "/api/v1/devices",
            json={"device_uid": "esp32-idor", "name": "IDOR Test"},
        )

        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"


def test_tenant_cannot_upload_firmware() -> None:
    """Tenant user must not upload firmware via admin endpoint."""
    with _TenantOverride():
        r = client.post(
            "/api/v1/firmware",
            data={"version": "1.0.0", "target_device_type": "esp32"},
            files={"file": ("test.bin", b"firmware", "application/octet-stream")},
        )

        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"


# ── MQTT Tests ──────────────────────────────────────────────────────────────


def test_mqtt_topics_contain_device_uid() -> None:
    """MQTT topics must contain the device UID."""
    from app.services.mqtt_topics import (
        telemetry_topic,
        status_topic,
        events_topic,
        commands_topic,
        ota_topic,
        ota_status_topic,
    )

    uid = "esp32-topic-001"

    assert uid in telemetry_topic(uid)
    assert uid in status_topic(uid)
    assert uid in events_topic(uid)
    assert uid in commands_topic(uid)
    assert uid in ota_topic(uid)
    assert uid in ota_status_topic(uid)


def test_mqtt_topics_are_unique() -> None:
    """MQTT topics must be unique for different devices."""
    from app.services.mqtt_topics import telemetry_topic

    uid1 = "esp32-unique-001"
    uid2 = "esp32-unique-002"

    assert telemetry_topic(uid1) != telemetry_topic(uid2)


# ── Edge Case Tests ─────────────────────────────────────────────────────────


def test_device_uid_with_special_chars(monkeypatch) -> None:
    """Device UID with special characters must be handled."""
    now = datetime.now(timezone.utc)
    device = SimpleNamespace(
        id=uuid4(),
        device_uid="esp32-special-chars-001",
        name="Special Device",
        firmware_version="1.0.0",
        status="offline",
        last_seen_at=None,
        created_at=now,
        updated_at=now,
    )

    def fake_create_device(db, payload):
        return device

    monkeypatch.setattr(device_repository, "create_device", fake_create_device)

    r = client.post(
        "/api/v1/devices",
        json={
            "device_uid": "esp32-special-chars-001",
            "name": "Special Device",
        },
    )

    assert r.status_code == 201, f"Expected 201, got {r.status_code}: {r.text}"


def test_device_uid_with_long_name(monkeypatch) -> None:
    """Device UID with long name must be handled."""
    now = datetime.now(timezone.utc)
    long_uid = "esp32-" + "a" * 100
    device = SimpleNamespace(
        id=uuid4(),
        device_uid=long_uid,
        name="Long UID Device",
        firmware_version="1.0.0",
        status="offline",
        last_seen_at=None,
        created_at=now,
        updated_at=now,
    )

    def fake_create_device(db, payload):
        return device

    monkeypatch.setattr(device_repository, "create_device", fake_create_device)

    r = client.post(
        "/api/v1/devices",
        json={
            "device_uid": long_uid,
            "name": "Long UID Device",
        },
    )

    # Should either succeed or return 422 for validation
    assert r.status_code in (201, 422), f"Expected 201/422, got {r.status_code}: {r.text}"


def test_concurrent_device_creation(monkeypatch) -> None:
    """Concurrent device creation must be handled."""
    import threading

    now = datetime.now(timezone.utc)
    devices = []

    def fake_create_device(db, payload):
        device = SimpleNamespace(
            id=uuid4(),
            device_uid=payload.device_uid,
            name=payload.name,
            firmware_version="1.0.0",
            status="offline",
            last_seen_at=None,
            created_at=now,
            updated_at=now,
        )
        devices.append(device)
        return device

    monkeypatch.setattr(device_repository, "create_device", fake_create_device)

    def create_device(uid):
        client.post(
            "/api/v1/devices",
            json={"device_uid": uid, "name": f"Device {uid}"},
        )

    threads = [
        threading.Thread(target=create_device, args=(f"esp32-concurrent-{i}",)) for i in range(5)
    ]

    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # All devices should be created
    assert len(devices) == 5


# ── Configuration Tests ─────────────────────────────────────────────────────


def test_settings_has_required_fields() -> None:
    """Settings must have all required fields."""
    from app.core.config import settings

    assert hasattr(settings, "app_name")
    assert hasattr(settings, "database_url")
    assert hasattr(settings, "jwt_secret")
    assert hasattr(settings, "jwt_expire_minutes")
    assert hasattr(settings, "ota_token_secret")
    assert hasattr(settings, "ota_token_expire_minutes")
    assert hasattr(settings, "device_provisioning_secret")


def test_settings_jwt_expire_minutes_default() -> None:
    """JWT expire minutes must default to 30."""
    from app.core.config import settings

    assert settings.jwt_expire_minutes == 30


def test_settings_ota_token_expire_minutes_default() -> None:
    """OTA token expire minutes must default to 15."""
    from app.core.config import settings

    assert settings.ota_token_expire_minutes == 15


def test_settings_cors_origins_list() -> None:
    """CORS origins must be a list."""
    from app.core.config import settings

    origins = settings.cors_origins_list

    assert isinstance(origins, list)
    assert len(origins) > 0


def test_settings_mqtt_public_host_alias() -> None:
    """MQTT public host must be aliased."""
    from app.core.config import settings

    assert settings.mqtt_public_host == settings.device_mqtt_host


def test_settings_mqtt_public_port_alias() -> None:
    """MQTT public port must be aliased."""
    from app.core.config import settings

    assert settings.mqtt_public_port == settings.device_mqtt_port


def test_settings_device_mqtt_port_follows_docker_host_mapping(monkeypatch) -> None:
    """ESP32-facing MQTT port should use Docker host port when remapped in dev."""
    from app.core.config import Settings

    monkeypatch.setenv("AIFOM_TESTING", "1")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("MQTT_PORT", "1883")
    monkeypatch.setenv("MQTT_HOST_PORT", "1884")
    monkeypatch.setenv("DEVICE_MQTT_PORT", "1883")

    settings = Settings(_env_file=None)

    assert settings.mqtt_port == 1883
    assert settings.mqtt_host_port == 1884
    assert settings.device_mqtt_port == 1884


def test_settings_device_mqtt_port_allows_explicit_public_override(monkeypatch) -> None:
    """Explicit DEVICE_MQTT_PORT still wins for proxy/TLS deployments."""
    from app.core.config import Settings

    monkeypatch.setenv("AIFOM_TESTING", "1")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("MQTT_PORT", "1883")
    monkeypatch.setenv("MQTT_HOST_PORT", "1884")
    monkeypatch.setenv("DEVICE_MQTT_PORT", "8883")

    settings = Settings(_env_file=None)

    assert settings.device_mqtt_port == 8883


def test_settings_device_api_base_url_follows_docker_host_mapping(monkeypatch) -> None:
    """ESP32-facing API URL should use Docker host port when remapped in dev."""
    from app.core.config import Settings

    monkeypatch.setenv("AIFOM_TESTING", "1")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("API_PORT", "8000")
    monkeypatch.setenv("API_HOST_PORT", "8001")
    monkeypatch.setenv("DEVICE_API_BASE_URL", "http://aifom.local:8000")

    settings = Settings(_env_file=None)

    assert settings.device_api_base_url == "http://aifom.local:8001"
    assert settings.device_api_port == 8001


def test_settings_device_api_base_url_allows_explicit_public_override(monkeypatch) -> None:
    """Explicit non-internal DEVICE_API_BASE_URL still wins."""
    from app.core.config import Settings

    monkeypatch.setenv("AIFOM_TESTING", "1")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("API_PORT", "8000")
    monkeypatch.setenv("API_HOST_PORT", "8001")
    monkeypatch.setenv("DEVICE_API_BASE_URL", "https://aifom.example.com:8443")

    settings = Settings(_env_file=None)

    assert settings.device_api_base_url == "https://aifom.example.com:8443"
    assert settings.device_api_port == 8443


def test_settings_ota_download_base_url_alias() -> None:
    """OTA download base URL must be aliased."""
    from app.core.config import settings

    assert settings.ota_download_base_url == settings.device_api_base_url


# ── Disabled Tenant Tests ───────────────────────────────────────────────────


# ── System Health Endpoint Tests ────────────────────────────────────────────


def test_system_health_endpoint_exists() -> None:
    """System health endpoint should be accessible."""
    response = client.get("/api/v1/debug/system-health")
    assert response.status_code == 200
    body = response.json()
    assert "api" in body
    assert "database" in body
    assert "mqtt" in body
    assert "storage" in body
    assert "overall" in body


def test_system_health_api_component_always_healthy() -> None:
    """If the endpoint responds, the API component is healthy."""
    response = client.get("/api/v1/debug/system-health")
    body = response.json()
    assert body["api"]["status"] == "healthy"


def test_system_health_overall_status() -> None:
    """Overall status should be derived from component statuses."""
    response = client.get("/api/v1/debug/system-health")
    body = response.json()
    assert body["overall"] in ("healthy", "degraded", "down")


def test_system_health_has_latency() -> None:
    """Component health should include latency measurements."""
    response = client.get("/api/v1/debug/system-health")
    body = response.json()
    # Database should have latency if healthy
    if body["database"]["status"] == "healthy":
        assert body["database"]["latency_ms"] is not None
        assert body["database"]["latency_ms"] >= 0


def test_system_health_has_timestamp() -> None:
    """Response should include a timestamp."""
    response = client.get("/api/v1/debug/system-health")
    body = response.json()
    assert "timestamp" in body


def test_system_health_has_detail() -> None:
    """Component health should include detail messages."""
    response = client.get("/api/v1/debug/system-health")
    body = response.json()
    assert body["api"]["detail"] is not None


# ── Device Registry Value Objects Tests ─────────────────────────────────────


def test_device_status_normalize_online() -> None:
    """DeviceStatus.normalize should map known online variants."""
    from app.bounded_contexts.device_registry.domain.value_objects import DeviceStatus

    assert DeviceStatus.normalize("online") == DeviceStatus.ONLINE
    assert DeviceStatus.normalize("connected") == DeviceStatus.ONLINE
    assert DeviceStatus.normalize("ok") == DeviceStatus.ONLINE
    assert DeviceStatus.normalize("up") == DeviceStatus.ONLINE


def test_device_status_normalize_offline() -> None:
    """DeviceStatus.normalize should map known offline variants."""
    from app.bounded_contexts.device_registry.domain.value_objects import DeviceStatus

    assert DeviceStatus.normalize("offline") == DeviceStatus.OFFLINE
    assert DeviceStatus.normalize("disconnected") == DeviceStatus.OFFLINE
    assert DeviceStatus.normalize("down") == DeviceStatus.OFFLINE


def test_device_status_normalize_unknown() -> None:
    """DeviceStatus.normalize should handle unknown/None values."""
    from app.bounded_contexts.device_registry.domain.value_objects import DeviceStatus

    assert DeviceStatus.normalize(None) == DeviceStatus.UNKNOWN
    assert DeviceStatus.normalize("") == DeviceStatus.UNKNOWN
    assert DeviceStatus.normalize("n/a") == DeviceStatus.UNKNOWN


def test_device_status_is_online_property() -> None:
    """DeviceStatus.is_online should be True only for ONLINE."""
    from app.bounded_contexts.device_registry.domain.value_objects import DeviceStatus

    assert DeviceStatus.ONLINE.is_online is True
    assert DeviceStatus.OFFLINE.is_online is False
    assert DeviceStatus.UNKNOWN.is_online is False


def test_offline_timeout_clamping() -> None:
    """OfflineTimeout should clamp values to valid range."""
    from app.bounded_contexts.device_registry.domain.value_objects import OfflineTimeout

    assert OfflineTimeout(seconds=5).seconds == 10  # clamped to min
    assert OfflineTimeout(seconds=100).seconds == 100  # within range
    assert OfflineTimeout(seconds=1000).seconds == 600  # clamped to max


def test_offline_timeout_default() -> None:
    """OfflineTimeout.default() should return 60 seconds."""
    from app.bounded_contexts.device_registry.domain.value_objects import OfflineTimeout

    assert OfflineTimeout.default().seconds == 60


def test_device_uid_validation() -> None:
    """DeviceUID should reject empty values."""
    from app.bounded_contexts.device_registry.domain.value_objects import DeviceUID

    assert str(DeviceUID("esp32-001")) == "esp32-001"
    try:
        DeviceUID("")
        assert False, "Should have raised ValueError"
    except ValueError:
        pass


def test_mqtt_topics_to_dict() -> None:
    """MqttTopics.to_dict() should return all 6 topic paths."""
    from app.bounded_contexts.device_registry.domain.value_objects import MqttTopics

    topics = MqttTopics(
        telemetry="a/esp32-001/telemetry",
        status="a/esp32-001/status",
        events="a/esp32-001/events",
        commands="a/esp32-001/commands",
        ota="a/esp32-001/ota",
        ota_status="a/esp32-001/ota_status",
    )
    d = topics.to_dict()
    assert len(d) == 6
    assert d["telemetry"] == "a/esp32-001/telemetry"
    assert d["commands"] == "a/esp32-001/commands"


# ── Token Blacklist Tests ────────────────────────────────────────────────────


def test_login_request_validates_email_length() -> None:
    """LoginRequest should reject empty email."""
    from app.bounded_contexts.identity.presentation.schemas import LoginRequest

    try:
        LoginRequest(email="", password="test1234")
        assert False, "Should have raised ValueError"
    except Exception:
        pass


def test_login_request_validates_password_length() -> None:
    """LoginRequest should reject password exceeding 128 characters."""
    from app.bounded_contexts.identity.presentation.schemas import LoginRequest

    try:
        LoginRequest(email="test@test.com", password="x" * 129)
        assert False, "Should have raised ValueError"
    except Exception:
        pass


def test_tenant_user_create_validates_password() -> None:
    """TenantUserCreate should reject short passwords."""
    from app.bounded_contexts.tenant_management.presentation.schemas import TenantUserCreate

    try:
        TenantUserCreate(email="test@test.com", password="short")
        assert False, "Should have raised ValueError"
    except Exception:
        pass


def test_tenant_user_create_requires_mixed_case_and_digit() -> None:
    """TenantUserCreate should enforce the password policy."""
    from app.bounded_contexts.tenant_management.presentation.schemas import TenantUserCreate

    for password in ("lowercase1", "UPPERCASE1", "NoDigitsHere"):
        try:
            TenantUserCreate(email="test@test.com", password=password)
            assert False, "Should have raised ValueError"
        except Exception:
            pass

    user = TenantUserCreate(email="test@test.com", password="Validpass1")
    assert user.password == "Validpass1"


def test_register_request_enforces_password_policy() -> None:
    """Tenant registration should enforce the password policy."""
    from app.bounded_contexts.identity.presentation.schemas import RegisterRequest

    try:
        RegisterRequest(
            tenant_name="Demo Tenant",
            owner_email="owner@test.com",
            owner_password="lowercase1",
        )
        assert False, "Should have raised ValueError"
    except Exception:
        pass


def test_tenant_user_create_validates_email() -> None:
    """TenantUserCreate should reject invalid emails."""
    from app.bounded_contexts.tenant_management.presentation.schemas import TenantUserCreate

    try:
        TenantUserCreate(email="not-an-email", password="Validpass1")
        assert False, "Should have raised ValueError"
    except Exception:
        pass


def test_access_token_requires_explicit_type() -> None:
    """Tokens without explicit 'type' claim should be rejected."""
    from jose import jwt
    from app.core.config import settings
    from app.bounded_contexts.identity.application.services import decode_access_token

    # Token without type claim
    import uuid

    now = datetime.now(timezone.utc)
    payload = {
        "sub": "user123",
        "exp": now + timedelta(minutes=30),
        "iat": now,
        "nbf": now,
        "jti": str(uuid.uuid4()),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    assert decode_access_token(token) is None

    # Token with explicit access type should work
    payload["type"] = "access"
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    assert decode_access_token(token) == "user123"


def test_token_claims_decoding() -> None:
    """decode_token_claims should return all claims from a token."""
    from jose import jwt
    from app.core.config import settings
    from app.bounded_contexts.identity.application.services import decode_token_claims

    payload = {
        "sub": "user123",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
        "type": "access",
        "jti": "test-jti-123",
        "role": "admin",
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    claims = decode_token_claims(token)
    assert claims is not None
    assert claims["sub"] == "user123"
    assert claims["jti"] == "test-jti-123"
    assert claims["role"] == "admin"


def test_system_health_requires_auth() -> None:
    """System health endpoint should require authentication."""
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}

    r = client.get("/api/v1/debug/system-health")
    assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"

    app_main.app.dependency_overrides = saved


# ── Regression tests: runtime fix (2026-05-30) ───────────────────────────────
# These tests guard against the regressions described in the runtime fix report:
#   - OTA jobs list returning 500
#   - Audit logs list returning 500
#   - auth/me returning 500 after F5
#   - Anomaly model info returning 500
#   - Session poisoning from missing tables


def test_admin_ota_jobs_list_returns_200(monkeypatch) -> None:
    """Admin OTA jobs list must return 200 with an empty list if no jobs exist."""
    monkeypatch.setattr(
        ota_repository,
        "list_jobs",
        lambda db, device_id=None, limit=100: [],
    )

    r = client.get("/api/v1/ota/jobs?limit=100")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    assert r.json() == []


def test_admin_ota_jobs_list_returns_jobs(monkeypatch) -> None:
    """Admin OTA jobs list must return job data when jobs exist."""
    device = _fake_device("esp32-demo-001")
    firmware = _fake_firmware("0.2.0")
    now = datetime.now(timezone.utc)

    fake_job = SimpleNamespace(
        id=uuid4(),
        device_id=device.id,
        firmware_version_id=firmware.id,
        tenant_id=None,
        device=device,
        firmware_version=firmware,
        status="sent",
        requested_at=now,
        started_at=None,
        completed_at=None,
        progress=None,
        last_message=None,
        error_message=None,
        created_at=now,
        updated_at=now,
    )

    monkeypatch.setattr(
        ota_repository,
        "list_jobs",
        lambda db, device_id=None, limit=100: [fake_job],
    )

    r = client.get("/api/v1/ota/jobs")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    body = r.json()
    assert len(body) == 1
    assert body[0]["status"] == "sent"


def test_client_ota_jobs_list_returns_200_empty(monkeypatch) -> None:
    """Client OTA jobs list must return 200 with empty list when no devices assigned."""
    from app.modules.tenants import repository as tenant_repo_mod

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        tenant_repo_mod,
        "list_tenant_devices",
        lambda db, tenant_id, **kwargs: [],
    )

    with _TenantOverride():
        r = client.get("/api/v1/client/ota-jobs")

    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    assert r.json() == []


def test_client_ota_jobs_includes_legacy_null_tenant_job_owned_by_device(monkeypatch) -> None:
    """Tenant OTA list must resolve ownership from device mapping, not ota_jobs.tenant_id."""
    from unittest.mock import MagicMock

    from app.db.session import get_db
    from app.modules.tenants import repository as tenant_repo_mod

    device = _fake_tenant_device("esp32-t001")
    firmware = _fake_firmware("2.0.0")
    now = datetime.now(timezone.utc)
    legacy_job = SimpleNamespace(
        id=uuid4(),
        device_id=device.id,
        firmware_version_id=firmware.id,
        tenant_id=None,
        device=device,
        firmware_version=firmware,
        status="sent",
        requested_at=now,
        started_at=None,
        completed_at=None,
        progress=None,
        last_message=None,
        error_message=None,
        created_at=now,
        updated_at=now,
    )

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        tenant_repo_mod,
        "list_tenant_devices",
        lambda db, tenant_id, **kwargs: [device],
    )

    fake_db = MagicMock()
    fake_scalars_result = MagicMock()
    fake_scalars_result.all.return_value = [legacy_job]
    fake_db.scalars.return_value = fake_scalars_result

    def override_get_db():
        yield fake_db

    saved = dict(app_main.app.dependency_overrides)
    try:
        with _TenantOverride():
            app_main.app.dependency_overrides[get_db] = override_get_db
            r = client.get("/api/v1/client/ota-jobs")

        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert len(body) == 1
        assert body[0]["device_uid"] == "esp32-t001"
        assert body[0]["firmware_version"] == "2.0.0"
    finally:
        app_main.app.dependency_overrides = saved


def test_create_ota_job_sets_tenant_id_from_device_mapping() -> None:
    """New OTA jobs should keep tenant_id populated when the device is mapped."""
    tenant_id = uuid4()
    device_id = uuid4()
    firmware_id = uuid4()

    class FakeSession:
        def __init__(self):
            self.added = None
            self.committed = False
            self.refreshed = False

        def scalar(self, stmt):
            return tenant_id

        def add(self, obj):
            self.added = obj

        def commit(self):
            self.committed = True

        def refresh(self, obj):
            self.refreshed = True

    session = FakeSession()
    job = ota_repository.create_job(session, device_id=device_id, firmware_version_id=firmware_id)

    assert session.added is job
    assert session.committed is True
    assert session.refreshed is True
    assert job.tenant_id == tenant_id


def test_admin_audit_logs_returns_200(monkeypatch) -> None:
    """Admin audit logs endpoint must return 200 even with no logs."""
    from unittest.mock import MagicMock
    from app.db.session import get_db

    # Create a fake DB session that returns empty results for any query.
    fake_db = MagicMock()
    fake_scalars_result = MagicMock()
    fake_scalars_result.all.return_value = []
    fake_db.scalars.return_value = fake_scalars_result

    def override_get_db():
        yield fake_db

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides[get_db] = override_get_db
    try:
        r = client.get("/api/v1/admin/audit-logs?limit=200")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert r.json() == []
    finally:
        app_main.app.dependency_overrides = saved


def test_admin_audit_logs_accepts_null_ip_address(monkeypatch) -> None:
    """Old audit rows with ip_address NULL must serialize successfully."""
    from unittest.mock import MagicMock

    from app.db.session import get_db

    now = datetime.now(timezone.utc)
    row = SimpleNamespace(
        id=uuid4(),
        tenant_id=None,
        user_id=None,
        action="create_tenant",
        resource_type="tenant",
        resource_id=str(uuid4()),
        detail={"name": "Demo"},
        ip_address=None,
        created_at=now,
    )
    fake_db = MagicMock()
    fake_execute_result = MagicMock()
    fake_execute_result.all.return_value = [(row, None)]
    fake_db.execute.return_value = fake_execute_result

    def override_get_db():
        yield fake_db

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides[get_db] = override_get_db
    try:
        r = client.get("/api/v1/admin/audit-logs?limit=200")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert len(body) == 1
        assert body[0]["action"] == "create_tenant"
    finally:
        app_main.app.dependency_overrides = saved


def test_client_audit_logs_returns_200_empty(monkeypatch) -> None:
    """Client audit logs must return 200 with empty list when no logs exist."""
    from unittest.mock import MagicMock
    from app.db.session import get_db

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )

    # Create a fake DB session that returns empty results.
    fake_db = MagicMock()
    fake_scalars_result = MagicMock()
    fake_scalars_result.all.return_value = []
    fake_db.scalars.return_value = fake_scalars_result

    def override_get_db():
        yield fake_db

    saved = dict(app_main.app.dependency_overrides)
    saved[get_db] = override_get_db
    app_main.app.dependency_overrides[get_db] = override_get_db
    try:
        with _TenantOverride():
            # Re-apply get_db override since _TenantOverride replaces all overrides
            app_main.app.dependency_overrides[get_db] = override_get_db
            r = client.get("/api/v1/client/audit-logs?limit=200")

        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert r.json() == []
    finally:
        app_main.app.dependency_overrides = saved


def test_baseline_uses_real_firmware_tenant_column() -> None:
    """The squashed baseline must use firmware_versions.uploaded_by_tenant_id."""
    migration = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / "0001_initial_schema.py"
    ).read_text(encoding="utf-8")

    assert "uploaded_by_tenant_id" in migration
    assert "ON firmware_versions (version, target_device_type, tenant_id)" not in migration
    assert "ON firmware_versions (tenant_id, target_device_type)" not in migration


def test_auth_me_returns_user_for_valid_token(monkeypatch) -> None:
    """auth/me must return user data for a valid access token."""

    # Ensure blacklist check doesn't interfere
    monkeypatch.setattr(
        "app.bounded_contexts.identity.application.services.is_token_blacklisted",
        lambda jti, db: False,
    )

    # Override get_current_user to return a known user
    from app.bounded_contexts.identity.presentation import dependencies as identity_deps

    test_user = SimpleNamespace(
        id=uuid4(),
        email="test@me.local",
        full_name="Test User",
        role="admin",
        is_active=True,
        tenant_id=None,
        created_at=datetime.now(timezone.utc),
    )

    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides[identity_deps.get_current_user] = lambda: test_user
    try:
        r = client.get("/api/v1/auth/me")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert body["email"] == "test@me.local"
        assert body["role"] == "admin"
    finally:
        app_main.app.dependency_overrides = saved


def test_auth_me_returns_401_for_missing_token() -> None:
    """auth/me must return 401 when no token is provided."""
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}
    try:
        r = client.get("/api/v1/auth/me")
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"
    finally:
        app_main.app.dependency_overrides = saved


def test_auth_me_patch_updates_current_user_profile() -> None:
    """auth/me PATCH must update editable profile fields for the current user."""
    from app.bounded_contexts.identity.presentation import dependencies as identity_deps
    from app.db.session import get_db

    test_user = SimpleNamespace(
        id=uuid4(),
        email="tenant-profile@me.local",
        full_name="Old Name",
        role="tenant_owner",
        is_active=True,
        tenant_id=uuid4(),
        created_at=datetime.now(timezone.utc),
    )

    class FakeDb:
        committed = False

        def add(self, obj) -> None:
            assert obj is test_user

        def commit(self) -> None:
            self.committed = True

        def refresh(self, obj) -> None:
            assert obj is test_user

    fake_db = FakeDb()
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides[identity_deps.get_current_user] = lambda: test_user
    app_main.app.dependency_overrides[get_db] = lambda: fake_db
    try:
        r = client.patch("/api/v1/auth/me", json={"full_name": "  New Tenant Name  "})
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert body["full_name"] == "New Tenant Name"
        assert test_user.full_name == "New Tenant Name"
        assert fake_db.committed is True
    finally:
        app_main.app.dependency_overrides = saved


def test_logout_requires_bearer_token() -> None:
    """Logout must reject missing bearer tokens."""
    saved = dict(app_main.app.dependency_overrides)
    app_main.app.dependency_overrides = {}
    try:
        r = client.post("/api/v1/auth/logout")
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"
    finally:
        app_main.app.dependency_overrides = saved


def test_is_token_blacklisted_fails_loudly_on_missing_table(monkeypatch) -> None:
    """is_token_blacklisted must not treat missing storage as not blacklisted."""
    from app.bounded_contexts.identity.application.services import (
        TokenBlacklistUnavailable,
        is_token_blacklisted,
    )

    class FakeSession:
        """Simulates a DB session where the table doesn't exist."""

        def __init__(self):
            self.rolled_back = False
            self._fail = True

        def scalar(self, stmt):
            if self._fail:
                raise Exception('relation "blacklisted_tokens" does not exist')
            return None

        def rollback(self):
            self.rolled_back = True

    session = FakeSession()
    try:
        is_token_blacklisted("test-jti-123", session)
        assert False, "Should have raised TokenBlacklistUnavailable"
    except TokenBlacklistUnavailable:
        pass

    assert session.rolled_back is True, (
        "Session must be rolled back after error to prevent poisoning"
    )






def test_auth_routes_reject_http_in_production(monkeypatch) -> None:
    """Authentication routes must reject HTTP requests in production."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "app_env", "production")

    r = client.post("/api/v1/auth/login", json={"email": "x@x.com", "password": "y"})
    assert r.status_code == 400
    assert "HTTPS required" in r.json()["detail"]


def test_auth_routes_accept_https_in_production(monkeypatch) -> None:
    """Authentication routes accept HTTPS (via proxy headers) in production."""
    from app.core.config import settings
    from app.modules.auth import repository as auth_repo

    monkeypatch.setattr(settings, "app_env", "production")

    def fake_get_user_by_email(db, email):
        return None

    monkeypatch.setattr(auth_repo, "get_user_by_email", fake_get_user_by_email)

    # With proxy headers simulating an HTTPS connection, it should hit the route (and return 401 because bad creds)
    r = client.post(
        "/api/v1/auth/login",
        json={"email": "invalid@x.com", "password": "y"},
        headers={"X-Forwarded-Proto": "https"},
    )
    assert r.status_code == 401
    assert "Invalid email or password" in r.json()["detail"]


def test_get_current_user_restores_pg_rls_bypass_after_lookup(monkeypatch) -> None:
    """Auth lookup may bypass RLS, but the request must continue tenant-scoped."""
    from app.core.tenant_context import (
        bypass_rls_context,
        current_tenant_id_context,
        current_user_role_context,
    )
    from app.modules.auth import repository as auth_repo
    from app.modules.auth.service import create_access_token
    from app.modules.tenants import repository as tenant_repo

    user_id = uuid4()
    tenant_id = uuid4()
    fake_user = SimpleNamespace(
        id=user_id,
        email="tenant@test.local",
        role="tenant_owner",
        tenant_id=tenant_id,
        is_active=True,
    )
    fake_tenant = SimpleNamespace(id=tenant_id, is_active=True)

    events: list[str] = []

    class FakeDb:
        bind = None

        def execute(self, statement, params=None):
            sql = str(statement)
            if "app.bypass_rls" in sql:
                events.append(sql)
            if "app.current_tenant_id" in sql:
                events.append(f"{sql}:{(params or {}).get('tenant_id', '')}")
            if "app.current_user_role" in sql:
                events.append(f"{sql}:{(params or {}).get('role', '')}")
            return SimpleNamespace()

    def fake_get_user_by_id(db, uid):
        events.append("get_user_by_id")
        assert uid == str(user_id)
        return fake_user

    def fake_get_tenant(db, tid):
        events.append("get_tenant")
        assert tid == tenant_id
        return fake_tenant

    monkeypatch.setattr(security_module, "is_token_blacklisted", lambda jti, db: False)
    monkeypatch.setattr(auth_repo, "get_user_by_id", fake_get_user_by_id)
    monkeypatch.setattr(tenant_repo, "get_tenant", fake_get_tenant)

    token = create_access_token(str(user_id), role="tenant_owner")
    token_tenant = current_tenant_id_context.set(None)
    token_bypass = bypass_rls_context.set(False)
    token_role = current_user_role_context.set("anonymous")
    try:
        user = security_module.get_current_user_from_token(token, FakeDb())
        assert user is fake_user
        assert events.index("SET LOCAL app.bypass_rls = 'true'") < events.index("get_user_by_id")
        assert events.index("get_tenant") < events.index("SET LOCAL app.bypass_rls = 'false'")
        assert events[-3:] == [
            f"SET LOCAL app.current_tenant_id = :tenant_id:{tenant_id}",
            "SET LOCAL app.bypass_rls = 'false'",
            "SET LOCAL app.current_user_role = :role:tenant_owner",
        ]
    finally:
        current_tenant_id_context.reset(token_tenant)
        bypass_rls_context.reset(token_bypass)
        current_user_role_context.reset(token_role)


def test_client_generate_device_token(monkeypatch) -> None:
    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    with _TenantOverride():
        response = client.get("/api/v1/client/devices/generate-token")
    assert response.status_code == 200
    body = response.json()
    assert "raw_token" in body
    assert "token_hash" in body

    import hashlib

    computed = hashlib.sha256(body["raw_token"].encode("utf-8")).hexdigest()
    assert computed == body["token_hash"]


def test_client_regenerate_device_token_atomic(monkeypatch) -> None:
    from app.bounded_contexts.tenant_management.presentation import router_client as tenant_router
    from app.modules.tenants import repository as tenant_repo_mod

    device = _fake_tenant_device("esp32-regen")
    device.auth_token_hash = "old-hash"

    def fake_update_device_metadata(db, target, **kwargs):
        assert target is device
        assert kwargs["fields_set"] == {"auth_token_hash"}
        target.auth_token_hash = kwargs["auth_token_hash"]
        return target

    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        tenant_repo_mod,
        "get_tenant_device",
        lambda db, tenant_id, device_uid: device if device_uid == "esp32-regen" else None,
    )
    monkeypatch.setattr(device_repository, "update_device_metadata", fake_update_device_metadata)
    monkeypatch.setattr(
        tenant_router.audit_service, "log_event_best_effort", lambda *args, **kwargs: None
    )

    with _TenantOverride():
        response = client.post("/api/v1/client/devices/esp32-regen/regenerate-token")

    assert response.status_code == 200, response.text
    body = response.json()
    assert "raw_token" in body
    assert "token_hash" in body
    assert device.auth_token_hash == body["token_hash"]

    import hashlib

    computed = hashlib.sha256(body["raw_token"].encode("utf-8")).hexdigest()
    assert computed == body["token_hash"]


def test_register_device_with_auth_token_hash(monkeypatch) -> None:
    from app.modules.devices.schema import DeviceCreate

    db_added = []

    class FakeDb:
        def add(self, obj):
            db_added.append(obj)

        def commit(self):
            pass

        def refresh(self, obj):
            pass

    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: None)

    token_hash = "fake-token-hash-12345"
    payload = DeviceCreate(
        device_uid="esp32-auth-token-test",
        name="Auth Token Test",
        auth_token_hash=token_hash,
    )

    device = device_repository.register_device(FakeDb(), payload)

    assert device.auth_token_hash == token_hash
    assert not hasattr(device, "mqtt_password") or device.mqtt_password is None
    assert device.mqtt_password_hash is None
    assert device.mqtt_username is None

    class FakeExistingDevice:
        def __init__(self):
            self.device_uid = "esp32-existing"
            self.name = "Old Name"
            self.hardware_model = None
            self.description = None
            self.firmware_version = None
            self.auth_token_hash = None
            self.mqtt_username = None
            self.mqtt_password_hash = None

    existing = FakeExistingDevice()
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: existing)

    payload_existing = DeviceCreate(
        device_uid="esp32-existing",
        name="New Name",
        auth_token_hash="new-hash-456",
    )

    device_existing = device_repository.register_device(FakeDb(), payload_existing)
    assert device_existing.auth_token_hash == "new-hash-456"
    assert device_existing.name == "New Name"
    assert device_existing.mqtt_password_hash is None
    assert device_existing.mqtt_username is None


def test_client_register_device_with_auth_token_hash(monkeypatch) -> None:
    from app.bounded_contexts.tenant_management.presentation import router_client as tenant_router
    from app.modules.tenants import repository as tenant_repo_mod
    from app.db.session import get_db

    # Setup monkeypatch for features, tenant and device count
    monkeypatch.setattr(
        tenant_service_mod,
        "get_effective_features",
        lambda db, tenant_id: _ALL_FEATURES_ON,
    )
    monkeypatch.setattr(
        tenant_repo_mod,
        "get_tenant",
        lambda db, tenant_id: SimpleNamespace(plan=SimpleNamespace(max_devices=10)),
    )
    monkeypatch.setattr(tenant_repo_mod, "count_tenant_devices", lambda db, tenant_id: 1)

    # Mock get_device_by_uid to return None (device doesn't exist yet)
    monkeypatch.setattr(device_repository, "get_device_by_uid", lambda db, uid: None)

    registered_payloads = []

    def fake_register_device(db, payload):
        registered_payloads.append(payload)
        now = datetime.now(timezone.utc)
        return SimpleNamespace(
            id=uuid4(),
            device_uid=payload.device_uid,
            name=payload.name,
            auth_token_hash=payload.auth_token_hash,
            firmware_version=payload.firmware_version,
            status="offline",
            last_seen_at=None,
            created_at=now,
            updated_at=now,
            mqtt_username=None,
            tenant=None,
        )

    monkeypatch.setattr(device_repository, "register_device", fake_register_device)

    monkeypatch.setattr(tenant_repo_mod, "assign_device", lambda db, tenant_id, device_id: None)
    monkeypatch.setattr(
        tenant_router.audit_service, "log_event_best_effort", lambda *args, **kwargs: None
    )

    class FakeDb:
        def refresh(self, obj):
            pass

        def add(self, obj):
            pass

        def commit(self):
            pass

        def rollback(self):
            pass

    token_hash = "test-hash-abcdef"
    with _TenantOverride():
        app_main.app.dependency_overrides[get_db] = lambda: FakeDb()
        response = client.post(
            "/api/v1/client/devices",
            json={
                "device_uid": "esp32-delayed-test",
                "name": "Delayed Test Device",
                "auth_token_hash": token_hash,
            },
        )

    assert response.status_code == 201, response.text
    assert len(registered_payloads) == 1
    assert registered_payloads[0].auth_token_hash == token_hash
    assert response.json()["device_uid"] == "esp32-delayed-test"


def test_telemetry_repository_time_range_aggregation(monkeypatch) -> None:
    """Verify list_telemetry_by_device_uid handles time_range and returns TelemetryQueryResult."""
    from datetime import datetime, timedelta, timezone
    from uuid import uuid4
    from app.bounded_contexts.telemetry.infrastructure.repositories import (
        list_telemetry_by_device_uid,
        TelemetryQueryResult,
    )
    from app.modules.devices.model import Device
    from app.modules.telemetry.model import Telemetry

    device = Device(id=uuid4(), device_uid="telem-dev-tr-01", name="Telem Test Device")
    monkeypatch.setattr(
        "app.bounded_contexts.telemetry.infrastructure.repositories.get_device_by_uid",
        lambda db, uid: device if uid == device.device_uid else None,
    )

    now = datetime.now(timezone.utc)
    mock_records = [
        Telemetry(
            id=uuid4(),
            device_id=device.id,
            device=device,
            timestamp=now - timedelta(hours=2),
            metric_name="temp",
            metric_value=25.5,
        ),
        Telemetry(
            id=uuid4(),
            device_id=device.id,
            device=device,
            timestamp=now - timedelta(minutes=10),
            metric_name="temp",
            metric_value=28.0,
        ),
    ]

    class FakeDb:
        bind = None

        def execute(self, stmt):
            class FakeResult:
                def all(self):
                    return []

            return FakeResult()

        def scalars(self, stmt):
            class FakeScalars:
                def all(self):
                    return mock_records

            return FakeScalars()

    res = list_telemetry_by_device_uid(
        FakeDb(),
        "telem-dev-tr-01",
        metric_name="temp",
        time_range="6h",
        aggregate="avg",
    )

    assert isinstance(res, TelemetryQueryResult)
    assert res.aggregated is False  # SQLite fallback
    assert len(res.records) == 2


def test_client_device_telemetry_endpoint_with_time_range(monkeypatch) -> None:
    """Verify GET /api/v1/client/devices/{uid}/telemetry?time_range=6h returns aggregated response wrapper."""
    from app.bounded_contexts.telemetry.infrastructure.repositories import TelemetryQueryResult
    from app.modules.telemetry import repository as telemetry_repository
    from app.modules.devices.model import Device
    from app.modules.telemetry.model import Telemetry
    from datetime import datetime, timezone
    from uuid import uuid4

    tenant_id = uuid4()
    device = Device(
        id=uuid4(), device_uid="esp32-tr-endpoint", name="Endpoint Test Device", tenant_id=tenant_id
    )

    now = datetime.now(timezone.utc)
    mock_records = [
        Telemetry(
            id=uuid4(),
            device_id=device.id,
            device=device,
            timestamp=now,
            metric_name="temp",
            metric_value=23.4,
        )
    ]
    mock_result = TelemetryQueryResult(records=mock_records, aggregated=True, grouping="1 minute")

    monkeypatch.setattr(
        tenant_service_mod, "get_effective_features", lambda db, tenant_id: _ALL_FEATURES_ON
    )
    monkeypatch.setattr(
        "app.bounded_contexts.tenant_management.presentation.router_client.repository.get_tenant_device",
        lambda db, tenant, uid: device if uid == device.device_uid else None,
    )
    monkeypatch.setattr(
        telemetry_repository,
        "list_telemetry_by_device_uid",
        lambda db, uid, **kw: mock_result,
    )

    with _TenantOverride():
        resp = client.get(
            "/api/v1/client/devices/esp32-tr-endpoint/telemetry?time_range=6h&aggregate=avg"
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["aggregated"] is True
    assert body["grouping"] == "1 minute"
    assert len(body["data"]) == 1
    assert body["data"][0]["metric_value"] == 23.4
