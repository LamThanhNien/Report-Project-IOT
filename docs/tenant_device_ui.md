# Tenant Device UI

## Goal

The tenant device detail page gives customer users an operational view of their assigned device without exposing platform-internal admin data.

Route:

- Tenant UI: `/client/devices/:deviceUid`
- Tenant API: `GET /api/v1/client/devices/{device_uid}/detail`

## Page Sections

The tenant detail view should show:

- basic device information
  - name
  - device UID
  - hardware model
  - description
  - online/offline status
  - last seen
  - assigned project bindings
- live status
  - latest telemetry payload
  - MQTT or connection status when available
  - output states
  - sensor values
  - last telemetry timestamp
- project and widget bindings
  - project using the device
  - bound widgets
  - widget type
  - GPIO mapping
  - telemetry state or capability binding
  - duplicate GPIO warnings
- device control
  - request status
  - request telemetry
  - widget output controls when supported
  - reboot only when allowed by the tenant permission model
- firmware and OTA
  - current firmware version
  - tenant-accessible firmware list related to the device
  - OTA job history
  - latest OTA progress and status
  - entry point to create a new OTA campaign
- alerts
  - recent alerts
  - severity and timestamp
- activity timeline
  - recent commands
  - recent telemetry
  - recent OTA events
  - recent alerts

## UX Rules

- Keep the UI customer-friendly and operational.
- Hide platform debugging details that do not help the tenant run the device.
- Treat duplicate GPIO mappings as warnings so the tenant understands the conflict without being blocked from viewing the project.
- Tenant Owner has full operational permissions (commands, reboot, OTA). Viewer users may inspect data and telemetry but cannot send commands or mutate device settings.

## Data Sources

The tenant detail endpoint aggregates tenant-safe data from:

- assigned device record
- latest telemetry and recent telemetry samples
- project/widget/GPIO bindings for the device
- tenant-visible firmware list
- OTA jobs for the device
- tenant-visible alerts
- recent tenant audit activity related to the device

All data must remain tenant-scoped.

## Admin Relationship

The admin device and project views are not the source of truth for tenant pages. Tenant UX should use tenant-scoped APIs even when the admin UI shows similar concepts.
