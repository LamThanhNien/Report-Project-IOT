# API Tests

FastAPI route tests using `TestClient` with `monkeypatch` to stub the
SQLAlchemy repository layer, the MinIO client, and the MQTT publisher, so
the suite runs without Postgres, Mosquitto, or MinIO. The MQTT subscriber
lifespan hook is no-op'd in `test_api.py` to keep tests fully offline.

## Covered

### Health

- `GET /health` — returns `{"status":"ok","service":"aifom-api"}`.

### Devices (Phase 2)

- `POST /api/v1/devices` — creates a device.
- `GET /api/v1/devices` — lists devices.
- `POST /api/v1/devices/register` — idempotent upsert; response contains topic map including `ota/status`.
- `GET /api/v1/devices/{uid}/status` — happy path + 404.
- `GET /api/v1/devices/{uid}/latest-telemetry` — happy path.
- `GET /api/v1/devices/{uid}/telemetry` — returns empty list for unknown UID.

### Telemetry (Phase 2 / Phase 5)

- `POST /api/v1/telemetry` — happy path; 404 for unknown device.
- `GET /api/v1/telemetry` — verifies `metric_name`, `from_time`, `to_time`, `limit`, `offset` filter kwargs are forwarded to the repository.
- `GET /api/v1/devices/{uid}/telemetry` — verifies same filter kwargs are forwarded.
- `GET /api/v1/telemetry?limit=0` — returns 422 (validation: limit must be ≥ 1).

### Firmware (Phase 3)

- `POST /api/v1/firmware` — multipart upload happy path; 400 on empty file; 413 on oversized file.
- `GET /api/v1/firmware` — lists firmware metadata.
- `GET /api/v1/firmware/latest?target_device_type=esp32` — happy path; 404 when none found.

### OTA (Phase 3 / Phase 4)

- `POST /api/v1/ota/jobs` — happy: job created, `mqtt_publisher.publish_ota_request` called, job flipped to `sent`, `download_url` and `checksum_sha256` embedded; 404 when device unknown; 404 when firmware unknown.
- `POST /api/v1/ota/jobs` — publish failure → 502, job marked `failed` with `error_message`.
- `GET /api/v1/firmware/{id}/download` — streams binary, sets `X-Firmware-Sha256` + `X-Firmware-Version` headers, releases MinIO connection. 404 when record missing.
- `MQTTSubscriber._handle_ota_status` — updates the job row from a valid payload; invalid payload does not crash the handler.
- `mqtt_topics.parse_device_topic` — parses `devices/{uid}/...` and legacy `aifom/devices/{uid}/...` for compatibility.

### Anomaly (Phase 6)

- `POST /api/v1/anomaly/run/{uid}` — 503 when model artifact is absent.
- `POST /api/v1/anomaly/run/{uid}` — happy: inserts anomaly events, returns `rows_scored` + `anomalies` counts.
- `GET /api/v1/anomaly/devices/{uid}` — returns stored events.
- `GET /api/v1/anomaly/devices/{uid}` — 404 when device not registered.

## Run

### Inside the docker stack (recommended — mirrors CI):

```bash
make test-api
```

### Locally without docker (dev deps must be installed):

```bash
cd backend
pip install -e ".[dev]"
pytest tests/ -q
```

### Lint / format:

```bash
make lint       # ruff check (read-only)
make format     # ruff format (modifies files)
```

## Database behaviour in tests

No real database is contacted. Every repository call (`create_device`,
`list_devices`, `get_firmware`, …) is replaced by a `monkeypatch.setattr`
lambda that returns a `SimpleNamespace` or list of `SimpleNamespace` objects
matching the shape the router expects. SQLAlchemy sessions are never opened.

## Known gaps

- No integration tests hitting a real Postgres / TimescaleDB.
- No MQTT subscriber tests against a live Mosquitto instance.
- No MinIO connectivity-error path tests (real client interaction).
- No ESP32 hardware tests (requires physical device; covered by the OTA
  client source in `iot/firmware/`).
- No end-to-end browser tests (Playwright / Cypress not wired up).
- `HTTP_413_REQUEST_ENTITY_TOO_LARGE` deprecation warning from FastAPI —
  non-blocking, test still passes.
