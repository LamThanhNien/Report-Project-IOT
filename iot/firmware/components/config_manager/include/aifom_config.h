#pragma once

#include <stdbool.h>
#include <stdint.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    const char *wifi_ssid;
    const char *wifi_password;
    int         wifi_max_retry;

    bool        enable_mdns_discovery;
    const char *mdns_host;

    const char *mqtt_host;
    const char *mqtt_scheme;
    int         mqtt_port;
    const char *mqtt_username;
    const char *mqtt_password;
    int         api_port;
    const char *fallback_api_base_url;

    const char *provisioning_token;
    uint32_t    telemetry_interval_ms;
    uint32_t    heartbeat_interval_ms;
} aifom_config_t;

/** Returns the immutable configuration loaded from Kconfig. */
const aifom_config_t *aifom_config_get(void);

/** Returns true if mandatory Wi-Fi credentials are set. */
bool aifom_config_has_wifi_credentials(void);

/** Saves MQTT credentials to NVS and updates config in RAM. */
esp_err_t aifom_config_save_mqtt_credentials(const char *username, const char *password);

#ifdef __cplusplus
}
#endif
