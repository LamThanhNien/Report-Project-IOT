#include "aifom_mqtt.h"

#include <stdio.h>
#include <string.h>

#include "aifom_config.h"
#include "device_identity.h"
#include "mdns.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/inet.h"
#include "mqtt_client.h"

static const char *TAG = "aifom_mqtt";
static const char *LWT_PAYLOAD = "{\"status\":\"offline\"}";

#define AIFOM_MAX_SUBSCRIPTIONS 4

typedef struct {
    const char *topic;
    int qos;
    aifom_mqtt_message_cb_t cb;
    void *ctx;
} aifom_mqtt_subscription_t;

static esp_mqtt_client_handle_t s_client = NULL;
static volatile bool s_connected = false;
static bool s_started = false;
static const char *s_uid = NULL;
static char s_resolved_broker_host[64];

static char s_topic_telemetry[96];
static char s_topic_status[96];
static char s_topic_heartbeat[96];
static char s_topic_events[96];
static char s_topic_ota_status[96];

static aifom_mqtt_subscription_t s_subs[AIFOM_MAX_SUBSCRIPTIONS];
static int s_sub_count = 0;

#define MDNS_RESOLVE_RETRIES 8
#define MDNS_RESOLVE_WAIT_MS 1500
#define MDNS_QUERY_TIMEOUT_MS 2000

static bool s_mdns_started = false;

static bool ensure_mdns_started(void)
{
    if (s_mdns_started) {
        return true;
    }

    esp_err_t err = mdns_init();
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "mDNS init failed err=%s", esp_err_to_name(err));
        return false;
    }

    const char *uid = device_identity_get_uid();
    if (uid != NULL && uid[0] != '\0') {
        (void)mdns_hostname_set(uid);
    }
    (void)mdns_instance_name_set("AIFOM ESP32");
    s_mdns_started = true;
    ESP_LOGI(TAG, "mDNS client san sang");
    return true;
}

static bool copy_first_ipv4(mdns_result_t *result, char *out_ip, size_t out_ip_len)
{
    for (mdns_ip_addr_t *addr = result != NULL ? result->addr : NULL; addr != NULL; addr = addr->next) {
        if (addr->addr.type == ESP_IPADDR_TYPE_V4 &&
            inet_ntop(AF_INET, &addr->addr.u_addr.ip4.addr, out_ip, out_ip_len) != NULL) {
            return true;
        }
    }
    return false;
}

static bool query_mqtt_service(
    const char *service,
    const char *proto,
    const char *service_label,
    char *out_host,
    size_t out_host_len,
    int *out_port
)
{
    mdns_result_t *results = NULL;
    esp_err_t err = mdns_query_ptr(service, proto, MDNS_QUERY_TIMEOUT_MS, 4, &results);
    if (err != ESP_OK || results == NULL) {
        if (results != NULL) {
            mdns_query_results_free(results);
        }
        return false;
    }

    bool ok = false;
    char ip[16] = {0};
    if (copy_first_ipv4(results, ip, sizeof(ip)) && results->port > 0) {
        strncpy(out_host, ip, out_host_len - 1);
        out_host[out_host_len - 1] = '\0';
        *out_port = results->port;
        ESP_LOGI(TAG, "Tim thay MQTT service: %s %s:%d", service_label, out_host, *out_port);
        ok = true;
    }

    mdns_query_results_free(results);
    return ok;
}

static bool resolve_mdns_hostname(const char *hostname, char *out_ip, size_t out_ip_len)
{
    struct esp_ip4_addr addr = {0};
    esp_err_t err = mdns_query_host_a(hostname, MDNS_QUERY_TIMEOUT_MS, &addr);
    if (err != ESP_OK || addr.addr == 0) {
        return false;
    }
    if (inet_ntop(AF_INET, &addr.addr, out_ip, out_ip_len) == NULL) {
        return false;
    }
    return true;
}

static bool resolve_broker_target(
    const aifom_config_t *cfg,
    char *out_host,
    size_t out_host_len,
    int *out_port
)
{
    out_host[0] = '\0';
    *out_port = cfg->mqtt_port;

    if (cfg->enable_mdns_discovery) {
        if (!ensure_mdns_started()) {
            ESP_LOGW(TAG, "mDNS init failed, trying hostname fallback");
        } else {
            for (int attempt = 1; attempt <= MDNS_RESOLVE_RETRIES; ++attempt) {
                ESP_LOGI(TAG,
                         "Dang query service _aifom-mqtt._tcp.local attempt %d/%d",
                         attempt,
                         MDNS_RESOLVE_RETRIES);
                if (query_mqtt_service(
                        "_aifom-mqtt",
                        "_tcp",
                        "_aifom-mqtt._tcp.local",
                        out_host,
                        out_host_len,
                        out_port
                    )) {
                    return true;
                }

                ESP_LOGW(TAG, "Khong thay _aifom-mqtt._tcp.local, thu _mqtt._tcp.local");
                if (query_mqtt_service(
                        "_mqtt",
                        "_tcp",
                        "_mqtt._tcp.local",
                        out_host,
                        out_host_len,
                        out_port
                    )) {
                    return true;
                }

                if (attempt < MDNS_RESOLVE_RETRIES) {
                    ESP_LOGW(TAG, "Khong thay MQTT service qua mDNS, thu lai sau %d ms", MDNS_RESOLVE_WAIT_MS);
                    vTaskDelay(pdMS_TO_TICKS(MDNS_RESOLVE_WAIT_MS));
                }
            }
            ESP_LOGW(TAG, "mDNS service discovery failed after %d attempts, trying hostname", MDNS_RESOLVE_RETRIES);
        }
    }

    // Fallback: resolve mdns_host (e.g. aifom.local) via mDNS hostname query
    if (cfg->mdns_host != NULL && cfg->mdns_host[0] != '\0') {
        char ip[16] = {0};
        ESP_LOGI(TAG, "Dang phan giai host %s ...", cfg->mdns_host);
        if (resolve_mdns_hostname(cfg->mdns_host, ip, sizeof(ip))) {
            strncpy(out_host, ip, out_host_len - 1);
            out_host[out_host_len - 1] = '\0';
            ESP_LOGI(TAG, "%s -> %s", cfg->mdns_host, ip);
            return true;
        }
        ESP_LOGW(TAG, "Khong phan giai duoc %s qua mDNS", cfg->mdns_host);
    }

    // Last resort: use mqtt_host from Kconfig directly (IP or DNS-resolvable hostname)
    if (cfg->mqtt_host != NULL && cfg->mqtt_host[0] != '\0') {
        strncpy(out_host, cfg->mqtt_host, out_host_len - 1);
        out_host[out_host_len - 1] = '\0';
        ESP_LOGI(TAG, "Using direct MQTT host: %s:%d", out_host, *out_port);
        return true;
    }

    ESP_LOGE(TAG, "Khong tim thay MQTT broker (mDNS that bai, mqtt_host trong)");
    return false;
}

static void build_topics(const char *uid)
{
    snprintf(s_topic_telemetry, sizeof(s_topic_telemetry), "devices/%s/telemetry", uid);
    snprintf(s_topic_status, sizeof(s_topic_status), "devices/%s/status", uid);
    snprintf(s_topic_heartbeat, sizeof(s_topic_heartbeat), "devices/%s/heartbeat", uid);
    snprintf(s_topic_events, sizeof(s_topic_events), "devices/%s/events", uid);
    snprintf(s_topic_ota_status, sizeof(s_topic_ota_status), "devices/%s/ota/status", uid);
}

static const char *mqtt_scheme(const aifom_config_t *cfg)
{
    if (cfg->mqtt_scheme != NULL && strcmp(cfg->mqtt_scheme, "mqtts") == 0) {
        return "mqtts";
    }
    return "mqtt";
}

static void publish_online_status_retained(void)
{
    const char *payload = "{\"status\":\"online\"}";
    int msg_id = esp_mqtt_client_publish(s_client, s_topic_status, payload, 0, 1, 1);
    if (msg_id < 0) {
        ESP_LOGE(TAG, "publish online status failed");
    } else {
        ESP_LOGI(TAG, "published online status retained (msg_id=%d)", msg_id);
    }
}

static void resubscribe_all(void)
{
    for (int i = 0; i < s_sub_count; ++i) {
        int msg_id = esp_mqtt_client_subscribe(s_client, s_subs[i].topic, s_subs[i].qos);
        ESP_LOGI(TAG, "re-subscribed topic=%s qos=%d msg_id=%d",
                 s_subs[i].topic, s_subs[i].qos, msg_id);
    }
}

static bool topic_matches(const char *pattern, const char *topic, int topic_len)
{
    return (int)strlen(pattern) == topic_len && strncmp(pattern, topic, topic_len) == 0;
}

static void dispatch_message(const char *topic, int topic_len, const char *data, int data_len)
{
    for (int i = 0; i < s_sub_count; ++i) {
        if (topic_matches(s_subs[i].topic, topic, topic_len) && s_subs[i].cb != NULL) {
            s_subs[i].cb(topic, topic_len, data, data_len, s_subs[i].ctx);
        }
    }
}

static void on_mqtt_event(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    (void)handler_args;
    (void)base;
    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;

    switch ((esp_mqtt_event_id_t)event_id) {
    case MQTT_EVENT_CONNECTED:
        ESP_LOGI(TAG, "[MQTT] Connected");
        s_connected = true;
        publish_online_status_retained();
        resubscribe_all();
        break;
    case MQTT_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "MQTT_EVENT_DISCONNECTED — esp-mqtt will reconnect");
        s_connected = false;
        break;
    case MQTT_EVENT_DATA:
        dispatch_message(event->topic, event->topic_len, event->data, event->data_len);
        break;
    case MQTT_EVENT_ERROR:
        ESP_LOGE(TAG, "MQTT_EVENT_ERROR: type=%d",
                 event->error_handle != NULL ? (int)event->error_handle->error_type : -1);
        if (event->error_handle != NULL) {
            if (event->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) {
                ESP_LOGE(TAG, "  tls_err=0x%x sock_errno=%d",
                         event->error_handle->esp_tls_last_esp_err,
                         event->error_handle->esp_transport_sock_errno);
            }
            if (event->error_handle->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED) {
                ESP_LOGE(TAG, "  connect_return_code=%d (1=unacceptable_protocol 2=identifier_rejected 3=server_unavailable 4=bad_credentials 5=not_authorized)",
                         event->error_handle->connect_return_code);
            }
        }
        break;
    case MQTT_EVENT_PUBLISHED:
        ESP_LOGD(TAG, "MQTT_EVENT_PUBLISHED msg_id=%d", event->msg_id);
        break;
    default:
        break;
    }
}

esp_err_t aifom_mqtt_start(void)
{
    if (s_started) {
        return ESP_OK;
    }

    const aifom_config_t *cfg = aifom_config_get();
    s_uid = device_identity_get_uid();
    build_topics(s_uid);

    int resolved_port = cfg->mqtt_port;
    if (!resolve_broker_target(cfg, s_resolved_broker_host, sizeof(s_resolved_broker_host), &resolved_port)) {
        return ESP_ERR_NOT_FOUND;
    }
    ESP_LOGI(TAG, "[MQTT] Connecting to %s:%d", s_resolved_broker_host, resolved_port);

    char uri[96];
    snprintf(uri, sizeof(uri), "%s://%s:%d", mqtt_scheme(cfg), s_resolved_broker_host, resolved_port);

    esp_mqtt_client_config_t config = {0};
    config.broker.address.uri = uri;
    config.credentials.client_id = s_uid;
    config.buffer.size = 4096;
    config.session.last_will.topic = s_topic_status;
    config.session.last_will.msg = LWT_PAYLOAD;
    config.session.last_will.msg_len = (int)strlen(LWT_PAYLOAD);
    config.session.last_will.qos = 1;
    config.session.last_will.retain = 1;
    config.session.keepalive = 15;
    config.network.reconnect_timeout_ms = 5000;

    // MQTT authentication — set username/password from Kconfig if configured.
    if (cfg->mqtt_username != NULL && cfg->mqtt_username[0] != '\0') {
        config.credentials.username = cfg->mqtt_username;
        if (cfg->mqtt_password != NULL) {
            config.credentials.authentication.password = cfg->mqtt_password;
        }
        ESP_LOGI(TAG, "MQTT auth: username=%s", cfg->mqtt_username);
    }

    s_client = esp_mqtt_client_init(&config);
    if (s_client == NULL) {
        ESP_LOGE(TAG, "esp_mqtt_client_init failed");
        return ESP_FAIL;
    }

    esp_err_t err = esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID, on_mqtt_event, NULL);
    if (err != ESP_OK) {
        return err;
    }

    err = esp_mqtt_client_start(s_client);
    if (err != ESP_OK) {
        return err;
    }

    s_started = true;
    ESP_LOGI(TAG, "MQTT client started uri=%s client_id=%s", uri, s_uid);
    return ESP_OK;
}

bool aifom_mqtt_is_connected(void)
{
    return s_connected;
}

const char *aifom_mqtt_device_uid(void)
{
    if (s_uid == NULL) {
        s_uid = device_identity_get_uid();
    }
    return s_uid;
}

esp_err_t aifom_mqtt_subscribe(const char *topic, int qos,
                               aifom_mqtt_message_cb_t cb, void *user_ctx)
{
    if (topic == NULL || cb == NULL) return ESP_ERR_INVALID_ARG;
    if (s_sub_count >= AIFOM_MAX_SUBSCRIPTIONS) {
        ESP_LOGE(TAG, "subscription table full");
        return ESP_ERR_NO_MEM;
    }
    s_subs[s_sub_count].topic = topic;
    s_subs[s_sub_count].qos = qos;
    s_subs[s_sub_count].cb = cb;
    s_subs[s_sub_count].ctx = user_ctx;
    s_sub_count++;

    if (s_connected && s_client != NULL) {
        int msg_id = esp_mqtt_client_subscribe(s_client, topic, qos);
        ESP_LOGI(TAG, "subscribed topic=%s qos=%d msg_id=%d", topic, qos, msg_id);
    } else {
        ESP_LOGI(TAG, "subscription queued topic=%s qos=%d", topic, qos);
    }
    return ESP_OK;
}

static esp_err_t publish(const char *topic, const char *json, size_t len, int qos, int retain)
{
    if (s_client == NULL || !s_connected) {
        return ESP_ERR_INVALID_STATE;
    }
    int msg_id = esp_mqtt_client_publish(s_client, topic, json, (int)len, qos, retain);
    return (msg_id < 0) ? ESP_FAIL : ESP_OK;
}

esp_err_t aifom_mqtt_publish_telemetry(const char *json, size_t len)
{
    return publish(s_topic_telemetry, json, len, 0, 0);
}

esp_err_t aifom_mqtt_publish_status(const char *json, size_t len)
{
    return publish(s_topic_status, json, len, 1, 1);
}

esp_err_t aifom_mqtt_publish_events(const char *json, size_t len)
{
    return publish(s_topic_events, json, len, 1, 0);
}

esp_err_t aifom_mqtt_publish_json(const char *topic, const char *json, size_t len, int qos, bool retain)
{
    return publish(topic, json, len, qos, retain ? 1 : 0);
}

esp_err_t aifom_mqtt_publish_ota_status(const char *json, size_t len)
{
    return publish(s_topic_ota_status, json, len, 1, 0);
}

esp_err_t aifom_mqtt_publish_result(const char *json, size_t len)
{
    return aifom_mqtt_publish_ota_status(json, len);
}

esp_err_t aifom_mqtt_publish_heartbeat(const char *json, size_t len)
{
    return publish(s_topic_heartbeat, json, len, 1, 0);
}

esp_err_t aifom_mqtt_reconnect(void)
{
    ESP_LOGW(TAG, "Forcing MQTT reconnect — destroying and re-creating client");

    if (s_client != NULL) {
        esp_mqtt_client_stop(s_client);
        esp_mqtt_client_destroy(s_client);
        s_client = NULL;
    }
    s_connected = false;
    s_started = false;

    const aifom_config_t *cfg = aifom_config_get();
    int resolved_port = cfg->mqtt_port;
    if (!resolve_broker_target(cfg, s_resolved_broker_host, sizeof(s_resolved_broker_host), &resolved_port)) {
        ESP_LOGE(TAG, "Re-resolve broker failed — cannot reconnect");
        return ESP_ERR_NOT_FOUND;
    }

    char uri[96];
    snprintf(uri, sizeof(uri), "%s://%s:%d", mqtt_scheme(cfg), s_resolved_broker_host, resolved_port);

    esp_mqtt_client_config_t config = {0};
    config.broker.address.uri = uri;
    config.credentials.client_id = s_uid;
    config.buffer.size = 4096;
    config.session.last_will.topic = s_topic_status;
    config.session.last_will.msg = LWT_PAYLOAD;
    config.session.last_will.msg_len = (int)strlen(LWT_PAYLOAD);
    config.session.last_will.qos = 1;
    config.session.last_will.retain = 1;
    config.session.keepalive = 15;
    config.network.reconnect_timeout_ms = 5000;

    // MQTT authentication
    if (cfg->mqtt_username != NULL && cfg->mqtt_username[0] != '\0') {
        config.credentials.username = cfg->mqtt_username;
        if (cfg->mqtt_password != NULL) {
            config.credentials.authentication.password = cfg->mqtt_password;
        }
    }

    s_client = esp_mqtt_client_init(&config);
    if (s_client == NULL) {
        ESP_LOGE(TAG, "esp_mqtt_client_init failed on reconnect");
        return ESP_FAIL;
    }

    esp_err_t err = esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID, on_mqtt_event, NULL);
    if (err != ESP_OK) return err;

    err = esp_mqtt_client_start(s_client);
    if (err != ESP_OK) return err;

    s_started = true;
    ESP_LOGI(TAG, "MQTT client restarted uri=%s", uri);
    return ESP_OK;
}
