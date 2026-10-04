# Tenant Management

Multi-tenant management: tenants, service plans, feature flags, device-to-tenant assignment.

## Layers

- **domain/** — Entities, value objects, domain events, repository interfaces
- **application/** — Use cases, command/query handlers
- **infrastructure/** — SQLAlchemy repository implementations, external adapters
- **presentation/** — FastAPI routers, Pydantic schemas, dependencies

## Database Tables

tenants, service_plans, tenant_feature_overrides, tenant_device_mappings

## Current Module

`app/modules/tenants`

## Migration Status

**SKELETON** — directory structure created. Code will be migrated in future phases.
