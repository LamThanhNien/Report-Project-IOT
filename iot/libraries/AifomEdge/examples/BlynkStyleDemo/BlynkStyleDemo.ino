#include <AifomEdge.h>

// WiFi credentials
const char* ssid = "Your_WiFi_SSID";
const char* pass = "Your_WiFi_Password";

// Aifom IoT credentials
const char* auth_token = "your-auth-token-here";
const char* device_uid = "esp32-demo-001";
const char* mqtt_host  = "aifom.local";
const uint16_t mqtt_port = 1883;

// GPIO configuration
const int LED_PIN_1 = 2; // Built-in LED / Relay 1
const int LED_PIN_2 = 4; // Relay 2

// Timing variables for sending telemetry
unsigned long lastTelemetryMs = 0;
const unsigned long telemetryIntervalMs = 5000; // Send telemetry every 5 seconds

// Callback for Virtual Channel 1
void onVirtualChannel1Write(AifomParam param) {
  int value = param.asInt();
  digitalWrite(LED_PIN_1, value ? HIGH : LOW);
  Serial.printf("[Demo] Channel 1 write value: %d\n", value);
}

// Callback for Virtual Channel 2
void onVirtualChannel2Write(AifomParam param) {
  int value = param.asInt();
  digitalWrite(LED_PIN_2, value ? HIGH : LOW);
  Serial.printf("[Demo] Channel 2 write value: %d\n", value);
}

// Callback for Virtual Channel 3 (e.g. receiving a floating point slider value)
void onVirtualChannel3Write(AifomParam param) {
  float value = param.asFloat();
  Serial.printf("[Demo] Channel 3 write value: %.2f\n", value);
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("[Demo] Starting BlynkStyleDemo...");

  // Initialize GPIO pins
  pinMode(LED_PIN_1, OUTPUT);
  pinMode(LED_PIN_2, OUTPUT);
  digitalWrite(LED_PIN_1, LOW);
  digitalWrite(LED_PIN_2, LOW);

  // Register virtual channel callbacks
  AifomEdge.onWrite(1, onVirtualChannel1Write);
  AifomEdge.onWrite(2, onVirtualChannel2Write);
  AifomEdge.onWrite(3, onVirtualChannel3Write);

  // Initialize AifomEdge (begins connection asynchronously)
  AifomEdge.begin(ssid, pass, auth_token, device_uid, mqtt_host, mqtt_port);
}

void loop() {
  // Run connection manager and process incoming MQTT messages (non-blocking)
  AifomEdge.run();

  // Send periodic telemetry in a non-blocking manner
  unsigned long now = millis();
  if (now - lastTelemetryMs >= telemetryIntervalMs) {
    lastTelemetryMs = now;

    if (AifomEdge.connected()) {
      // Simulate reading sensors
      float temp = 22.0f + (random(0, 100) / 10.0f);
      float hum  = 50.0f + (random(0, 200) / 10.0f);
      
      // Publish sensor values to virtual channels V4 and V5
      AifomEdge.virtualWrite(4, temp, 2);
      AifomEdge.virtualWrite(5, hum, 2);

      // Publish uptime to V6
      AifomEdge.virtualWrite(6, (int)(millis() / 1000));

      Serial.printf("[Demo] Periodic telemetry sent: temp=%.2f, hum=%.2f\n", temp, hum);
    }
  }

  // Sensor readings and other device tasks can run here without being blocked.
}
