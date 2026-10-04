#include "aifom_config.h"
#include "aifom_mqtt.h"
#include "device_identity.h"
#include "driver/gpio.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "ota_client.h"
#include "telemetry.h"
#include "wifi_manager.h"

#include "cJSON.h"
#include <stdio.h>
#include <string.h>

static const char *TAG = "aifom_main";
static char s_commands_topic[96];
static bool s_relay_1 = false;
static bool s_relay_2 = false;

#define RELAY_1_GPIO 2
#define RELAY_2_GPIO 4

static void init_nvs(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
}

static void init_output_pins(void)
{
    gpio_config_t io = {
        .pin_bit_mask = (1ULL << RELAY_1_GPIO) | (1ULL << RELAY_2_GPIO),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    ESP_ERROR_CHECK(gpio_config(&io));
    gpio_set_level(RELAY_1_GPIO, 0);
    gpio_set_level(RELAY_2_GPIO, 0);
    telemetry_set_output_state(false, false);
}

static void apply_output_state(void)
{
    gpio_set_level(RELAY_1_GPIO, s_relay_1 ? 1 : 0);
    gpio_set_level(RELAY_2_GPIO, s_relay_2 ? 1 : 0);
    telemetry_set_output_state(s_relay_1, s_relay_2);
}

static void publish_command_result(
    const char *command_id,
    const char *type,
    const char *target,
    bool success,
    const char *message
)
{
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) return;
    cJSON_AddStringToObject(root, "event", "command_result");
    cJSON_AddStringToObject(root, "device_id", aifom_mqtt_device_uid());
    cJSON_AddStringToObject(root, "command_id", command_id != NULL ? command_id : "");
    cJSON_AddStringToObject(root, "type", type != NULL ? type : "");
    if (target != NULL && target[0] != '\0') {
        cJSON_AddStringToObject(root, "target", target);
    }
    cJSON_AddStringToObject(root, "status", success ? "success" : "failed");
    cJSON_AddStringToObject(root, "message", message != NULL ? message : "");
    cJSON_AddBoolToObject(root, "relay_1", s_relay_1);
    cJSON_AddBoolToObject(root, "relay_2", s_relay_2);
    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (json == NULL) return;
    (void)aifom_mqtt_publish_events(json, strlen(json));
    free(json);
}

static void handle_set_output(const char *command_id, const char *target, bool value)
{
    if (target == NULL) {
        publish_command_result(command_id, "set_output", "", false, "missing target");
        return;
    }
    if (strcmp(target, "relay_1") == 0) {
        s_relay_1 = value;
        apply_output_state();
        publish_command_result(command_id, "set_output", "relay_1", true, "relay_1 updated");
        telemetry_publish_once();
        telemetry_publish_status_once("online", "relay_1 changed");
        return;
    }
    if (strcmp(target, "relay_2") == 0) {
        s_relay_2 = value;
        apply_output_state();
        publish_command_result(command_id, "set_output", "relay_2", true, "relay_2 updated");
        telemetry_publish_once();
        telemetry_publish_status_once("online", "relay_2 changed");
        return;
    }
    publish_command_result(command_id, "set_output", target, false, "unknown target");
}

static void handle_toggle_output(const char *command_id, const char *target)
{
    if (target == NULL) {
        publish_command_result(command_id, "toggle_output", "", false, "missing target");
        return;
    }
    if (strcmp(target, "relay_1") == 0) {
        s_relay_1 = !s_relay_1;
        apply_output_state();
        publish_command_result(command_id, "toggle_output", "relay_1", true, "relay_1 toggled");
        telemetry_publish_once();
        return;
    }
    if (strcmp(target, "relay_2") == 0) {
        s_relay_2 = !s_relay_2;
        apply_output_state();
        publish_command_result(command_id, "toggle_output", "relay_2", true, "relay_2 toggled");
        telemetry_publish_once();
        return;
    }
    publish_command_result(command_id, "toggle_output", target, false, "unknown target");
}

static void on_command_message(const char *topic, int topic_len, const char *data, int data_len, void *ctx)
{
    (void)topic;
    (void)topic_len;
    (void)ctx;
    cJSON *root = cJSON_ParseWithLength(data, data_len);
    if (root == NULL) {
        return;
    }
    const cJSON *command_id_json = cJSON_GetObjectItemCaseSensitive(root, "command_id");
    const cJSON *legacy_request_id = cJSON_GetObjectItemCaseSensitive(root, "request_id");
    const cJSON *type_json = cJSON_GetObjectItemCaseSensitive(root, "type");
    const cJSON *legacy_command = cJSON_GetObjectItemCaseSensitive(root, "command");
    const cJSON *target_json = cJSON_GetObjectItemCaseSensitive(root, "target");
    const cJSON *value_json = cJSON_GetObjectItemCaseSensitive(root, "value");
    const cJSON *params_json = cJSON_GetObjectItemCaseSensitive(root, "params");

    const char *command_id = cJSON_IsString(command_id_json)
        ? command_id_json->valuestring
        : (cJSON_IsString(legacy_request_id) ? legacy_request_id->valuestring : "");
    const char *type = cJSON_IsString(type_json)
        ? type_json->valuestring
        : (cJSON_IsString(legacy_command) ? legacy_command->valuestring : "");
    const char *target = cJSON_IsString(target_json) ? target_json->valuestring : NULL;
    bool value = cJSON_IsBool(value_json) ? cJSON_IsTrue(value_json) : false;

    if (target == NULL && cJSON_IsObject(params_json)) {
        const cJSON *target_from_params = cJSON_GetObjectItemCaseSensitive(params_json, "target");
        const cJSON *value_from_params = cJSON_GetObjectItemCaseSensitive(params_json, "value");
        const cJSON *state_from_params = cJSON_GetObjectItemCaseSensitive(params_json, "state");
        const cJSON *channel_from_params = cJSON_GetObjectItemCaseSensitive(params_json, "channel");
        const cJSON *pin_from_params = cJSON_GetObjectItemCaseSensitive(params_json, "pin");
        if (cJSON_IsString(target_from_params)) {
            target = target_from_params->valuestring;
        } else if (cJSON_IsString(channel_from_params)) {
            target = channel_from_params->valuestring;
        } else if (cJSON_IsNumber(pin_from_params)) {
            if ((int)pin_from_params->valuedouble == RELAY_1_GPIO) target = "relay_1";
            if ((int)pin_from_params->valuedouble == RELAY_2_GPIO) target = "relay_2";
        }
        if (cJSON_IsBool(value_from_params)) {
            value = cJSON_IsTrue(value_from_params);
        } else if (cJSON_IsBool(state_from_params)) {
            value = cJSON_IsTrue(state_from_params);
        }
    }

    if (strcmp(type, "set_output") == 0 || strcmp(type, "set_gpio") == 0) {
        handle_set_output(command_id, target, value);
    } else if (strcmp(type, "toggle_output") == 0) {
        handle_toggle_output(command_id, target);
    } else if (strcmp(type, "request_status") == 0) {
        telemetry_publish_status_once("online", "status requested");
        publish_command_result(command_id, "request_status", "", true, "status published");
    } else if (strcmp(type, "request_telemetry") == 0) {
        telemetry_publish_once();
        publish_command_result(command_id, "request_telemetry", "", true, "telemetry published");
    } else if (strcmp(type, "reboot") == 0) {
        publish_command_result(command_id, "reboot", "", true, "rebooting");
        vTaskDelay(pdMS_TO_TICKS(300));
        esp_restart();
    } else if (strcmp(type, "ota_update") == 0) {
        publish_command_result(command_id, "ota_update", "", true, "ota_update accepted");
    } else if (strcmp(type, "rotate_mqtt_creds") == 0) {
        const cJSON *username_json = cJSON_GetObjectItemCaseSensitive(root, "username");
        if (username_json == NULL || !cJSON_IsString(username_json)) {
            username_json = cJSON_GetObjectItemCaseSensitive(root, "mqtt_username");
        }
        const cJSON *password_json = cJSON_GetObjectItemCaseSensitive(root, "password");
        if (password_json == NULL || !cJSON_IsString(password_json)) {
            password_json = cJSON_GetObjectItemCaseSensitive(root, "mqtt_password");
        }
        if (cJSON_IsObject(params_json)) {
            if (username_json == NULL || !cJSON_IsString(username_json)) {
                username_json = cJSON_GetObjectItemCaseSensitive(params_json, "username");
            }
            if (username_json == NULL || !cJSON_IsString(username_json)) {
                username_json = cJSON_GetObjectItemCaseSensitive(params_json, "mqtt_username");
            }
            if (password_json == NULL || !cJSON_IsString(password_json)) {
                password_json = cJSON_GetObjectItemCaseSensitive(params_json, "password");
            }
            if (password_json == NULL || !cJSON_IsString(password_json)) {
                password_json = cJSON_GetObjectItemCaseSensitive(params_json, "mqtt_password");
            }
        }

        if (cJSON_IsString(username_json) && cJSON_IsString(password_json)) {
            const char *username = username_json->valuestring;
            const char *password = password_json->valuestring;
            esp_err_t err = aifom_config_save_mqtt_credentials(username, password);
            if (err == ESP_OK) {
                ESP_LOGI(TAG, "Successfully rotated MQTT credentials. Saving to NVS and reconnecting...");
                publish_command_result(command_id, "rotate_mqtt_creds", "", true, "credentials rotated successfully");
                aifom_mqtt_reconnect();
            } else {
                ESP_LOGE(TAG, "Failed to save MQTT credentials to NVS: %d", err);
                publish_command_result(command_id, "rotate_mqtt_creds", "", false, "failed to save credentials to NVS");
            }
        } else {
            ESP_LOGW(TAG, "rotate_mqtt_creds command missing username or password");
            publish_command_result(command_id, "rotate_mqtt_creds", "", false, "missing username or password parameters");
        }
    } else {
        publish_command_result(command_id, type, target != NULL ? target : "", false, "unsupported command");
    }

    cJSON_Delete(root);
}

void app_main(void)
{
    ESP_LOGI(TAG, "AIFOM ESP32 node boot");
    init_nvs();
    init_output_pins();

    const char *uid = device_identity_get_uid();
    ESP_LOGI(TAG, "device_uid=%s", uid);

    if (!aifom_config_has_wifi_credentials()) {
        ESP_LOGE(TAG, "missing Wi-Fi credentials");
        while (true) {
            vTaskDelay(pdMS_TO_TICKS(10000));
        }
    }

    ESP_ERROR_CHECK(wifi_manager_start());
    while (wifi_manager_wait_connected(30000) != ESP_OK) {
        ESP_LOGW(TAG, "waiting for Wi-Fi...");
    }

    const aifom_config_t *cfg = aifom_config_get();
    if (cfg->enable_mdns_discovery && cfg->mdns_host != NULL && cfg->mdns_host[0] != '\0') {
        ESP_LOGI(TAG, "[API] Base URL: http://%s:%d", cfg->mdns_host, cfg->api_port);
    } else {
        ESP_LOGI(TAG, "[API] Base URL: %s", cfg->fallback_api_base_url);
    }

    ESP_ERROR_CHECK(aifom_mqtt_start());
    ESP_ERROR_CHECK(ota_client_start());
    ESP_ERROR_CHECK(telemetry_start());

    snprintf(s_commands_topic, sizeof(s_commands_topic), "devices/%s/commands", uid);
    ESP_ERROR_CHECK(aifom_mqtt_subscribe(s_commands_topic, 1, on_command_message, NULL));

    for (int i = 0; i < 30 && !aifom_mqtt_is_connected(); ++i) {
        vTaskDelay(pdMS_TO_TICKS(500));
    }
    ota_client_mark_running_valid();
    telemetry_publish_status_once("online", "boot complete");
    telemetry_publish_once();
    ESP_LOGI(TAG, "ready");
}
