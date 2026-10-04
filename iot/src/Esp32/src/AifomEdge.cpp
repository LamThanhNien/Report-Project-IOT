#include "AifomEdge.h"
#include <ESPmDNS.h>
#include "esp_pm.h"      // Dynamic Frequency Scaling + Automatic Light-Sleep API
#include "esp_wifi.h"    // esp_wifi_set_ps() — power-save mode granular hơn WiFi.setSleep()

static const uint32_t WIFI_RECONNECT_MS = 60000;
static const uint32_t WIFI_LOG_MS = 5000;
static const uint32_t BACKOFF_MS[] = {2000, 5000, 10000, 30000, 60000};
static const uint8_t BACKOFF_COUNT = sizeof(BACKOFF_MS) / sizeof(BACKOFF_MS[0]);

// Công suất phát WiFi — giảm từ mặc định ~19.5 dBm xuống 15 dBm vì thiết bị
// thường đặt gần AP; giảm nhiệt và tiêu thụ điện. Chỉnh hằng số này nếu cần.
static const wifi_power_t WIFI_TX_POWER = WIFI_POWER_15dBm;

// Tần số CPU tối đa khi bận — 160 MHz đủ cho WiFi + MQTT + mDNS, ít nóng hơn 240 MHz.
// Chỉnh lên 240 nếu cần xử lý cảm biến nặng.
static const int PM_MAX_FREQ_MHZ = 160;
// Tần số CPU tối thiểu khi FreeRTOS idle — ESP-IDF yêu cầu >= 40 MHz khi WiFi bật.
// 80 MHz an toàn cho Arduino core và PubSubClient; 40 MHz tiết kiệm hơn nhưng rủi ro hơn.
static const int PM_MIN_FREQ_MHZ = 80;

AifomEdgeClass AifomEdge;

AifomEdgeClass::AifomEdgeClass() : _mqttClient(_netClient) {
    memset(_wifiSsid, 0, sizeof(_wifiSsid));
    memset(_wifiPass, 0, sizeof(_wifiPass));
    memset(_authToken, 0, sizeof(_authToken));
    memset(_mqttHost, 0, sizeof(_mqttHost));
    _mqttPort = 1883;
    memset(_deviceUid, 0, sizeof(_deviceUid));
    memset(_firmwareVersion, 0, sizeof(_firmwareVersion));
    
    for (int i = 0; i < AIFOM_MAX_CHANNELS; i++) {
        _callbacks[i] = nullptr;
    }

    _wifiStarted = false;
    _wasWifiUp = false;
    _wasMqttUp = false;
    _nextWifiMs = 0;
    _lastWifiLogMs = 0;
    _nextMqttMs = 0;
    _backoffIdx = 0;
    _lastHeartbeatMs = 0;
    _mdnsStarted = false;
    _lastKnownIP = INADDR_NONE;
    _lastKnownPort = 0;
    _hasLastKnown = false;
    _lastKnownAttempts = 0;
}

void AifomEdgeClass::begin(const char* ssid, const char* pass, const char* authToken, const char* deviceUid, const char* host, uint16_t port) {
    strncpy(_wifiSsid, ssid, sizeof(_wifiSsid) - 1);
    strncpy(_wifiPass, pass, sizeof(_wifiPass) - 1);
    strncpy(_authToken, authToken, sizeof(_authToken) - 1);
    strncpy(_deviceUid, deviceUid, sizeof(_deviceUid) - 1);
    strncpy(_mqttHost, host, sizeof(_mqttHost) - 1);
    _mqttPort = port;

    snprintf(_topicCommandsWildcard, sizeof(_topicCommandsWildcard), "devices/%s/commands/+", _deviceUid);
    snprintf(_topicCommandsPrefix, sizeof(_topicCommandsPrefix), "devices/%s/commands/ch_", _deviceUid);

    snprintf(_topicOta, sizeof(_topicOta), "devices/%s/ota", _deviceUid);
    snprintf(_topicOtaStatus, sizeof(_topicOtaStatus), "devices/%s/ota/status", _deviceUid);

    _mqttClient.setServer(_mqttHost, _mqttPort);
    _mqttClient.setCallback(AifomEdgeClass::mqttCallback);
    _mqttClient.setBufferSize(4096); // Tăng buffer size để nhận đủ chuỗi JSON OTA rất dài
    // TODO: Tăng keepAlive lên 45–60 s để giảm PINGREQ sau khi xác nhận broker
    // (Mosquitto mặc định timeout = 1.5× keepAlive, nên 60 s vẫn an toàn với timeout 90 s).
    // Hiện giữ 60 s — nếu broker từ chối hãy hạ về 45 hoặc 20.
    _mqttClient.setKeepAlive(60);
    _mqttClient.setSocketTimeout(15);

    _prefs.begin("aifom", false);
    String savedVer = _prefs.getString("fw_ver", "");
    if (savedVer.length() > 0 && strlen(_firmwareVersion) == 0) {
        strlcpy(_firmwareVersion, savedVer.c_str(), sizeof(_firmwareVersion));
    }
    _prefs.end();

    startWifi();

    // Kích hoạt DFS + Automatic Light-Sleep sau khi WiFi stack đã khởi động.
    // Phải gọi sau startWifi() vì esp_wifi_set_ps() cần WiFi driver đang chạy.
    initPowerManagement();
}

void AifomEdgeClass::setFirmwareVersion(const char* version) {
    if (version) {
        strlcpy(_firmwareVersion, version, sizeof(_firmwareVersion));
        _prefs.begin("aifom", false);
        String current = _prefs.getString("fw_ver", "");
        if (current != version) {
            _prefs.putString("fw_ver", version);
        }
        _prefs.end();
    }
}

void AifomEdgeClass::startWifi(bool force) {
    if (!force && _wifiStarted && WiFi.status() == WL_CONNECTED) return;
    WiFi.mode(WIFI_STA);
    // Bật modem-sleep qua Arduino API (WiFi.setSleep = wrapper của esp_wifi_set_ps).
    // Chế độ chính xác (MIN_MODEM) sẽ được set lại trong initPowerManagement() qua
    // esp_wifi_set_ps() trực tiếp để phối hợp đúng với PM framework — cuộc gọi sau
    // ghi đè cuộc gọi trước, không conflict.
    WiFi.setSleep(true);
    // Giảm công suất phát từ mặc định ~19.5 dBm xuống WIFI_TX_POWER (15 dBm).
    WiFi.setTxPower(WIFI_TX_POWER);
    WiFi.setAutoReconnect(true);
    WiFi.persistent(false);
    if (force) WiFi.disconnect(false);
    WiFi.begin(_wifiSsid, _wifiPass);
    _wifiStarted = true;
    _nextWifiMs = millis() + WIFI_RECONNECT_MS;
    Serial.printf("[AifomEdge] WiFi connect ssid=%s status=%d uptime_ms=%lu\n",
                  _wifiSsid, WiFi.status(), millis());
}

bool AifomEdgeClass::ensureWifi() {
    unsigned long now = millis();
    if (WiFi.status() == WL_CONNECTED) {
        if (!_wasWifiUp) {
            Serial.printf("[AifomEdge] WiFi OK ip=%s rssi=%d uptime_ms=%lu\n",
                          WiFi.localIP().toString().c_str(), WiFi.RSSI(), now);
            _wasWifiUp = true;
            _backoffIdx = 0;
            _nextMqttMs = 0;
        }
        // Reset the reconnect timer while WiFi is healthy so it never fires
        // spuriously and tears down an active MQTT connection.
        _nextWifiMs = now + WIFI_RECONNECT_MS;
        return true;
    }

    if (_wasWifiUp) {
        Serial.printf("[AifomEdge] WiFi disconnected status=%d uptime_ms=%lu\n", WiFi.status(), now);
        if (_mqttClient.connected()) _mqttClient.disconnect();
        _netClient.stop();
        _wasMqttUp = false;
        _backoffIdx = 0;
        _nextMqttMs = 0;
        _hasLastKnown = false;
        _lastKnownAttempts = 0;
        if (_mdnsStarted) {
            MDNS.end();
            _mdnsStarted = false;
        }
        _wasWifiUp = false;
    }

    if (!_wifiStarted || ((long)(now - _nextWifiMs) >= 0)) {
        startWifi(true);
    } else if ((unsigned long)(now - _lastWifiLogMs) >= WIFI_LOG_MS) {
        _lastWifiLogMs = now;
        Serial.printf("[AifomEdge] WiFi waiting status=%d uptime_ms=%lu\n", WiFi.status(), now);
    }
    return false;
}

void AifomEdgeClass::ensureMdns() {
    if (_mdnsStarted || WiFi.status() != WL_CONNECTED) return;
    if (!MDNS.begin("esp32-aifom")) {
        Serial.printf("[AifomEdge] mDNS init failed uptime_ms=%lu\n", millis());
    } else {
        _mdnsStarted = true;
        Serial.printf("[AifomEdge] mDNS client ready uptime_ms=%lu\n", millis());
    }
}

void AifomEdgeClass::initPowerManagement() {
    // Cấu hình Dynamic Frequency Scaling (DFS) + Automatic Light-Sleep.
    // DFS: CPU tự hạ tần số (160→80 MHz) khi rảnh, tăng lại khi cần — transparent với code.
    // Auto Light-Sleep: FreeRTOS idle task vào light-sleep, radio WiFi sync theo DTIM beacon;
    //   CPU + radio cùng nghỉ, wakeup hardware < 1 ms, độ trễ nhận lệnh MQTT ~ 100–300 ms
    //   tùy DTIM interval của AP (thường 100–300 ms — chấp nhận được cho IoT).
    // Yêu cầu: CONFIG_PM_ENABLE=y và CONFIG_FREERTOS_USE_TICKLESS_IDLE=1 trong sdkconfig
    //   (đã cấu hình qua board_build.sdkconfig_options trong platformio.ini).
    esp_pm_config_esp32_t pm_config = {};
    pm_config.max_freq_mhz       = PM_MAX_FREQ_MHZ;
    pm_config.min_freq_mhz       = PM_MIN_FREQ_MHZ;
    pm_config.light_sleep_enable = true;

    esp_err_t err = esp_pm_configure(&pm_config);
    if (err == ESP_OK) {
        Serial.printf("[AifomEdge] PM: DFS %d/%d MHz + auto light-sleep ON uptime_ms=%lu\n",
                      PM_MAX_FREQ_MHZ, PM_MIN_FREQ_MHZ, millis());
    } else if (err == ESP_ERR_NOT_SUPPORTED) {
        // Xảy ra khi CONFIG_PM_ENABLE hoặc CONFIG_FREERTOS_USE_TICKLESS_IDLE chưa bật.
        // Thư viện vẫn hoạt động bình thường — chỉ mất tính năng tiết kiệm năng lượng.
        Serial.println("[AifomEdge] PM: NOT SUPPORTED — kiểm tra CONFIG_PM_ENABLE "
                       "và CONFIG_FREERTOS_USE_TICKLESS_IDLE trong platformio.ini");
    } else {
        Serial.printf("[AifomEdge] PM: esp_pm_configure lỗi err=0x%x uptime_ms=%lu\n",
                      err, millis());
    }

    // Đặt WiFi power-save mode qua ESP-IDF API trực tiếp để phối hợp đúng với PM framework.
    // WIFI_PS_MIN_MODEM: radio nghỉ giữa các DTIM beacon, wakeup đúng lịch AP.
    // Ghi đè WiFi.setSleep(true) đã gọi trong startWifi() — kết quả giống nhau.
    esp_err_t ps_err = esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
    if (ps_err == ESP_OK) {
        Serial.printf("[AifomEdge] PM: WiFi WIFI_PS_MIN_MODEM OK uptime_ms=%lu\n", millis());
    } else {
        Serial.printf("[AifomEdge] PM: esp_wifi_set_ps lỗi err=0x%x uptime_ms=%lu\n",
                      ps_err, millis());
    }
}

void AifomEdgeClass::connectMQTT() {
    unsigned long now = millis();
    if (_mqttClient.connected()) return;
    if (!ensureWifi()) return;
    if ((long)(now - _nextMqttMs) < 0) return;

    ensureMdns();

    IPAddress brokerIp;
    uint16_t brokerPort = _mqttPort;
    String hostStr = String(_mqttHost);
    bool isLocal = hostStr.endsWith(".local");
    bool resolved = false;

    if (isLocal) {
        if (_mdnsStarted) {
            // Try queryService first
            Serial.printf("[AifomEdge] mDNS query service _aifom-mqtt._tcp uptime_ms=%lu\n", millis());
            int n = MDNS.queryService("aifom-mqtt", "tcp");
            if (n > 0) {
                brokerIp = MDNS.IP(0);
                brokerPort = (MDNS.port(0) > 0) ? MDNS.port(0) : _mqttPort;
                Serial.printf("[AifomEdge] mDNS service _aifom-mqtt._tcp -> %s:%u\n", brokerIp.toString().c_str(), brokerPort);
                _lastKnownIP = brokerIp;
                _lastKnownPort = brokerPort;
                _hasLastKnown = true;
                _lastKnownAttempts = 0;
                resolved = true;
            } else {
                // Fallback to queryHost
                Serial.printf("[AifomEdge] mDNS service failed, host query uptime_ms=%lu\n", millis());
                String mdnsName = hostStr.substring(0, hostStr.length() - 6);
                brokerIp = MDNS.queryHost(mdnsName, 1500);
                if (brokerIp != INADDR_NONE && brokerIp.toString() != "0.0.0.0") {
                    Serial.printf("[AifomEdge] mDNS host %s.local -> %s:%u\n", mdnsName.c_str(), brokerIp.toString().c_str(), brokerPort);
                    _lastKnownIP = brokerIp;
                    _lastKnownPort = brokerPort;
                    _hasLastKnown = true;
                    _lastKnownAttempts = 0;
                    resolved = true;
                }
            }
        }

        if (!resolved) {
            if (_hasLastKnown && _lastKnownAttempts < 5) {
                brokerIp = _lastKnownIP;
                brokerPort = _lastKnownPort;
                _lastKnownAttempts++;
                resolved = true;
                Serial.printf("[AifomEdge] Using cached broker %s:%u attempt=%u/5 uptime_ms=%lu\n",
                              brokerIp.toString().c_str(), brokerPort, _lastKnownAttempts, millis());
            } else if (_hasLastKnown) {
                Serial.println("[AifomEdge] Dropping stale broker cache");
                _hasLastKnown = false;
                _lastKnownAttempts = 0;
            }
        }
    }

    if (resolved) {
        _mqttClient.setServer(brokerIp, brokerPort);
    } else {
        Serial.printf("[AifomEdge] Using default server %s:%u uptime_ms=%lu\n", _mqttHost, _mqttPort, now);
        _mqttClient.setServer(_mqttHost, _mqttPort);
    }

    Serial.printf("[AifomEdge] MQTT connect attempt broker=%s:%u uid=%s uptime_ms=%lu\n",
                  resolved ? brokerIp.toString().c_str() : _mqttHost, brokerPort, _deviceUid, now);

    char topicStatus[128];
    snprintf(topicStatus, sizeof(topicStatus), "devices/%s/status", _deviceUid);
    
    char lwt[64];
    snprintf(lwt, sizeof(lwt), "{\"device_id\":\"%s\",\"status\":\"offline\"}", _deviceUid);

    const char* user = (strlen(_authToken) > 0) ? _authToken : nullptr;
    const char* pass = (strlen(_authToken) > 0) ? _authToken : nullptr;

    if (_mqttClient.connect(_deviceUid, user, pass, topicStatus, 1, true, lwt)) {
        Serial.printf("[AifomEdge] MQTT connected uptime_ms=%lu\n", millis());
        _backoffIdx = 0;
        _nextMqttMs = 0;
        _wasMqttUp = true;
        _lastKnownAttempts = 0;
        
        _mqttClient.subscribe(_topicCommandsWildcard, 1);
        _mqttClient.subscribe(_topicOta, 1);
        Serial.printf("[AifomEdge] Subscribed to %s\n", _topicOta);
        
        char onlinePayload[192];
        // Thêm timestamp ISO8601 để backend không ignore retained payload
        unsigned long now_ms = millis();
        if (strlen(_firmwareVersion) > 0) {
            snprintf(onlinePayload, sizeof(onlinePayload),
                     "{\"device_id\":\"%s\",\"status\":\"online\",\"uptime_ms\":%lu,\"firmware_version\":\"%s\"}",
                     _deviceUid, now_ms, _firmwareVersion);
        } else {
            snprintf(onlinePayload, sizeof(onlinePayload),
                     "{\"device_id\":\"%s\",\"status\":\"online\",\"uptime_ms\":%lu}",
                     _deviceUid, now_ms);
        }
        _mqttClient.publish(topicStatus, onlinePayload, false); // retain=false để backend luôn process
        _lastHeartbeatMs = now_ms;
        
        Serial.printf("[AifomEdge] Subscribed to %s\n", _topicCommandsWildcard);
    } else {
        int state = _mqttClient.state();
        _netClient.stop();
        Serial.printf("[AifomEdge] MQTT connect failed state=%d uptime_ms=%lu\n", state, millis());
        scheduleMqttRetry();
    }
}

void AifomEdgeClass::sendHeartbeat() {
    if (!_mqttClient.connected()) return;
    char topicHeartbeat[128];
    snprintf(topicHeartbeat, sizeof(topicHeartbeat), "devices/%s/heartbeat", _deviceUid);
    char hbPayload[192];
    if (strlen(_firmwareVersion) > 0) {
        snprintf(hbPayload, sizeof(hbPayload),
                 "{\"device_id\":\"%s\",\"uptime_ms\":%lu,\"firmware_version\":\"%s\"}",
                 _deviceUid, millis(), _firmwareVersion);
    } else {
        snprintf(hbPayload, sizeof(hbPayload),
                 "{\"device_id\":\"%s\",\"uptime_ms\":%lu}",
                 _deviceUid, millis());
    }
    _mqttClient.publish(topicHeartbeat, hbPayload, false);
    Serial.printf("[AifomEdge] Heartbeat sent uptime_ms=%lu\n", millis());
}

void AifomEdgeClass::scheduleMqttRetry() {
    uint8_t idx = (_backoffIdx >= BACKOFF_COUNT) ? (BACKOFF_COUNT - 1) : _backoffIdx;
    uint32_t delay = BACKOFF_MS[idx];
    _nextMqttMs = millis() + delay;
    if (_backoffIdx < BACKOFF_COUNT) _backoffIdx++;
    Serial.printf("[AifomEdge] MQTT reconnect scheduled in %lu ms\n", delay);
}

void AifomEdgeClass::run() {
    bool wifiOk = ensureWifi();

    if (wifiOk && !_mqttClient.connected()) {
        if (_wasMqttUp) {
            Serial.printf("[AifomEdge] MQTT disconnected state=%d uptime_ms=%lu\n", _mqttClient.state(), millis());
            _wasMqttUp = false;
            _netClient.stop();
        }
        connectMQTT();
    }

    if (_mqttClient.connected()) {
        _mqttClient.loop();
        // Gửi heartbeat mỗi 30 giây để cập nhật last_seen_at và tránh bị mark offline
        static const unsigned long HEARTBEAT_INTERVAL_MS = 30000;
        unsigned long now = millis();
        if ((unsigned long)(now - _lastHeartbeatMs) >= HEARTBEAT_INTERVAL_MS) {
            sendHeartbeat();
            _lastHeartbeatMs = now;
        }

        if (_otaPending && !_otaInProgress) {
            _otaPending = false;
            _otaInProgress = true;
            processOta();
            _otaInProgress = false;
        }
    }
    yield();
}

void AifomEdgeClass::onWrite(int channel, AifomEdgeCallback cb) {
    if (channel >= 0 && channel < AIFOM_MAX_CHANNELS) {
        _callbacks[channel] = cb;
    }
}

void AifomEdgeClass::virtualWrite(int channel, const char* value) {
    if (!_mqttClient.connected() || channel < 0 || channel >= AIFOM_MAX_CHANNELS) return;
    char topicTelemetry[128];
    snprintf(topicTelemetry, sizeof(topicTelemetry), "devices/%s/telemetry/ch_v%d", _deviceUid, channel);
    _mqttClient.publish(topicTelemetry, value, false);
}

void AifomEdgeClass::virtualWrite(int channel, String value) {
    virtualWrite(channel, value.c_str());
}

void AifomEdgeClass::virtualWrite(int channel, int value) {
    char buf[16];
    itoa(value, buf, 10);
    virtualWrite(channel, buf);
}

void AifomEdgeClass::virtualWrite(int channel, float value, int decimals) {
    char buf[32];
    dtostrf(value, 0, decimals, buf);
    virtualWrite(channel, buf);
}

void AifomEdgeClass::virtualWrite(int channel, double value, int decimals) {
    char buf[32];
    dtostrf(value, 0, decimals, buf);
    virtualWrite(channel, buf);
}

bool AifomEdgeClass::connected() {
    return _mqttClient.connected();
}

void AifomEdgeClass::mqttCallback(char* topic, byte* payload, unsigned int length) {
    AifomEdge.handleMqttMessage(topic, payload, length);
}

void AifomEdgeClass::handleMqttMessage(char* topic, byte* payload, unsigned int length) {
    if (strcmp(topic, _topicOta) == 0) {
        handleOtaMessage(payload, length);
        return;
    }

    int prefixLen = strlen(_topicCommandsPrefix);
    if (strncmp(topic, _topicCommandsPrefix, prefixLen) == 0) {
        const char* chStr = topic + prefixLen;
        bool virtualChannel = chStr[0] == 'v';
        const char* channelText = virtualChannel ? chStr + 1 : chStr;
        if (*channelText == '\0') return;
        for (const char* cursor = channelText; *cursor; ++cursor) {
            if (*cursor < '0' || *cursor > '9') return;
        }
        int channel = atoi(channelText);
        
        char* valStr = (char*)malloc(length + 1);
        if (valStr) {
            memcpy(valStr, payload, length);
            valStr[length] = '\0';

            AifomParam param(valStr);
            
            if (channel >= 0 && channel < AIFOM_MAX_CHANNELS) {
                if (_callbacks[channel] != nullptr) {
                    _callbacks[channel](param);
                    if (virtualChannel) {
                        // State telemetry is the virtual command acknowledgement.
                        virtualWrite(channel, valStr);
                    } else {
                        // Preserve legacy physical/GPIO state topics. ch_2 is not Virtual Pin V2.
                        char legacyTopic[128];
                        snprintf(legacyTopic, sizeof(legacyTopic), "devices/%s/telemetry/ch_%d", _deviceUid, channel);
                        _mqttClient.publish(legacyTopic, valStr, false);
                    }
                }
            }
            free(valStr);
        }
    }
}

void AifomEdgeClass::handleOtaMessage(byte* payload, unsigned int length) {
    if (_otaInProgress) {
        Serial.println("[OTA] Đang xử lý job khác, bỏ qua lệnh mới.");
        return;
    }

    JsonDocument doc;
    if (deserializeJson(doc, payload, length)) {
        Serial.println("[OTA] Parse JSON failed");
        return;
    }

    const char* jobId       = doc["job_id"];
    const char* firmwareUrl = doc["firmware_url"] | doc["download_url"];
    const char* version     = doc["firmware_version"] | doc["version"];
    const char* md5         = doc["firmware_md5"] | doc["md5"] | "";
    int expectedSize        = doc["file_size"] | doc["size_bytes"] | 0;

    if (!jobId || !firmwareUrl) {
        Serial.println("[OTA] Missing required fields");
        return;
    }

    _pendingJobId = jobId;
    _pendingFirmwareUrl = firmwareUrl;
    _pendingVersion = version ? version : "";
    _pendingMd5 = md5;
    _pendingExpectedSize = expectedSize;
    _otaPending = true;
}

void AifomEdgeClass::processOta() {
    const char* jobId   = _pendingJobId.c_str();
    const char* version = _pendingVersion.c_str();

    String url = _pendingFirmwareUrl;
    if (_hasLastKnown && url.indexOf(_mqttHost) != -1) {
        // HTTPClient của Arduino không tự phân giải mDNS (.local),
        // nên ta dùng lại IP đã resolve thành công từ MQTT để thay thế.
        url.replace(_mqttHost, _lastKnownIP.toString());
    }

    Serial.printf("[OTA] Bắt đầu job %s, URL: %s\n", jobId, url.c_str());
    publishOtaStatus(jobId, "started", 0, version, "OTA started");

    HTTPClient http;
    http.begin(url);
    int httpCode = http.GET();
    
    if (httpCode != HTTP_CODE_OK) {
        char msg[64];
        snprintf(msg, sizeof(msg), "HTTP GET failed (%d)", httpCode);
        publishOtaStatus(jobId, "failed", 0, version, msg);
        http.end();
        return;
    }

    int contentLength = http.getSize();
    int sizeToUse = (contentLength > 0) ? contentLength : _pendingExpectedSize;

    if (sizeToUse <= 0) {
        publishOtaStatus(jobId, "failed", 0, version, "Unknown content size");
        http.end();
        return;
    }
    
    if (_pendingExpectedSize > 0 && contentLength > 0 && contentLength != _pendingExpectedSize) {
        publishOtaStatus(jobId, "failed", 0, version, "Size mismatch");
        http.end();
        return;
    }

    if ((size_t)sizeToUse > ESP.getFreeSketchSpace()) {
        publishOtaStatus(jobId, "failed", 0, version, "Not enough flash space");
        http.end();
        return;
    }

    if (!Update.begin(sizeToUse)) {
        char msg[80];
        snprintf(msg, sizeof(msg), "Update.begin failed: %s", Update.errorString());
        publishOtaStatus(jobId, "failed", 0, version, msg);
        http.end();
        return;
    }

    if (_pendingMd5.length() > 0) {
        Update.setMD5(_pendingMd5.c_str());
    }

    Update.onProgress([&](size_t written, size_t total) {
        static int lastPct = -1;
        int pct = (total > 0) ? (int)((written * 100) / total) : 0;
        if (pct != lastPct && pct % 10 == 0) {
            lastPct = pct;
            AifomEdge.publishOtaStatus(AifomEdge._pendingJobId.c_str(), "downloading", pct, AifomEdge._pendingVersion.c_str(), "Downloading...");
        }
    });

    WiFiClient* stream = http.getStreamPtr();
    size_t written = Update.writeStream(*stream);

    if (written != (size_t)sizeToUse) {
        char msg[64];
        snprintf(msg, sizeof(msg), "Write incomplete: %u/%d", written, sizeToUse);
        Update.abort();
        publishOtaStatus(jobId, "failed", 0, version, msg);
        http.end();
        return;
    }

    if (!Update.end()) {
        char msg[80];
        snprintf(msg, sizeof(msg), "Update.end failed: %s", Update.errorString());
        publishOtaStatus(jobId, "failed", 0, version, msg);
        http.end();
        return;
    }

    if (!Update.isFinished()) {
        publishOtaStatus(jobId, "failed", 0, version, "Update did not finish cleanly");
        http.end();
        return;
    }

    Serial.println("[OTA] Thành công, khởi động lại...");
    publishOtaStatus(jobId, "success", 100, version, "OTA success");
    http.end();

    if (version) {
        _prefs.begin("aifom", false);
        _prefs.putString("fw_ver", version);
        _prefs.end();
    }

    delay(1000);
    ESP.restart();
}

void AifomEdgeClass::publishOtaStatus(const char* jobId, const char* status, int progress, const char* version, const char* message) {
    if (!_mqttClient.connected()) return;
    
    char payload[512];
    snprintf(payload, sizeof(payload), 
             "{\"job_id\":\"%s\",\"device_id\":\"%s\",\"status\":\"%s\",\"progress\":%d,\"firmware_version\":\"%s\",\"message\":\"%s\",\"timestamp\":%lu}",
             jobId, _deviceUid, status, progress, version, message, millis());
             
    _mqttClient.publish(_topicOtaStatus, payload, true);
    Serial.printf("[OTA] Status: %s (%d%%)\n", status, progress);
}
