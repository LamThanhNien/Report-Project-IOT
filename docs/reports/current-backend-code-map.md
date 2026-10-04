# AIFOM Backend — Current Implementation Code Map

> Generated: 2026-06-01 | Branch: `final/backend-runtime`
> Purpose: Pre-implementation baseline. Required reading before any code changes (CLAUDE.md rule #3).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Entry Point & Startup Sequence](#2-entry-point--startup-sequence)
3. [API Router Map](#3-api-router-map)
4. [Bounded Contexts (DDD)](#4-bounded-contexts-ddd)
5. [Legacy Modules (app/modules/)](#5-legacy-modules-appmodules)
6. [Cross-Cutting: Core & Shared](#6-cross-cutting-core--shared)
7. [Infrastructure Services](#7-infrastructure-services)
8. [Database & Migrations](#8-database--migrations)
9. [MQTT & Device Communication](#9-mqtt--device-communication)
10. [Frontend API Surface](#10-frontend-api-surface)
11. [Testing Infrastructure](#11-testing-infrastructure)
12. [DevOps & Infrastructure](#12-devops--infrastructure)
13. [Active TODOs & Known Issues](#13-active-todos--known-issues)
14. [Legacy ↔ Bounded Context Dependency Matrix](#14-legacy--bounded-context-dependency-matrix)
15. [P0/P1 Classification](#15-p0p1-classification)

---

## 1. Architecture Overview

**Pattern**: Modular monolith with DDD bounded contexts layered on top of legacy modules.

```
┌─────────────────────────────────────────────────────────────────┐
│  FastAPI (main.py)                                              │
│  ├── Middleware: CORS, CSRF, Security Headers, HTTP Logging,    │
│  │               Rate Limiting (200/min)                        │
│  ├── Instrumentator: Prometheus metrics                         │
│  └── Endpoints: /health, /ready, /metrics                       │
├─────────────────────────────────────────────────────────────────┤
│  API Router (/api/v1)                                           │
│  └── 13 sub-routers from bounded_contexts/ + shared/            │
├─────────────────────────────────────────────────────────────────┤
│  Bounded Contexts (presentation → application → domain)         │
│  │  identity · device_registry · firmware_ota · telemetry        │
│  │  tenant_management · project_dashboard · tinyml_model_mgmt    │
│  ├── Use Cases / Services (thin)                                │
│  ├── Adapters (bridge to legacy)                                │
│  └── Domain Entities / Value Objects (thin)                     │
├─────────────────────────────────────────────────────────────────┤
│  Legacy Modules (app/modules/) ← REAL implementation            │
│  │  auth · devices · firmware · ota · telemetry · tenants        │
│  │  anomaly · audit · projects · alerts · debug · users          │
│  ├── ORM Models (SQLAlchemy)                                    │
│  ├── Repositories (DB queries)                                  │
│  ├── Services (business logic)                                  │
│  └── Schemas (Pydantic)                                         │
├─────────────────────────────────────────────────────────────────┤
│  Shared Infrastructure                                          │
│  │  MQTT Subscriber · mDNS Service · Device Status Event Bus    │
│  │  Audit Service · DB Session · MinIO Client                   │
│  └── Core: Config · Security · Auth Cookies · Tenant Resolution │
├─────────────────────────────────────────────────────────────────┤
│  External: PostgreSQL/TimescaleDB · Mosquitto MQTT · MinIO      │
└─────────────────────────────────────────────────────────────────┘
```

**Key architectural fact**: The DDD bounded contexts are a **presentation-layer refactor**. The `app/modules/` packages still contain the actual ORM models, repositories, services, and schemas. The bounded context routers import from `app.modules.*` for all data access. Do NOT delete `app/modules/`.

**Tech stack**: Python 3.11, FastAPI, SQLAlchemy 2.x, PostgreSQL 16 + TimescaleDB, paho-mqtt v2.1, MinIO, Alembic, Prometheus, Pydantic v2, bcrypt, python-jose (JWT).

---

## 2. Entry Point & Startup Sequence

**File**: `backend/app/main.py` (518 lines)

### Startup (lifespan context manager)

| Step | What it does | Blocking? |
|------|-------------|-----------|
| 1 | `configure_logging()` — structured JSON logging | No |
| 2 | `register_custom_collectors()` — Prometheus custom metrics | No |
| 3 | `device_status_bus.set_loop()` — wire event bus to asyncio loop | No |
| 4 | `_run_alembic_upgrade()` — apply pending DB migrations | **Yes** (in thread) |
| 5 | `_verify_token_blacklist_table()` — check JWT revocation table exists | **Yes** (in thread) |
| 6 | `_seed_startup_data()` — seed device types + sync plan features | **Yes** (in thread) |
| 7 | `_ensure_minio_bucket()` — create firmware bucket (3 retries) | No (background) |
| 8 | `device_repository.reset_online_devices_on_startup_with_events()` — reconcile stale online → offline | **Yes** |
| 9 | `mdns_service.start()` — mDNS discovery for ESP32 | No |
| 10 | `mqtt_subscriber.start()` — MQTT message processing | No |
| 11 | `device_presence_monitor.start()` — periodic stale device check | No |

### Readiness gate

- `_startup_complete` flag: `True` only if both Alembic migration AND token blacklist verification passed.
- `/ready` returns 503 until `_startup_complete` is `True`.
- `/health` always returns 200 (liveness probe).

### Shutdown

1. `device_status_bus.stop()`
2. `device_presence_monitor.stop()`
3. `mqtt_subscriber.stop()`
4. `mdns_service.stop()`

### Middleware stack (order matters)

1. `CORSMiddleware` — origins from `settings.cors_origins_list`
2. CSRF middleware — validates `X-CSRF-Token` header against cookie for browser unsafe methods (POST/PUT/PATCH/DELETE), skips public auth paths
3. Security headers middleware — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`
4. HTTP logging middleware — one log line per request with method, path, status, latency, JWT role

---

## 3. API Router Map

**File**: `backend/app/api/v1/router.py`

All routes prefixed with `/api/v1`.

| Prefix | Source Router | Tags | Bounded Context |
|--------|--------------|------|-----------------|
| `/auth` | `identity.presentation.router` | auth | identity |
| `/devices` | `device_registry.presentation.router` | devices | device_registry |
| `/admin/device-types` | `device_registry.presentation.router_device_types` | admin | device_registry |
| `/telemetry` | `telemetry.presentation.router` | telemetry | telemetry |
| `/firmware` | `firmware_ota.presentation.router_firmware` | firmware | firmware_ota |
| `/ota` | `firmware_ota.presentation.router_ota` | ota | firmware_ota |
| `/anomaly` | `tinyml_model_management.presentation.router` | anomaly | tinyml_model_management |
| `/admin` | `tenant_management.presentation.router_admin` | admin | tenant_management |
| `/admin/audit-logs` | `shared.presentation.audit_router` | admin | shared |
| `/client` | `tenant_management.presentation.router_client` | client | tenant_management |
| `/client` | `project_dashboard.presentation.router` | client-projects | project_dashboard |
| `/debug` | `shared.presentation.debug_router` | debug | shared |
| `/debug` | `shared.presentation.system_health_router` | observability | shared |

### Complete Endpoint Inventory

#### Auth (`/api/v1/auth`)
| Method | Path | Handler | Rate Limit | Notes |
|--------|------|---------|------------|-------|
| POST | `/register` | `register` | 3/min | Creates tenant + owner user |
| POST | `/login` | `login` | 5/min | Blocks disabled tenants |
| POST | `/logout` | `logout` | — | Blacklists access token, clears cookies |
| POST | `/refresh` | `refresh_token` | 10/min | Token rotation |
| GET | `/me` | `me` | — | Current user info |

#### Devices (`/api/v1/devices`)
| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/` | `list_devices` | Admin, tenant-filtered |
| POST | `/` | `create_device` | Admin |
| POST | `/register` | `register_device` | Rate-limited, provisioning token auth |
| GET | `/{device_uid}/telemetry` | `get_device_telemetry` | Admin |
| GET | `/{device_uid}/latest-telemetry` | `get_latest_device_telemetry` | Admin |
| GET | `/{device_uid}/status` | `get_device_status` | Admin |

#### Device Types (`/api/v1/admin/device-types`)
| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/` | `list_device_types` | Admin |
| POST | `/` | `create_device_type` | Admin |
| GET | `/{device_type_id}` | `get_device_type` | Admin |
| PUT | `/{device_type_id}` | `update_device_type` | Admin |
| DELETE | `/{device_type_id}` | `delete_device_type` | Admin |

#### Telemetry (`/api/v1/telemetry`)
| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/` | `list_telemetry` | Admin, filters: device_uid, metric_name, from, to |
| POST | `/` | `create_telemetry` | Admin |

#### Firmware (`/api/v1/firmware`)
| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| POST | `/` | `upload_firmware` | Admin, multipart upload to MinIO |
| GET | `/` | `list_firmware` | Admin, optional device_type filter |
| GET | `/latest` | `latest_firmware` | Admin |
| GET | `/{firmware_id}` | `get_firmware` | Admin |
| GET | `/{firmware_id}/download` | `download_firmware` | Admin, rate-limited, streams from MinIO |
| GET | `/ota-download/{firmware_id}` | `ota_download_firmware` | Token-authenticated, for ESP32 |

#### OTA (`/api/v1/ota`)
| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| POST | `/jobs` | `create_ota_job_endpoint` | Admin, publishes OTA request via MQTT |
| GET | `/jobs` | `list_ota_jobs` | Admin, optional device_uid filter |
| GET | `/jobs/{job_id}` | `get_ota_job` | Admin |

#### Anomaly/TinyML (`/api/v1/anomaly`)
| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/models` | `get_anomaly_model_info_endpoint` | Admin |
| GET | `/devices/{device_uid}` | `list_device_anomalies_endpoint` | Admin |
| POST | `/run/{device_uid}` | `run_anomaly_detection_endpoint` | Admin |

#### Admin Tenants (`/api/v1/admin`)
| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/service-plans` | | List all plans |
| POST | `/service-plans` | | Create plan |
| GET | `/service-plans/{plan_id}` | | Get plan |
| PUT | `/service-plans/{plan_id}` | | Update plan |
| DELETE | `/service-plans/{plan_id}` | | Delete plan |
| GET | `/tenants` | | List all tenants |
| POST | `/tenants` | | Create tenant |
| GET | `/tenants/{tenant_id}` | | Get tenant |
| PUT | `/tenants/{tenant_id}` | | Update tenant |
| PATCH | `/tenants/{tenant_id}/status` | | Enable/disable tenant |
| GET | `/tenants/{tenant_id}/features` | | Get tenant features |
| PUT | `/tenants/{tenant_id}/features` | | Update tenant features |
| GET | `/tenants/{tenant_id}/devices` | | List tenant devices |
| POST | `/tenants/{tenant_id}/devices` | | Assign device to tenant |
| DELETE | `/tenants/{tenant_id}/devices/{device_id}` | | Remove device from tenant |
| GET | `/tenants/{tenant_id}/projects` | | List tenant projects |
| GET | `/tenants/{tenant_id}/projects/{project_id}` | | Get tenant project detail |
| GET | `/tenants/{tenant_id}/users` | | List tenant users |
| POST | `/tenants/{tenant_id}/users` | | Create tenant user |
| DELETE | `/tenants/{tenant_id}/users/{user_id}` | | Delete tenant user |

#### Admin Audit Logs (`/api/v1/admin/audit-logs`)
| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/` | `list_audit_logs` | Admin, filters: limit, offset, action, tenant_id |

#### Client (Tenant Workspace) (`/api/v1/client`)
| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/me` | | Current tenant user profile |
| GET | `/features` | | Tenant feature flags |
| GET | `/dashboard` | | Dashboard summary |
| GET | `/devices` | | List tenant devices |
| POST | `/devices` | | Create device |
| GET | `/devices/{device_uid}` | | Get device |
| PATCH | `/devices/{device_uid}/offline-timeout` | | Update offline timeout |
| GET | `/devices/{device_uid}/detail` | | Device detail view |
| GET | `/devices/{device_uid}/latest-telemetry` | | Latest telemetry |
| GET | `/devices/{device_uid}/telemetry` | | Telemetry history |
| DELETE | `/devices/{device_uid}` | | Delete device |
| GET | `/devices/{device_uid}/mqtt-config` | | MQTT connection config |
| GET | `/devices/status/stream` | | **SSE** — live device status |
| GET | `/firmware` | | List firmware |
| POST | `/firmware` | | Upload firmware |
| POST | `/firmware/from-source` | | Compile from .ino source |
| GET | `/ota-jobs` | | List OTA jobs |
| POST | `/ota-jobs` | | Create OTA job |
| GET | `/alerts` | | List alerts |
| GET | `/ai-events` | | List AI/anomaly events |
| GET | `/users` | | List tenant users |
| POST | `/users` | | Create tenant user |
| DELETE | `/users/{user_id}` | | Delete tenant user |
| GET | `/plan` | | Current service plan |
| GET | `/audit-logs` | | Tenant audit logs |

#### Client Projects (`/api/v1/client`)
| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| GET | `/projects` | | List projects |
| POST | `/projects` | | Create project |
| GET | `/projects/{project_id}` | | Get project |
| PUT | `/projects/{project_id}` | | Update project |
| DELETE | `/projects/{project_id}` | | Delete project |
| POST | `/projects/{project_id}/pages` | | Create page |
| POST | `/pages/{page_id}/widgets` | | Add widget |
| PUT | `/widgets/{widget_id}` | | Update widget |
| DELETE | `/widgets/{widget_id}` | | Remove widget |
| GET | `/devices/{device_id}/capabilities` | | Device capabilities |
| GET | `/projects/{project_id}/devices/{device_id}/used-gpio` | | Used GPIO pins |
| POST | `/devices/{device_id}/commands` | | Send MQTT command to device |

#### Debug (`/api/v1/debug`)
| Method | Path | Handler | Notes |
|--------|------|---------|-------|
| POST | `/log` | `receive_debug_log` | Rate-limited 30/min, dev-only |
| GET | `/system-health` | `get_system_health` | Admin, checks DB/MQTT/MinIO |

---

## 4. Bounded Contexts (DDD)

Each bounded context follows this layer structure:
```
bounded_contexts/<name>/
├── domain/          # Entities, Value Objects, Policies
├── application/     # Use Cases, Application Schemas, Services
├── infrastructure/  # Repositories, Adapters, Persistence (ORM Models)
└── presentation/    # Routers, Pydantic Schemas, Dependencies
```

### 4a. identity

**Purpose**: Authentication, authorization, user management, JWT tokens.

| Layer | Key Files | What it contains |
|-------|-----------|-----------------|
| domain | `entities.py`, `value_objects.py` | User entity, role/email value objects |
| application | `services.py`, `use_cases.py`, `schemas.py` | Token blacklist, refresh token creation/decoding |
| infrastructure | `adapters.py`, `repositories.py` | `BcryptPasswordService`, `JwtTokenService`, `SqlAlchemyUserRepository` |
| infrastructure/persistence | `models.py`, `token_blacklist.py` | User ORM model (actually imports from `app.modules.auth.model`), `BlacklistedToken` model |
| presentation | `router.py`, `schemas.py`, `dependencies.py` | Auth endpoints, `get_current_user` dependency |

**Legacy coupling**: Models and schemas come from `app.modules.auth`. Bounded context provides adapters and token management.

### 4b. device_registry

**Purpose**: Device CRUD, device types, device status, device self-registration.

| Layer | Key Files | What it contains |
|-------|-----------|-----------------|
| domain | `entities.py`, `value_objects.py` | Device entity, `MqttTopics` value object |
| application | `use_cases.py`, `platform_use_cases.py` | Device listing/creation/registration use cases |
| infrastructure | `repositories.py`, `device_presence_monitor.py`, `device_type_repositories.py` | Device repository adapter, presence monitor |
| infrastructure/persistence | `models.py`, `device_type_models.py`, `platform_models.py` | Device, DeviceType, Platform ORM models |
| presentation | `router.py`, `router_device_types.py`, `router_platforms.py`, `schemas.py`, `platform_schemas.py` | Device + device type + platform endpoints |

**Legacy coupling**: Router imports schemas from `app.modules.devices.schema`, telemetry from `app.modules.telemetry`. Uses adapter pattern to bridge legacy repos to use-case ports.

**Platform support**: Has `platform_models.py`, `router_platforms.py`, `platform_schemas.py`, `platform_use_cases.py` — multi-platform device management is partially implemented.

### 4c. firmware_ota

**Purpose**: Firmware upload/storage, OTA job management, firmware compilation.

| Layer | Key Files | What it contains |
|-------|-----------|-----------------|
| domain | `entities.py`, `value_objects.py` | Firmware/OTA entities, checksum value objects |
| application | `use_cases.py`, `schemas.py` | Firmware CRUD, OTA job creation, checksum computation |
| infrastructure | `firmware_repositories.py`, `ota_repositories.py`, `adapters.py`, `minio_adapter.py`, `mqtt_adapter.py` | Repository adapters, MinIO storage, MQTT OTA publisher |
| infrastructure/compiler | `arduino_compiler.py` | Arduino .ino compilation |
| infrastructure/persistence | `firmware_models.py`, `firmware_profile_models.py`, `ota_models.py`, `ota_campaign_models.py` | ORM models |
| infrastructure/storage | `minio_client.py` | MinIO bucket/file operations |
| presentation | `router_firmware.py`, `router_ota.py`, `firmware_schemas.py`, `ota_schemas.py` | Firmware + OTA endpoints |

**Legacy coupling**: Minimal — uses bounded context use cases and adapters. Imports only `FirmwareRead` schema and audit service from legacy.

### 4d. telemetry

**Purpose**: Telemetry data ingestion, querying, alerts, extended metrics.

| Layer | Key Files | What it contains |
|-------|-----------|-----------------|
| domain | `entities.py`, `value_objects.py` | Telemetry entity, `TelemetryFilter` value object |
| application | `use_cases.py`, `schemas.py` | Telemetry creation, querying |
| infrastructure | `repositories.py`, `adapters.py`, `mqtt_handler.py` | Telemetry repository, MQTT handler |
| infrastructure/persistence | `models.py`, `extended_models.py`, `alert_models.py` | Telemetry, extended telemetry, alert ORM models |
| presentation | `router.py`, `schemas.py` | Telemetry endpoints |

**Legacy coupling**: Imports `Telemetry` model, `TelemetryCreate`/`TelemetryRead` schemas, and audit service from legacy modules.

### 4e. tenant_management

**Purpose**: Multi-tenant management — service plans, tenants, tenant users, tenant features, device assignments.

| Layer | Key Files | What it contains |
|-------|-----------|-----------------|
| domain | `entities.py`, `policies.py` | Tenant entity, business policies |
| application | `use_cases.py`, `schemas.py`, `services.py` | Tenant management use cases |
| infrastructure | `repositories.py`, `adapters.py` | Tenant repository adapters |
| infrastructure/persistence | `models.py` | Tenant, ServicePlan, TenantDeviceMapping, TenantUser, PlanFeature ORM models |
| presentation | `router_admin.py`, `router_client.py`, `schemas.py`, `dependencies.py` | Admin + client endpoints |

**Legacy coupling**: **HEAVIEST** — both routers import from 10+ legacy `app.modules.*` packages with no use-case abstraction. This is the most legacy-coupled bounded context.

**Notable**: `router_client.py` is the largest router in the system (~900+ lines) with endpoints for dashboard, devices, firmware, OTA, alerts, users, plan, audit logs, and SSE streaming.

### 4f. project_dashboard

**Purpose**: Tenant project management, dashboard pages, widgets, device commands.

| Layer | Key Files | What it contains |
|-------|-----------|-----------------|
| domain | `entities.py`, `value_objects.py`, `widget_registry.py` | Project entity, widget types |
| application | `schemas.py` | Project schemas |
| infrastructure | `repositories.py`, `adapters.py`, `mqtt_adapter.py` | Project repo, MQTT device command adapter |
| infrastructure/persistence | `models.py` | Project, Page, Widget ORM models |
| presentation | `router.py`, `schemas.py` | Project CRUD, widget management, device commands |

**Legacy coupling**: Heavy — imports models, schemas, repositories, and widget_registry from `app.modules.projects`. Only MQTT command publishing uses a bounded context adapter.

### 4g. tinyml_model_management

**Purpose**: Anomaly detection model management, anomaly event tracking, ML inference.

| Layer | Key Files | What it contains |
|-------|-----------|-----------------|
| domain | `entities.py`, `value_objects.py` | Anomaly model entity |
| application | `use_cases.py`, `schemas.py`, `services.py` | Anomaly detection use cases |
| infrastructure | `repositories.py`, `adapters.py`, `sqlalchemy_models.py` | Anomaly repository, ML model loading |
| infrastructure/persistence | `models.py` | AnomalyEvent ORM model |
| presentation | `router.py`, `schemas.py` | Anomaly endpoints |

**Legacy coupling**: Light — imports only device repository and anomaly schemas from legacy.

---

## 5. Legacy Modules (app/modules/)

**Location**: `backend/app/modules/`

**Status**: **ACTIVE — DO NOT DELETE**. Contains the real ORM models, repositories, services, and schemas. Bounded contexts import from these.

### Module Inventory

| Module | Files | Purpose | Active Imports? |
|--------|-------|---------|-----------------|
| `auth` | model, repository, router (redirect), schema, service | User model, auth logic, JWT | **Yes** — heavily imported |
| `devices` | model, model_device_types, repository, repository_device_types, router (redirect), schema, schema_device_types | Device + DeviceType models/repos | **Yes** — heavily imported |
| `firmware` | model, model_profiles, repository, router (redirect), schema | Firmware model/repo | **Yes** — imported by firmware_ota BC |
| `ota` | model, model_campaigns, repository, router (redirect), schema | OTA job model/repo | **Yes** — imported by firmware_ota BC |
| `telemetry` | model, model_extended, repository, router (redirect), schema | Telemetry model/repo | **Yes** — heavily imported |
| `tenants` | model, repository, router_admin (redirect), router_client (redirect), schema, service | Tenant model/repo/service | **Yes** — heavily imported |
| `anomaly` | model, repository, router (redirect), schema, service | Anomaly event model | **Yes** — imported by tinyml BC |
| `audit` | model, router (redirect), service | AuditLog model, audit service | **Yes** — imported everywhere |
| `projects` | model, repository, router (redirect), schema, widget_registry | Project/Page/Widget models | **Yes** — imported by project_dashboard BC |
| `alerts` | model | AlertEvent model | **Yes** — imported by alembic/env.py |
| `debug` | router (redirect) | Debug log endpoint | Redirect only |
| `users` | README.md | Placeholder | No code |

### Router Redirect Pattern

All `router.py` files in `app/modules/` are **thin shims** that use `importlib` + `sys.modules` aliasing to redirect to the corresponding bounded context router. They contain zero business logic.

### Critical dependency chain

```
bounded_contexts/*  ──imports──►  modules/*/model.py    (ORM tables)
bounded_contexts/*  ──imports──►  modules/*/repository.py (DB queries)
bounded_contexts/*  ──imports──►  modules/*/schema.py    (Pydantic models)
bounded_contexts/*  ──imports──►  modules/*/service.py   (business logic)
alembic/env.py      ──imports──►  modules/*/model.py    (migration metadata)
```

---

## 6. Cross-Cutting: Core & Shared

### Core (`backend/app/core/`)

| File | Purpose | Key Exports |
|------|---------|-------------|
| `config.py` | Pydantic Settings with secret validation | `Settings`, `settings` singleton |
| `security.py` | JWT encode/decode, password hashing | `create_access_token`, `decode_access_token`, `get_password_hash`, `verify_password` |
| `tenant.py` | Tenant resolution from JWT | `get_current_tenant_user`, `require_tenant_write` |
| `auth_cookies.py` | HTTP-only cookie management | `set_auth_cookies`, `clear_auth_cookies`, `ACCESS_TOKEN_COOKIE`, `REFRESH_TOKEN_COOKIE`, `csrf_tokens_match` |
| `ota_tokens.py` | Short-lived OTA download tokens | `create_ota_token`, `verify_ota_token` |
| `logging.py` | Structured JSON logging config | `configure_logging()` |
| `metrics.py` | Custom Prometheus collectors | `register_custom_collectors()` |

### Shared (`backend/app/shared/`)

| Layer | File | Purpose |
|-------|------|---------|
| **application** | `audit_service.py` | Cross-context audit logging |
| **application** | `errors.py` | Shared error types |
| **application** | `pagination.py` | Pagination helpers |
| **application** | `unit_of_work.py` | UoW pattern (if used) |
| **domain** | `events.py` | Domain event base classes |
| **domain** | `exceptions.py` | Domain exceptions |
| **domain** | `value_objects.py` | Shared value objects |
| **infrastructure/db** | `base.py`, `session.py` | SQLAlchemy Base, SessionLocal |
| **infrastructure/messaging** | `mqtt_client.py`, `mqtt_publisher.py`, `mqtt_subscriber.py`, `mqtt_topics.py` | MQTT infrastructure |
| **infrastructure/messaging** | `device_status_events.py` | Thread-safe SSE event bus (sync→async bridge) |
| **infrastructure/messaging** | `mdns_service.py` | mDNS service discovery for ESP32 |
| **infrastructure/persistence** | `audit_models.py` | AuditLog ORM model |
| **presentation** | `audit_router.py` | `/admin/audit-logs` endpoint |
| **presentation** | `debug_router.py` | `/debug/log` endpoint (dev-only) |
| **presentation** | `system_health_router.py` | `/debug/system-health` endpoint |
| **presentation** | `dependencies.py` | Shared FastAPI dependencies |
| **presentation** | `error_handlers.py` | Global exception handlers |

---

## 7. Infrastructure Services

### `backend/app/services/`

| File | Purpose | Used By |
|------|---------|---------|
| `mqtt_client.py` | paho-mqtt client wrapper | `main.py`, shared infrastructure |
| `mqtt_publisher.py` | MQTT message publishing | firmware_ota, project_dashboard, tenant client router |
| `mqtt_subscriber.py` | MQTT subscription (legacy, may be unused — see shared version) | Unknown |
| `mqtt_topics.py` | Topic name construction helpers | device_registry, mqtt_subscriber, tenant client router |
| `minio_client.py` | MinIO bucket/file operations (legacy) | firmware upload/download |
| `device_presence_monitor.py` | Periodic stale device detection (legacy) | `main.py` uses bounded context version |
| `arduino_compiler.py` | Arduino .ino → .bin compilation | tenant client router |

**Note**: There are TWO implementations of several services:
1. `backend/app/services/` — legacy standalone services
2. `backend/app/shared/infrastructure/messaging/` — shared infrastructure version
3. `backend/app/bounded_contexts/*/infrastructure/` — bounded context adapters

The active `main.py` uses the shared infrastructure versions for MQTT subscriber, mDNS, and device presence monitor.

---

## 8. Database & Migrations

### Session management

- **File**: `backend/app/db/session.py` (and `backend/app/shared/infrastructure/db/session.py`)
- **Engine**: PostgreSQL via `psycopg2-binary`
- **Session**: `SessionLocal()` factory, used directly (no dependency injection in most places)

### Alembic migrations

**Config**: `backend/alembic.ini`
**Engine**: `backend/alembic/env.py`

| Migration | File | Description |
|-----------|------|-------------|
| 0001 | `0001_initial_schema.py` | Initial tables |
| 0002 | `0002_architecture_completion.py` | Architecture completion |
| 0003 | `0003_tinyml_model_management.py` | TinyML tables |
| 0004 | `0004_telemetry_hypertable.py` | TimescaleDB hypertable for telemetry |
| 0005 | `0005_database_improvements.py` | DB improvements |
| 0006 | `0006_token_blacklist.py` | JWT token blacklist table |
| 0007 | `0007_multi_platform_support.py` | Multi-platform device support |
| 0008 | `0008_firmware_signature_metadata.py` | Firmware signature metadata |

**Alembic imports ALL `app.modules.*.model` modules** for metadata discovery. This is a critical dependency — removing any module model will break migrations.

### ORM Models (by location)

| Location | Models |
|----------|--------|
| `modules/auth/model.py` | User |
| `modules/devices/model.py` | Device |
| `modules/devices/model_device_types.py` | DeviceType |
| `modules/firmware/model.py` | Firmware |
| `modules/firmware/model_profiles.py` | FirmwareProfile |
| `modules/ota/model.py` | OtaJob |
| `modules/ota/model_campaigns.py` | OtaCampaign |
| `modules/telemetry/model.py` | Telemetry |
| `modules/telemetry/model_extended.py` | ExtendedTelemetry |
| `modules/tenants/model.py` | Tenant, ServicePlan, TenantDeviceMapping, TenantUser, PlanFeature |
| `modules/anomaly/model.py` | AnomalyEvent |
| `modules/audit/model.py` | AuditLog |
| `modules/projects/model.py` | Project, Page, Widget |
| `modules/alerts/model.py` | AlertEvent |
| `identity/persistence/token_blacklist.py` | BlacklistedToken |
| `device_registry/persistence/platform_models.py` | Platform |
| `tinyml_model_management/sqlalchemy_models.py` | (additional TinyML models) |

---

## 9. MQTT & Device Communication

### MQTT Subscriber (`backend/app/shared/infrastructure/messaging/mqtt_subscriber.py`)

**Class**: `MQTTSubscriber`

**Subscribed topics** (9 patterns):
```
aifom/+/telemetry          (legacy)
aifom/+/status             (legacy)
aifom/+/heartbeat          (legacy)
aifom/+/ota/result         (legacy)
devices/+/telemetry        (standard)
devices/+/status           (standard)
devices/+/heartbeat        (standard)
devices/+/events           (standard)
devices/+/ota/status       (standard)
```

**Message handling**:
- Messages queued non-blocking (`_on_message` → queue)
- Worker threads drain queue in batches (`_queue_worker` → `_process_batch`)
- Each handler validates device exists and tenant is active via `TenantDeviceMapping`
- Device status changes emit events to `device_status_bus` for SSE streaming

**Handlers**: `_handle_telemetry`, `_handle_status`, `_handle_heartbeat`, `_handle_events`, `_handle_ota_status`

### Device Status Event Bus (`backend/app/shared/infrastructure/messaging/device_status_events.py`)

**Class**: `DeviceStatusEventBus`
- Thread-safe fan-out pub/sub
- Bridges sync MQTT worker threads → async SSE handlers via `loop.call_soon_threadsafe()`
- Per-tenant filtering via `subscribe(tenant_id)` async generator

### mDNS Service (`backend/app/shared/infrastructure/messaging/mdns_service.py`)

Publishes MQTT broker address via mDNS for ESP32 auto-discovery.

---

## 10. Frontend API Surface

The frontend (`frontend/src/services/`) has these API client modules that correspond to backend endpoints:

| Frontend Service | Backend Endpoint(s) |
|-----------------|---------------------|
| `authApi.ts` | `/api/v1/auth/*` |
| `deviceApi.ts` | `/api/v1/devices/*`, `/api/v1/client/devices/*` |
| `firmwareApi.ts` | `/api/v1/firmware/*`, `/api/v1/client/firmware/*` |
| `otaApi.ts` | `/api/v1/ota/*`, `/api/v1/client/ota-jobs/*` |
| `telemetryApi.ts` | `/api/v1/telemetry/*`, `/api/v1/client/devices/*/telemetry` |
| `tenantAdminApi.ts` | `/api/v1/admin/*` |
| `platformApi.ts` | `/api/v1/admin/device-types/*`, platform endpoints |
| `clientApi.ts` | `/api/v1/client/*` (dashboard, me, features, plan, users, alerts, audit) |
| `modelApi.ts` | `/api/v1/anomaly/*` |
| `alertApi.ts` | `/api/v1/client/alerts/*` |
| `anomalyApi.ts` | `/api/v1/client/ai-events/*` |
| `systemApi.ts` | `/api/v1/debug/system-health` |
| `apiClient.ts` | Base Axios client with auth interceptor |

---

## 11. Testing Infrastructure

### Backend unit tests

- **File**: `backend/tests/test_api.py`
- **Framework**: pytest
- **Coverage**: Imports extensively from `app.modules.*`
- **Run**: `make test-api` (inside Docker container)

### Integration/E2E tests (`tester/`)

| Directory | Framework | Files |
|-----------|-----------|-------|
| `tester/api/` | pytest | 8 test files: health, auth, admin_tenants, tenant_isolation, devices, firmware, ota, telemetry, viewer_protection, alerts_anomaly |
| `tester/e2e/` | Playwright | 3 specs: admin_flow, ota_flow, tenant_flow |
| `tester/mqtt/` | pytest | 4 files: device_simulator, mqtt_connection, esp32_contract, ota_mqtt_publish |
| `tester/utils/` | — | api_client, assertions, auth, mqtt_client, test_data |

### CI/CD

| Workflow | Trigger | What it runs |
|----------|---------|-------------|
| `backend-ci.yml` | PR/push to `backend/**` | ruff lint, ruff format, pytest (offline) |
| `frontend-ci.yml` | PR/push to `frontend/**` | npm ci, tsc, vitest |
| `docker-build.yml` | PR/push to Dockerfiles/infra | compose validate, build backend+frontend images |

---

## 12. DevOps & Infrastructure

### Docker Compose files

| File | Services | Purpose |
|------|----------|---------|
| `docker-compose.dev.yml` | postgres (TimescaleDB), minio, mosquitto, api | Local development |
| `docker-compose.prod.yml` | Same + TLS, resource limits, read-only containers | Production |
| `docker-compose.ml.yml` | mlflow | ML experiment tracking |
| `docker-compose.observability.yml` | prometheus, grafana | Monitoring |

### Makefile targets

| Category | Targets |
|----------|---------|
| Dev stack | `dev-up`, `dev-down`, `dev-build`, `logs`, `api-shell`, `db-shell` |
| Simulator | `simulate-device`, `simulate-fleet`, `simulate-fleet-ota` |
| Demo | `demo-up`, `demo-down`, `demo-seed`, `demo-simulate`, `demo-reset` |
| Seeding | `seed-admin`, `seed-tenant-demo`, `seed-all` |
| Observability | `obs-up`, `obs-down` |
| Migrations | `migrate`, `migrate-current`, `migrate-new`, `migrate-stamp` |
| Quality | `test`, `test-api`, `test-web`, `lint`, `format` |

### Seed scripts

| Script | What it seeds |
|--------|--------------|
| `scripts/seed_admin.py` | admin@aifom.local user |
| `scripts/seed_demo.py` | 3 demo devices, firmware, OTA job |
| `scripts/seed_tenant_demo.py` | 2 tenants (Greenhouse Corp, SmartFactory Ltd), users, device assignments, GPIO capabilities |

---

## 13. Active TODOs & Known Issues

| Location | TODO/Issue | Severity |
|----------|-----------|----------|
| `router_client.py:892` | `TODO(security): replace host execution with a Docker sandbox for Arduino builds.` | Security (P1) |

No FIXME or HACK comments found in any backend file.

---

## 14. Legacy ↔ Bounded Context Dependency Matrix

This matrix shows which bounded contexts import from which legacy modules. **X** = direct import.

| Bounded Context | auth | devices | firmware | ota | telemetry | tenants | anomaly | audit | projects | alerts |
|----------------|------|---------|----------|-----|-----------|---------|---------|-------|----------|--------|
| **identity** | X | | | | | X | | X | | |
| **device_registry** | | X | | | X | | | X | | |
| **firmware_ota** | | X | X | X | | | | X | | |
| **telemetry** | | | | | X | | | X | | |
| **tenant_management** | X | X | X | X | X | X | X | X | X | |
| **project_dashboard** | X | | | | | | | X | X | |
| **tinyml_model_mgmt** | X | X | | | | | X | | | |
| **shared/mqtt_subscriber** | | X | | X | X | | | | | |

**Most coupled**: `tenant_management` (imports from 9 legacy modules)
**Least coupled**: `telemetry` (imports from 2 legacy modules)

---

## 15. P0/P1 Classification

Based on CLAUDE.md priorities and this code map:

### P0 — Must work for demo

| Area | Status | Notes |
|------|--------|-------|
| App starts locally | ✅ Working | `make dev-up` + Alembic migrations |
| Login works | ✅ Working | `/api/v1/auth/login` with cookie + token response |
| F5 does not log out | ✅ Working | HTTP-only cookies + refresh token rotation |
| Admin OTA Campaigns | ✅ Working | `/api/v1/ota/jobs` endpoints |
| Admin Audit Logs | ✅ Working | `/api/v1/admin/audit-logs` |
| Tenant OTA/Firmware | ✅ Working | `/api/v1/client/ota-jobs`, `/api/v1/client/firmware` |
| Tenant Audit Log | ✅ Working | `/api/v1/client/audit-logs` |
| Device online/offline | ✅ Working | MQTT heartbeat + presence monitor + SSE stream |
| MQTT/mDNS/simulator | ✅ Working | Mosquitto + mDNS + fleet simulator |
| No tenant data leakage | ⚠️ Verify | Tenant scoping via JWT → `tenant_id` resolution |
| No exposed secrets | ⚠️ Verify | Secret validation in `config.py`, but check `.env` files |

### P1 — Should have

| Area | Status | Notes |
|------|--------|-------|
| Loading/empty/error UI states | Partial | Frontend has `EmptyState`, `ErrorState`, `Skeleton` components |
| Basic validation | Partial | Pydantic schemas validate input, but coverage varies |
| Basic regression tests | Partial | `tester/` has API + E2E + MQTT tests, but `backend/tests/` is minimal |
| Demo seed data | ✅ Working | `scripts/seed_*.py` |
| README/demo instructions | Partial | `docs/demo/` exists |
| Defense documentation | Partial | `docs/thesis/` has 20 spec documents |

---

*This document is the authoritative baseline for the current backend implementation state. Update it after significant changes.*
