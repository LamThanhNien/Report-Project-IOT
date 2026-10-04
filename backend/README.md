# AIFOM Backend (FastAPI)

Python 3.11 + FastAPI + SQLAlchemy 2 + Pydantic v2 service for the AIFOM
platform.

## Modules

```
backend/
├── app/
│   ├── api/             # API router (versioned at /api/v1)
│   ├── core/            # config, logging, metrics, security (JWT, deps)
│   ├── db/              # SQLAlchemy session, base, init
│   ├── modules/
│   │   ├── auth/        # login, /me, JWT (bcrypt + python-jose)
│   │   ├── devices/     # register / list / status
│   │   ├── telemetry/   # query historical / latest
│   │   ├── firmware/    # upload + signed download (MinIO)
│   │   ├── ota/         # job creation, MQTT publish, result intake
│   │   └── projects/    # workspace identity, device assignment, datastreams
│   ├── repositories/
│   ├── schemas/
│   ├── services/        # mqtt_subscriber, mqtt_publisher, minio_client
│   └── main.py          # FastAPI app + lifespan (MQTT subscriber thread)
├── alembic/             # migrations
├── tests/               # pytest tests (TestClient + monkeypatch)
├── pyproject.toml
└── Dockerfile
```

## Run

The dev stack runs the backend in Docker. From the repo root:

```bash
make dev-up
```

The API is exposed at <http://localhost:8000> (port configurable via
`API_HOST_PORT` in `.env`).

Smoke test:

```bash
curl http://localhost:8000/health
curl http://localhost:8000/ready
curl http://localhost:8000/metrics      # Prometheus exposition
```

## Reduced project scope

The runtime supports device registration and presence, telemetry, remote commands,
Automation / Rule Engine, firmware management, and OTA. Projects are simple
workspaces used to scope devices, datastreams, rules, and commands. The custom
page/widget designer, AI/TinyML training and inference, health scoring, commercial
service-plan CRUD, public-site configuration API, and custom API documentation
portal have been removed. FastAPI's `/docs`, `/redoc`, and `/openapi.json` remain.

All historical Alembic migrations and ORM metadata are retained, including old
AI, page/widget, and API documentation tables. This allows existing databases to
upgrade without data loss or migration-history changes. Those tables have no
active feature endpoints or background processing. No ML libraries or model
artifacts are required by the API.

## Local (outside Docker)

```bash
cd backend
pip install -e ".[dev]"
export DATABASE_URL=postgresql+psycopg2://aifom:aifom@localhost:5432/aifom
export MQTT_HOST=localhost MQTT_PORT=1883
uvicorn app.main:app --reload
```

## Tests

```bash
make test-api                # ruff check + pytest, in the api container
# or, locally:
cd backend && pytest tests/ -q
```

See [`tests/README.md`](tests/README.md) for the test strategy and known gaps.

## Public endpoints

`/health`, `/ready`, `/metrics`, `POST /api/v1/auth/login`,
`POST /api/v1/devices/register` (ESP32), `GET /api/v1/firmware/{id}/download`
(ESP32). All other endpoints require a `Bearer` JWT issued by `/auth/login`.

## OpenAPI

`http://localhost:8000/docs` (Swagger UI) — `http://localhost:8000/redoc`.

---

## Observability

### `/health` vs `/ready`

| Endpoint | Purpose | Cost | Returns |
|----------|---------|------|---------|
| `GET /health` | Liveness check (is the process alive?) | Free — no I/O | `200 {"status":"ok"}` |
| `GET /ready` | Readiness check (are dependencies available?) | Probes all components | `200` or `503` |
| `GET /metrics` | Prometheus exposition | DB query on scrape | Prometheus text format |

### Readiness States

| State | HTTP Status | Meaning |
|-------|------------|---------|
| `ready` | 200 | All required and optional components healthy |
| `degraded` | 200 | Required components OK; one or more optional components degraded |
| `not_ready` | 503 | At least one required component is down |

### Required vs Optional Dependencies

**Required** (503 if down): `database`, `alembic`, `token_store`

**Optional/configurable** (degraded 200 if down):
- `mqtt` — required if `REQUIRE_MQTT_FOR_READINESS=true`
- `minio` — required if `REQUIRE_MINIO_FOR_READINESS=true`

### Readiness Timeouts and Cache

| Setting | Default | Description |
|---------|---------|-------------|
| `READINESS_COMPONENT_TIMEOUT` | 5s | Per-component probe timeout |
| `READINESS_OVERALL_TIMEOUT` | 20s | Total readiness budget |
| `READINESS_CACHE_TTL` | 10s | Cache TTL (avoids hammering on every Kubernetes ping) |

A component that times out reports as `down`. The lock is always released so
concurrent requests are not blocked indefinitely. Values are validated at
startup: component timeout 0.1-30s, overall timeout 1-60s, cache TTL 0-60s.
A dedicated bounded executor retains at most one outstanding synchronous probe
per component, preventing repeated timeouts from creating unbounded work.

### Alembic Multi-Head Support

The readiness probe compares `get_current_heads()` (database) vs `get_heads()`
(migration scripts) as sets. It returns healthy only when the sets match
exactly, including repositories with multiple heads. Missing or unknown extra
database heads return `down` because either state can indicate incompatible
schema history.
The `alembic.ini` is resolved relative to the backend directory, not the
process working directory.

### MQTT Readiness

The probe uses the application subscriber's authenticated `on_connect` /
`on_disconnect` state. Raw TCP reachability is intentionally insufficient:
an open broker port does not prove authentication or subscription success.

### Correlation ID Propagation

Format: `^[A-Za-z0-9._:-]{1,128}$`

| Context | Behaviour |
|---------|-----------|
| HTTP request with valid `X-Correlation-ID` | Echoed as-is |
| HTTP request with missing header | UUID v4 generated (counted in `aifom_correlation_id_generated_total`) |
| HTTP request with invalid format / injection / oversized | Rejected silently; UUID v4 generated (counted in `aifom_correlation_id_invalid_total`). Raw value **never** logged. |
| MQTT publish | Injects the validated ContextVar value into the payload. Caller's dict is **never mutated**. |
| Background thread / MQTT callback | Generates a fresh `op-<uuid4>` operation ID via `mqtt_callback_context()`. Never inherits stale request IDs. |

The `X-Correlation-ID` header is present on **all** responses: 2xx, 4xx, 5xx.

### Audit Redaction Limits

The audit payload sanitiser enforces these bounds before persisting:

| Limit | Value |
|-------|-------|
| Max recursion depth | 10 |
| Max dictionary keys per level | 100 |
| Max list items per level | 100 |
| Max string length | 2048 chars |
| Max total serialised payload | 64 KB |

Sensitive keys are matched **case-insensitively** using an explicit allowlist
(not broad substring matching). Examples of redacted keys: `password`, `token`,
`secret`, `api_key`, `authorization`, `cookie`, `private_key`, `refresh_token`,
`mqtt_password`, `minio_secret_key`, `signed_url`, `provisioning_secret`.

Safe keys that happen to contain sensitive substrings (e.g. `keyboard_layout`,
`key_count`) are **not** redacted.

### Audit Transaction Modes

| Mode | Function | When to use |
|------|----------|-------------|
| **Atomic** | `log_event_atomic(db, ...)` | Audit must roll back with business mutation |
| **Best-effort** | `log_event_best_effort(...)` | Audit after commit; failure never rolls back business data |
| **Alias (external compatibility only)** | `log_event(db, ...)` | Deprecated; internal callers use an explicit mode |

Atomic audit failures propagate to the caller so the enclosing business
transaction cannot silently succeed without its required audit record.

### Prometheus Metrics

| Metric | Labels | Description |
|--------|--------|-------------|
| `aifom_correlation_id_generated_total` | — | Correlation IDs auto-generated (missing header) |
| `aifom_correlation_id_invalid_total` | — | Correlation IDs rejected as invalid |
| `aifom_readiness_checks_total` | `outcome` | Readiness results (ready/degraded/not_ready) |
| `aifom_readiness_cache_hits_total` | — | Readiness cache hits |
| `aifom_readiness_timeouts_total` | `component` | Per-component timeout count |
| `aifom_readiness_component_up` | `component` | Current component state (1=up, 0=down) |
| `aifom_readiness_duration_seconds` | — | Histogram of overall readiness probe duration |
| `aifom_audit_log_events_total` | `outcome` | Audit event success/failure count |
| `aifom_audit_redaction_total` | — | Total fields redacted in audit payloads |
| `aifom_audit_truncation_total` | — | Total payloads truncated due to size |
| `aifom_mqtt_publish_correlation_total` | `source` | MQTT messages with correlation (propagated/generated) |

All metrics use **low-cardinality labels only** (no user IDs, correlation IDs,
hostnames, or device IDs as labels).

### Operator Troubleshooting

**`/ready` returns 503 after deployment:**
- Check `alembic heads` — ensure no pending migrations: `alembic current && alembic heads`.
- Check DB connectivity and check the `components` field in the response body.

**`/ready` returns `degraded`:**
- An optional component is down. Check `components.minio` or `components.mqtt`.
- MinIO: verify `MINIO_ENDPOINT` and that bucket `MINIO_BUCKET_FIRMWARE` exists.

**`/ready` hangs:**
- Should not happen — per-component timeout is `READINESS_COMPONENT_TIMEOUT` (default 5s)
  and overall timeout is `READINESS_OVERALL_TIMEOUT` (default 20s).

**Correlation ID not appearing on error responses:**
- Ensure `_correlation_id_middleware` is registered (it is in `main.py`).
- Error handlers call `get_correlation_id()` from the ContextVar — verify the
  middleware runs before the handler processes the request.

**Audit failures visible in metrics:**
- `aifom_audit_log_events_total{outcome="failure"}` increments on failures.
- Best-effort mode: failures are logged at WARNING and never block the caller.
- Check DB connectivity and `blacklisted_tokens` table accessibility.
