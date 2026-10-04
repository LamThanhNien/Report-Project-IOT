# Mosquitto

Mosquitto runs as the local MQTT broker on `localhost:1883`.

Anonymous access is disabled. Set `MQTT_ADMIN_USER`, `MQTT_ADMIN_PASSWORD`,
`MQTT_DEVICE_USER`, and `MQTT_DEVICE_PASSWORD` in `.env`; startup fails if any
credential is missing.

Documented topic convention:

- `aifom/devices/{device_uid}/telemetry`
- `aifom/devices/{device_uid}/status`
- `aifom/devices/{device_uid}/heartbeat`
- `aifom/devices/{device_uid}/ota/result`
