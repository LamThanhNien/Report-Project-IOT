#include "device_identity.h"

#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_mac.h"
#include "sdkconfig.h"

static const char *TAG = "device_identity";
static char s_uid[32];
static bool s_initialised = false;

const char *device_identity_get_uid(void)
{
    if (s_initialised) {
        return s_uid;
    }

    const char *configured = CONFIG_AIFOM_DEVICE_UID;
    if (configured != NULL && configured[0] != '\0') {
        strncpy(s_uid, configured, sizeof(s_uid) - 1);
        s_uid[sizeof(s_uid) - 1] = '\0';
        s_initialised = true;
        ESP_LOGI(TAG, "device_uid (configured) = %s", s_uid);
        return s_uid;
    }

    uint8_t mac[6] = {0};
    esp_err_t err = esp_read_mac(mac, ESP_MAC_WIFI_STA);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "esp_read_mac failed: %d", err);
        strcpy(s_uid, "esp32-unknown");
    } else {
        snprintf(s_uid, sizeof(s_uid), "esp32-%02x%02x%02x%02x%02x%02x",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    }

    s_initialised = true;
    ESP_LOGI(TAG, "device_uid (derived) = %s", s_uid);
    return s_uid;
}
