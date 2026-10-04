#pragma once

#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Returns a pointer to a NUL-terminated device UID.
 *
 * If CONFIG_AIFOM_DEVICE_UID is set and non-empty, that value is returned.
 * Otherwise, the UID is derived from the chip's base MAC and looks like
 * "esp32-aabbccddeeff". The returned pointer is owned by this module and is
 * valid for the lifetime of the application.
 */
const char *device_identity_get_uid(void);

#ifdef __cplusplus
}
#endif
