#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Start the OTA client.
 *
 * Subscribes to `devices/{uid}/ota` and runs every incoming
 * job: download via HTTP, stream SHA-256, write to the next OTA partition,
 * set boot partition, reboot. Progress is reported on
 * `devices/{uid}/ota/status` (started, downloading, applying,
 * rebooting, success, failed). Failure reports include an error_code.
 *
 * Also marks the currently-running image as valid (cancels the bootloader
 * rollback) once basic health is reached — call after MQTT is connected.
 */
esp_err_t ota_client_start(void);

/**
 * Tell the bootloader the currently running image is healthy. Safe to call
 * even when this firmware was not freshly OTA'd; it is a no-op in that case.
 */
void ota_client_mark_running_valid(void);

#ifdef __cplusplus
}
#endif
