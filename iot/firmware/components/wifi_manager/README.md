# wifi_manager

Brings up the Wi-Fi STA interface and keeps it connected.

```c
esp_err_t wifi_manager_start(void);
esp_err_t wifi_manager_wait_connected(uint32_t timeout_ms);
bool      wifi_manager_is_connected(void);
```

Behaviour:

- Initialises `esp_netif`, the default event loop, and the Wi-Fi driver.
- Registers handlers for `WIFI_EVENT_STA_DISCONNECTED` and
  `IP_EVENT_STA_GOT_IP`.
- Reconnects with a 1-second back-off up to
  `CONFIG_AIFOM_WIFI_MAXIMUM_RETRY` attempts, then enters a 5-second back-off
  loop instead of giving up — so the device recovers automatically when the
  AP returns.
- Idempotent: calling `wifi_manager_start()` twice is a no-op.

Requires: `esp_wifi`, `esp_netif`, `esp_event`, `nvs_flash`.
