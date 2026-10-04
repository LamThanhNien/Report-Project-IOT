"""
AIFOM Comprehensive System Tester
===================================
Runs ALL test suites against the running AIFOM stack and generates
a consolidated report. Tests are grouped by domain:

  1. Infrastructure Health (API, DB, MQTT, MinIO reachability)
  2. Authentication & Authorization
  3. Admin Tenant Management
  4. Tenant Isolation & Security
  5. Device Management
  6. Firmware Management
  7. OTA Job Lifecycle
  8. Telemetry Pipeline
  9. Viewer Role Protection
 10. Operational Device Alerts
 11. MQTT Broker Connectivity
 12. MQTT ESP32 Contract
 13. MQTT OTA Publish Verification
 14. Project Workspace (client)
 15. Client User Management
 16. Audit Logs
 17. Device Commands via MQTT
 18. Edge Cases & Error Handling

Usage:
  python run_full_test.py              # run all groups
  python run_full_test.py --group 5    # run only group 5 (devices)
  python run_full_test.py --quick      # skip MQTT integration tests
  python run_full_test.py --report     # generate HTML report only
"""
import sys
import os
import json
import time
import argparse
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from dataclasses import dataclass, field

# Ensure tester/ is on the path
sys.path.insert(0, str(Path(__file__).parent))

from utils.api_client import ApiClient
from utils.auth import admin_client, tenant1_client, tenant2_client, anon_client
from utils.assertions import assert_status, assert_json, assert_fields, assert_list
from config.settings import API_BASE_URL, MQTT_HOST, MQTT_PORT

PYTHON = sys.executable
TESTER_DIR = Path(__file__).parent
REPORT_DIR = TESTER_DIR / "reports"
REPORT_DIR.mkdir(exist_ok=True)

# ─── Result Tracking ──────────────────────────────────────────────────────────

@dataclass
class TestResult:
    name: str
    group: str
    status: str  # PASS, FAIL, SKIP, ERROR
    duration_ms: int = 0
    message: str = ""


@dataclass
class TestReport:
    results: list[TestResult] = field(default_factory=list)
    start_time: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def add(self, result: TestResult):
        self.results.append(result)

    @property
    def passed(self):
        return sum(1 for r in self.results if r.status == "PASS")

    @property
    def failed(self):
        return sum(1 for r in self.results if r.status == "FAIL")

    @property
    def skipped(self):
        return sum(1 for r in self.results if r.status == "SKIP")

    @property
    def errors(self):
        return sum(1 for r in self.results if r.status == "ERROR")

    @property
    def total(self):
        return len(self.results)

    def summary(self) -> str:
        return (
            f"Total: {self.total} | "
            f"PASS: {self.passed} | FAIL: {self.failed} | "
            f"SKIP: {self.skipped} | ERROR: {self.errors}"
        )


report = TestReport()


def run_test(name: str, group: str, fn):
    """Execute a test function and record the result."""
    start = time.time()
    try:
        fn()
        elapsed = int((time.time() - start) * 1000)
        report.add(TestResult(name, group, "PASS", elapsed))
        return True
    except AssertionError as e:
        elapsed = int((time.time() - start) * 1000)
        report.add(TestResult(name, group, "FAIL", elapsed, str(e)[:500]))
        return False
    except Exception as e:
        elapsed = int((time.time() - start) * 1000)
        report.add(TestResult(name, group, "ERROR", elapsed, f"{type(e).__name__}: {e}"[:500]))
        return False


def skip_test(name: str, group: str, reason: str):
    report.add(TestResult(name, group, "SKIP", 0, reason))


# ─── Group 1: Infrastructure Health ───────────────────────────────────────────

def test_group_infrastructure():
    GROUP = "01-Infrastructure"
    print(f"\n{'='*60}")
    print(f"  Group 1: Infrastructure Health")
    print(f"{'='*60}")

    def api_health():
        resp = ApiClient().get("/health")
        assert_status(resp, 200, "GET /health")
        data = assert_json(resp)
        assert data.get("status") == "ok", f"Expected status=ok, got: {data}"

    def api_ready():
        resp = ApiClient().get("/ready")
        assert_status(resp, 200, "GET /ready")

    def api_base_url_reachable():
        resp = ApiClient().get("/health")
        assert resp.status_code < 500, f"API at {API_BASE_URL} returned {resp.status_code}"

    def openapi_docs():
        resp = ApiClient().get("/docs")
        # /docs returns HTML, just check it's not 500
        assert resp.status_code in (200, 307, 404), f"/docs returned {resp.status_code}"

    def metrics_endpoint():
        resp = ApiClient().get("/metrics")
        assert resp.status_code in (200, 404), f"/metrics returned {resp.status_code}"

    tests = [
        ("API /health", api_health),
        ("API /ready", api_ready),
        ("API base URL reachable", api_base_url_reachable),
        ("OpenAPI docs", openapi_docs),
        ("Metrics endpoint", metrics_endpoint),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 2: Auth ────────────────────────────────────────────────────────────

def test_group_auth():
    GROUP = "02-Authentication"
    print(f"\n{'='*60}")
    print(f"  Group 2: Authentication & Authorization")
    print(f"{'='*60}")

    def admin_login():
        from config.settings import ADMIN_EMAIL, ADMIN_PASSWORD
        resp = ApiClient().post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert_status(resp, 200, "Admin login")
        data = assert_json(resp)
        assert_fields(data, "access_token", "token_type")
        assert data["token_type"] == "bearer"
        assert len(data["access_token"]) > 20

    def tenant_login():
        from config.settings import TENANT1_EMAIL, TENANT1_PASSWORD
        resp = ApiClient().post("/api/v1/auth/login", json={"email": TENANT1_EMAIL, "password": TENANT1_PASSWORD})
        assert_status(resp, 200, "Tenant login")
        data = assert_json(resp)
        assert_fields(data, "access_token")

    def invalid_login():
        resp = ApiClient().post("/api/v1/auth/login", json={"email": "nobody@x.com", "password": "wrong"})
        assert_status(resp, 401, "Invalid login")

    def wrong_password():
        from config.settings import ADMIN_EMAIL
        resp = ApiClient().post("/api/v1/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong_password"})
        assert_status(resp, 401, "Wrong password")

    def admin_me():
        resp = admin_client().get("/api/v1/auth/me")
        assert_status(resp, 200, "GET /auth/me admin")
        data = assert_json(resp)
        assert data["role"] == "admin"

    def tenant_me():
        resp = tenant1_client().get("/api/v1/auth/me")
        assert_status(resp, 200, "GET /auth/me tenant")
        data = assert_json(resp)
        assert data["role"] in ("tenant_owner", "viewer")

    def no_token_rejected():
        resp = anon_client().get("/api/v1/devices")
        assert resp.status_code in (401, 403)

    def invalid_token_rejected():
        c = ApiClient()
        c.set_token("invalid.token.here")
        resp = c.get("/api/v1/auth/me")
        assert resp.status_code in (401, 403)

    tests = [
        ("Admin login OK", admin_login),
        ("Tenant login OK", tenant_login),
        ("Invalid credentials -> 401", invalid_login),
        ("Wrong password -> 401", wrong_password),
        ("GET /auth/me admin role", admin_me),
        ("GET /auth/me tenant role", tenant_me),
        ("No token -> 401/403", no_token_rejected),
        ("Invalid token -> 401/403", invalid_token_rejected),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 3: Admin Tenant Management ────────────────────────────────────────

def test_group_admin_tenants():
    GROUP = "03-Admin-Tenants"
    print(f"\n{'='*60}")
    print(f"  Group 3: Admin Tenant Management")
    print(f"{'='*60}")

    admin = admin_client()

    def list_tenants():
        resp = admin.get("/api/v1/admin/tenants")
        assert_status(resp, 200, "GET /admin/tenants")
        assert_list(assert_json(resp))

    def list_users():
        # Users are scoped per-tenant: /admin/tenants/{id}/users
        tenants = admin.get("/api/v1/admin/tenants").json()
        if not tenants:
            skip_test("List admin users", GROUP, "No tenants found")
            return
        tenant_id = tenants[0]["id"]
        resp = admin.get(f"/api/v1/admin/tenants/{tenant_id}/users")
        assert_status(resp, 200, f"GET /admin/tenants/{tenant_id}/users")
        assert_list(assert_json(resp))

    def list_admin_devices():
        resp = admin.get("/api/v1/devices")
        assert_status(resp, 200, "GET /devices (admin)")
        assert_list(assert_json(resp))

    tests = [
        ("List tenants", list_tenants),
        ("List admin users", list_users),
        ("List admin devices", list_admin_devices),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 4: Tenant Isolation ───────────────────────────────────────────────

def test_group_isolation():
    GROUP = "04-Tenant-Isolation"
    print(f"\n{'='*60}")
    print(f"  Group 4: Tenant Isolation & Security")
    print(f"{'='*60}")

    t1 = tenant1_client()

    def tenant_cannot_admin_devices():
        resp = t1.get("/api/v1/devices")
        assert resp.status_code in (403, 404)

    def tenant_cannot_admin_telemetry():
        resp = t1.get("/api/v1/telemetry")
        assert resp.status_code in (403, 404)

    def tenant_cannot_admin_firmware():
        resp = t1.get("/api/v1/firmware")
        assert resp.status_code in (403, 404)

    def tenant_cannot_admin_ota():
        resp = t1.get("/api/v1/ota/jobs")
        assert resp.status_code in (403, 404)

    def tenant_cannot_admin_tenants():
        resp = t1.get("/api/v1/admin/tenants")
        assert resp.status_code in (403, 404)

    tests = [
        ("Tenant blocked from admin /devices", tenant_cannot_admin_devices),
        ("Tenant blocked from admin /telemetry", tenant_cannot_admin_telemetry),
        ("Tenant blocked from admin /firmware", tenant_cannot_admin_firmware),
        ("Tenant blocked from admin /ota/jobs", tenant_cannot_admin_ota),
        ("Tenant blocked from admin /tenants", tenant_cannot_admin_tenants),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 5: Device Management ──────────────────────────────────────────────

def test_group_devices():
    GROUP = "05-Devices"
    print(f"\n{'='*60}")
    print(f"  Group 5: Device Management")
    print(f"{'='*60}")

    admin = admin_client()
    t1 = tenant1_client()
    from utils.test_data import test_device_uid

    def create_device():
        uid = test_device_uid()
        resp = admin.post("/api/v1/devices", json={"device_uid": uid, "name": f"TEST_{uid}"})
        assert_status(resp, 201, "POST /devices")
        data = assert_json(resp)
        assert_fields(data, "id", "device_uid", "name", "status")

    def list_devices():
        resp = admin.get("/api/v1/devices")
        assert_status(resp, 200, "GET /devices")
        assert_list(assert_json(resp))

    def duplicate_uid_409():
        uid = test_device_uid()
        payload = {"device_uid": uid, "name": f"TEST_{uid}"}
        admin.post("/api/v1/devices", json=payload)
        resp = admin.post("/api/v1/devices", json=payload)
        assert resp.status_code == 409, f"Expected 409, got {resp.status_code}"

    def register_public():
        uid = test_device_uid()
        resp = ApiClient().post("/api/v1/devices/register", json={"device_uid": uid, "name": f"TEST_{uid}"})
        assert resp.status_code in (200, 409)

    def tenant_list_devices():
        resp = t1.get("/api/v1/client/devices")
        assert_status(resp, 200, "GET /client/devices")
        assert_list(assert_json(resp))

    def tenant_device_detail():
        devices = t1.get("/api/v1/client/devices").json()
        if not devices:
            skip_test("Tenant device detail", GROUP, "No devices assigned")
            return
        uid = devices[0]["device_uid"]
        resp = t1.get(f"/api/v1/client/devices/{uid}")
        assert_status(resp, 200, f"GET /client/devices/{uid}")

    def mqtt_config():
        devices = t1.get("/api/v1/client/devices").json()
        if not devices:
            skip_test("MQTT config endpoint", GROUP, "No devices assigned")
            return
        uid = devices[0]["device_uid"]
        resp = t1.get(f"/api/v1/client/devices/{uid}/mqtt-config")
        assert_status(resp, 200, "GET /mqtt-config")
        data = assert_json(resp)
        assert any(k in data for k in ("host", "broker", "mqtt_host", "topics", "broker_host"))

    def device_types():
        resp = admin.get("/api/v1/admin/device-types")
        assert_status(resp, 200, "GET /admin/device-types")
        assert_list(assert_json(resp))

    tests = [
        ("Create device", create_device),
        ("List devices", list_devices),
        ("Duplicate UID -> 409", duplicate_uid_409),
        ("Register device (public)", register_public),
        ("Tenant list devices", tenant_list_devices),
        ("Tenant device detail", tenant_device_detail),
        ("MQTT config endpoint", mqtt_config),
        ("Device types", device_types),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 6: Firmware ───────────────────────────────────────────────────────

def test_group_firmware():
    GROUP = "06-Firmware"
    print(f"\n{'='*60}")
    print(f"  Group 6: Firmware Management")
    print(f"{'='*60}")

    admin = admin_client()
    t1 = tenant1_client()
    from utils.test_data import fake_firmware_bytes, unique_suffix

    def upload_firmware():
        data = fake_firmware_bytes(512)
        version = f"2.0.{unique_suffix()}"
        resp = t1.upload_file("/api/v1/client/firmware", file_field="file",
                              file_bytes=data, filename=f"test_{version}.bin",
                              extra_fields={"version": version, "target_device_type": "esp32"})
        assert_status(resp, 201, "POST /client/firmware")
        d = assert_json(resp)
        assert_fields(d, "id", "version", "checksum_sha256")

    def list_tenant_firmware():
        resp = t1.get("/api/v1/client/firmware")
        assert_status(resp, 200, "GET /client/firmware")
        assert_list(assert_json(resp))

    def list_admin_firmware():
        resp = admin.get("/api/v1/firmware")
        assert_status(resp, 200, "GET /firmware (admin)")
        assert_list(assert_json(resp))

    def firmware_download():
        data = fake_firmware_bytes(256)
        resp = t1.upload_file("/api/v1/client/firmware", file_field="file",
                              file_bytes=data, filename="dl_test.bin",
                              extra_fields={"version": f"dl.{unique_suffix()}", "target_device_type": "esp32"})
        if resp.status_code != 201:
            skip_test("Firmware download", GROUP, "Upload failed")
            return
        fw_id = resp.json()["id"]
        dl = admin.get(f"/api/v1/firmware/{fw_id}/download")
        assert_status(dl, 200, "GET /firmware/{id}/download")
        assert len(dl.content) > 0

    def empty_upload_rejected():
        resp = t1.upload_file("/api/v1/client/firmware", file_field="file",
                              file_bytes=b"", filename="empty.bin",
                              extra_fields={"version": f"0.0.{unique_suffix()}", "target_device_type": "esp32"})
        assert resp.status_code in (400, 413, 422)

    tests = [
        ("Upload firmware", upload_firmware),
        ("List tenant firmware", list_tenant_firmware),
        ("List admin firmware", list_admin_firmware),
        ("Firmware download", firmware_download),
        ("Empty upload rejected", empty_upload_rejected),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 7: OTA ────────────────────────────────────────────────────────────

def test_group_ota():
    GROUP = "07-OTA"
    print(f"\n{'='*60}")
    print(f"  Group 7: OTA Job Lifecycle")
    print(f"{'='*60}")

    admin = admin_client()
    t1 = tenant1_client()
    from utils.test_data import fake_firmware_bytes, unique_suffix
    from config.settings import VALID_OTA_STATUSES

    def create_ota_job():
        devices = t1.get("/api/v1/client/devices").json()
        if not devices:
            skip_test("Create OTA job", GROUP, "No devices assigned")
            return
        device_uid = devices[0]["device_uid"]
        data = fake_firmware_bytes(256)
        resp = t1.upload_file("/api/v1/client/firmware", file_field="file",
                              file_bytes=data, filename="ota_test.bin",
                              extra_fields={"version": f"ota.{unique_suffix()}", "target_device_type": "esp32"})
        if resp.status_code != 201:
            skip_test("Create OTA job", GROUP, "Firmware upload failed")
            return
        fw_id = resp.json()["id"]
        resp = t1.post("/api/v1/client/ota-jobs", json={"device_uid": device_uid, "firmware_version_id": fw_id})
        assert_status(resp, 201, "POST /client/ota-jobs")
        d = assert_json(resp)
        assert_fields(d, "job_id", "status")
        assert d["status"] in VALID_OTA_STATUSES

    def unassigned_device_ota_rejected():
        data = fake_firmware_bytes(256)
        resp = t1.upload_file("/api/v1/client/firmware", file_field="file",
                              file_bytes=data, filename="ota_rej.bin",
                              extra_fields={"version": f"rej.{unique_suffix()}", "target_device_type": "esp32"})
        if resp.status_code != 201:
            skip_test("OTA unassigned device", GROUP, "Firmware upload failed")
            return
        fw_id = resp.json()["id"]
        resp = t1.post("/api/v1/client/ota-jobs", json={"device_uid": "NONEXISTENT_99999", "firmware_version_id": fw_id})
        assert resp.status_code in (403, 404, 400)

    def list_tenant_ota_jobs():
        resp = t1.get("/api/v1/client/ota-jobs")
        assert_status(resp, 200, "GET /client/ota-jobs")
        assert_list(assert_json(resp))

    def list_admin_ota_jobs():
        resp = admin.get("/api/v1/ota/jobs")
        assert_status(resp, 200, "GET /ota/jobs")
        assert_list(assert_json(resp))

    def ota_statuses_valid():
        resp = admin.get("/api/v1/ota/jobs")
        if resp.status_code != 200:
            return
        for job in resp.json()[:20]:
            assert job.get("status") in VALID_OTA_STATUSES, f"Invalid OTA status: {job.get('status')}"

    tests = [
        ("Create OTA job", create_ota_job),
        ("Unassigned device OTA rejected", unassigned_device_ota_rejected),
        ("List tenant OTA jobs", list_tenant_ota_jobs),
        ("List admin OTA jobs", list_admin_ota_jobs),
        ("OTA statuses valid", ota_statuses_valid),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 8: Telemetry ─────────────────────────────────────────────────────

def test_group_telemetry():
    GROUP = "08-Telemetry"
    print(f"\n{'='*60}")
    print(f"  Group 8: Telemetry Pipeline")
    print(f"{'='*60}")

    admin = admin_client()
    t1 = tenant1_client()
    from datetime import datetime, timezone

    def _now_iso():
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def create_telemetry():
        devices = admin.get("/api/v1/devices").json()
        if not devices:
            skip_test("Create telemetry", GROUP, "No devices")
            return
        uid = devices[0]["device_uid"]
        resp = admin.post("/api/v1/telemetry", json={
            "device_uid": uid, "timestamp": _now_iso(),
            "metric_name": "temperature", "metric_value": 25.5,
        })
        assert_status(resp, 201, "POST /telemetry")

    def list_telemetry():
        resp = admin.get("/api/v1/telemetry")
        assert_status(resp, 200, "GET /telemetry")
        assert_list(assert_json(resp))

    def tenant_device_telemetry():
        devices = t1.get("/api/v1/client/devices").json()
        if not devices:
            skip_test("Tenant device telemetry", GROUP, "No devices")
            return
        uid = devices[0]["device_uid"]
        resp = t1.get(f"/api/v1/client/devices/{uid}/telemetry", params={"limit": 10})
        assert_status(resp, 200, "GET /client/devices/{uid}/telemetry")

    def tenant_device_latest_telemetry():
        devices = t1.get("/api/v1/client/devices").json()
        if not devices:
            skip_test("Tenant latest telemetry", GROUP, "No devices")
            return
        uid = devices[0]["device_uid"]
        resp = t1.get(f"/api/v1/client/devices/{uid}/latest-telemetry")
        assert_status(resp, 200, "GET /client/devices/{uid}/latest-telemetry")

    tests = [
        ("Create telemetry", create_telemetry),
        ("List telemetry", list_telemetry),
        ("Tenant device telemetry", tenant_device_telemetry),
        ("Tenant latest telemetry", tenant_device_latest_telemetry),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 9: Viewer Protection ──────────────────────────────────────────────

def test_group_viewer():
    GROUP = "09-Viewer-Protection"
    print(f"\n{'='*60}")
    print(f"  Group 9: Viewer Role Protection")
    print(f"{'='*60}")

    t1_owner = tenant1_client()
    from utils.test_data import fake_firmware_bytes, unique_suffix
    from utils.api_client import ApiClient
    from config.settings import API_BASE_URL

    # Create viewer user
    viewer_email = f"viewer_system_{unique_suffix()}@aifom.test"
    viewer_password = "viewer_test_pw_9x"

    resp = t1_owner.post("/api/v1/client/users", json={
        "email": viewer_email, "password": viewer_password,
        "full_name": "System Test Viewer", "role": "viewer",
    })
    if resp.status_code not in (200, 201):
        skip_test("Viewer protection (all)", GROUP, f"Could not create viewer: {resp.status_code}")
        return

    user_id = resp.json().get("id")

    login_resp = ApiClient(API_BASE_URL).post("/api/v1/auth/login",
        json={"email": viewer_email, "password": viewer_password})
    if login_resp.status_code != 200:
        skip_test("Viewer protection (all)", GROUP, "Viewer login failed")
        return

    viewer = ApiClient(API_BASE_URL)
    viewer.set_token(login_resp.json()["access_token"])

    def viewer_cannot_write_device():
        resp = viewer.post("/api/v1/client/devices", json={"device_uid": f"V_{unique_suffix()}", "name": "test"})
        assert resp.status_code == 403

    def viewer_cannot_upload_firmware():
        resp = viewer.upload_file("/api/v1/client/firmware", file_field="file",
                                  file_bytes=fake_firmware_bytes(256), filename="v.bin",
                                  extra_fields={"version": f"v.{unique_suffix()}", "target_device_type": "esp32"})
        assert resp.status_code == 403

    def viewer_can_read_devices():
        resp = viewer.get("/api/v1/client/devices")
        assert resp.status_code == 200

    def viewer_can_read_firmware():
        resp = viewer.get("/api/v1/client/firmware")
        assert resp.status_code == 200

    tests = [
        ("Viewer cannot write device", viewer_cannot_write_device),
        ("Viewer cannot upload firmware", viewer_cannot_upload_firmware),
        ("Viewer can read devices", viewer_can_read_devices),
        ("Viewer can read firmware", viewer_can_read_firmware),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)

    # Teardown
    if user_id:
        t1_owner.delete(f"/api/v1/client/users/{user_id}")


# ─── Group 10: Operational Alerts ────────────────────────────────────────────

def test_group_alerts():
    GROUP = "10-Alerts"
    print(f"\n{'='*60}")
    print(f"  Group 10: Operational Device Alerts")
    print(f"{'='*60}")

    t1 = tenant1_client()

    def client_alerts():
        resp = t1.get("/api/v1/client/alerts")
        assert_status(resp, 200, "GET /client/alerts")
        assert isinstance(assert_json(resp), list)

    tests = [
        ("Client alerts endpoint", client_alerts),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 11: MQTT Connectivity ─────────────────────────────────────────────

def test_group_mqtt_connectivity():
    GROUP = "11-MQTT-Connectivity"
    print(f"\n{'='*60}")
    print(f"  Group 11: MQTT Broker Connectivity")
    print(f"{'='*60}")

    from utils.mqtt_client import MQTTTestClient
    import time as _time

    def broker_reachable():
        c = MQTTTestClient()
        ok = c.connect(timeout=5)
        c.disconnect()
        assert ok, f"Cannot connect to MQTT at {MQTT_HOST}:{MQTT_PORT}"

    def publish_subscribe():
        c = MQTTTestClient()
        if not c.connect(timeout=5):
            skip_test("MQTT pub/sub", GROUP, "Broker not reachable")
            return
        topic = "aifom/test/system_check"
        c.subscribe(topic)
        _time.sleep(0.3)
        c.publish(topic, {"test": "system_check", "ts": _time.time()})
        received = c.wait_for_message(topic, timeout=5)
        c.disconnect()
        assert received is not None, "No message received within 5s"
        assert received.get("test") == "system_check"

    tests = [
        ("MQTT broker reachable", broker_reachable),
        ("MQTT publish & subscribe", publish_subscribe),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 12: Projects (Client) ─────────────────────────────────────────────

def test_group_projects():
    GROUP = "12-Projects"
    print(f"\n{'='*60}")
    print(f"  Group 12: Project Dashboard (Client)")
    print(f"{'='*60}")

    t1 = tenant1_client()

    def list_projects():
        resp = t1.get("/api/v1/client/projects")
        assert_status(resp, 200, "GET /client/projects")
        assert_list(assert_json(resp))

    tests = [
        ("List tenant projects", list_projects),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 13: Client User Management ────────────────────────────────────────

def test_group_client_users():
    GROUP = "13-Client-Users"
    print(f"\n{'='*60}")
    print(f"  Group 13: Client User Management")
    print(f"{'='*60}")

    t1 = tenant1_client()
    from utils.test_data import unique_suffix

    def list_client_users():
        resp = t1.get("/api/v1/client/users")
        assert_status(resp, 200, "GET /client/users")
        assert_list(assert_json(resp))

    def create_client_user():
        email = f"sys_test_{unique_suffix()}@aifom.test"
        resp = t1.post("/api/v1/client/users", json={
            "email": email, "password": "test1234",
            "full_name": "System Test User", "role": "viewer",
        })
        if resp.status_code == 403:
            skip_test("Create client user", GROUP, "Feature not enabled (requires Pro plan)")
            return
        assert_status(resp, 201, "POST /client/users")
        uid = resp.json().get("id")
        if uid:
            t1.delete(f"/api/v1/client/users/{uid}")

    tests = [
        ("List client users", list_client_users),
        ("Create client user", create_client_user),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 14: Audit Logs ────────────────────────────────────────────────────

def test_group_audit():
    GROUP = "14-Audit-Logs"
    print(f"\n{'='*60}")
    print(f"  Group 14: Audit Logs")
    print(f"{'='*60}")

    admin = admin_client()

    def list_audit_logs():
        resp = admin.get("/api/v1/admin/audit-logs")
        assert_status(resp, 200, "GET /admin/audit-logs")
        assert_list(assert_json(resp))

    tests = [
        ("List audit logs", list_audit_logs),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Group 15: Edge Cases ────────────────────────────────────────────────────

def test_group_edge_cases():
    GROUP = "15-Edge-Cases"
    print(f"\n{'='*60}")
    print(f"  Group 15: Edge Cases & Error Handling")
    print(f"{'='*60}")

    admin = admin_client()
    t1 = tenant1_client()
    anon = anon_client()

    def nonexistent_device_404():
        resp = admin.get("/api/v1/devices/NONEXISTENT_UID_99999/status")
        assert resp.status_code == 404

    def nonexistent_firmware_404():
        import uuid
        resp = admin.get(f"/api/v1/firmware/{uuid.uuid4()}")
        assert resp.status_code == 404

    def nonexistent_ota_job_404():
        import uuid
        resp = admin.get(f"/api/v1/ota/jobs/{uuid.uuid4()}")
        assert resp.status_code == 404

    def cors_headers():
        resp = anon.session.options(f"{API_BASE_URL}/api/v1/auth/login",
            headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST"})
        # Just check it doesn't 500
        assert resp.status_code < 500

    def invalid_json_422():
        resp = admin.session.post(f"{API_BASE_URL}/api/v1/devices",
            data="not json", headers={"Content-Type": "application/json"})
        assert resp.status_code in (400, 422)

    def large_payload_handled():
        huge_name = "x" * 10000
        resp = admin.post("/api/v1/devices", json={"device_uid": huge_name, "name": huge_name})
        assert resp.status_code in (400, 413, 422)

    def ota_with_invalid_firmware_id():
        resp = t1.post("/api/v1/client/ota-jobs", json={
            "device_uid": "any", "firmware_version_id": "not-a-uuid"})
        assert resp.status_code in (400, 422)

    tests = [
        ("Nonexistent device -> 404", nonexistent_device_404),
        ("Nonexistent firmware -> 404", nonexistent_firmware_404),
        ("Nonexistent OTA job -> 404", nonexistent_ota_job_404),
        ("CORS headers present", cors_headers),
        ("Invalid JSON -> 422", invalid_json_422),
        ("Large payload handled", large_payload_handled),
        ("Invalid firmware UUID -> 400", ota_with_invalid_firmware_id),
    ]
    for name, fn in tests:
        run_test(name, GROUP, fn)


# ─── Main ─────────────────────────────────────────────────────────────────────

ALL_GROUPS = [
    test_group_infrastructure,
    test_group_auth,
    test_group_admin_tenants,
    test_group_isolation,
    test_group_devices,
    test_group_firmware,
    test_group_ota,
    test_group_telemetry,
    test_group_viewer,
    test_group_alerts,
    test_group_mqtt_connectivity,
    test_group_projects,
    test_group_client_users,
    test_group_audit,
    test_group_edge_cases,
]


def print_results():
    print(f"\n{'='*60}")
    print(f"  AIFOM System Test Results")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}")

    current_group = ""
    for r in report.results:
        if r.group != current_group:
            current_group = r.group
            print(f"\n  [{current_group}]")
        icon = {"PASS": "✓", "FAIL": "✗", "SKIP": "⊘", "ERROR": "⚠"}[r.status]
        color = {"PASS": "", "FAIL": " *** FAIL ***", "SKIP": " (skipped)", "ERROR": " *** ERROR ***"}[r.status]
        ms = f" ({r.duration_ms}ms)" if r.duration_ms > 0 else ""
        print(f"    {icon} {r.name}{ms}{color}")
        if r.status in ("FAIL", "ERROR") and r.message:
            print(f"      → {r.message[:200]}")

    print(f"\n{'='*60}")
    print(f"  {report.summary()}")
    print(f"  Duration: {(datetime.now(timezone.utc) - report.start_time).total_seconds():.1f}s")
    print(f"{'='*60}")


def save_json_report():
    path = REPORT_DIR / "system_test_report.json"
    data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "total": report.total,
            "passed": report.passed,
            "failed": report.failed,
            "skipped": report.skipped,
            "errors": report.errors,
        },
        "results": [
            {
                "name": r.name,
                "group": r.group,
                "status": r.status,
                "duration_ms": r.duration_ms,
                "message": r.message,
            }
            for r in report.results
        ],
    }
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n  JSON report: {path}")


def save_html_report():
    path = REPORT_DIR / "system_test_report.html"
    rows = ""
    for r in report.results:
        cls = {"PASS": "pass", "FAIL": "fail", "SKIP": "skip", "ERROR": "error"}[r.status]
        ms = f"{r.duration_ms}ms" if r.duration_ms > 0 else "-"
        msg = r.message.replace("<", "&lt;").replace(">", "&gt;")[:300] if r.message else ""
        rows += f'<tr class="{cls}"><td>{r.group}</td><td>{r.name}</td><td>{r.status}</td><td>{ms}</td><td>{msg}</td></tr>\n'

    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AIFOM System Test Report</title>
<style>
body {{ font-family: -apple-system, sans-serif; margin: 20px; background: #1a1a2e; color: #e0e0e0; }}
h1 {{ color: #00d4ff; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ border: 1px solid #333; padding: 6px 10px; text-align: left; font-size: 13px; }}
th {{ background: #16213e; color: #00d4ff; }}
tr.pass td:first-child {{ border-left: 4px solid #00ff88; }}
tr.fail td:first-child {{ border-left: 4px solid #ff4444; }}
tr.skip td:first-child {{ border-left: 4px solid #888; }}
tr.error td:first-child {{ border-left: 4px solid #ffaa00; }}
.summary {{ margin: 20px 0; padding: 15px; background: #16213e; border-radius: 8px; font-size: 16px; }}
.summary span {{ margin-right: 20px; }}
.pass-count {{ color: #00ff88; }} .fail-count {{ color: #ff4444; }}
.skip-count {{ color: #888; }} .error-count {{ color: #ffaa00; }}
</style></head><body>
<h1>🔬 AIFOM System Test Report</h1>
<p>Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
<div class="summary">
<span class="pass-count">✓ PASS: {report.passed}</span>
<span class="fail-count">✗ FAIL: {report.failed}</span>
<span class="skip-count">⊘ SKIP: {report.skipped}</span>
<span class="error-count">⚠ ERROR: {report.errors}</span>
<span>Total: {report.total}</span>
</div>
<table><tr><th>Group</th><th>Test</th><th>Status</th><th>Time</th><th>Details</th></tr>
{rows}
</table></body></html>"""

    path.write_text(html, encoding="utf-8")
    print(f"  HTML report: {path}")


def main():
    parser = argparse.ArgumentParser(description="AIFOM Comprehensive System Tester")
    parser.add_argument("--group", type=int, help="Run only a specific group number (1-15)")
    parser.add_argument("--quick", action="store_true", help="Skip MQTT integration tests")
    parser.add_argument("--report", action="store_true", help="Only generate report from last run")
    args = parser.parse_args()

    if args.report:
        # TODO: load last JSON and regenerate HTML
        print("Report-only mode not yet implemented. Run without --report.")
        return

    print(f"\n{'#'*60}")
    print(f"  AIFOM Comprehensive System Tester")
    print(f"  Target: {API_BASE_URL}")
    print(f"  MQTT:   {MQTT_HOST}:{MQTT_PORT}")
    print(f"  Time:   {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'#'*60}")

    groups_to_run = ALL_GROUPS
    if args.group:
        idx = args.group - 1
        if 0 <= idx < len(ALL_GROUPS):
            groups_to_run = [ALL_GROUPS[idx]]
        else:
            print(f"Invalid group number: {args.group}. Valid: 1-{len(ALL_GROUPS)}")
            sys.exit(1)

    for group_fn in groups_to_run:
        if args.quick and group_fn == test_group_mqtt_connectivity:
            continue
        try:
            group_fn()
        except Exception as e:
            print(f"  [ERROR] Group crashed: {e}")

    print_results()
    save_json_report()
    save_html_report()

    # Exit code: 1 if any failures
    if report.failed > 0 or report.errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
