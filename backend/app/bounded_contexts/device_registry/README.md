# Device Registry

Device registration, device types, device capabilities, credentials, and presence monitoring.

## Layers

- **domain/** — Entities, value objects, domain events, repository interfaces
- **application/** — Use cases, command/query handlers
- **infrastructure/** — SQLAlchemy repository implementations, external adapters
- **presentation/** — FastAPI routers, Pydantic schemas, dependencies

## Database Tables

devices, device_types, device_capabilities, device_credentials

## Current Module

`app/modules/devices`

## Migration Status

**SKELETON** — directory structure created. Code will be migrated in future phases.
