# AIFOM Small IoT Project Flow

Project title: **Hệ thống quản lý thiết bị IoT biên với cập nhật firmware từ xa**

This project is intentionally scoped as a **lightweight IoT platform for small customer projects**, not an industrial SCADA platform.

## Target use cases

- Indoor LED ON/OFF control
- Indoor humidity/temperature monitor
- Small relay control panel
- Simple sensor dashboard
- ESP32 OTA firmware update
- Automation rule execution and alerts

## Admin flow

1. Admin creates a tenant/customer.
2. Admin creates tenant owner account.
3. Admin creates/registers device.
4. Admin assigns device to tenant.
5. Admin can view all devices and OTA jobs for debugging.

## Tenant flow

1. Tenant logs in to client workspace.
2. Tenant sees only assigned devices.
3. Tenant creates/edits small IoT project dashboard.
4. Tenant links widgets to assigned device capabilities.
5. Tenant controls relay/LED from widgets.
6. Tenant uploads firmware `.bin`.
7. Tenant creates OTA job for own device.
8. Tenant tracks OTA status and history.

## Device flow (physical ESP32)

1. Device connects Wi-Fi.
2. Device connects MQTT broker.
3. Device publishes `status` (online, firmware, rssi, uptime, heap).
4. Device publishes `telemetry` (temp/humidity/light/soil/battery/relay states).
5. Device subscribes `commands` and executes:
   - `set_output`
   - `toggle_output`
   - `request_status`
   - `request_telemetry`
   - `reboot`
   - `ota_update`
6. Device publishes command results to `events`.
7. Device receives OTA command from `ota`.
8. Device publishes OTA lifecycle to `ota/status`.

## MVP boundaries

- Keep capabilities practical and demo-friendly.
- Prioritize clear end-to-end flow over feature breadth.
- Tenant isolation is enforced in backend APIs and data layer.
