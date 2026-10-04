# IoT

ESP32 edge firmware and MQTT examples for AIFOM small-project MVP.

```
iot/
├── firmware/         ESP-IDF firmware for ESP32
└── mqtt-examples/    MQTT payload examples
```

## Firmware

See `iot/firmware/README.md` for build/flash/OTA details.

## Physical device setup

Build and flash a physical ESP32, register its UID, assign it to a tenant,
and configure its MQTT credentials. See [firmware setup](../docs/esp32_firmware_setup.md)
and [LAN/mDNS setup](../docs/esp32_physical_demo_mdns.md). Live telemetry, command
results and OTA progress require a connected device.

## MQTT contract

| Topic | Direction | QoS | Description |
|-------|-----------|-----|-------------|
| `devices/{uid}/telemetry` | device → backend | 0 | Sensor data (temperature, humidity, etc.) |
| `devices/{uid}/status` | device → backend | 1 | Online/offline status (retained, LWT) |
| `devices/{uid}/heartbeat` | device → backend | 1 | Periodic heartbeat with uptime |
| `devices/{uid}/events` | device → backend | 1 | Command results, alerts |
| `devices/{uid}/commands` | backend → device | 1 | GPIO control, status requests |
| `devices/{uid}/ota` | backend → device | 1 | OTA firmware update request |
| `devices/{uid}/ota/status` | device → backend | 1 | OTA progress/completion |

> Legacy prefix `aifom/devices/` is accepted for backward compatibility.

Virtual channels use `devices/{uid}/telemetry/ch_v{n}` for state and
`devices/{uid}/commands/ch_v{n}` for control. Automation evaluates telemetry
in the backend and sends commands through these existing device topics.
