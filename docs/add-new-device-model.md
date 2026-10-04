# Adding a New Device Model

This guide walks through adding support for a new WiFi-capable device type to AIFOM.

## Prerequisites

- Device must support WiFi connectivity
- Device must support MQTT (for telemetry and commands)
- Device should support OTA updates (optional but recommended)
- You have compiled firmware binary (`.bin`) for the device

## Step 1: Create or Identify the Platform

If the device uses an existing platform (e.g., ESP32 with ESP-IDF), skip to Step 2.

### Create a new platform

```bash
curl -X POST http://localhost:8000/api/v1/admin/platforms \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "stm32_hal",
    "name": "STM32 (HAL)",
    "sdk_toolchain": "stm32cubeide",
    "description": "STM32 microcontrollers with HAL library",
    "wifi_required": true,
    "supports_mqtt": true,
    "supports_ota": true,
    "supports_gpio_config": true
  }'
```

### Platform key naming convention

- Use lowercase with underscores
- Format: `{mcu_family}_{sdk}`
- Examples: `esp32_espidf`, `esp8266_arduino`, `rp2040_pico_w`, `stm32_hal`

## Step 2: Create the Device Model

```bash
curl -X POST http://localhost:8000/api/v1/admin/device-models \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "platform_id": "uuid-of-platform",
    "key": "nucleo_f401re",
    "name": "STM32 Nucleo-F401RE",
    "description": "STM32 Nucleo board with WiFi shield",
    "gpio_pins_json": {
      "min": 0,
      "max": 15,
      "reserved": [13, 14],
      "bootstraps": [],
      "output_capable": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15]
    },
    "default_capabilities_json": [
      {
        "capability_key": "led_builtin",
        "capability_type": "led",
        "label": "Built-in LED",
        "gpio_pin": 13,
        "command_name": "set_led",
        "telemetry_state_key": "led_state"
      }
    ]
  }'
```

### GPIO Pin Configuration

| Field | Type | Description |
|-------|------|-------------|
| `min` | int | Lowest GPIO pin number |
| `max` | int | Highest GPIO pin number |
| `reserved` | int[] | Pins that cannot be used (flash, USB, etc.) |
| `bootstraps` | int[] | Pins used for boot mode selection |
| `output_capable` | int[] | Pins safe for digital output (null = all non-reserved) |

## Step 3: Create Capability Templates

```bash
curl -X POST http://localhost:8000/api/v1/admin/capability-templates \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "device_model_id": "uuid-of-model",
    "capability_key": "relay_1",
    "capability_type": "relay",
    "label": "Relay 1",
    "gpio_pin": 5,
    "command_name": "set_relay",
    "telemetry_state_key": "relay_1_state",
    "is_bindable": true
  }'
```

### Capability Types

| Type | Description | Widget Binding |
|------|-------------|----------------|
| `relay` | Relay output | Toggle switch, push button |
| `led` | LED output | Toggle switch, LED indicator |
| `digital_output` | Generic digital output | Toggle switch |
| `analog_input` | Analog sensor input | Gauge, chart, number card |
| `sensor` | Digital sensor | Text value, number card, chart |
| `pwm` | PWM output | Slider, knob dial |

## Step 4: Implement Device Firmware

Your firmware must:

1. **Connect to WiFi and MQTT**
2. **Publish status** on connect:
   ```
   Topic: devices/{device_uid}/status
   Payload: {"status": "online", "firmware_version": "1.0.0"}
   ```
3. **Publish capabilities** on boot:
   ```
   Topic: devices/{device_uid}/capabilities
   Payload: {"platform_key": "stm32_hal", "model_key": "nucleo_f401re", "capabilities": [...]}
   ```
4. **Handle commands** on `devices/{device_uid}/commands`
5. **Publish telemetry** on `devices/{device_uid}/telemetry`
6. **Optionally handle OTA** on `devices/{device_uid}/ota/status`

### Minimal MQTT Client Example (Pseudo-code)

```c
// On boot
mqtt_connect();
mqtt_publish("devices/" + device_uid + "/status", {"status": "online"});
mqtt_publish("devices/" + device_uid + "/capabilities", {
    "platform_key": "stm32_hal",
    "model_key": "nucleo_f401re",
    "capabilities": [
        {"capability_key": "led_builtin", "capability_type": "led", "label": "LED", "gpio_pin": 13, "command_name": "set_led"}
    ]
});
mqtt_subscribe("devices/" + device_uid + "/commands");

// Telemetry loop
every 5_seconds:
    mqtt_publish("devices/" + device_uid + "/telemetry", {"temperature": read_temp(), "humidity": read_humidity()});
```

## Step 5: Upload Firmware

```bash
curl -X POST http://localhost:8000/api/v1/firmware \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -F "file=@firmware.bin" \
  -F "version=1.0.0" \
  -F "target_device_type=stm32-nucleo-f401re" \
  -F "target_platform_key=stm32_hal" \
  -F "target_model_key=nucleo_f401re" \
  -F "release_notes=Initial release"
```

## Step 6: Test the Flow

1. Register a device with the new model
2. Device connects and publishes capabilities
3. Verify capabilities appear in the tenant UI
4. Create a widget bound to a capability
5. Send a command and verify device responds
6. Upload firmware and create OTA job
7. Verify OTA compatibility check works

## Troubleshooting

### Device capabilities not appearing

- Check MQTT topic format (must be `devices/{uid}/capabilities`)
- Check JSON payload is valid
- Check server logs for parsing errors

### OTA rejected with FIRMWARE_INCOMPATIBLE

- Verify firmware's `target_platform_id` matches device's `platform_id`
- If firmware has `target_model_id`, verify it matches device's `device_model_id`

### GPIO pins not showing in widget config

- Verify device model's `gpio_pins_json` is correct
- Check `output_capable` array includes the pins you want
- Verify pins are not in `reserved` or `bootstraps` arrays
