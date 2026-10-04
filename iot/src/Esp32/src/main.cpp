/**
 * AIFOM ESP32 — Light control test firmware
 *
 * Chức năng: kết nối WiFi + MQTT qua mDNS, nhận lệnh bật/tắt đèn từ server.
 *
 * Đã tối ưu so với phiên bản đầy đủ:
 *  - Loại bỏ hệ thống OutputBinding động (struct array 8 phần tử, 9 hàm liên quan)
 *  - Loại bỏ publishCommandResult() và topicEvents
 *  - JsonDocument (heap) → StaticJsonDocument (stack) — không phân mảnh heap
 *  - String object → const char* + strcmp() — không cấp phát heap động
 *  - MQTT buffer 1024 → 512 B, keepalive 30 s → 60 s, telemetry 5 s → 10 s
 *  - Giữ nguyên 5 bản sửa lỗi reconnect (#1–#5)
 */

#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

// ── Build-flag overrides (platformio.ini / platformio_local.ini) ──────────────
#define DEFAULT_WIFI_SSID  "Nha Tro SV Khanh An"
#define DEFAULT_WIFI_PASS  "68686868"
#define DEFAULT_MQTT_HOST  "aifom.local"
#define DEFAULT_MQTT_PORT  1883
#define DEFAULT_MQTT_USER  "aifom_device"
#define DEFAULT_MQTT_PASS  "aifom_device_pass"

#ifndef WIFI_SSID
#define WIFI_SSID DEFAULT_WIFI_SSID
#endif
#ifndef WIFI_PASS
#define WIFI_PASS DEFAULT_WIFI_PASS
#endif
#ifndef MQTT_BROKER_HOST
#define MQTT_BROKER_HOST DEFAULT_MQTT_HOST
#endif
#ifndef MQTT_BROKER_PORT
#define MQTT_BROKER_PORT DEFAULT_MQTT_PORT
#endif
#ifndef MQTT_USER
#define MQTT_USER DEFAULT_MQTT_USER
#endif
#ifndef MQTT_PASS
#define MQTT_PASS DEFAULT_MQTT_PASS
#endif
#ifndef DEVICE_ID
#define DEVICE_ID "fffff"
#endif

// ── GPIO ──────────────────────────────────────────────────────────────────────
#define LIGHT_PIN  2   // GPIO2 — built-in LED / relay_1
#define RELAY2_PIN 4   // GPIO4 — relay_2

// ── Tuning ────────────────────────────────────────────────────────────────────
static const uint32_t WIFI_RECONNECT_MS   = 10000;  // khoảng cách giữa các lần thử WiFi
static const uint32_t WIFI_LOG_MS         = 5000;   // log trạng thái WiFi mỗi 5 s
static const uint32_t MDNS_TIMEOUT_MS     = 2000;   // timeout host query mDNS
static const uint32_t TELEMETRY_MS        = 10000;  // gửi telemetry mỗi 10 s (tối ưu: trước là 5 s)
static const uint8_t  MQTT_KEEPALIVE_S    = 60;     // keepalive 60 s (tối ưu: trước là 30 s)
static const uint8_t  MQTT_SOCK_TIMEOUT_S = 5;
static const uint16_t MQTT_BUF_SIZE       = 512;   // buffer 512 B (tối ưu: trước là 1024 B)
static const uint8_t  LAST_KNOWN_MAX      = 3;
static const uint32_t BACKOFF_MS[]        = {2000, 5000, 10000, 30000, 60000};

// ── Effective credentials ─────────────────────────────────────────────────────
static const char*    SSID_EFF  = (WIFI_SSID[0]       != '\0') ? WIFI_SSID       : DEFAULT_WIFI_SSID;
static const char*    PASS_EFF  = (WIFI_PASS[0]       != '\0') ? WIFI_PASS       : DEFAULT_WIFI_PASS;
static const char*    HOST_EFF  = (MQTT_BROKER_HOST[0] != '\0') ? MQTT_BROKER_HOST : DEFAULT_MQTT_HOST;
static const uint16_t PORT_EFF  = (MQTT_BROKER_PORT   >  0)    ? MQTT_BROKER_PORT : DEFAULT_MQTT_PORT;
static const char*    MUSER_EFF = (MQTT_USER[0]       != '\0') ? MQTT_USER       : DEFAULT_MQTT_USER;
static const char*    MPASS_EFF = (MQTT_PASS[0]       != '\0') ? MQTT_PASS       : DEFAULT_MQTT_PASS;

// ── Network objects ───────────────────────────────────────────────────────────
static WiFiClient   net;
static PubSubClient mqtt(net);

// ── MQTT topics ───────────────────────────────────────────────────────────────
static char topicStatus   [80];
static char topicTelemetry[80];
static char topicCommands [80];

// ── Broker discovery state ────────────────────────────────────────────────────
static IPAddress mqttIP;
static uint16_t  mqttPort        = PORT_EFF;
static IPAddress lastKnownIP;
static uint16_t  lastKnownPort   = PORT_EFF;
static bool      hasLastKnown    = false;
static uint8_t   lastKnownAttempts = 0;

// ── Connection state ──────────────────────────────────────────────────────────
static bool        wifiStarted    = false;
static bool        mdnsStarted    = false;
static bool        wasWifiUp      = false;
static bool        wasMqttUp      = false;
static uint8_t     backoffIdx     = 0;
static uint32_t    mqttAttempts   = 0;
static unsigned long nextWifiMs   = 0;
static unsigned long lastWifiLogMs = 0;
static unsigned long nextMqttMs   = 0;
static unsigned long lastTelemetryMs = 0;

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Kiểm tra deadline đã qua chưa, an toàn với millis() overflow sau ~49.7 ngày.
 * deadline == 0 → coi như đã qua (thực hiện ngay).
 */
static inline bool deadlinePassed(unsigned long now, unsigned long deadline)
{
    return (deadline == 0) || ((int32_t)(now - deadline) >= 0);
}

/**
 * Ánh xạ target string / số pin → GPIO an toàn để xuất.
 * Trả LIGHT_PIN nếu không nhận dạng được.
 */
static int resolvePin(const char* target, int gpioPin)
{
    if (gpioPin >= 0) {
        // Từ chối flash SPI (6–11) và chân input-only (34–39)
        if (gpioPin >= 6  && gpioPin <= 11) return -1;
        if (gpioPin >= 34 && gpioPin <= 39) return -1;
        return gpioPin;
    }
    if (target && strcmp(target, "relay_2") == 0) return RELAY2_PIN;
    return LIGHT_PIN;  // led_builtin / relay_1 / mặc định
}

// ── Publish ───────────────────────────────────────────────────────────────────

static void publishStatus(const char* status)
{
    JsonDocument doc;
    doc["device_id"] = DEVICE_ID;
    doc["status"]    = status;
    doc["uptime_ms"] = millis();
    doc["rssi"]      = WiFi.RSSI();
    char buf[160];
    serializeJson(doc, buf, sizeof(buf));
    mqtt.publish(topicStatus, buf, /*retain=*/true);
}

static void publishTelemetry()
{
    JsonDocument doc;
    doc["device_id"]  = DEVICE_ID;
    doc["uptime_ms"]  = millis();
    doc["rssi"]       = WiFi.RSSI();
    doc["free_heap"]  = ESP.getFreeHeap();
    doc["light"]      = (digitalRead(LIGHT_PIN)  == HIGH);
    doc["relay2"]     = (digitalRead(RELAY2_PIN) == HIGH);
    char buf[192];
    serializeJson(doc, buf, sizeof(buf));
    mqtt.publish(topicTelemetry, buf, /*retain=*/false);
}

// ── Command handler ───────────────────────────────────────────────────────────

static void onMessage(char* topic, byte* payload, unsigned int len)
{
    Serial.printf("MQTT Rx topic=%s len=%u\n", topic, len);

    JsonDocument doc;
    DeserializationError error = deserializeJson(doc, payload, len);
    if (error) {
        Serial.printf("JSON deserialization failed: %s\n", error.c_str());
        return;
    }

    // Lấy tên lệnh — ưu tiên "command", fallback "type"
    const char* cmd = nullptr;
    if (doc["command"].is<const char*>())      cmd = doc["command"].as<const char*>();
    else if (doc["type"].is<const char*>())    cmd = doc["type"].as<const char*>();
    if (!cmd || cmd[0] == '\0') {
        Serial.println("Invalid command: field 'command' or 'type' missing");
        return;
    }

    Serial.printf("Command received: %s\n", cmd);

    // Xác định GPIO target
    const char* target = "";
    if (doc["target"].is<const char*>())                   target = doc["target"].as<const char*>();
    else if (doc["params"]["target"].is<const char*>())    target = doc["params"]["target"].as<const char*>();

    int gpioPin = -1;
    if      (doc["gpio_pin"].is<int>())          gpioPin = doc["gpio_pin"].as<int>();
    else if (doc["params"]["gpio_pin"].is<int>()) gpioPin = doc["params"]["gpio_pin"].as<int>();
    else if (doc["params"]["pin"].is<int>())      gpioPin = doc["params"]["pin"].as<int>();

    int pin = resolvePin(target, gpioPin);

    // ── Xử lý lệnh ───────────────────────────────────────────────────────────

    if (strcmp(cmd, "request_status") == 0) {
        publishStatus("online");
        return;
    }

    if (strcmp(cmd, "request_telemetry") == 0) {
        publishTelemetry();
        return;
    }

    if (strcmp(cmd, "set_output") == 0 || strcmp(cmd, "set_gpio") == 0) {
        // Lấy value: bool, int hoặc string
        bool val = false;
        JsonVariantConst v = doc["value"];
        if (v.isNull()) v = doc["params"]["value"];
        if (v.isNull()) v = doc["params"]["state"];
        if (v.isNull()) v = doc["state"];

        if (v.is<bool>()) {
            val = v.as<bool>();
        } else if (v.is<int>()) {
            val = (v.as<int>() != 0);
        } else if (v.is<const char*>()) {
            const char* s = v.as<const char*>();
            val = (strcmp(s, "true") == 0 || strcmp(s, "1") == 0 || strcmp(s, "on") == 0 || strcmp(s, "high") == 0);
        } else {
            Serial.println("CMD set: no valid boolean/integer/string value found");
            return;
        }

        if (pin >= 0) {
            digitalWrite(pin, val ? HIGH : LOW);
            Serial.printf("CMD set pin=%d val=%d uptime_ms=%lu\n", pin, val, millis());
        } else {
            Serial.println("CMD set: target pin is invalid");
        }
        publishTelemetry();
        publishStatus("online");
        return;
    }

    if (strcmp(cmd, "toggle_output") == 0) {
        if (pin >= 0) {
            bool cur = (digitalRead(pin) == HIGH);
            digitalWrite(pin, cur ? LOW : HIGH);
            Serial.printf("CMD toggle pin=%d -> %d uptime_ms=%lu\n", pin, !cur, millis());
        } else {
            Serial.println("CMD toggle: target pin is invalid");
        }
        publishTelemetry();
        publishStatus("online");
        return;
    }

    Serial.printf("CMD unknown cmd=%s uptime_ms=%lu\n", cmd, millis());
}

// ── mDNS ─────────────────────────────────────────────────────────────────────

static void ensureMdns()
{
    if (mdnsStarted || WiFi.status() != WL_CONNECTED) return;
    if (!MDNS.begin("esp32")) {
        Serial.printf("mDNS init failed uptime_ms=%lu\n", millis());
    } else {
        mdnsStarted = true;
        Serial.println("mDNS client ready");
    }
}

/**
 * Tìm địa chỉ MQTT broker qua mDNS.
 * Bước 1: service query _aifom-mqtt._tcp (chính xác nhất).
 * Bước 2: host query aifom.local (fallback).
 */
static bool resolveBroker(IPAddress& ipOut, uint16_t& portOut, bool& usedCache)
{
    usedCache = false;
    ensureMdns();

    if (mdnsStarted) {
        Serial.printf("mDNS query _aifom-mqtt._tcp uptime_ms=%lu\n", millis());
        int n = MDNS.queryService("aifom-mqtt", "tcp");
        if (n > 0) {
            ipOut   = MDNS.IP(0);
            portOut = (MDNS.port(0) > 0) ? MDNS.port(0) : PORT_EFF;
            Serial.printf("mDNS _aifom-mqtt._tcp -> %s:%u\n", ipOut.toString().c_str(), portOut);
            lastKnownIP = ipOut; lastKnownPort = portOut;
            hasLastKnown = true; lastKnownAttempts = 0;
            return true;
        }

        // Fallback: A/AAAA record của aifom.local
        Serial.printf("mDNS _aifom-mqtt._tcp failed, host query uptime_ms=%lu\n", millis());
        IPAddress hi = MDNS.queryHost("aifom", MDNS_TIMEOUT_MS);
        if (hi != INADDR_NONE && hi.toString() != "0.0.0.0") {
            ipOut = hi; portOut = PORT_EFF;
            Serial.printf("mDNS aifom.local -> %s:%u\n", ipOut.toString().c_str(), portOut);
            lastKnownIP = ipOut; lastKnownPort = portOut;
            hasLastKnown = true; lastKnownAttempts = 0;
            return true;
        }
    }

    // Cache broker cuối cùng biết — thử lại tối đa LAST_KNOWN_MAX lần
    if (hasLastKnown && lastKnownAttempts < LAST_KNOWN_MAX) {
        ipOut = lastKnownIP; portOut = lastKnownPort;
        usedCache = true;
        Serial.printf("Using cached broker %s:%u attempt=%u/%u uptime_ms=%lu\n",
            ipOut.toString().c_str(), portOut,
            lastKnownAttempts + 1, LAST_KNOWN_MAX, millis());
        return true;
    }
    if (hasLastKnown) {
        Serial.println("Dropping stale broker cache");
        hasLastKnown = false; lastKnownAttempts = 0;
    }
    return false;
}

// ── WiFi ──────────────────────────────────────────────────────────────────────

static void startWifi(bool force = false)
{
    if (!force && wifiStarted && WiFi.status() == WL_CONNECTED) return;
    WiFi.mode(WIFI_STA);
    WiFi.setAutoReconnect(true);
    WiFi.persistent(false);
    if (force) WiFi.disconnect(false);
    WiFi.begin(SSID_EFF, PASS_EFF);
    wifiStarted = true;
    nextWifiMs = millis() + WIFI_RECONNECT_MS;
    Serial.printf("WiFi connect ssid=%s status=%d uptime_ms=%lu\n",
        SSID_EFF, WiFi.status(), millis());
}

static bool ensureWifi()
{
    unsigned long now = millis();
    if (WiFi.status() == WL_CONNECTED) {
        if (!wasWifiUp) {
            Serial.printf("WiFi OK ip=%s rssi=%d uptime_ms=%lu\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI(), now);
            wasWifiUp = true;
        }
        return true;
    }

    if (wasWifiUp) {
        Serial.printf("WiFi disconnected status=%d uptime_ms=%lu\n", WiFi.status(), now);
        if (mqtt.connected()) mqtt.disconnect();
        net.stop();              // [Fix #1] đóng hoàn toàn TCP socket — PubSubClient tái sử dụng WiFiClient
        wasMqttUp      = false;  // [Fix #5] đồng bộ flag MQTT
        hasLastKnown   = false;  // [Fix #3] xóa cache broker cũ — buộc mDNS query lại
        lastKnownAttempts = 0;
        backoffIdx     = 0;      // [Fix #2] reset backoff — kết nối lại ngay sau khi WiFi phục hồi
        nextMqttMs     = 0;
        if (mdnsStarted) { MDNS.end(); mdnsStarted = false; }
        wasWifiUp = false;
    }

    // [Fix #4] so sánh overflow-safe với deadlinePassed()
    if (!wifiStarted || deadlinePassed(now, nextWifiMs)) {
        startWifi(true);
    } else if ((uint32_t)(now - lastWifiLogMs) >= WIFI_LOG_MS) {
        lastWifiLogMs = now;
        Serial.printf("WiFi waiting status=%d uptime_ms=%lu\n", WiFi.status(), now);
    }
    return false;
}

// ── MQTT ──────────────────────────────────────────────────────────────────────

static void scheduleMqttRetry()
{
    static const uint8_t MAX_IDX = sizeof(BACKOFF_MS) / sizeof(BACKOFF_MS[0]) - 1;
    uint8_t idx = (backoffIdx > MAX_IDX) ? MAX_IDX : backoffIdx;
    uint32_t delay = BACKOFF_MS[idx];
    nextMqttMs = millis() + delay;
    if (backoffIdx < MAX_IDX) backoffIdx++;
    Serial.printf("MQTT reconnect scheduled backoff_ms=%lu uptime_ms=%lu\n", delay, millis());
}

static void connectMQTT()
{
    unsigned long now = millis();
    if (mqtt.connected()) return;
    if (!ensureWifi()) return;
    if (!deadlinePassed(now, nextMqttMs)) return;   // [Fix #4]

    bool     usedCache = false;
    uint16_t port      = PORT_EFF;
    if (!resolveBroker(mqttIP, port, usedCache)) {
        mqttAttempts++;
        Serial.printf("MQTT resolve failed host=%s attempt=%lu uptime_ms=%lu\n",
            HOST_EFF, mqttAttempts, now);
        scheduleMqttRetry();
        return;
    }

    mqttPort = port;
    mqtt.setServer(mqttIP, mqttPort);
    mqttAttempts++;
    Serial.printf("MQTT connect attempt=%lu broker=%s:%u fallback=%s state=%d uptime_ms=%lu\n",
        mqttAttempts, mqttIP.toString().c_str(), mqttPort,
        usedCache ? "yes" : "no", mqtt.state(), now);

    char lwt[48];
    snprintf(lwt, sizeof(lwt), "{\"status\":\"offline\"}");
    const char* u = (strlen(MUSER_EFF) > 0) ? MUSER_EFF : nullptr;
    const char* p = (strlen(MPASS_EFF) > 0) ? MPASS_EFF : nullptr;

    if (mqtt.connect(DEVICE_ID, u, p, topicStatus, 1, /*retain=*/true, lwt)) {
        Serial.printf("MQTT connected broker=%s:%u uptime_ms=%lu\n",
            mqttIP.toString().c_str(), mqttPort, millis());
        backoffIdx = 0; nextMqttMs = 0; lastKnownAttempts = 0;
        wasMqttUp = true;
        mqtt.subscribe(topicCommands, 1);
        publishStatus("online");
        publishTelemetry();
        Serial.println("Waiting for device commands");
    } else {
        int state = mqtt.state();
        net.stop();              // [Fix #1] loại bỏ socket cũ — tránh CLOSE_WAIT/TIME_WAIT
        if (usedCache) lastKnownAttempts++;
        Serial.printf("MQTT connect failed state=%d attempt=%lu fallback_attempts=%u uptime_ms=%lu\n",
            state, mqttAttempts, lastKnownAttempts, millis());
        scheduleMqttRetry();
    }
}

// ── Setup & Loop ──────────────────────────────────────────────────────────────

void setup()
{
    Serial.begin(115200);
    if (strlen(SSID_EFF) == 0) {
        Serial.println("ERROR: WIFI_SSID empty — set credentials in platformio_local.ini");
        while (true) delay(10000);
    }

    // Khởi tạo GPIO
    pinMode(LIGHT_PIN,  OUTPUT); digitalWrite(LIGHT_PIN,  LOW);
    pinMode(RELAY2_PIN, OUTPUT); digitalWrite(RELAY2_PIN, LOW);

    // Cấu hình MQTT client
    mqtt.setBufferSize(MQTT_BUF_SIZE);
    mqtt.setKeepAlive(MQTT_KEEPALIVE_S);
    mqtt.setSocketTimeout(MQTT_SOCK_TIMEOUT_S);
    mqtt.setCallback(onMessage);

    snprintf(topicStatus,    sizeof(topicStatus),    "devices/%s/status",    DEVICE_ID);
    snprintf(topicTelemetry, sizeof(topicTelemetry), "devices/%s/telemetry", DEVICE_ID);
    snprintf(topicCommands,  sizeof(topicCommands),  "devices/%s/commands",  DEVICE_ID);

    startWifi();
}

void loop()
{
    bool wifiOk = ensureWifi();

    if (wifiOk && !mqtt.connected()) {
        if (wasMqttUp) {
            Serial.printf("MQTT disconnected state=%d uptime_ms=%lu\n", mqtt.state(), millis());
            wasMqttUp = false;
        }
        connectMQTT();
    }

    if (mqtt.connected()) {
        mqtt.loop();
        unsigned long now = millis();
        if ((uint32_t)(now - lastTelemetryMs) >= TELEMETRY_MS) {
            lastTelemetryMs = now;
            publishTelemetry();
            publishStatus("online");
        }
    }
}
