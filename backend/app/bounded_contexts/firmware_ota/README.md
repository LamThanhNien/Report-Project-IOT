# Firmware Ota

Firmware binary management, OTA campaigns, OTA jobs, and MinIO integration.

## Layers

- **domain/** — Entities, value objects, domain events, repository interfaces
- **application/** — Use cases, command/query handlers
- **infrastructure/** — SQLAlchemy repository implementations, external adapters
- **presentation/** — FastAPI routers, Pydantic schemas, dependencies

## Database Tables

firmware_versions, firmware_profiles, ota_jobs, ota_campaigns, ota_campaign_targets, ota_job_events

## Current Module

`app/modules/firmware, modules/ota`

## Migration Status

**SKELETON** — directory structure created. Code will be migrated in future phases.
