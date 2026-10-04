# Shared — Cross-Cutting Concerns

This package contains cross-cutting concerns shared across all bounded contexts.

## Layers

### `domain/`
- `events.py` — Domain event base classes for cross-context communication
- `exceptions.py` — Shared domain exceptions (EntityNotFoundError, etc.)
- `value_objects.py` — Shared value objects (DeviceUID, TenantSlug, SemVer)

### `application/`
- `unit_of_work.py` — Abstract Unit of Work interface
- `pagination.py` — Pagination helpers (Page, clamp_page_size)
- `errors.py` — Application error codes (ErrorCode enum)

### `infrastructure/`
- `db/base.py` — Re-exports from app.db.base (SQLAlchemy Base)
- `db/session.py` — Re-exports from app.db.session (SessionLocal, get_db)
- `config.py` — Re-exports from app.core.config (Settings)
- `logging.py` — Re-exports from app.core.logging
- `metrics.py` — Re-exports from app.core.metrics (Prometheus counters)

### `presentation/`
- `dependencies.py` — Shared FastAPI dependencies (auth, tenant checks)
- `error_handlers.py` — Domain exception → HTTP response translators

## Design Rules

1. **No framework imports in domain/** — domain/ must not import FastAPI, SQLAlchemy, Pydantic, MQTT, or MinIO.
2. **application/ may define interfaces** — but does not implement them.
3. **infrastructure/ implements adapters** — re-exports from existing app.core and app.db for backward compatibility.
4. **presentation/ owns FastAPI** — routers, schemas, dependencies, error handlers.

## Backward Compatibility

The infrastructure re-exports (config, session, metrics, etc.) allow bounded
contexts to import from `shared.infrastructure` instead of `app.core` / `app.db`.
Both paths work during the migration period.
