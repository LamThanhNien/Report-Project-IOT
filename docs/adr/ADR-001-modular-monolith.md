# ADR-001: Backend Architecture is Modular Monolith with Bounded Contexts

## Status

**Accepted** — 2026-05-27

## Context

AIFOM backend started as a flat modular monolith with modules under `backend/app/modules/`. As the codebase grew to 32 database tables and 7+ domain areas, we needed clearer domain boundaries without the operational complexity of microservices.

Key constraints:
- Solo developer / thesis project — cannot operate multiple deployables.
- IoT platform with MQTT, MinIO, PostgreSQL, TimescaleDB — already complex infrastructure.
- 86+ tests monkeypatch module-level functions — test compatibility is critical.
- TinyML is optional/academic — must not destabilize core IoT/OTA flow.

## Decision

**Backend architecture is Modular Monolith with DDD Bounded Contexts, NOT microservices.**

Specifically:
1. All bounded contexts deploy in a single FastAPI process.
2. Domain boundaries are enforced through folder structure and import discipline, not network.
3. Each bounded context follows Clean Architecture: `domain/`, `application/`, `infrastructure/`, `presentation/`.
4. Legacy modules (`app/modules/`) are preserved as compatibility wrappers.
5. Bounded context routers import from legacy modules via module reference (not adapter indirection) to preserve test monkeypatch compatibility.

## Consequences

### Positive
- Single deployable — simple Docker Compose setup.
- Clear domain boundaries without network overhead.
- All 86+ tests continue to pass unchanged.
- API paths preserved — no frontend changes needed.
- Incremental migration — each bounded context can be refactored independently.

### Negative
- Import discipline must be enforced manually (no compile-time boundary checks).
- Legacy modules still exist, creating dual code paths.
- Adapter layer cannot be used for monkeypatched functions.

### Neutral
- Future migration to microservices is possible by extracting bounded contexts into separate services.
- The `shared/` layer provides cross-cutting concerns without circular dependencies.

## Related

- 02_ARCHITECTURE.md — Full architecture specification
- 06_BACKEND_SERVICES_SPEC.md — Backend services specification
- AGENT_PROGRESS.md — Refactoring progress tracking
