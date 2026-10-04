# Telemetry

Telemetry data ingest from MQTT, storage, and query APIs. Includes device health and status events.

## Layers

- **domain/** — Entities, value objects, domain events, repository interfaces
- **application/** — Use cases, command/query handlers
- **infrastructure/** — SQLAlchemy repository implementations, external adapters
- **presentation/** — FastAPI routers, Pydantic schemas, dependencies

## Database Tables

telemetry, device_health, device_status_events, telemetry_schemas

## Current Module

`app/modules/telemetry`

## Migration Status

**SKELETON** — directory structure created. Code will be migrated in future phases.
