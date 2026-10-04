# Bounded Contexts

This package contains the bounded contexts for the AIFOM modular monolith.

## Architecture

Each bounded context follows Clean Architecture with four layers:

```
context_name/
  domain/          — Entities, value objects, domain events, repository interfaces
  application/     — Use cases, command/query handlers, application services
  infrastructure/  — Repository implementations, external service adapters
  presentation/    — FastAPI routers, Pydantic schemas, dependencies
```

## Contexts

| Context | Responsibility | Current Module |
|---------|---------------|----------------|
| `identity` | Auth, users, roles, JWT | `modules/auth` |
| `tenant_management` | Tenants, plans, features, device assignment | `modules/tenants` |
| `device_registry` | Devices, device types, capabilities, presence | `modules/devices` |
| `telemetry` | Telemetry ingest, storage, queries | `modules/telemetry` |
| `firmware_ota` | Firmware versions, OTA jobs, campaigns, MinIO | `modules/firmware`, `modules/ota` |
| `project_dashboard` | Workspaces, device assignment, datastreams, command capabilities | `modules/projects` |
| `command_center` | Command templates, dispatch, ACK/retry | — |
| `rule_engine` | Automation triggers, conditions, command/alert actions | — |

## Design Rules

1. **Domain layer must not import** FastAPI, SQLAlchemy, Pydantic, MQTT, or MinIO.
2. **Application layer** may define use cases and port interfaces.
3. **Infrastructure layer** implements repositories and adapters using SQLAlchemy/MinIO/etc.
4. **Presentation layer** owns FastAPI routers, Pydantic schemas, and dependency injection.
5. **Cross-context communication** uses domain events defined in `shared/domain/events.py`.
6. **Direct cross-context imports** between domain/application layers are forbidden.
   Use events or query interfaces through the presentation layer.

## Migration Strategy

During the transition period:
- `app/modules/` continues to work unchanged.
- New code goes into `bounded_contexts/<context>/`.
- Routers in `app/api/v1/router.py` will gradually delegate to bounded context presentation layers.
- Operational API paths remain stable. Removed feature paths are covered by scope regression tests.
- `tinyml_model_management` and `api_docs` retain historical ORM metadata only; no active feature code remains.
