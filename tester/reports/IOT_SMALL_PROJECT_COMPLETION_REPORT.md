# IOT Small Project Completion Report (AIFOM)

Date: 2026-05-24  
Scope: Lightweight multi-tenant IoT MVP (ESP32 + MQTT + telemetry + control + OTA) for small demo projects.

## 1) What Was Implemented

### A. MQTT contract unified (small-project convention)
- Standard topics implemented across backend, firmware, simulator, tests:
  - `devices/{device_id}/telemetry`
  - `devices/{device_id}/status`
  - `devices/{device_id}/events`
  - `devices/{device_id}/commands`
  - `devices/{device_id}/ota`
  - `devices/{device_id}/ota/status`
- Added shared topic helper:
  - `backend/app/services/mqtt_topics.py`
- Backend subscriber keeps legacy compatibility (`aifom/devices/...`) but uses new topics as primary.

### B. Backend IoT flow completed for MVP
- Device runtime status model enriched:
  - `ip_address`, `rssi`, `free_heap`, `uptime_ms`, `last_status_payload`
- Telemetry/status ingest handles flat + metrics payloads.
- Device command publish path updated to new topic and payload format (`command_id`, `type`, `target`, `value`).
- Tenant isolation enforced server-side for:
  - device visibility
  - command permission
  - OTA permission
  - firmware ownership
- OTA job persistence improved:
  - supports `accepted/downloading/flashing/rebooting/success/failed`
  - persists `progress`, `last_message`

### C. ESP32 firmware flow completed for demo use
- Firmware modules updated for:
  - Wi-Fi + MQTT reconnect
  - status + telemetry publish
  - commands subscribe/execute
  - OTA command receive and OTA status/progress reporting
- Command handling supports:
  - `set_output`, `toggle_output`, `request_status`, `request_telemetry`, `reboot`, `ota_update`
- OTA status publishes lifecycle progress to `devices/{uid}/ota/status`.

### D. Tenant project/dashboard improvements
- Project command widget path aligned to small IoT command model.
- Device detail and onboarding MQTT config updated to new topic contract.
- Route refresh blank-page regression mitigated in:
  - `frontend/src/components/ProtectedRoute.tsx`

### E. Simulator + tests + docs completed
- Simulator updated:
  - `tester/mqtt/device_simulator.py`
  - `iot/simulator/simulate_device.py`
  - `iot/simulator/simulate_fleet.py` (rewritten for new contract)
  - `tester/run_device_simulator.bat`
- Added schema/contract tests:
  - `tester/mqtt/test_esp32_contract.py`
- Added required docs:
  - `docs/iot_small_project_flow.md`
  - `docs/mqtt_protocol.md`
  - `docs/esp32_firmware_setup.md`
  - `docs/ota_demo_guide.md`
- Required audit report created:
  - `tester/reports/IOT_SMALL_PROJECT_AUDIT.md`

## 2) Key Files Changed

### Backend
- `backend/app/services/mqtt_topics.py`
- `backend/app/services/mqtt_subscriber.py`
- `backend/app/services/mqtt_publisher.py`
- `backend/app/modules/devices/model.py`
- `backend/app/modules/devices/repository.py`
- `backend/app/modules/devices/router.py`
- `backend/app/modules/devices/schema.py`
- `backend/app/modules/projects/repository.py`
- `backend/app/modules/projects/router.py`
- `backend/app/modules/ota/model.py`
- `backend/app/modules/ota/repository.py`
- `backend/app/modules/ota/router.py`
- `backend/app/modules/ota/schema.py`
- `backend/app/modules/tenants/router_client.py`
- `backend/app/modules/tenants/repository.py`
- `backend/app/main.py`

### Firmware / IoT
- `iot/firmware/main/app_main.c`
- `iot/firmware/components/mqtt_client/include/aifom_mqtt.h`
- `iot/firmware/components/mqtt_client/src/aifom_mqtt.c`
- `iot/firmware/components/telemetry/include/telemetry.h`
- `iot/firmware/components/telemetry/src/telemetry.c`
- `iot/firmware/components/ota_client/src/ota_client.c`
- `iot/simulator/simulate_device.py`
- `iot/simulator/simulate_fleet.py`

### Frontend
- `frontend/src/components/ProtectedRoute.tsx`
- `frontend/src/pages/client/ClientDeviceDetail.tsx`
- `frontend/src/pages/client/ClientDeviceOnboarding.tsx`
- `frontend/src/pages/client/projects/ProjectEditor.tsx`
- `frontend/src/pages/DeviceDetail.tsx`
- `frontend/src/types/index.ts`

### Tester
- `tester/mqtt/device_simulator.py`
- `tester/mqtt/test_mqtt_connection.py`
- `tester/mqtt/test_ota_mqtt_publish.py`
- `tester/mqtt/test_esp32_contract.py`
- `tester/api/test_03_tenant_isolation.py`
- `tester/api/test_04_devices.py`

## 3) Tests Run and Results

### Executed
1. `docker compose --env-file .env -f infrastructure/docker-compose.dev.yml exec -T api pytest tests/test_api.py -q`
- Result: **61 passed**

2. `docker compose --env-file .env -f infrastructure/docker-compose.dev.yml exec -T api sh -lc "API_BASE_URL=http://localhost:8000 pytest /workspace/tester/api/test_03_tenant_isolation.py /workspace/tester/api/test_04_devices.py -q"`
- Result: **11 passed, 8 skipped**

3. `docker compose --env-file .env -f infrastructure/docker-compose.dev.yml exec -T api sh -lc "API_BASE_URL=http://localhost:8000 MQTT_HOST=mosquitto MQTT_PORT=1883 pytest /workspace/tester/mqtt/test_mqtt_connection.py /workspace/tester/mqtt/test_ota_mqtt_publish.py /workspace/tester/mqtt/test_esp32_contract.py -q"`
- Result: **9 passed, 1 skipped**

4. `npm test -- src/pages/client/projects/Projects.test.tsx` (from `frontend/`)
- Result: **13 passed**

5. `npm run typecheck` (from `frontend/`)
- Result: **pass**

6. `python -m py_compile` checks inside API container for updated Python modules
- Result: **pass**

## 4) Simulator Status

### MQTT simulator runtime
- `tester/mqtt/device_simulator.py` ran successfully against `mosquitto:1883`.
- Confirmed logs include:
  - connected
  - OTA lifecycle statuses (`accepted`, `downloading`, `flashing`, `rebooting`, `success`)

### End-to-end OTA with simulator
- Tenant uploaded firmware via `/api/v1/client/firmware`.
- Tenant created OTA job via `/api/v1/client/ota-jobs`.
- Simulator received OTA command and published progress.
- Backend persisted OTA to terminal state:
  - `status = success`
  - `progress = 100`
  - `last_message = OTA completed successfully`

### Fleet simulator
- `iot/simulator/simulate_fleet.py` rewritten to new topic contract.
- Syntax validated (`py_compile`).

## 5) Physical ESP32 Status

- Physical board run/build was **not executed in this environment** (no ESP-IDF toolchain/hardware attached in this session).
- Firmware source and OTA/control flow are updated for real ESP32 demo, but hardware verification remains a separate step.

## 6) Acceptance Criteria Mapping (Current)

1. Backend starts: **PASS**  
2. Frontend starts: **Not executed in this run**  
3. MQTT broker starts: **PASS**  
4. ESP32 firmware builds: **Not executed in this run**  
5. Device simulator runs: **PASS**  
6. Simulator publishes telemetry: **PASS**  
7. Backend/UI shows telemetry: **Backend confirmed; UI full E2E not executed**  
8. Backend/UI shows online/offline status: **Backend confirmed; UI full E2E not executed**  
9. Tenant sees only assigned devices: **PASS (tests)**  
10. Tenant can control LED/relay own device: **API contract + simulator support PASS; UI click E2E not executed**  
11. Tenant cannot control other tenant device: **PASS (tests)**  
12. Tenant can upload firmware .bin: **PASS**  
13. Tenant can create OTA job for own device: **PASS**  
14. Tenant cannot OTA another tenant device: **PASS (tests)**  
15. Tenant cannot use another tenant firmware: **PASS (tests)**  
16. OTA status persisted and visible: **PASS**  
17. Tenant dashboard survives refresh: **Code fix + unit coverage; browser E2E not executed**  
18. Documentation updated: **PASS**  
19. Test report written: **PASS (this file)**

## 7) Remaining Limitations

- Full frontend Playwright E2E (browser rendering + refresh navigation flows) was not run in this session.
- ESP32 hardware flashing/build verification was not run in this session.
- Some legacy thesis/docs references still mention old topic names; MVP docs are updated, but deep archival docs may still contain legacy text.

## 8) Exact Demo Commands To Run Next

From repo root `D:\DATT\aifom`:

1. Start stack (if default ports are free):
```bat
docker compose --env-file .env -f infrastructure/docker-compose.dev.yml up -d
```

2. Seed admin + demo + tenants:
```bat
docker compose --env-file .env -f infrastructure/docker-compose.dev.yml exec -T api python /workspace/scripts/seed_admin.py
docker compose --env-file .env -f infrastructure/docker-compose.dev.yml exec -T api python /workspace/scripts/seed_demo.py
docker compose --env-file .env -f infrastructure/docker-compose.dev.yml exec -T api python /workspace/scripts/seed_tenant_demo.py
```

3. Run backend and MQTT test bundles:
```bat
docker compose --env-file .env -f infrastructure/docker-compose.dev.yml exec -T api pytest tests/test_api.py -q
docker compose --env-file .env -f infrastructure/docker-compose.dev.yml exec -T api sh -lc "API_BASE_URL=http://localhost:8000 MQTT_HOST=mosquitto MQTT_PORT=1883 pytest /workspace/tester/mqtt -q"
```

4. Run one simulator device:
```bat
docker compose --env-file .env -f infrastructure/docker-compose.dev.yml exec -T api sh -lc "PYTHONPATH=/workspace/tester python -u /workspace/tester/mqtt/device_simulator.py --device-uid esp32-demo-003 --host mosquitto --port 1883"
```

5. Frontend checks:
```bat
cd frontend
npm test -- src/pages/client/projects/Projects.test.tsx
npm run typecheck
```

6. Stop stack:
```bat
docker compose --env-file .env -f infrastructure/docker-compose.dev.yml down
```
