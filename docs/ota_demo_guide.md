# OTA Demo Guide (Small IoT MVP)

## Goal

Show tenant-scoped OTA update from UI/API to device via MQTT with persisted status.

## Steps

1. Start stack:
   - Backend API
   - Frontend
   - MQTT broker
   - MinIO (for firmware storage)
2. Ensure tenant has:
   - assigned device
   - `ota_update` feature enabled (Pro/admin config)
3. Upload firmware `.bin` in tenant UI (`/client/ota`) or API.
4. Create OTA job for own assigned device.
5. Observe MQTT `devices/{device_id}/ota` command.
6. Physical ESP32 performs update and publishes progress to `devices/{device_id}/ota/status`.
7. Verify OTA job status updates in tenant and admin views.

## Expected MQTT logs

Outbound from backend:
- `devices/{uid}/ota` with `job_id`, `firmware_version`, `firmware_url`, `checksum_sha256`.

Inbound from device:
- `devices/{uid}/ota/status` sequence:
  - `started`
  - `downloading` (progress milestones)
  - `applying`
  - `rebooting`
  - `success` or `failed`

## Expected ESP32 serial logs

- receives OTA command
- HTTP download starts
- checksum verification
- flash finalize
- reboot

## Expected UI status

- OTA job appears immediately with `sent`
- transitions with progress/status updates
- terminal state `success` or `failed`
- failure reason shown via message

## Troubleshooting

- Device not receiving OTA:
  - verify device subscribes `devices/{uid}/ota`
  - verify job publishes to same `uid`
- OTA stuck at `sent`:
  - device offline or not subscribed
- OTA failed with checksum:
  - uploaded binary mismatch/corruption
- Tenant cannot create OTA:
  - device not assigned to tenant
  - firmware owned by another tenant
  - tenant feature flag disables OTA
