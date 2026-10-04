# MQTT Device Contract

This document describes the MQTT topic structure and message formats for AIFOM device communication.

## Topic Structure

### New Convention (Recommended)

```
devices/{device_uid}/telemetry      # Device → Server: sensor data
devices/{device_uid}/status         # Device → Server: online/offline/status
devices/{device_uid}/heartbeat      # Device → Server: keepalive
devices/{device_uid}/events         # Device → Server: device events
devices/{device_uid}/capabilities   # Device → Server: capability announcement
devices/{device_uid}/commands       # Server → Device: commands
devices/{device_uid}/commands/ack   # Device → Server: command acknowledgment
devices/{device_uid}/commands/ch_v{pin}  # Server → Device: Virtual Pin command
devices/{device_uid}/telemetry/ch_v{pin} # Device → Server: Virtual Pin state/telemetry
devices/{device_uid}/ota/status     # Device → Server: OTA progress
```

### Legacy Convention (Backward Compatible)

```
aifom/devices/{device_uid}/telemetry
aifom/devices/{device_uid}/status
aifom/devices/{device_uid}/heartbeat
aifom/devices/{device_uid}/events
aifom/devices/{device_uid}/capabilities
aifom/devices/{device_uid}/ota/result
aifom/devices/{device_uid}/ota/request
```

Both conventions are supported. New firmware should use the new convention.

## Message Formats

### Telemetry (`devices/{uid}/telemetry`)

**Direction**: Device → Server
**QoS**: 0

```json
{
  "schema_version": "1.0",
  "timestamp": "2026-05-30T10:00:00Z",
  "temperature": 25.5,
  "humidity": 60.2,
  "voltage": 3.3,
  "metrics": {
    "temperature": 25.5,
    "humidity": 60.2
  }
}
```

**Notes**:
- Numeric fields at top level are extracted as metrics
- `metrics` object is also processed
- Non-numeric fields are ignored for telemetry storage

### Status (`devices/{uid}/status`)

**Direction**: Device → Server
**QoS**: 1

```json
{
  "schema_version": "1.0",
  "status": "online",
  "firmware_version": "1.0.0",
  "ip": "192.168.1.100",
  "rssi": -55,
  "free_heap": 120000,
  "uptime_ms": 3600000
}
```

**Status values**: `online`, `offline`, `maintenance`

### Heartbeat (`devices/{uid}/heartbeat`)

**Direction**: Device → Server
**QoS**: 0

```json
{
  "schema_version": "1.0",
  "timestamp": "2026-05-30T10:00:00Z"
}
```

**Notes**: Simple keepalive. Server updates `last_seen_at`.

### Capabilities (`devices/{uid}/capabilities`)

**Direction**: Device → Server
**QoS**: 1

```json
{
  "schema_version": "1.0",
  "platform_key": "esp32_espidf",
  "model_key": "generic_esp32",
  "capabilities": [
    {
      "capability_key": "relay_1",
      "capability_type": "relay",
      "label": "Relay 1",
      "gpio_pin": 25,
      "command_name": "set_relay",
      "telemetry_state_key": "relay_1_state"
    },
    {
      "capability_key": "led_builtin",
      "capability_type": "led",
      "label": "Built-in LED",
      "gpio_pin": 2,
      "command_name": "set_led",
      "telemetry_state_key": "led_state"
    },
    {
      "capability_key": "temperature",
      "capability_type": "sensor",
      "label": "Temperature",
      "command_name": "get_temperature",
      "telemetry_state_key": "temperature"
    }
  ]
}
```

**Notes**:
- Device publishes this on boot or when capabilities change
- Server upserts capabilities in `device_capabilities` table
- Server updates device's `platform_id` and `device_model_id` if announced

### Commands (`devices/{uid}/commands`)

**Direction**: Server → Device
**QoS**: 1

```json
{
  "schema_version": "1.0",
  "command_id": "uuid",
  "command": "set_relay",
  "params": {
    "pin": 25,
    "state": true
  },
  "timestamp": "2026-05-30T10:00:00Z"
}
```

### Virtual Pin Channels (`devices/{uid}/commands/ch_v{pin}`)

**Direction**: Server → Device for commands; Device → Server on the matching
`telemetry/ch_v{pin}` topic for reported state and telemetry.

Virtual Pins are project-scoped Datastream templates. Their canonical channel is
`v0` through `v255`; the MQTT topic always uses `ch_v{pin}`. For example, a
command bound to Datastream `V2` for device `esp32-001` writes to
`devices/esp32-001/commands/ch_v2` and receives state from
`devices/esp32-001/telemetry/ch_v2`.

```json
{
  "schema_version": "1.0",
  "command_id": "uuid",
  "channel": "v2",
  "value": true,
  "timestamp": "2026-05-30T10:00:00Z"
}
```

During the compatibility window, devices may receive a raw scalar payload on
the same command topic. New firmware must support the JSON envelope and publish
the resulting value to the matching telemetry topic. `ch_2` is a legacy
physical/GPIO channel, not an alias for virtual `ch_v2`.

### Command Acknowledgment (`devices/{uid}/commands/ack`)

**Direction**: Device → Server
**QoS**: 1

```json
{
  "schema_version": "1.0",
  "command_id": "uuid",
  "status": "success",
  "message": null,
  "timestamp": "2026-05-30T10:00:01Z"
}
```

**Status values**: `success`, `error`, `unsupported`

### OTA Status (`devices/{uid}/ota/status`)

**Direction**: Device → Server
**QoS**: 1

```json
{
  "schema_version": "1.0",
  "job_id": "uuid",
  "status": "downloading",
  "progress": 50,
  "message": "Downloading firmware...",
  "timestamp": "2026-05-30T10:00:00Z"
}
```

**Status values**: `downloading`, `verifying`, `flashing`, `rebooting`, `success`, `failed`

### OTA Request (Server → Device)

**Direction**: Server → Device
**QoS**: 1

```json
{
  "job_id": "uuid",
  "firmware_version_id": "uuid",
  "firmware_version": "1.2.3",
  "firmware_url": "https://ota.local/api/v1/firmware/uuid/download",
  "download_url": "https://ota.local/api/v1/firmware/uuid/download",
  "checksum": "sha256-hex",
  "checksum_sha256": "sha256-hex",
  "force": false,
  "version": "1.2.3"
}
```

## Capability Announcement Flow

1. Device boots and connects to MQTT
2. Device publishes status (online)
3. Device publishes capabilities with platform/model info
4. Server processes capabilities message:
   - Updates device's `platform_id` and `device_model_id`
   - Upserts capabilities in `device_capabilities` table
5. UI can show device capabilities for commands and datastream bindings

## Backward Compatibility

- Legacy topic prefix `aifom/devices/` is still supported
- Legacy message formats are still parsed
- New firmware should use the new convention
- Existing ESP32 firmware continues to work without changes
