# ESP32 Firmware Setup (AIFOM MVP)

## Prerequisites

- ESP-IDF v5.1+ installed
- Python + build toolchain from ESP-IDF installer
- MQTT broker running (`mosquitto`)
- Backend API running (for device register + OTA binary download)

## Configure device

1. Open `iot/firmware`.
2. Set config using either:
   - `idf.py menuconfig` (`AIFOM Edge Node` section), or
   - `sdkconfig.defaults.local`.

Required values:
- Wi-Fi SSID/password
- mDNS host (`CONFIG_AIFOM_MDNS_HOST`, default `aifom.local`)
- MQTT port
- Device UID (`CONFIG_AIFOM_DEVICE_UID`) or leave blank for MAC-derived UID.

Recommended local-demo config (mDNS service discovery):

```ini
CONFIG_AIFOM_ENABLE_MDNS_DISCOVERY=y
CONFIG_AIFOM_MDNS_HOST="aifom.local"
CONFIG_AIFOM_MQTT_PORT=1883
CONFIG_AIFOM_API_PORT=8000
```

MQTT discovery uses `_aifom-mqtt._tcp.local` first, then `_mqtt._tcp.local`.
Do not put a fixed PC IP in firmware config for normal local demos.

## Build and flash

```bash
cd iot/firmware
idf.py set-target esp32
idf.py build
idf.py -p COM5 flash
idf.py -p COM5 monitor
```

Replace `COM5` with actual serial port.

## Register device in backend

```bash
curl -X POST http://localhost:8000/api/v1/devices/register \
  -H "Content-Type: application/json" \
  -d "{\"device_uid\":\"esp32-demo-001\",\"name\":\"ESP32 Demo Node\",\"firmware_version\":\"1.0.0\"}"
```

Assign device to tenant from admin API/UI before tenant usage.

## MQTT behavior

Device publishes:
- `devices/{uid}/status`
- `devices/{uid}/telemetry`
- `devices/{uid}/events`
- `devices/{uid}/ota/status`

Device subscribes:
- `devices/{uid}/commands`
- `devices/{uid}/ota`

## Command support

- `set_output`
- `toggle_output`
- `request_status`
- `request_telemetry`
- `reboot`
- `ota_update`

## OTA demo readiness checks

Serial monitor should show:
- Wi-Fi connected
- mDNS service discovery logs for `_aifom-mqtt._tcp.local`
- MQTT connected
- OTA topic subscription active
- periodic telemetry/status publish logs

Backend should show:
- device `online`
- telemetry rows increasing
