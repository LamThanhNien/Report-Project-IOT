#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/** Start the AIFOM MQTT client. Idempotent. */
esp_err_t aifom_mqtt_start(void);

/** Returns true once the client has reported MQTT_EVENT_CONNECTED at least once. */
bool aifom_mqtt_is_connected(void);

/**
 * Callback invoked when a subscribed topic receives data.
 * The buffers are only valid for the duration of the callback — copy if you
 * need to keep them.
 */
typedef void (*aifom_mqtt_message_cb_t)(const char *topic, int topic_len,
                                        const char *data, int data_len,
                                        void *user_ctx);

/**
 * Register a topic subscription. Multiple registrations allowed; each
 * delivers its own callback on every matching message. Subscribed topics
 * are re-subscribed automatically after every reconnect.
 *
 * `topic` must outlive the subscription (use a string literal or static).
 * Returns ESP_OK on registration; the actual broker SUBSCRIBE happens on the
 * next connect.
 */
esp_err_t aifom_mqtt_subscribe(const char *topic, int qos,
                               aifom_mqtt_message_cb_t cb, void *user_ctx);

/** Returns the cached device UID used to build topics (same as device_identity_get_uid). */
const char *aifom_mqtt_device_uid(void);

/** Publish JSON to `devices/{uid}/telemetry` (QoS 0, no retain). */
esp_err_t aifom_mqtt_publish_telemetry(const char *json, size_t len);

/**
 * Publish JSON to `devices/{uid}/status` (QoS 1, retained).
 * The MQTT client also installs an LWT that publishes `{"status":"offline"}`
 * with retain when the broker considers the device gone.
 */
esp_err_t aifom_mqtt_publish_status(const char *json, size_t len);

/** Publish JSON to `devices/{uid}/events` (QoS 1, no retain). */
esp_err_t aifom_mqtt_publish_events(const char *json, size_t len);

/** Publish JSON to an explicit topic. Use for feature-specific contracts. */
esp_err_t aifom_mqtt_publish_json(const char *topic, const char *json, size_t len, int qos, bool retain);

/** Publish heartbeat to `devices/{uid}/heartbeat` (QoS 1, no retain). */
esp_err_t aifom_mqtt_publish_heartbeat(const char *json, size_t len);

/**
 * Force a reconnection cycle. Destroys the current client, re-resolves the
 * broker via mDNS, and creates a fresh connection. Safe to call from any task.
 */
esp_err_t aifom_mqtt_reconnect(void);

/** Publish JSON to `devices/{uid}/ota/status` (QoS 1, no retain). */
esp_err_t aifom_mqtt_publish_ota_status(const char *json, size_t len);

/** Backward compatibility alias. */
esp_err_t aifom_mqtt_publish_result(const char *json, size_t len);

#ifdef __cplusplus
}
#endif
