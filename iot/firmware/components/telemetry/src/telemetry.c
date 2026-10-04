#include "telemetry.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "aifom_config.h"
#include "aifom_mqtt.h"
#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "telemetry";
static bool s_started = false;
static volatile bool s_relay_1 = false;
static volatile bool s_relay_2 = false;
static volatile int s_step = 0;

static double frand_in(double lo, double hi)
{
    const uint32_t r = esp_random();
    return lo + ((double)r / (double)UINT32_MAX) * (hi - lo);
}

static void format_timestamp_iso(char *out, size_t out_len)
{
    time_t now = time(NULL);
    struct tm tm_utc;
    gmtime_r(&now, &tm_utc);
    if (tm_utc.tm_year + 1900 >= 2024) {
        strftime(out, out_len, "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
        return;
    }
    int64_t uptime_us = esp_timer_get_time();
    snprintf(out, out_len, "uptime+%lld", (long long)(uptime_us / 1000000));
}

static int read_rssi(void)
{
    wifi_ap_record_t ap;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
        return ap.rssi;
    }
    return 0;
}

static const char *running_version(void)
{
    const esp_app_desc_t *desc = esp_app_get_description();
    return (desc != NULL && desc->version[0] != '\0') ? desc->version : "unknown";
}

static char *build_telemetry_payload(size_t *out_len)
{
    int step = s_step++;
    const double base_temp = 27.0 + sin(step / 8.0) * 2.0;
    const double base_hum = 65.0 + sin(step / 10.0) * 8.0;
    const double base_light = 350.0 + sin(step / 12.0) * 120.0;
    const double base_soil = 45.0 + sin(step / 14.0) * 8.0;
    const double battery = 3.85 + sin(step / 18.0) * 0.08;
    const int64_t uptime_ms = esp_timer_get_time() / 1000;
    const int rssi = read_rssi();
    const int free_heap = (int)esp_get_free_heap_size();

    const double temperature = base_temp + frand_in(-0.3, 0.3);
    const double humidity = base_hum + frand_in(-1.0, 1.0);
    const double light = base_light + frand_in(-10.0, 10.0);
    const double soil = base_soil + frand_in(-1.0, 1.0);

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) return NULL;

    char ts[32];
    format_timestamp_iso(ts, sizeof(ts));
    cJSON_AddStringToObject(root, "timestamp", ts);
    cJSON_AddStringToObject(root, "device_id", aifom_mqtt_device_uid());
    cJSON_AddStringToObject(root, "firmware_version", running_version());
    cJSON_AddNumberToObject(root, "uptime_ms", (double)uptime_ms);
    cJSON_AddNumberToObject(root, "rssi", (double)rssi);
    cJSON_AddNumberToObject(root, "free_heap", (double)free_heap);
    cJSON_AddNumberToObject(root, "temperature", temperature);
    cJSON_AddNumberToObject(root, "humidity", humidity);
    cJSON_AddNumberToObject(root, "light", light);
    cJSON_AddNumberToObject(root, "soil_moisture", soil);
    cJSON_AddNumberToObject(root, "battery_level", battery);
    cJSON_AddBoolToObject(root, "relay_1", s_relay_1);
    cJSON_AddBoolToObject(root, "relay_2", s_relay_2);

    cJSON *metrics = cJSON_AddObjectToObject(root, "metrics");
    if (metrics == NULL) {
        cJSON_Delete(root);
        return NULL;
    }
    cJSON_AddNumberToObject(metrics, "uptime_ms", (double)uptime_ms);
    cJSON_AddNumberToObject(metrics, "rssi", (double)rssi);
    cJSON_AddNumberToObject(metrics, "free_heap", (double)free_heap);
    cJSON_AddNumberToObject(metrics, "temperature", temperature);
    cJSON_AddNumberToObject(metrics, "humidity", humidity);
    cJSON_AddNumberToObject(metrics, "light", light);
    cJSON_AddNumberToObject(metrics, "soil_moisture", soil);
    cJSON_AddNumberToObject(metrics, "battery_level", battery);
    cJSON_AddNumberToObject(metrics, "relay_1", s_relay_1 ? 1.0 : 0.0);
    cJSON_AddNumberToObject(metrics, "relay_2", s_relay_2 ? 1.0 : 0.0);

    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (json != NULL && out_len != NULL) {
        *out_len = strlen(json);
    }
    return json;
}

static char *build_status_payload(const char *status, const char *message, size_t *out_len)
{
    const int64_t uptime_ms = esp_timer_get_time() / 1000;
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) return NULL;

    char ts[32];
    format_timestamp_iso(ts, sizeof(ts));
    cJSON_AddStringToObject(root, "timestamp", ts);
    cJSON_AddStringToObject(root, "device_id", aifom_mqtt_device_uid());
    cJSON_AddStringToObject(root, "status", status != NULL ? status : "online");
    cJSON_AddStringToObject(root, "firmware_version", running_version());
    cJSON_AddStringToObject(root, "ip", "0.0.0.0");
    cJSON_AddNumberToObject(root, "rssi", (double)read_rssi());
    cJSON_AddNumberToObject(root, "uptime_ms", (double)uptime_ms);
    cJSON_AddNumberToObject(root, "free_heap", (double)esp_get_free_heap_size());
    if (message != NULL && message[0] != '\0') {
        cJSON_AddStringToObject(root, "message", message);
    }

    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (json != NULL && out_len != NULL) {
        *out_len = strlen(json);
    }
    return json;
}

esp_err_t telemetry_publish_once(void)
{
    if (!aifom_mqtt_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }
    size_t len = 0;
    char *json = build_telemetry_payload(&len);
    if (json == NULL) {
        return ESP_ERR_NO_MEM;
    }
    esp_err_t err = aifom_mqtt_publish_telemetry(json, len);
    free(json);
    return err;
}

esp_err_t telemetry_publish_status_once(const char *status, const char *message)
{
    if (!aifom_mqtt_is_connected()) {
        return ESP_ERR_INVALID_STATE;
    }
    size_t len = 0;
    char *json = build_status_payload(status, message, &len);
    if (json == NULL) {
        return ESP_ERR_NO_MEM;
    }
    esp_err_t err = aifom_mqtt_publish_status(json, len);
    free(json);
    return err;
}

void telemetry_set_output_state(bool relay_1, bool relay_2)
{
    s_relay_1 = relay_1;
    s_relay_2 = relay_2;
}

static void telemetry_task(void *arg)
{
    (void)arg;
    const aifom_config_t *cfg = aifom_config_get();
    const TickType_t period = pdMS_TO_TICKS(cfg->telemetry_interval_ms);

    while (true) {
        if (aifom_mqtt_is_connected()) {
            esp_err_t err = telemetry_publish_once();
            if (err != ESP_OK) {
                ESP_LOGW(TAG, "telemetry publish failed err=%d", err);
            } else {
                ESP_LOGI(TAG, "telemetry published");
            }
        }
        vTaskDelay(period);
    }
}

static void status_task(void *arg)
{
    (void)arg;
    const aifom_config_t *cfg = aifom_config_get();
    const TickType_t period = pdMS_TO_TICKS(cfg->heartbeat_interval_ms);
    while (true) {
        if (aifom_mqtt_is_connected()) {
            telemetry_publish_status_once("online", "periodic status");

            // Also publish a lightweight heartbeat so the backend presence
            // monitor has a second signal path (status + heartbeat topics).
            const int64_t uptime_ms = esp_timer_get_time() / 1000;
            char hb_json[128];
            snprintf(hb_json, sizeof(hb_json),
                     "{\"device_id\":\"%s\",\"uptime_ms\":%lld}",
                     aifom_mqtt_device_uid(), (long long)uptime_ms);
            aifom_mqtt_publish_heartbeat(hb_json, strlen(hb_json));
        }
        vTaskDelay(period);
    }
}

esp_err_t telemetry_start(void)
{
    if (s_started) {
        return ESP_OK;
    }
    BaseType_t r1 = xTaskCreate(telemetry_task, "telemetry", 4096, NULL, 5, NULL);
    BaseType_t r2 = xTaskCreate(status_task, "status", 3072, NULL, 4, NULL);
    if (r1 != pdPASS || r2 != pdPASS) {
        ESP_LOGE(TAG, "task create failed (telemetry=%d status=%d)", (int)r1, (int)r2);
        return ESP_ERR_NO_MEM;
    }
    s_started = true;
    return ESP_OK;
}
