#include <AifomEdge.h>
#include <DHT.h>

// =========================
// WiFi credentials
// =========================
const char* ssid = "Nha Tro SV Khanh An";
const char* pass = "68686868";

// const char* ssid = "VNPT THANH NIEN";
// const char* pass = "123456780";

// =========================
// Aifom IoT credentials
// =========================
const char* auth_token = "0_nX63zhQlPUKiEdMxydABEfCMRJ76yRFT9P7dw7emU";
const char* device_uid = "Esp32 test 1";
const char* mqtt_host  = "aifom.local";
const uint16_t mqtt_port = 1884;

// ===================================================
// GPIO Configuration (Physical Pins)
// ===================================================
const int LED_PIN = 2; // Pin connected to D2 (GPIO 2)

// ===================================================
// Virtual Pin Configuration (Server Channels)
// ===================================================
const int VIRTUAL_LED_PIN = 2;       // V2: LED Control
const int VIRTUAL_TEMP_PIN = 3;      // V3: Temperature Telemetry
const int VIRTUAL_HUMIDITY_PIN = 4;  // V4: Humidity Telemetry

// DHT11
#define DHTPIN 15
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);

// Gửi dữ liệu định kỳ (Cấu hình chu kỳ gửi Telemetry)
unsigned long lastRead = 0;
const unsigned long READ_INTERVAL = 5000; // 5000ms = 5 giây (Giúp giảm tải server & tránh spam)

// ===================================================
// Callback điều khiển LED
// ===================================================
void onLedControl(AifomParam param)
{
    int value = param.asInt();

    digitalWrite(LED_PIN, value ? HIGH : LOW);

    // Đồng bộ trạng thái lên Server
    AifomEdge.virtualWrite(VIRTUAL_LED_PIN, value);

    Serial.printf("[LED] %s\n", value ? "ON" : "OFF");
}

void setup()
{
    Serial.begin(115200);
    delay(1000);

    Serial.println("[App] Khoi dong...");

    pinMode(LED_PIN, OUTPUT);
    digitalWrite(LED_PIN, LOW);

    dht.begin();

    // Điều khiển LED ở Channel cấu hình trên Server
    AifomEdge.onWrite(VIRTUAL_LED_PIN, onLedControl);

    // Kết nối AIFOM
    AifomEdge.begin(
        ssid,
        pass,
        auth_token,
        device_uid,
        mqtt_host,
        mqtt_port);
}

void loop()
{
    AifomEdge.run();

    // Đọc DHT11 định kỳ
    if (millis() - lastRead >= READ_INTERVAL)
    {
        lastRead = millis();

        float humidity = dht.readHumidity();
        float temperature = dht.readTemperature();

        if (isnan(humidity) || isnan(temperature))
        {
            Serial.println("[DHT11] Loi doc cam bien!");
        }
        else
        {
            Serial.printf(
                "[DHT11] Nhiet do: %.1f C | Do am: %.1f %%\n",
                temperature,
                humidity);

            // Gửi dữ liệu lên các chân ảo cấu hình trên Server
            AifomEdge.virtualWrite(VIRTUAL_TEMP_PIN, temperature);
            AifomEdge.virtualWrite(VIRTUAL_HUMIDITY_PIN, humidity);
        }
    }

    delay(1);
}