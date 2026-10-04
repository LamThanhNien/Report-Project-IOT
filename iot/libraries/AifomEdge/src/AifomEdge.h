#ifndef AIFOM_EDGE_H
#define AIFOM_EDGE_H

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>

#define AIFOM_MAX_CHANNELS 16

class AifomParam {
private:
    const char* _val;
public:
    AifomParam(const char* val) : _val(val) {}
    int asInt() const { return _val ? atoi(_val) : 0; }
    double asDouble() const { return _val ? atof(_val) : 0.0; }
    float asFloat() const { return _val ? (float)atof(_val) : 0.0f; }
    const char* asStr() const { return _val ? _val : ""; }
    const char* asString() const { return asStr(); }
};

typedef void (*AifomEdgeCallback)(AifomParam param);

class AifomEdgeClass {
private:
    WiFiClient _netClient;
    PubSubClient _mqttClient;

    char _wifiSsid[64];
    char _wifiPass[64];
    char _authToken[64];
    char _mqttHost[64];
    uint16_t _mqttPort;
    char _deviceUid[64];

    AifomEdgeCallback _callbacks[AIFOM_MAX_CHANNELS];

    bool _wifiStarted;
    bool _wasWifiUp;
    bool _wasMqttUp;
    unsigned long _nextWifiMs;
    unsigned long _lastWifiLogMs;
    unsigned long _nextMqttMs;
    uint8_t _backoffIdx;

    char _topicCommandsWildcard[128];
    char _topicCommandsPrefix[128];

    void startWifi(bool force = false);
    bool ensureWifi();
    void connectMQTT();
    void scheduleMqttRetry();
    void handleMqttMessage(char* topic, byte* payload, unsigned int length);

    static void mqttCallback(char* topic, byte* payload, unsigned int length);

public:
    AifomEdgeClass();

    void begin(const char* ssid, const char* pass, const char* authToken, const char* deviceUid, const char* host = "aifom.local", uint16_t port = 1883);
    void run();

    void onWrite(int channel, AifomEdgeCallback cb);

    void virtualWrite(int channel, const char* value);
    void virtualWrite(int channel, String value);
    void virtualWrite(int channel, int value);
    void virtualWrite(int channel, float value, int decimals = 2);
    void virtualWrite(int channel, double value, int decimals = 2);

    bool connected();
};

extern AifomEdgeClass AifomEdge;

#endif // AIFOM_EDGE_H
