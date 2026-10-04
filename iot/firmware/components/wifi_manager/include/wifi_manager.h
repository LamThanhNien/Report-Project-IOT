#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Bring up Wi-Fi in STA mode using the AIFOM Kconfig credentials.
 *
 * Idempotent. Returns ESP_OK once the station starts; connection itself is
 * asynchronous. Use wifi_manager_wait_connected() to block until DHCP
 * completes.
 */
esp_err_t wifi_manager_start(void);

/**
 * Block the caller until Wi-Fi reports "got IP", or until `timeout_ms`
 * elapses. Pass 0 to poll without waiting. Returns ESP_OK on connection,
 * ESP_ERR_TIMEOUT otherwise.
 */
esp_err_t wifi_manager_wait_connected(uint32_t timeout_ms);

/** Returns true if the station currently has an IP address. */
bool wifi_manager_is_connected(void);

#ifdef __cplusplus
}
#endif
