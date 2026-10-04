# Firmware Module

Firmware version metadata, binary upload to MinIO, and download streaming
for the OTA flow.

## Tables

- `firmware_versions` — `id`, `version`, `target_device_type`, `file_name`,
  `object_key`, `file_size`, `checksum_sha256`, `release_notes`, `is_active`,
  `created_at`.

## Endpoints

- `POST /api/v1/firmware` — multipart upload. Form fields: `version`,
  `target_device_type`, optional `release_notes`. File field: `file`.
  Server-side: computes SHA-256, rejects empty files and files larger than
  `FIRMWARE_MAX_SIZE_MB` (default 32 MB), stores the binary in MinIO under
  `{target_device_type}/{version}/{uuid}-{filename}`, persists metadata.
- `GET /api/v1/firmware` — list metadata. Optional query: `target_device_type`,
  `limit`.
- `GET /api/v1/firmware/{firmware_id}` — fetch one record.
- `GET /api/v1/firmware/latest?target_device_type=esp32` — newest active
  record for that device type.
- `GET /api/v1/firmware/{firmware_id}/download` — streams the binary from
  MinIO as `application/octet-stream`. Response headers:
  - `Content-Disposition: attachment; filename="..."`.
  - `X-Firmware-Sha256: <hex>` — for clients that want to verify out-of-band.
  - `X-Firmware-Version: <version>`.
  - `Content-Length` when known.
  Used directly by the ESP32 OTA client via the `download_url` in the OTA
  request payload.

## Not implemented

- Firmware signing / signature verification.
- Delta OTA.
- Pre-signed download URLs.
- Bulk delete / retention policy.

## Tenant API

- `POST /api/v1/client/firmware` - tenant self-service upload for precompiled
  `.bin` firmware only. The backend validates non-empty size, max size, tenant
  ownership, SHA-256, and stores metadata with `uploaded_by_tenant_id`.
- `GET /api/v1/client/firmware` - tenant-visible firmware list; includes
  firmware uploaded by the tenant plus global admin firmware.
- `GET /api/v1/client/firmware/{firmware_id}` - tenant-scoped metadata.
- `GET /api/v1/client/firmware/{firmware_id}/download-url` - authenticated
  tenant download URL metadata. MinIO credentials are never exposed.
- `GET /api/v1/client/firmware/{firmware_id}/download` - tenant-scoped
  authenticated firmware binary download.
