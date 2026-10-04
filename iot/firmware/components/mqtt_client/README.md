# mqtt_client component

Thin wrapper around ESP-IDF MQTT client.

## Provides

- mDNS MQTT service discovery (`_aifom-mqtt._tcp.local`, then `_mqtt._tcp.local`)
- connection lifecycle
- automatic reconnect
- topic builders for:
  - `devices/{uid}/telemetry`
  - `devices/{uid}/status`
  - `devices/{uid}/events`
  - `devices/{uid}/ota/status`
- subscription callback registry
