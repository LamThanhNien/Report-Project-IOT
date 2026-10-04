# ESP32 mDNS Physical Demo Report

## Scope

Prepared the AIFOM codebase for physical ESP32 local demo stability when host LAN IP changes.

Core direction implemented:
- device-facing hostnames use `aifom.local` (not hardcoded LAN IP/localhost)
- backend internal Docker networking remains unchanged (`mosquitto`, internal service names)
- ESP32 firmware is mDNS-first with fallback host/IP

## Files changed

- `backend/app/core/config.py`
- `backend/app/modules/ota/router.py`
- `backend/app/modules/tenants/router_client.py`
- `backend/tests/test_api.py`
- `.env.example`
- `backend/.env.example`
- `.env`
- `iot/firmware/Kconfig.projbuild`
- `iot/firmware/sdkconfig.defaults`
- `iot/firmware/sdkconfig.defaults.example`
- `iot/firmware/components/config_manager/include/aifom_config.h`
- `iot/firmware/components/config_manager/src/aifom_config.c`
- `iot/firmware/components/config_manager/README.md`
- `iot/firmware/components/mqtt_client/src/aifom_mqtt.c`
- `iot/firmware/components/mqtt_client/CMakeLists.txt`
- `iot/firmware/components/mqtt_client/README.md`
- `iot/firmware/main/app_main.c`
- `iot/firmware/README.md`
- `docs/esp32_firmware_setup.md`
- `docs/esp32_physical_demo_mdns.md` (new)
- `scripts/README.md`
- `scripts/start_mdns_publisher.bat` (new)
- `scripts/check_mdns.bat` (new)
- `scripts/aifom_mdns_publisher.py` (new)
- `run-aifom.ps1`
- `tester/mqtt/test_esp32_contract.py`
- `tester/mqtt/test_ota_mqtt_publish.py`
- `tester/reports/ESP32_PHYSICAL_DEMO_CHECKLIST.md` (new)

## Config/env values added

- `DEVICE_MQTT_HOST=aifom.local`
- `DEVICE_MQTT_PORT=1883`
- `DEVICE_API_BASE_URL=http://aifom.local:8000`
- `AIFOM_PUBLIC_BASE_URL=http://aifom.local:8000` (alias)

ESP32 config keys added:
- `CONFIG_AIFOM_ENABLE_MDNS_DISCOVERY`
- `CONFIG_AIFOM_MDNS_HOST`
- `CONFIG_AIFOM_API_PORT`
- `CONFIG_AIFOM_FALLBACK_API_BASE_URL`

## How mDNS works here

1. ESP32 connects Wi-Fi.
2. MQTT client resolves `CONFIG_AIFOM_MDNS_HOST` (`aifom.local`) via DNS/mDNS lookup.
3. On success, MQTT connects to `aifom.local:1883`.
4. On repeated failure, firmware falls back to configured host/IP (`CONFIG_AIFOM_MQTT_HOST`).
5. Backend OTA payload uses `settings.device_api_base_url` for `firmware_url` (default `http://aifom.local:8000/...`).

Host-side helper:
- `scripts/aifom_mdns_publisher.py` advertises `_aifom-api._tcp.local`, `_aifom-mqtt._tcp.local`, and `_http._tcp.local`.

## Exact commands to run

```bat
run-aifom.bat
scripts\start_mdns_publisher.bat
scripts\check_mdns.bat
```

Backend/test checks used during implementation:

```bat
pytest backend\tests\test_api.py -k "create_ota_job_ok or client_create_ota_job_ok or client_device_mqtt_config_uses_device_facing_host" -q
pytest tester\mqtt\test_esp32_contract.py -q
pytest tester\mqtt\test_ota_mqtt_publish.py -q
python scripts\aifom_mdns_publisher.py --help
```

## Test results

- `backend/tests/test_api.py` targeted mDNS/OTA tests: **3 passed**
- `tester/mqtt/test_esp32_contract.py`: **5 passed**
- `tester/mqtt/test_ota_mqtt_publish.py`: **1 passed**
- mDNS helper CLI help command: **ok**

## Known limitations

- mDNS depends on LAN multicast behavior and local firewall/router settings.
- Docker containers are not relied on for multicast advertisement; host helper script is used.
- This environment did not perform `idf.py build/flash` against a real ESP32 board.

## Physical verification status

mDNS code/config prepared; physical ESP32 verification must be done locally.
