#include "ota_client.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "aifom_mqtt.h"
#include "cJSON.h"
#include "esp_app_desc.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "mbedtls/base64.h"
#include "mbedtls/pk.h"
#include "mbedtls/sha256.h"

static const char *TAG = "ota_client";

#define OTA_BUF_SIZE     4096
#define OTA_JOB_ID_LEN   64
#define OTA_VERSION_LEN  32
#define OTA_URL_LEN      768
#define OTA_SHA_HEX_LEN  65
#define OTA_SIGNATURE_B64_LEN  128
#define OTA_SIGNATURE_PAYLOAD_LEN  65
#define OTA_PUBLIC_KEY_PEM_LEN  256

typedef struct {
    char job_id[OTA_JOB_ID_LEN];
    char firmware_version[OTA_VERSION_LEN];
    char firmware_url[OTA_URL_LEN];
    char checksum_sha256[OTA_SHA_HEX_LEN];
    char signature_b64[OTA_SIGNATURE_B64_LEN];
    char signature_payload[OTA_SIGNATURE_PAYLOAD_LEN];
    char signing_public_key[OTA_PUBLIC_KEY_PEM_LEN];
    bool verification_required;
    int expected_size;
} ota_job_t;

static char s_ota_topic[96];

static const char *running_version(void)
{
    const esp_app_desc_t *desc = esp_app_get_description();
    return (desc != NULL && desc->version[0] != '\0') ? desc->version : "unknown";
}

static void to_hex(const uint8_t *bytes, size_t len, char *out)
{
    static const char hex[] = "0123456789abcdef";
    for (size_t i = 0; i < len; ++i) {
        out[i * 2] = hex[(bytes[i] >> 4) & 0xF];
        out[i * 2 + 1] = hex[bytes[i] & 0xF];
    }
    out[len * 2] = '\0';
}

static bool verify_ota_signature(const ota_job_t *job)
{
    const bool has_signature = job->signature_b64[0] != '\0';
    if (!job->verification_required && !has_signature) {
        return true;
    }
    if (!has_signature || job->signature_payload[0] == '\0' ||
        job->signing_public_key[0] == '\0' || job->checksum_sha256[0] == '\0') {
        ESP_LOGE(TAG, "OTA signature metadata incomplete");
        return false;
    }
    if (strcmp(job->signature_payload, job->checksum_sha256) != 0) {
        ESP_LOGE(TAG, "OTA signature payload does not match checksum");
        return false;
    }

    const char *trusted_fingerprint = CONFIG_AIFOM_OTA_SIGNING_KEY_SHA256;
    if (trusted_fingerprint[0] == '\0') {
        ESP_LOGE(TAG, "OTA signing trust root is not configured");
        return false;
    }
    uint8_t key_digest[32];
    char key_digest_hex[OTA_SHA_HEX_LEN];
    if (mbedtls_sha256(
            (const unsigned char *)job->signing_public_key,
            strlen(job->signing_public_key),
            key_digest,
            0
        ) != 0) {
        ESP_LOGE(TAG, "OTA signing key fingerprint failed");
        return false;
    }
    to_hex(key_digest, sizeof(key_digest), key_digest_hex);
    if (strcasecmp(key_digest_hex, trusted_fingerprint) != 0) {
        ESP_LOGE(TAG, "OTA signing key is not trusted");
        return false;
    }

    unsigned char signature[96];
    size_t signature_len = 0;
    if (mbedtls_base64_decode(
            signature,
            sizeof(signature),
            &signature_len,
            (const unsigned char *)job->signature_b64,
            strlen(job->signature_b64)
        ) != 0) {
        ESP_LOGE(TAG, "OTA signature base64 is invalid");
        return false;
    }

    mbedtls_pk_context public_key;
    mbedtls_pk_init(&public_key);
    int rc = mbedtls_pk_parse_public_key(
        &public_key,
        (const unsigned char *)job->signing_public_key,
        strlen(job->signing_public_key) + 1
    );
    if (rc == 0) {
        rc = mbedtls_pk_verify(
            &public_key,
            MBEDTLS_MD_NONE,
            (const unsigned char *)job->signature_payload,
            strlen(job->signature_payload),
            signature,
            signature_len
        );
    }
    mbedtls_pk_free(&public_key);
    if (rc != 0) {
        ESP_LOGE(TAG, "OTA Ed25519 signature verification failed: -0x%04x", (unsigned int)-rc);
        return false;
    }
    return true;
}

static void publish_ota_status_ext(
    const char *job_id,
    const char *status,
    int progress,
    const char *firmware_version,
    const char *message,
    const char *phase,
    const char *error_code
)
{
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) return;
    cJSON_AddStringToObject(root, "job_id", job_id ? job_id : "");
    cJSON_AddStringToObject(root, "device_id", aifom_mqtt_device_uid());
    cJSON_AddStringToObject(root, "status", status);
    cJSON_AddNumberToObject(root, "progress", progress);
    if (firmware_version != NULL && firmware_version[0] != '\0') {
        cJSON_AddStringToObject(root, "firmware_version", firmware_version);
        cJSON_AddStringToObject(root, "version", firmware_version);
    }
    if (message != NULL && message[0] != '\0') {
        cJSON_AddStringToObject(root, "message", message);
    }
    if (phase != NULL && phase[0] != '\0') {
        cJSON_AddStringToObject(root, "phase", phase);
    }
    if (error_code != NULL && error_code[0] != '\0') {
        cJSON_AddStringToObject(root, "error_code", error_code);
    }
    char *json = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (json == NULL) return;
    (void)aifom_mqtt_publish_ota_status(json, strlen(json));
    free(json);
}

static void publish_ota_status(
    const char *job_id,
    const char *status,
    int progress,
    const char *firmware_version,
    const char *message
)
{
    publish_ota_status_ext(job_id, status, progress, firmware_version, message, status, NULL);
}

static void publish_ota_failure(
    const ota_job_t *job,
    int progress,
    const char *error_code,
    const char *message
)
{
    publish_ota_status_ext(
        job != NULL ? job->job_id : "",
        "failed",
        progress,
        job != NULL ? job->firmware_version : "",
        message,
        "failed",
        error_code
    );
}

static bool parse_job(const char *data, int data_len, ota_job_t *out)
{
    cJSON *root = cJSON_ParseWithLength(data, data_len);
    if (root == NULL) {
        ESP_LOGE(TAG, "ota command JSON parse failed");
        return false;
    }

    const cJSON *job_id = cJSON_GetObjectItemCaseSensitive(root, "job_id");
    const cJSON *firmware_version = cJSON_GetObjectItemCaseSensitive(root, "firmware_version");
    const cJSON *firmware_url = cJSON_GetObjectItemCaseSensitive(root, "firmware_url");
    const cJSON *checksum = cJSON_GetObjectItemCaseSensitive(root, "checksum");
    const cJSON *file_size = cJSON_GetObjectItemCaseSensitive(root, "file_size");
    const cJSON *signature = cJSON_GetObjectItemCaseSensitive(root, "signature");
    const cJSON *signature_alg = cJSON_GetObjectItemCaseSensitive(root, "signature_alg");
    const cJSON *signature_payload = cJSON_GetObjectItemCaseSensitive(root, "signature_payload");
    const cJSON *signing_public_key = cJSON_GetObjectItemCaseSensitive(root, "signing_public_key");
    const cJSON *verification_required = cJSON_GetObjectItemCaseSensitive(root, "verification_required");

    const cJSON *legacy_version = cJSON_GetObjectItemCaseSensitive(root, "version");
    const cJSON *legacy_url = cJSON_GetObjectItemCaseSensitive(root, "download_url");
    const cJSON *legacy_checksum = cJSON_GetObjectItemCaseSensitive(root, "checksum_sha256");
    const cJSON *legacy_size = cJSON_GetObjectItemCaseSensitive(root, "size_bytes");

    const cJSON *version_node = cJSON_IsString(firmware_version) ? firmware_version : legacy_version;
    const cJSON *url_node = cJSON_IsString(firmware_url) ? firmware_url : legacy_url;
    const cJSON *checksum_node = cJSON_IsString(checksum) ? checksum : legacy_checksum;
    const cJSON *size_node = cJSON_IsNumber(file_size) ? file_size : legacy_size;

    if (!cJSON_IsString(job_id) || !cJSON_IsString(version_node) || !cJSON_IsString(url_node)) {
        ESP_LOGE(TAG, "ota command missing required fields");
        cJSON_Delete(root);
        return false;
    }

    strncpy(out->job_id, job_id->valuestring, sizeof(out->job_id) - 1);
    strncpy(out->firmware_version, version_node->valuestring, sizeof(out->firmware_version) - 1);
    strncpy(out->firmware_url, url_node->valuestring, sizeof(out->firmware_url) - 1);
    out->job_id[sizeof(out->job_id) - 1] = '\0';
    out->firmware_version[sizeof(out->firmware_version) - 1] = '\0';
    out->firmware_url[sizeof(out->firmware_url) - 1] = '\0';

    out->checksum_sha256[0] = '\0';
    if (cJSON_IsString(checksum_node)) {
        strncpy(out->checksum_sha256, checksum_node->valuestring, sizeof(out->checksum_sha256) - 1);
        out->checksum_sha256[sizeof(out->checksum_sha256) - 1] = '\0';
    }
    out->expected_size = 0;
    if (cJSON_IsNumber(size_node) && size_node->valuedouble > 0) {
        out->expected_size = (int)size_node->valuedouble;
    }

    out->signature_b64[0] = '\0';
    out->signature_payload[0] = '\0';
    out->signing_public_key[0] = '\0';
    out->verification_required = cJSON_IsTrue(verification_required);
    if (cJSON_IsString(signature)) {
        strncpy(out->signature_b64, signature->valuestring, sizeof(out->signature_b64) - 1);
        out->signature_b64[sizeof(out->signature_b64) - 1] = '\0';
    }
    if (cJSON_IsString(signature_payload)) {
        strncpy(out->signature_payload, signature_payload->valuestring, sizeof(out->signature_payload) - 1);
        out->signature_payload[sizeof(out->signature_payload) - 1] = '\0';
    }
    if (cJSON_IsString(signing_public_key)) {
        strncpy(out->signing_public_key, signing_public_key->valuestring, sizeof(out->signing_public_key) - 1);
        out->signing_public_key[sizeof(out->signing_public_key) - 1] = '\0';
    }
    if ((out->verification_required || out->signature_b64[0] != '\0') &&
        (!cJSON_IsString(signature_alg) || strcmp(signature_alg->valuestring, "Ed25519") != 0)) {
        ESP_LOGE(TAG, "OTA signature algorithm is missing or unsupported");
        cJSON_Delete(root);
        return false;
    }

    cJSON_Delete(root);
    return true;
}

static esp_err_t perform_ota(const ota_job_t *job)
{
    ESP_LOGI(TAG, "OTA start url=%s target=%s current=%s", job->firmware_url, job->firmware_version, running_version());

    if (strcmp(job->firmware_version, running_version()) == 0) {
        publish_ota_status(job->job_id, "success", 100, job->firmware_version, "already up to date");
        return ESP_OK;
    }

    if (!verify_ota_signature(job)) {
        publish_ota_failure(job, 0, "signature_verification_failed", "firmware signature is invalid or untrusted");
        return ESP_ERR_INVALID_CRC;
    }

    publish_ota_status(job->job_id, "started", 0, job->firmware_version, "OTA started");
    publish_ota_status(job->job_id, "downloading", 0, job->firmware_version, "Downloading firmware");

    esp_http_client_config_t http_cfg = {
        .url = job->firmware_url,
        .timeout_ms = 30000,
        .keep_alive_enable = true,
    };
    esp_http_client_handle_t http = esp_http_client_init(&http_cfg);
    if (http == NULL) {
        publish_ota_failure(job, 0, "download_failed", "http init failed");
        return ESP_FAIL;
    }

    esp_err_t err = esp_http_client_open(http, 0);
    if (err != ESP_OK) {
        esp_http_client_cleanup(http);
        publish_ota_failure(job, 0, "download_failed", "http open failed");
        return err;
    }

    int content_length = esp_http_client_fetch_headers(http);
    int status_code = esp_http_client_get_status_code(http);
    if (status_code != 200) {
        char msg[64];
        snprintf(msg, sizeof(msg), "http status %d", status_code);
        esp_http_client_close(http);
        esp_http_client_cleanup(http);
        publish_ota_failure(job, 0, "invalid_response", msg);
        return ESP_FAIL;
    }

    const esp_partition_t *update = esp_ota_get_next_update_partition(NULL);
    if (update == NULL) {
        esp_http_client_close(http);
        esp_http_client_cleanup(http);
        publish_ota_failure(job, 0, "not_enough_space", "no update partition");
        return ESP_FAIL;
    }

    int expected_size = content_length > 0 ? content_length : job->expected_size;
    if (job->expected_size > 0 && content_length > 0 && content_length != job->expected_size) {
        esp_http_client_close(http);
        esp_http_client_cleanup(http);
        publish_ota_failure(job, 0, "invalid_response", "firmware size mismatch");
        return ESP_FAIL;
    }
    if (expected_size > 0 && expected_size > update->size) {
        esp_http_client_close(http);
        esp_http_client_cleanup(http);
        publish_ota_failure(job, 0, "not_enough_space", "firmware larger than OTA partition");
        return ESP_FAIL;
    }

    esp_ota_handle_t ota_handle = 0;
    err = esp_ota_begin(update, OTA_WITH_SEQUENTIAL_WRITES, &ota_handle);
    if (err != ESP_OK) {
        esp_http_client_close(http);
        esp_http_client_cleanup(http);
        publish_ota_failure(job, 0, "flash_write_failed", "ota_begin failed");
        return err;
    }

    mbedtls_sha256_context sha_ctx;
    mbedtls_sha256_init(&sha_ctx);
    mbedtls_sha256_starts(&sha_ctx, 0);

    char *buf = malloc(OTA_BUF_SIZE);
    if (buf == NULL) {
        esp_ota_abort(ota_handle);
        mbedtls_sha256_free(&sha_ctx);
        esp_http_client_close(http);
        esp_http_client_cleanup(http);
        publish_ota_failure(job, 0, "not_enough_space", "out of memory");
        return ESP_ERR_NO_MEM;
    }

    int total = 0;
    int next_milestone = 25;
    while (true) {
        int n = esp_http_client_read(http, buf, OTA_BUF_SIZE);
        if (n < 0) {
            err = ESP_FAIL;
            break;
        }
        if (n == 0) {
            break;
        }
        err = esp_ota_write(ota_handle, buf, n);
        if (err != ESP_OK) {
            break;
        }
        mbedtls_sha256_update(&sha_ctx, (const unsigned char *)buf, n);
        total += n;
        if (expected_size > 0) {
            int percent = (int)(((double)total / (double)expected_size) * 100.0);
            while (next_milestone <= 100 && percent >= next_milestone) {
                publish_ota_status(
                    job->job_id,
                    "downloading",
                    next_milestone,
                    job->firmware_version,
                    "Downloading firmware"
                );
                next_milestone += 25;
            }
        }
    }
    free(buf);

    uint8_t digest[32];
    mbedtls_sha256_finish(&sha_ctx, digest);
    mbedtls_sha256_free(&sha_ctx);

    esp_http_client_close(http);
    esp_http_client_cleanup(http);

    if (err != ESP_OK) {
        esp_ota_abort(ota_handle);
        publish_ota_failure(job, 0, "download_failed", "download/write error");
        return err;
    }
    if (total <= 0) {
        esp_ota_abort(ota_handle);
        publish_ota_failure(job, 0, "invalid_response", "empty firmware response");
        return ESP_FAIL;
    }
    if (expected_size > 0 && total != expected_size) {
        esp_ota_abort(ota_handle);
        publish_ota_failure(job, 0, "download_failed", "downloaded size mismatch");
        return ESP_FAIL;
    }
    if (next_milestone <= 100) {
        publish_ota_status(job->job_id, "downloading", 100, job->firmware_version, "Download complete");
    }

    char hex_actual[OTA_SHA_HEX_LEN];
    to_hex(digest, sizeof(digest), hex_actual);
    if (job->checksum_sha256[0] != '\0' && strcasecmp(hex_actual, job->checksum_sha256) != 0) {
        esp_ota_abort(ota_handle);
        publish_ota_failure(job, 100, "checksum_mismatch", "checksum mismatch");
        return ESP_ERR_INVALID_CRC;
    }

    publish_ota_status(job->job_id, "applying", 100, job->firmware_version, "Applying firmware");
    err = esp_ota_end(ota_handle);
    if (err != ESP_OK) {
        publish_ota_failure(job, 100, "flash_write_failed", "ota_end failed");
        return err;
    }
    err = esp_ota_set_boot_partition(update);
    if (err != ESP_OK) {
        publish_ota_failure(job, 100, "update_verification_failed", "set_boot failed");
        return err;
    }

    publish_ota_status(job->job_id, "rebooting", 100, job->firmware_version, "Rebooting device");
    publish_ota_status(job->job_id, "success", 100, job->firmware_version, "OTA completed");
    vTaskDelay(pdMS_TO_TICKS(1000));
    esp_restart();
    return ESP_OK;
}

static void ota_task(void *arg)
{
    ota_job_t *job = (ota_job_t *)arg;
    (void)perform_ota(job);
    free(job);
    vTaskDelete(NULL);
}

static void on_ota_command(const char *topic, int topic_len, const char *data, int data_len, void *ctx)
{
    (void)topic;
    (void)topic_len;
    (void)ctx;
    ota_job_t *job = calloc(1, sizeof(ota_job_t));
    if (job == NULL) return;
    if (!parse_job(data, data_len, job)) {
        free(job);
        return;
    }
    if (xTaskCreate(ota_task, "ota_run", 8192, job, 6, NULL) != pdPASS) {
        publish_ota_failure(job, 0, "flash_write_failed", "task spawn failed");
        free(job);
    }
}

void ota_client_mark_running_valid(void)
{
    const esp_partition_t *running = esp_ota_get_running_partition();
    if (running == NULL) return;
    esp_ota_img_states_t state = 0;
    if (esp_ota_get_state_partition(running, &state) == ESP_OK && state == ESP_OTA_IMG_PENDING_VERIFY) {
        ESP_LOGI(TAG, "marking running image valid");
        esp_ota_mark_app_valid_cancel_rollback();
    }
}

esp_err_t ota_client_start(void)
{
    const char *uid = aifom_mqtt_device_uid();
    snprintf(s_ota_topic, sizeof(s_ota_topic), "devices/%s/ota", uid);
    ESP_LOGI(TAG, "subscribing %s", s_ota_topic);
    return aifom_mqtt_subscribe(s_ota_topic, 1, on_ota_command, NULL);
}
