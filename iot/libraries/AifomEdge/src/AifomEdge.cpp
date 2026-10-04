#include "AifomEdge.h"

static const uint32_t WIFI_RECONNECT_MS = 10000;
static const uint32_t WIFI_LOG_MS = 5000;
static const uint32_t BACKOFF_MS[] = {2000, 5000, 10000, 30000, 60000};
static const uint8_t BACKOFF_COUNT = sizeof(BACKOFF_MS) / sizeof(BACKOFF_MS[0]);

AifomEdgeClass AifomEdge;

AifomEdgeClass::AifomEdgeClass() : _mqttClient(_netClient) {
    memset(_wifiSsid, 0, sizeof(_wifiSsid));
    memset(_wifiPass, 0, sizeof(_wifiPass));
    memset(_authToken, 0, sizeof(_authToken));
    memset(_mqttHost, 0, sizeof(_mqttHost));
    _mqttPort = 1883;
    memset(_deviceUid, 0, sizeof(_deviceUid));
    
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
}

void AifomEdgeClass::begin(const char* ssid, const char* pass, const char* authToken, const char* deviceUid, const char* host, uint16_t port) {
    strncpy(_wifiSsid, ssid, sizeof(_wifiSsid) - 1);
    strncpy(_wifiPass, pass, sizeof(_wifiPass) - 1);
    strncpy(_authToken, authToken, sizeof(_authToken) - 1);
    strncpy(_deviceUid, deviceUid, sizeof(_deviceUid) - 1);
    strncpy(_mqttHost, host, sizeof(_mqttHost) - 1);
    _mqttPort = port;

    snprintf(_topicCommandsWildcard, sizeof(_topicCommandsWildcard), "devices/%s/commands/ch_+", _deviceUid);
    snprintf(_topicCommandsPrefix, sizeof(_topicCommandsPrefix), "devices/%s/commands/ch_", _deviceUid);

    _mqttClient.setServer(_mqttHost, _mqttPort);
    _mqttClient.setCallback(AifomEdgeClass::mqttCallback);
    _mqttClient.setBufferSize(512);
    _mqttClient.setKeepAlive(60);
    _mqttClient.setSocketTimeout(5);

    startWifi();
}

void AifomEdgeClass::startWifi(bool force) {
    if (!force && _wifiStarted && WiFi.status() == WL_CONNECTED) return;
    WiFi.mode(WIFI_STA);
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
        }
        return true;
    }

    if (_wasWifiUp) {
        Serial.printf("[AifomEdge] WiFi disconnected status=%d uptime_ms=%lu\n", WiFi.status(), now);
        if (_mqttClient.connected()) _mqttClient.disconnect();
        _netClient.stop();
        _wasMqttUp = false;
        _backoffIdx = 0;
        _nextMqttMs = 0;
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

void AifomEdgeClass::connectMQTT() {
    unsigned long now = millis();
    if (_mqttClient.connected()) return;
    if (!ensureWifi()) return;
    if ((long)(now - _nextMqttMs) < 0) return;

    Serial.printf("[AifomEdge] MQTT connect attempt broker=%s:%u uid=%s uptime_ms=%lu\n",
                  _mqttHost, _mqttPort, _deviceUid, now);

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
        
        _mqttClient.subscribe(_topicCommandsWildcard, 1);
        
        char onlinePayload[128];
        snprintf(onlinePayload, sizeof(onlinePayload), "{\"device_id\":\"%s\",\"status\":\"online\"}", _deviceUid);
        _mqttClient.publish(topicStatus, onlinePayload, true);
        
        Serial.printf("[AifomEdge] Subscribed to %s\n", _topicCommandsWildcard);
    } else {
        int state = _mqttClient.state();
        _netClient.stop();
        Serial.printf("[AifomEdge] MQTT connect failed state=%d uptime_ms=%lu\n", state, millis());
        scheduleMqttRetry();
    }
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
        }
        connectMQTT();
    }

    if (_mqttClient.connected()) {
        _mqttClient.loop();
    }
}

void AifomEdgeClass::onWrite(int channel, AifomEdgeCallback cb) {
    if (channel >= 1 && channel <= AIFOM_MAX_CHANNELS) {
        _callbacks[channel - 1] = cb;
    }
}

void AifomEdgeClass::virtualWrite(int channel, const char* value) {
    if (!_mqttClient.connected()) return;
    char topicTelemetry[128];
    snprintf(topicTelemetry, sizeof(topicTelemetry), "devices/%s/telemetry/ch_%d", _deviceUid, channel);
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
    int prefixLen = strlen(_topicCommandsPrefix);
    if (strncmp(topic, _topicCommandsPrefix, prefixLen) == 0) {
        const char* chStr = topic + prefixLen;
        int channel = atoi(chStr);
        
        char* valStr = (char*)malloc(length + 1);
        if (valStr) {
            memcpy(valStr, payload, length);
            valStr[length] = '\0';

            AifomParam param(valStr);
            
            if (channel >= 1 && channel <= AIFOM_MAX_CHANNELS) {
                int idx = channel - 1;
                if (_callbacks[idx] != nullptr) {
                    _callbacks[idx](param);
                    virtualWrite(channel, valStr);
                }
            }
            free(valStr);
        }
    }
}
