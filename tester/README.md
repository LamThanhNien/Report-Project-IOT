# AIFOM Test Suite

End-to-end integration testing toolkit for the AIFOM IoT platform.
Tests call the **running system** via real HTTP and MQTT — no mocks.

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Python | 3.11+ | API & MQTT tests |
| Node.js | 18+ | Playwright E2E tests |
| pip | latest | Python deps |
| npm | latest | Playwright deps |
| Docker Desktop | latest | AIFOM stack |

---

## Before Running Tests — Start AIFOM

The full Docker stack must be running:

```bat
cd D:\DATT\aifom
docker compose -f infrastructure/docker-compose.dev.yml up -d
```

Seed data is prepared automatically by:
- `run_api_tests.bat`
- `run_mqtt_tests.bat`
- `run_e2e_tests.bat`

These scripts call `tester\seed_test_data.bat`, which executes:
`scripts/seed_admin.py`, `scripts/seed_demo.py`, `scripts/seed_tenant_demo.py`.

To seed manually:

```bat
cd D:\DATT\aifom\tester
seed_test_data.bat
```

Frontend (required for E2E only):

```bat
cd D:\DATT\aifom\frontend
npm install
npm run dev
```

Verify the stack is up:

- Backend API : http://localhost:8000/health → `{"status":"ok"}`
- Frontend    : http://localhost:5173
- MinIO       : http://localhost:9001 (console)
- Mosquitto   : localhost:1883

---

## Configure .env

```bat
cd D:\DATT\aifom\tester
copy .env.example .env
```

Edit `.env` if your ports differ from defaults. The defaults match the seed
scripts (`admin@aifom.local / admin1234`, `tenant1@aifom.local / tenant1234`).

---

## Install Python Dependencies

```bat
cd D:\DATT\aifom\tester
pip install -r requirements.txt
```

---

## Run Tests

### API Tests (backend only, no frontend needed)

```bat
cd D:\DATT\aifom\tester
run_api_tests.bat
```

Or with pytest directly:

```bat
python -m pytest api\ -v --tb=short
```

When running pytest directly, seed data is not auto-run. Execute
`seed_test_data.bat` first.

### MQTT Tests (requires Mosquitto + backend)

```bat
run_mqtt_tests.bat
```

Interactive command/OTA checks require a physical ESP32 with its registered UID
and MQTT credentials. Follow [firmware setup](../docs/esp32_firmware_setup.md).
The MQTT contract tests publish test messages only while the tests run.

### Frontend E2E Tests (requires frontend running at FRONTEND_URL)

```bat
run_e2e_tests.bat
```

Or with headed browser (useful for debugging):

```bat
cd e2e
npm install && npx playwright install chromium
npx playwright test --headed
```

### All Tests

```bat
run_all_tests.bat
```

---

## What Each Test Group Verifies

### `api/test_00_health_ready.py`
GET /health and GET /ready return 200. Fails if backend is unreachable.

### `api/test_01_auth.py`
Login flow: admin and tenant tokens are issued correctly. Invalid credentials
return 401. Protected routes require Bearer token.

### `api/test_02_admin_tenants.py`
Full admin demo flow: create service plan → create tenant → create tenant owner
user → list tenants → view detail → assign device → list tenant devices.

### `api/test_03_tenant_isolation.py`
Tenant A cannot see Tenant B devices. Tenant cannot call admin-only routes
(`/api/v1/devices`, `/api/v1/telemetry`, `/api/v1/firmware`, `/api/v1/ota/jobs`).
These must return 403 or 404.

### `api/test_04_devices.py`
Admin CRUD for devices. Tenant can list/view their assigned devices via
`/client/devices`. Public device registration endpoint works without auth.

### `api/test_05_firmware.py`
Tenant uploads a fake .bin file. Response includes SHA-256 checksum.
Firmware download returns binary + `X-Firmware-Sha256` header.
Empty and oversized uploads are rejected.

### `api/test_06_ota.py`
Tenant creates OTA job for assigned device + uploaded firmware. OTA job appears
in both tenant and admin lists. Status is a valid value
(pending/sent/accepted/downloading/flashing/rebooting/success/failed).

### `api/test_07_telemetry.py`
Admin creates telemetry records. Tenant can view telemetry for own devices only.
Cross-tenant telemetry access returns 403/404.

### `api/test_08_alerts.py`
Tenant-scoped operational alerts return a list. AI/anomaly endpoints have been removed.

### `mqtt/test_mqtt_connection.py`
Broker connectivity. Publish/subscribe loopback works.

### `mqtt/test_ota_mqtt_publish.py`
Creates an OTA job via API then listens on the MQTT topic. Validates that the
backend publishes `{job_id, firmware_version_id, firmware_version, firmware_url, checksum?}`.

### `e2e/tests/admin_flow.spec.ts`
Admin login → dashboard → tenant management → devices → firmware → OTA pages.

### `e2e/tests/tenant_flow.spec.ts`
Tenant login → client dashboard → devices → OTA. Admin routes must be blocked.

### `e2e/tests/ota_flow.spec.ts`
Tenant firmware upload through UI (if upload button is found). OTA job initiation.

---

## What Must Be Running

| Test Group | Backend | MQTT | Frontend | MinIO |
|------------|---------|------|----------|-------|
| API tests  | ✅      | ✅ (OTA publish) | ❌ | ✅ (firmware) |
| MQTT tests | ✅      | ✅   | ❌       | ✅ |
| E2E tests  | ✅      | optional | ✅ | ✅ |

---

## Common Failure Reasons

### 401 Unauthorized
- Token expired or invalid.
- Seed data not prepared: run `seed_test_data.bat`.
- Wrong `ADMIN_PASSWORD` in `.env`.

### 403 Forbidden
- Token is valid but role is wrong.
- Tenant calling an admin-only route is expected 403 — isolation tests pass.

### 404 Not Found
- Resource does not exist (expected for cross-tenant access — isolation tests pass).
- Seed data not prepared.

### 409 Conflict
- Duplicate record (device UID, tenant slug). Usually safe to ignore — tests
  handle 409 gracefully.

### 502 Bad Gateway
- Backend cannot reach MQTT broker or MinIO.
- Check Docker: `docker compose -f infrastructure/docker-compose.dev.yml ps`

### 503 Service Unavailable
- A required dependency is unavailable. Check readiness details and API logs.

### MQTT test skipped
- Mosquitto not reachable. Start stack with Docker Compose.

### E2E test fails on login
- Frontend not running. Start: `cd frontend && npm run dev`.
- Seed tenant users and devices: `seed_test_data.bat`.

---

## Interpreting Results

```
PASSED  — feature works correctly
FAILED  — real bug found, see test output for details
SKIPPED — precondition not met (e.g. no devices assigned, model not loaded)
WARNING — printed inside test output, not a pytest state
```

A `SKIPPED` result is NOT a failure — it means the test data was not set up.
Run `seed_test_data.bat` to reduce skips.

---

## Test Data Policy

- Test records are prefixed with `TEST_`
- Emails: `admin@aifom.local`, `tenant1@aifom.local`, `tenant2@aifom.local`
- Tests are idempotent where possible (409 handled gracefully)
- Fake `.bin` files are generated in `tester/temp/` and never committed

---

## Reports

| Report | Location |
|--------|----------|
| API (HTML) | `tester/reports/api_report.html` |
| MQTT (HTML) | `tester/reports/mqtt_report.html` |
| Playwright | `tester/reports/playwright-report/index.html` |
| Full test run | `tester/reports/FULL_TEST_REPORT.md` |
