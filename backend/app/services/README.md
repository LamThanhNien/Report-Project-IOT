# Legacy Services

This package is a compatibility layer for older imports under `app.services`.

Implementations have moved to bounded-context infrastructure or shared
infrastructure:

| Legacy service | New owner |
| --- | --- |
| `minio_client` | `bounded_contexts.firmware_ota.infrastructure.storage` |
| `arduino_compiler` | `bounded_contexts.firmware_ota.infrastructure.compiler` |
| `device_presence_monitor` | `bounded_contexts.device_registry.infrastructure` |
| `mqtt_client`, `mqtt_publisher`, `mqtt_subscriber`, `mqtt_topics` | `shared.infrastructure.messaging` |

Do not add new behavior here. Keep this package only while tests, seed scripts,
or external callers still import legacy paths.
