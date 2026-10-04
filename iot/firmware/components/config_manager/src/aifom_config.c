#include "aifom_config.h"

#include <stdbool.h>
#include <string.h>

#include "sdkconfig.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "esp_log.h"

static const char *TAG = "aifom_config";

static aifom_config_t s_config = {
    .wifi_ssid             = CONFIG_AIFOM_WIFI_SSID,
    .wifi_password         = CONFIG_AIFOM_WIFI_PASSWORD,
    .wifi_max_retry        = CONFIG_AIFOM_WIFI_MAXIMUM_RETRY,
    .enable_mdns_discovery = CONFIG_AIFOM_ENABLE_MDNS_DISCOVERY,
    .mdns_host             = CONFIG_AIFOM_MDNS_HOST,
    .mqtt_host             = CONFIG_AIFOM_MQTT_HOST,
    .mqtt_scheme           = CONFIG_AIFOM_MQTT_SCHEME,
    .mqtt_port             = CONFIG_AIFOM_MQTT_PORT,
    .mqtt_username         = CONFIG_AIFOM_MQTT_USERNAME,
    .mqtt_password         = CONFIG_AIFOM_MQTT_PASSWORD,
    .provisioning_token    = CONFIG_AIFOM_PROVISIONING_TOKEN,
    .api_port              = CONFIG_AIFOM_API_PORT,
    .fallback_api_base_url = CONFIG_AIFOM_FALLBACK_API_BASE_URL,
    .telemetry_interval_ms = CONFIG_AIFOM_TELEMETRY_INTERVAL_MS,
    .heartbeat_interval_ms = CONFIG_AIFOM_HEARTBEAT_INTERVAL_MS,
};

static char s_dynamic_mqtt_username[128] = {0};
static char s_dynamic_mqtt_password[128] = {0};
static bool s_nvs_loaded = false;

static void load_mqtt_credentials_from_nvs(void)
{
    nvs_handle_t my_handle;
    esp_err_t err = nvs_open("aifom", NVS_READONLY, &my_handle);
    if (err == ESP_OK) {
        size_t required_size = sizeof(s_dynamic_mqtt_username);
        err = nvs_get_str(my_handle, "mqtt_user", s_dynamic_mqtt_username, &required_size);
        if (err == ESP_OK) {
            s_config.mqtt_username = s_dynamic_mqtt_username;
            ESP_LOGI(TAG, "Loaded mqtt_user from NVS: %s", s_dynamic_mqtt_username);
        }

        required_size = sizeof(s_dynamic_mqtt_password);
        err = nvs_get_str(my_handle, "mqtt_pass", s_dynamic_mqtt_password, &required_size);
        if (err == ESP_OK) {
            s_config.mqtt_password = s_dynamic_mqtt_password;
            ESP_LOGI(TAG, "Loaded mqtt_pass from NVS");
        }
        nvs_close(my_handle);
    } else {
        ESP_LOGI(TAG, "No NVS credentials found (err %d), using defaults", err);
    }
}

const aifom_config_t *aifom_config_get(void)
{
    if (!s_nvs_loaded) {
        s_nvs_loaded = true;
        load_mqtt_credentials_from_nvs();
    }
    return &s_config;
}

bool aifom_config_has_wifi_credentials(void)
{
    return s_config.wifi_ssid != NULL && s_config.wifi_ssid[0] != '\0';
}

esp_err_t aifom_config_save_mqtt_credentials(const char *username, const char *password)
{
    if (username == NULL || password == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    nvs_handle_t my_handle;
    esp_err_t err = nvs_open("aifom", NVS_READWRITE, &my_handle);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Error opening NVS namespace 'aifom' (err %d)", err);
        return err;
    }

    err = nvs_set_str(my_handle, "mqtt_user", username);
    if (err == ESP_OK) {
        err = nvs_set_str(my_handle, "mqtt_pass", password);
    }

    if (err == ESP_OK) {
        err = nvs_commit(my_handle);
    }
    nvs_close(my_handle);

    if (err == ESP_OK) {
        strncpy(s_dynamic_mqtt_username, username, sizeof(s_dynamic_mqtt_username) - 1);
        s_dynamic_mqtt_username[sizeof(s_dynamic_mqtt_username) - 1] = '\0';
        s_config.mqtt_username = s_dynamic_mqtt_username;

        strncpy(s_dynamic_mqtt_password, password, sizeof(s_dynamic_mqtt_password) - 1);
        s_dynamic_mqtt_password[sizeof(s_dynamic_mqtt_password) - 1] = '\0';
        s_config.mqtt_password = s_dynamic_mqtt_password;

        s_nvs_loaded = true;
        ESP_LOGI(TAG, "Saved and updated MQTT credentials: %s", username);
    } else {
        ESP_LOGE(TAG, "Failed to save MQTT credentials to NVS (err %d)", err);
    }

    return err;
}
