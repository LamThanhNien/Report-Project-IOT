# config_manager

Immutable runtime view of the AIFOM Kconfig values.

```c
const aifom_config_t *aifom_config_get(void);
bool aifom_config_has_wifi_credentials(void);
```

`aifom_config_t` exposes:

- `wifi_ssid`, `wifi_password`, `wifi_max_retry`
- `enable_mdns_discovery`, `mdns_host`
- `mqtt_host`, `mqtt_port` (legacy host setting + MQTT port)
- `api_port`, `fallback_api_base_url`
- `telemetry_interval_ms`, `heartbeat_interval_ms`

Values come from `Kconfig.projbuild` → `sdkconfig` / `sdkconfig.defaults*`.
Edit `sdkconfig.defaults.local` (gitignored) for secrets.
