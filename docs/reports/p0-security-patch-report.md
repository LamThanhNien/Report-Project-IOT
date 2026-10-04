# AIFOM P0 Security Patch Report

**Ngày:** 2026-05-29
**Phạm vi:** Fix 6 lỗ hổng bảo mật Critical (P0) từ Full System Audit

---

## 1. Tóm tắt các fix bảo mật

### Fix 1: Loại bỏ hardcode Wi-Fi trong firmware

**Trước:** `iot/src/Esp32/src/main.cpp` chứa SSID `"Nha Tro SV Khanh An"` và password `"68686868"` hardcode trực tiếp.

**Sau:** 
- Wi-Fi credentials được cấu hình qua build flags trong `platformio.ini`
- Tạo `platformio_local.ini` (gitignored) để chứa credentials thật
- Firmware từ chối khởi động nếu `WIFI_SSID` trống
- ESP-IDF firmware đã dùng Kconfig đúng cách từ trước

**Files thay đổi:**
- `iot/src/Esp32/src/main.cpp` — removed hardcoded creds, added empty-check
- `iot/src/Esp32/platformio.ini` — added build flags for Wi-Fi/MQTT/provisioning
- `iot/src/Esp32/.gitignore` — added `platformio_local.ini`

### Fix 2: JWT secret hardening

**Trước:** `JWT_SECRET=changeme-replace-with-a-long-random-secret` — backend chấp nhận insecure default.

**Sau:**
- Backend **từ chối khởi động** nếu JWT_SECRET nằm trong danh sách insecure hoặc ngắn hơn 32 ký tự
- Startup validator kiểm tra trước khi app chạy
- Test mode (`AIFOM_TESTING=1`) bỏ qua validation

**Files thay đổi:**
- `backend/app/core/config.py` — added `_INSECURE_JWT_SECRETS` blocklist, `model_validator` fail-fast
- `.env.example` — updated instructions, added `REPLACE_ME` placeholders

### Fix 3: Mosquitto authentication

**Trước:** `allow_anonymous true` — bất kỳ ai cũng có thể connect MQTT.

**Sau:**
- `allow_anonymous false` — bắt buộc username/password
- Docker entrypoint tự tạo password file từ environment variables
- Default demo users: `aifom_backend` / `aifom_device`
- ESP32 firmware hỗ trợ MQTT credentials qua Kconfig

**Files thay đổi:**
- `infrastructure/mosquitto/config/mosquitto.conf` — disabled anonymous, added password_file
- `infrastructure/mosquitto/docker-entrypoint.sh` — new: auto-generates passwd file
- `infrastructure/docker-compose.dev.yml` — added entrypoint, env vars, passwd volume
- `iot/firmware/Kconfig.projbuild` — added MQTT username/password config
- `iot/firmware/components/config_manager/include/aifom_config.h` — added mqtt_username/password
- `iot/firmware/components/config_manager/src/aifom_config.c` — added MQTT creds
- `iot/firmware/components/mqtt_client/src/aifom_mqtt.c` — added auth to connect/reconnect
- `iot/firmware/sdkconfig.defaults` — added MQTT cred defaults

### Fix 4: Bảo vệ firmware download

**Trước:** `GET /api/v1/firmware/{id}/download` không cần auth — ai cũng download được.

**Sau:**
- Admin download: yêu cầu admin JWT token
- Device OTA download: dùng signed token (`GET /api/v1/firmware/ota-download/{id}?token=...`)
- Token hết hạn sau 30 phút, scoped theo firmware/job/device
- Token được tạo khi tạo OTA job, gửi qua MQTT

**Files thay đổi:**
- `backend/app/core/ota_tokens.py` — new: OTA token create/decode
- `backend/app/bounded_contexts/firmware_ota/presentation/router_firmware.py` — added auth, new OTA download endpoint
- `backend/app/bounded_contexts/firmware_ota/presentation/router_ota.py` — signed download URLs
- `backend/app/bounded_contexts/tenant_management/presentation/router_client.py` — signed download URLs

### Fix 5: Bảo vệ device registration

**Trước:** `POST /api/v1/devices/register` không cần auth — ai cũng đăng ký device giả.

**Sau:**
- Yêu cầu `provisioning_token` query parameter
- Token phải khớp với `DEVICE_PROVISIONING_SECRET` trong .env
- Nếu secret trống → registration bị disable
- Audit log cho mỗi lần đăng ký

**Files thay đổi:**
- `backend/app/bounded_contexts/device_registry/presentation/router.py` — added provisioning token validation
- `iot/firmware/Kconfig.projbuild` — added provisioning token config
- `iot/firmware/components/config_manager/include/aifom_config.h` — added provisioning_token
- `iot/firmware/components/config_manager/src/aifom_config.c` — added provisioning_token

### Fix 6: Clean .env handling

**Trước:** `.env` chứa credentials thật, không có startup validation.

**Sau:**
- `.env` đã được gitignore (xác nhận)
- `.env.example` chứa placeholders an toàn với hướng dẫn
- Backend startup validator từ chối chạy nếu secrets insecure
- `backend/.env.example` updated với security settings mới

---

## 2. Files thay đổi

### Backend (Python)
| File | Thay đổi |
|---|---|
| `backend/app/core/config.py` | JWT validation, OTA token secret, provisioning secret |
| `backend/app/core/ota_tokens.py` | **NEW** — OTA download token create/decode |
| `backend/app/bounded_contexts/firmware_ota/presentation/router_firmware.py` | Auth on download, OTA token download endpoint |
| `backend/app/bounded_contexts/firmware_ota/presentation/router_ota.py` | Signed download URLs |
| `backend/app/bounded_contexts/tenant_management/presentation/router_client.py` | Signed download URLs |
| `backend/app/bounded_contexts/device_registry/presentation/router.py` | Provisioning token validation |
| `backend/tests/test_api.py` | Updated existing tests + new security tests |

### Firmware (C/C++)
| File | Thay đổi |
|---|---|
| `iot/src/Esp32/src/main.cpp` | Removed hardcoded Wi-Fi, added MQTT auth |
| `iot/src/Esp32/platformio.ini` | Added build flags |
| `iot/src/Esp32/.gitignore` | Added platformio_local.ini |
| `iot/firmware/Kconfig.projbuild` | Added MQTT creds, provisioning token |
| `iot/firmware/components/config_manager/include/aifom_config.h` | Added new config fields |
| `iot/firmware/components/config_manager/src/aifom_config.c` | Added new config fields |
| `iot/firmware/components/mqtt_client/src/aifom_mqtt.c` | Added MQTT auth |
| `iot/firmware/sdkconfig.defaults` | Added new defaults |

### Infrastructure
| File | Thay đổi |
|---|---|
| `infrastructure/mosquitto/config/mosquitto.conf` | Disabled anonymous, added password_file |
| `infrastructure/mosquitto/docker-entrypoint.sh` | **NEW** — auto-generates passwd |
| `infrastructure/docker-compose.dev.yml` | Mosquitto entrypoint + credentials |

### Documentation
| File | Thay đổi |
|---|---|
| `.env.example` | Updated security settings |
| `backend/.env.example` | Updated security settings |
| `tester/.env.example` | Added provisioning token |
| `docs/security/README.md` | Complete rewrite with new security model |

---

## 3. Hành vi trước vs sau

| Endpoint | Trước | Sau |
|---|---|---|
| `GET /firmware/{id}/download` | 200 (no auth) | 401/403 without admin token |
| `GET /firmware/ota-download/{id}` | Not existed | 200 with valid signed token, 401 without |
| `POST /devices/register` | 200 (no auth) | 422 without token, 401 with wrong token |
| MQTT connect | Anonymous OK | Username/password required |
| Backend start with insecure JWT | Starts normally | **Exits with error** |

---

## 4. Biến môi trường mới

| Variable | Default | Mô tả |
|---|---|---|
| `JWT_SECRET` | `changeme-...` (rejected) | **REQUIRED** — min 32 chars |
| `OTA_TOKEN_SECRET` | `changeme-ota-token-secret` | Secret for OTA download tokens |
| `OTA_TOKEN_EXPIRE_MINUTES` | `30` | OTA token TTL |
| `DEVICE_PROVISIONING_SECRET` | `""` (disabled) | Provisioning token for device registration |
| `MQTT_ADMIN_USER` | `aifom_backend` | Mosquitto backend user |
| `MQTT_ADMIN_PASSWORD` | `aifom_backend_pass` | Mosquitto backend password |
| `MQTT_DEVICE_USER` | `aifom_device` | Mosquitto device user |
| `MQTT_DEVICE_PASSWORD` | `aifom_device_pass` | Mosquitto device password |

---

## 5. Tests mới/cập nhật

### Tests cập nhật
- `test_register_device` — thêm provisioning token
- `test_download_firmware_streams` — verify admin auth
- `test_create_ota_job_ok` — verify signed download URL
- `test_client_create_ota_job_ok` — verify signed download URL

### Tests mới (11 tests)
- `test_firmware_download_requires_auth` — verify 401/403 without auth
- `test_firmware_download_with_admin_auth` — verify admin can download
- `test_ota_download_without_token_returns_401` — verify token required
- `test_ota_download_with_invalid_token_returns_401` — verify invalid token rejected
- `test_ota_download_with_valid_token` — verify valid token works
- `test_ota_download_token_firmware_mismatch_returns_403` — verify cross-firmware rejection
- `test_device_register_without_token_returns_422` — verify token required
- `test_device_register_with_wrong_token_returns_401` — verify wrong token rejected
- `test_device_register_with_valid_token` — verify valid token works
- `test_device_register_no_spoof_tenant_id` — verify no tenant spoofing
- `test_create_ota_job_uses_signed_download_url` — verify signed URL format

**Kết quả: 113 tests PASSED**

---

## 6. Kết quả test/build

```
113 passed, 8 warnings in 32.79s
```

Tất cả tests pass, bao gồm cả tests mới và tests hiện có đã được cập nhật.

---

## 7. Giới hạn còn lại

1. **MQTT ACL chưa đầy đủ** — Mosquitto có auth nhưng chưa có per-topic ACL. Devices có thể subscribe vào topics của devices khác. Đây là P1 improvement.

2. **Không có token revocation** — JWT vẫn valid cho đến khi hết hạn. Logout chỉ ở client-side.

3. **Provisioning token là shared secret** — Trong production nên dùng per-tenant tokens có thể revoke.

4. **Không có HTTPS** — Tất cả traffic vẫn plain HTTP trong local dev.

5. **OTA token không có replay protection** — Token có thể được dùng nhiều lần trong thời gian TTL. Thêm nonce/jti là P2 improvement.

---

## 8. Các bước xác minh thủ công

### MQTT anonymous connection phải fail

```bash
# Không có credentials — phải fail
mosquitto_sub -h localhost -t "devices/#" -C 1

# Có credentials — phải work
mosquitto_sub -h localhost -t "devices/#" -C 1 -u aifom_device -P aifom_device_pass
```

### Firmware download không có auth phải fail

```bash
# Không có token — phải trả 401
curl http://localhost:8000/api/v1/firmware/<firmware_id>/download

# Có admin token — phải trả firmware
curl -H "Authorization: Bearer <admin_token>" \
     http://localhost:8000/api/v1/firmware/<firmware_id>/download
```

### Device registration không có token phải fail

```bash
# Không có token — phải trả 422
curl -X POST http://localhost:8000/api/v1/devices/register \
     -H "Content-Type: application/json" \
     -d '{"device_uid":"test-001","name":"Test"}'

# Có token — phải succeed
curl -X POST "http://localhost:8000/api/v1/devices/register?provisioning_token=aifom_demo_provision_2026" \
     -H "Content-Type: application/json" \
     -d '{"device_uid":"test-001","name":"Test"}'
```

---

## 9. Task tiếp theo khuyến nghị

Sau khi patch P0 security, task tiếp theo nên là:

1. **P1: Add TimescaleDB hypertable + composite indexes** cho telemetry
2. **P1: Add rate limiting** cho login và API endpoints
3. **P1: Add MQTT per-topic ACL** để devices chỉ publish/subscribe vào topics của mình
4. **P1: Add firmware signature verification** trên ESP32
5. **P1: Bổ sung backend unit tests** cho auth, tenant isolation, device CRUD
