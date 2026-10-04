# ESP32 Firmware (AIFOM Small IoT MVP)

This firmware targets practical demo projects (LED/relay + basic sensors + OTA).

## Features

- Wi-Fi connect + reconnect
- mDNS-first broker/API host resolution (`aifom.local` for local demos)
- MQTT connect + reconnect
- Status publish (`online/offline`, firmware, RSSI, uptime, heap)
- Telemetry publish (temp/humidity/light/soil/battery/relay states)
- Command handling:
  - `set_output`
  - `toggle_output`
  - `request_status`
  - `request_telemetry`
  - `reboot`
  - `ota_update`
- Command result events publish
- OTA receive + download + file-size validation + checksum + flash + reboot
- OTA lifecycle publish with progress milestones and structured failure codes

## MQTT topics

- Publish:
  - `devices/{uid}/status`
  - `devices/{uid}/telemetry`
  - `devices/{uid}/events`
  - `devices/{uid}/ota/status`
- Subscribe:
  - `devices/{uid}/commands`
  - `devices/{uid}/ota`

## Build

```bash
cd iot/firmware
idf.py set-target esp32
idf.py build
idf.py -p COM5 flash
idf.py -p COM5 monitor
```

See `docs/esp32_firmware_setup.md` for full setup and demo steps.

## OTA status contract

The firmware subscribes to `devices/{uid}/ota`. OTA requests must include
`job_id`, `firmware_version`, `firmware_url` or `download_url`, and should
include `checksum_sha256` plus `file_size` or `size_bytes`.

The device publishes progress to `devices/{uid}/ota/status`:

```text
started -> downloading 25% -> downloading 50% -> downloading 75% ->
downloading 100% -> applying -> rebooting -> success
```

Failures publish `status=failed`, `message`, and one of these `error_code`
values: `download_failed`, `invalid_response`, `checksum_mismatch`,
`flash_write_failed`, `not_enough_space`, or `update_verification_failed`.
