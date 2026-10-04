# OTA Module

Backend OTA lifecycle for small-project MVP.

## Status flow

`pending -> sent -> started|accepted -> downloading -> applying|flashing -> rebooting -> success|failed`

`ota_jobs` persists:
- status
- progress
- last_message
- error_message

## API

- `POST /api/v1/client/ota-jobs`
- `GET /api/v1/client/ota-jobs`
- `POST /api/v1/ota/jobs` (admin)
- `GET /api/v1/ota/jobs` (admin)

Tenant `POST /api/v1/client/ota-jobs` accepts exactly one target:
- `device_uid` for a single tenant-owned device.
- `group_id` for a tenant-owned device group; the backend expands the group
  into one OTA job per member device.

## MQTT topics

- backend -> device: `devices/{uid}/ota`
- device -> backend: `devices/{uid}/ota/status`

Request payload includes:
- `job_id`
- `firmware_version_id`
- `firmware_version`
- `firmware_url`
- `checksum`
- `checksum_sha256`
- `file_size`
- `size_bytes`

Device status payloads may include `phase` and `error_code`. Supported real
ESP32 failure codes are `download_failed`, `invalid_response`,
`checksum_mismatch`, `flash_write_failed`, `not_enough_space`, and
`update_verification_failed`.
- `force`
