# IOT Small Project Audit (AIFOM)

Date: 2026-05-24  
Scope: IoT, MQTT, OTA, ESP32, tenant project flow for small IoT demo projects.

## Summary

Current codebase already has a strong base for multi-tenant backend and OTA upload/job creation, but the IoT runtime contract is not yet aligned to a lightweight, consistent small-project MVP.

Biggest blockers:
- MQTT topic convention is inconsistent across backend/components (`aifom/devices/...` vs `tenants/{tenant_id}/devices/...`).
- ESP32 firmware does not handle device commands (LED/relay control) yet.
- OTA status persistence does not include progress/detail levels expected by demo flow.
- Tenant dashboard/project widgets are functional but command semantics and capability defaults are not fully small-project-ready.

---

## Classification by Requested Area

## 1) ESP32 code
- Classification: **Partially implemented**
- Implemented:
  - Wi-Fi connect/reconnect (`wifi_manager`)
  - MQTT connect/reconnect (`aifom_mqtt`)
  - online/offline status (retained + LWT)
  - telemetry publishing
  - OTA request handling + download + checksum + flash + reboot
- Missing/Broken for MVP prompt:
  - No command subscriber for `set_output`, `toggle_output`, `request_status`, `request_telemetry`, `reboot`, `ota_update`
  - No LED/relay GPIO control flow
  - No command result publishing contract
  - OTA status does not publish progress percent

## 2) MQTT topic design
- Classification: **Broken**
- Current state:
  - Device uplink uses `aifom/devices/{uid}/...`
  - Command downlink from tenant UI uses `tenants/{tenant_id}/devices/{device_id}/commands`
- Issue:
  - Not one consistent convention across backend, firmware, simulator, tests.

## 3) telemetry flow
- Classification: **Partially implemented**
- Implemented:
  - MQTT subscriber ingests telemetry and stores metric rows.
  - Tenant can read telemetry for assigned devices.
- Gaps:
  - Payload contract differs from requested flat telemetry schema.
  - Primarily fake telemetry in firmware; no output state fields mapped to command actions.

## 4) device status flow
- Classification: **Partially implemented**
- Implemented:
  - online/offline and last_seen updates.
- Gaps:
  - Status payload richness (ip/rssi/free_heap/uptime/fw) not consistently stored/displayed.
  - Heartbeat topic is separate legacy path, increasing complexity.

## 5) LED/relay command flow
- Classification: **Partially implemented**
- Implemented:
  - API exists to publish command to MQTT after tenant checks.
  - Project widget command pipeline exists.
- Broken:
  - Firmware does not subscribe to command topic and cannot execute commands.
  - Command names currently skewed to `set_gpio` rather than requested small-MVP command set.

## 6) tenant device isolation
- Classification: **Implemented**
- Evidence:
  - `tenant_device_mappings` and tenant-scoped queries.
  - Tenant API validates device ownership for device detail/telemetry/commands/OTA.
  - Firmware visibility scoped by `uploaded_by_tenant_id`.
- Note:
  - Isolation is server-side (good), not just frontend filtering.

## 7) firmware upload flow
- Classification: **Implemented**
- Implemented:
  - Tenant upload `.bin`, checksum, object storage, listing.
  - Download endpoint with checksum headers.
- Needs simplification:
  - Source-code upload/compile paths are useful but beyond strict small-project MVP core.

## 8) OTA job flow
- Classification: **Partially implemented**
- Implemented:
  - Tenant creates OTA job for own device.
  - Firmware ownership check.
  - MQTT OTA request publish.
- Gaps:
  - OTA command payload keys not fully aligned to requested contract.
  - Status lifecycle mostly present but progress granularity not persisted.

## 9) OTA status reporting
- Classification: **Partially implemented**
- Implemented:
  - Subscriber consumes OTA result and updates job status.
- Missing:
  - `progress` persistence and display.
  - Separate OTA status topic contract (`.../ota/status`) not unified.

## 10) tenant project UI/device dashboard
- Classification: **Partially implemented**
- Implemented:
  - Tenant dashboard, devices page, project widgets, OTA page, firmware upload.
- Gaps:
  - Device command schema/topics not fully aligned with firmware/runtime.
  - Refresh stability risk due auth/route timing and feature loading transitions.
  - Needs clearer “small IoT dashboard” behavior around status + latest telemetry + control widgets.

## 11) tests/simulator
- Classification: **Partially implemented**
- Implemented:
  - API tests, MQTT tests, Playwright flows exist.
  - Simulators exist under `iot/simulator` and `tester/mqtt`.
- Gaps:
  - Tests and simulator use legacy topic/status values (`running`, `heartbeat`, etc.) not aligned with target contract.
  - Missing explicit contract/schema tests for telemetry/status/command/ota payloads.

## 12) documentation
- Classification: **Partially implemented**
- Implemented:
  - Many existing docs and demo scripts.
- Missing for this prompt:
  - Required docs do not yet exist with requested names/content:
    - `docs/iot_small_project_flow.md`
    - `docs/mqtt_protocol.md`
    - `docs/esp32_firmware_setup.md`
    - `docs/ota_demo_guide.md`

---

## Over-scoped / Needs Simplification

- **Over-scoped**
  - Some SaaS/advanced feature surface (plan/billing/anomaly breadth) is larger than needed for small-device MVP demo.
- **Needs simplification**
  - MQTT contract should be a single simple convention.
  - Capability model should default to practical small-project controls/sensors.
  - UI should prioritize tenant demo tasks (device status, telemetry cards, relay/LED control, OTA) over broader platform noise.

---

## Priority Fix Order

1. Unify MQTT topics + payload contracts (backend + firmware + simulator + tests).  
2. Implement firmware command handling + output control + command result events.  
3. Add OTA progress/status persistence + tenant/admin visibility.  
4. Stabilize tenant dashboard refresh/loading/error/empty states.  
5. Update simulator/tests/docs to match final MVP contract.
