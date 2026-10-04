# Device Platforms

AIFOM supports multiple WiFi-capable device types through a capability-driven platform model. This document describes the platform hierarchy, supported platforms, and how to add new device types.

## Platform Hierarchy

```
DevicePlatform (SDK/toolchain level)
  └── DeviceModel (specific hardware board)
        └── CapabilityTemplate (reusable capability definitions)
              └── DeviceCapability (per-device instance)

TenantProject (dashboards)
  └── ProjectWidget (dashboard widgets)
        └── TenantDatastream (Virtual Pin V0-V255 mapping)
              └── DatastreamTemplateCompatibility (model compatibility whitelist)
```

### DevicePlatform

Represents an SDK/toolchain combination. Each platform defines:
- **key**: Unique identifier (e.g., `esp32_espidf`)
- **name**: Human-readable name
- **sdk_toolchain**: Build toolchain (e.g., `esp-idf`, `arduino-esp8266`)
- **Capability flags**: What this platform can do

#### Capability Flags

| Flag | Description |
|------|-------------|
| `wifi_required` | Device must have WiFi connectivity |
| `supports_mqtt` | Platform supports MQTT protocol |
| `supports_ota` | Platform supports over-the-air firmware updates |
| `supports_gpio_config` | Platform supports GPIO pin configuration |

### DeviceModel

A specific hardware board within a platform. Each model defines:
- **key**: Unique identifier within platform (e.g., `generic_esp32`)
- **gpio_pins_json**: GPIO pin configuration for this board
- **default_capabilities_json**: Default capabilities for devices of this model

#### GPIO Pin Configuration

```json
{
  "min": 0,
  "max": 39,
  "reserved": [6, 7, 8, 9, 10, 11, 34, 35, 36, 39],
  "bootstraps": [0, 1, 3, 5, 12],
  "output_capable": [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33]
}
```

### CapabilityTemplate

Reusable capability definitions for a device model. When a device is registered with a model, these templates can auto-populate the device's capabilities.

## Supported Platforms

### ESP32 (ESP-IDF)

| Property | Value |
|----------|-------|
| Key | `esp32_espidf` |
| SDK | ESP-IDF |
| WiFi | ✅ |
| MQTT | ✅ |
| OTA | ✅ |
| GPIO | ✅ |

**Models**: Generic ESP32 (ESP32-WROOM-32 DevKit V1)

**Default Capabilities**: Relay 1 (GPIO 25), Relay 2 (GPIO 26), Built-in LED (GPIO 2), Digital Output 1 (GPIO 13), Digital Output 2 (GPIO 14), Analog Input 1 (GPIO 34), Analog Input 2 (GPIO 35), Temperature sensor, Humidity sensor

### ESP8266 (Arduino)

| Property | Value |
|----------|-------|
| Key | `esp8266_arduino` |
| SDK | Arduino-ESP8266 |
| WiFi | ✅ |
| MQTT | ✅ |
| OTA | ✅ |
| GPIO | ✅ |

**Models**: NodeMCU ESP8266 (NodeMCU V3 with ESP-12E)

**Default Capabilities**: Built-in LED (GPIO 2), Relay 1 (GPIO 5), Digital Output 1 (GPIO 12), Temperature sensor

### Arduino WiFi

| Property | Value |
|----------|-------|
| Key | `arduino_wifi` |
| SDK | Arduino |
| WiFi | ✅ |
| MQTT | ✅ |
| OTA | ✅ |
| GPIO | ❌ |

**Models**: Arduino WiFi Generic

### Raspberry Pi Pico W

| Property | Value |
|----------|-------|
| Key | `rp2040_pico_w` |
| SDK | Arduino-Pico |
| WiFi | ✅ |
| MQTT | ✅ |
| OTA | ✅ |
| GPIO | ✅ |

**Models**: Raspberry Pi Pico W

### Linux WiFi Gateway

| Property | Value |
|----------|-------|
| Key | `linux_gateway` |
| SDK | Linux |
| WiFi | ✅ |
| MQTT | ✅ |
| OTA | ✅ |
| GPIO | ❌ |

**Models**: Linux WiFi Gateway

## API Endpoints

### Admin Endpoints

```
GET    /api/v1/admin/platforms                    # List all platforms
GET    /api/v1/admin/platforms/{id}               # Get platform details
POST   /api/v1/admin/platforms                    # Create platform

GET    /api/v1/admin/device-models                # List device models
GET    /api/v1/admin/device-models/{id}           # Get model details
POST   /api/v1/admin/device-models                # Create model

GET    /api/v1/admin/capability-templates         # List templates
GET    /api/v1/admin/capability-templates/{id}    # Get template details
POST   /api/v1/admin/capability-templates         # Create template
```

### Client Endpoints

```
GET    /api/v1/client/platforms                   # List available platforms
GET    /api/v1/client/device-models               # List available models
GET    /api/v1/client/device-models/{id}/capabilities  # List model capabilities
```

## Database Schema

### device_platforms

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| key | VARCHAR(64) | Unique platform identifier |
| name | VARCHAR(255) | Human-readable name |
| sdk_toolchain | VARCHAR(128) | Build toolchain |
| description | TEXT | Platform description |
| wifi_required | BOOLEAN | Requires WiFi |
| supports_mqtt | BOOLEAN | Supports MQTT |
| supports_ota | BOOLEAN | Supports OTA |
| supports_gpio_config | BOOLEAN | Supports GPIO config |

### device_models

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| platform_id | UUID | FK to device_platforms |
| key | VARCHAR(64) | Model identifier (unique per platform) |
| name | VARCHAR(255) | Human-readable name |
| description | TEXT | Model description |
| gpio_pins_json | JSONB | GPIO pin configuration |
| default_capabilities_json | JSONB | Default capabilities |

### capability_templates

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| device_model_id | UUID | FK to device_models |
| capability_key | VARCHAR(128) | Capability identifier |
| capability_type | VARCHAR(64) | Type (relay, led, sensor, etc.) |
| label | VARCHAR(255) | Display label |
| gpio_pin | INTEGER | GPIO pin number (nullable) |
| channel | VARCHAR(64) | Channel identifier (nullable) |
| command_name | VARCHAR(64) | MQTT command name |
| telemetry_state_key | VARCHAR(128) | Telemetry state key |
| is_bindable | BOOLEAN | Can bind to widgets |
| config_json | JSONB | Additional configuration |
