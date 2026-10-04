# ESP32 Physical Demo With mDNS (`aifom.local`)

## Why mDNS

For local ESP32 demos, hardcoding `192.168.x.x` is fragile:
- router/DHCP restart can change host IP
- Wi-Fi reconnect can change lease
- power outage can reshuffle LAN addresses

Using MQTT service discovery avoids reflashing firmware every time the PC IP changes.
The ESP32 discovers `_aifom-mqtt._tcp.local` first, then `_mqtt._tcp.local`.

## Target hostnames/ports

- API/backend: `http://aifom.local:8000`
- MQTT broker: discovered from `_aifom-mqtt._tcp.local` or `_mqtt._tcp.local`
- OTA firmware URL base: `http://aifom.local:8000`

## Architecture note

- Backend internal Docker networking remains unchanged:
  - `MQTT_HOST=mosquitto`
  - `MQTT_PORT=1883`
- Device-facing settings are separated:
  - `DEVICE_MQTT_HOST=aifom.local`
  - `DEVICE_MQTT_PORT=1883`
  - `DEVICE_API_BASE_URL=http://aifom.local:8000`

When backend publishes OTA command, `firmware_url` uses device-facing base URL.

## Start local stack

```bat
run-aifom.bat
```

Then start the host-side mDNS MQTT publisher. Keep this running while the ESP32 is online.
Do not run this publisher inside Docker; multicast mDNS is unreliable from Docker Desktop on Windows.

```bat
scripts\start_mdns_publisher.bat
```

Check MQTT service discovery:

```bat
scripts\check_mdns.bat
```

## ESP32 config (mDNS-first)

```ini
CONFIG_AIFOM_WIFI_SSID="YOUR_WIFI"
CONFIG_AIFOM_WIFI_PASSWORD="YOUR_PASSWORD"

CONFIG_AIFOM_ENABLE_MDNS_DISCOVERY=y
CONFIG_AIFOM_MDNS_HOST="aifom.local"
CONFIG_AIFOM_MQTT_PORT=1883
CONFIG_AIFOM_API_PORT=8000

CONFIG_AIFOM_DEVICE_UID="esp32-demo-001"
```

## Expected ESP32 serial logs

Success path (service discovery):
- `WiFi OK, IP: 192.168.x.x`
- `mDNS client san sang`
- `Dang query service _aifom-mqtt._tcp.local attempt 1/8`
- `Tim thay MQTT service: _aifom-mqtt._tcp.local 192.168.x.x:1883`
- `[MQTT] Connecting to 192.168.x.x:1883`
- `[MQTT] Connected`

If `_aifom-mqtt._tcp.local` is not found, the firmware tries `_mqtt._tcp.local`.

If both service types fail, the firmware resolves the hostname via mDNS:
- `Dang phan giai host aifom.local ...`
- `aifom.local -> 192.168.x.x`
- `[MQTT] Connecting to 192.168.x.x:1883`
- `[MQTT] Connected`

## Full diagnostics

Run the network diagnostic script to check Docker, ports, mDNS, firewall, and connectivity:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_aifom_network.ps1
```

## Verify OTA payload host

Create OTA job from API/UI, then verify published payload contains:

```json
{
  "type": "ota_update",
  "firmware_url": "http://aifom.local:8000/api/v1/firmware/<id>/download"
}
```

It must not default to `localhost`, `127.0.0.1`, or random LAN IP.

## Common problems

- Windows Firewall blocks UDP `5353` or TCP `1883`.
- ESP32 and PC are on different Wi-Fi/VLAN.
- Guest Wi-Fi, dorm Wi-Fi, AP isolation, or client isolation blocks multicast/mDNS.
- Docker container cannot advertise mDNS reliably on Windows; run `scripts/aifom_mdns_publisher.py` on the host.
- If mDNS fails on public Wi-Fi, test with a phone hotspot or private router.
- OTA payload still shows `localhost` because `DEVICE_API_BASE_URL` is not set.
- Firmware download fails because URL is not reachable from ESP32 network.
