# ESP32 Physical Demo Checklist

## mDNS / dynamic IP handling

- Expected mDNS hostname: `aifom.local`
- Expected API URL: `http://aifom.local:8000`
- Expected MQTT host: `aifom.local:1883`
- Expected OTA firmware URL prefix: `http://aifom.local:8000/api/v1/firmware/`
- Fallback behavior: use configured fallback host/IP only after mDNS retries fail

### Verification commands (Windows)

- Start publisher: `scripts\start_mdns_publisher.bat`
- Check resolution: `scripts\check_mdns.bat`
- API health: `curl http://aifom.local:8000/health`

### Verification logs (ESP32 serial)

- `[AIFOM] Using mDNS host: aifom.local`
- `[MDNS] Resolving aifom.local...`
- `[MDNS] Resolved aifom.local -> <LAN_IP>`
- `[MQTT] Connecting to aifom.local:1883`
- `[MQTT] Connected`
- `[API] Base URL: http://aifom.local:8000`

### OTA payload checks

- `firmware_url` contains `http://aifom.local:8000/...`
- `firmware_url` does **not** contain:
  - `http://localhost:8000/...`
  - `http://127.0.0.1:8000/...`
