# Legacy Modules

This package is a compatibility layer for older imports such as
`app.modules.devices.repository` and `app.modules.auth.model`.

Implementations have moved into `app.bounded_contexts/*` or `app.shared/*`.
Do not add new behavior here. New feature work should go into the matching
bounded context layer:

| Legacy module | New owner |
| --- | --- |
| `auth`, `users` | `bounded_contexts.identity` |
| `tenants` | `bounded_contexts.tenant_management` |
| `devices` | `bounded_contexts.device_registry` |
| `telemetry`, `alerts` | `bounded_contexts.telemetry` |
| `firmware`, `ota` | `bounded_contexts.firmware_ota` |
| `projects` | `bounded_contexts.project_dashboard` |
| `anomaly.model` | Historical database metadata only |
| `audit`, `debug` | `shared` |
