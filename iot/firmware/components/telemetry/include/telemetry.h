#pragma once

#include <stdbool.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t telemetry_start(void);

esp_err_t telemetry_publish_once(void);

esp_err_t telemetry_publish_status_once(const char *status, const char *message);

void telemetry_set_output_state(bool relay_1, bool relay_2);

#ifdef __cplusplus
}
#endif
