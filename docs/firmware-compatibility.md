# Firmware Compatibility

AIFOM enforces firmware-device compatibility to prevent flashing firmware built for the wrong platform or model. This document describes the compatibility model, validation rules, and error handling.

## Compatibility Model

### Platform Targeting

Firmware is targeted at a specific platform (and optionally a specific model):

| Field | Required | Description |
|-------|----------|-------------|
| `target_device_type` | Yes | Legacy field for backward compat (e.g., "esp32-devkit-v1") |
| `target_platform_id` | No | UUID of target platform (new) |
| `target_model_id` | No | UUID of target model (new, null = all models on platform) |

### Validation Rules

1. **Universal firmware** (no `target_platform_id`): Compatible with all devices (backward compat)
2. **Platform-specific firmware** (`target_platform_id` set): Only compatible with devices on the same platform
3. **Model-specific firmware** (`target_platform_id` + `target_model_id` set): Only compatible with devices of the exact model

### Compatibility Matrix

| Firmware Target | Device Platform | Device Model | Compatible? |
|-----------------|-----------------|--------------|-------------|
| Universal | Any | Any | ✅ Yes |
| esp32_espidf | esp32_espidf | Any | ✅ Yes |
| esp32_espidf | esp8266_arduino | Any | ❌ No |
| esp32_espidf + Generic ESP32 | esp32_espidf | Generic ESP32 | ✅ Yes |
| esp32_espidf + Generic ESP32 | esp32_espidf | Custom ESP32 | ❌ No |

## API Validation

### OTA Job Creation

When creating an OTA job, the backend validates firmware-device compatibility:

**Admin endpoint**: `POST /api/v1/ota/jobs`
**Client endpoint**: `POST /api/v1/client/ota-jobs`

**Request**:
```json
{
  "device_uid": "esp32-001",
  "firmware_version_id": "uuid-of-firmware"
}
```

**Validation flow**:
1. Load firmware record
2. Load device record
3. Call `check_firmware_device_compatibility()`
4. If incompatible, return HTTP 422 with error details

**Error response** (incompatible):
```json
{
  "detail": {
    "code": "FIRMWARE_INCOMPATIBLE",
    "message": "Firmware platform 'ESP32 (ESP-IDF)' is not compatible with device platform 'ESP8266 (Arduino)'",
    "details": {
      "firmware_id": "uuid",
      "firmware_platform_id": "uuid",
      "device_platform_id": "uuid"
    }
  }
}
```

### Firmware Upload

When uploading firmware, specify the target platform:

**Admin endpoint**: `POST /api/v1/firmware`
**Client endpoint**: `POST /api/v1/client/firmware`

**Form fields**:
| Field | Required | Description |
|-------|----------|-------------|
| file | Yes | Firmware binary (.bin) |
| version | Yes | SemVer version string |
| target_device_type | Yes | Legacy device type string |
| target_platform_key | No | Platform key (e.g., "esp32_espidf") |
| target_model_key | No | Model key (e.g., "generic_esp32") |
| release_notes | No | Release notes |

## Tenant UI Behavior

### Firmware List Filtering

In the tenant firmware list (`GET /api/v1/client/firmware`):
- If `platform_key` query param is provided, only return firmware for that platform
- If device_uid is in context, filter to show only compatible firmware

### OTA Creation

When creating an OTA job from the tenant UI:
1. User selects a device
2. UI fetches compatible firmware (filtered by device's platform)
3. User selects firmware from filtered list
4. Backend validates compatibility on submit

### Disabled States

If a device's platform does not support OTA:
- OTA button is disabled
- Tooltip shows "This device platform does not support OTA updates"

## Migration

### Backfilling Existing Data

Migration `0007_multi_platform_support.py` backfills:
- Existing devices with `hardware_model ILIKE '%esp32%'` → platform `esp32_espidf`, model `Generic ESP32`
- Existing firmware with `target_device_type ILIKE '%esp32%'` → platform `esp32_espidf`

### Backward Compatibility

- `target_device_type` field is preserved and still required
- Firmware without `target_platform_id` is treated as universal (compatible with all devices)
- Existing ESP32 flows continue to work unchanged

## Implementation Details

### Compatibility Check Function

```python
def check_firmware_device_compatibility(
    db: Session,
    firmware_platform_id: uuid.UUID | None,
    firmware_model_id: uuid.UUID | None,
    device_platform_id: uuid.UUID | None,
    device_model_id: uuid.UUID | None,
) -> tuple[bool, str | None]:
```

Returns `(is_compatible, error_message)`.

### Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `FIRMWARE_INCOMPATIBLE` | 422 | Firmware platform/model doesn't match device |
| `FIRMWARE_NOT_FOUND` | 404 | Firmware ID doesn't exist |
| `DEVICE_NOT_FOUND` | 404 | Device UID doesn't exist |
