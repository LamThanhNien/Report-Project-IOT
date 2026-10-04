> [!NOTE]
> **TÀI LIỆU ĐẶC TẢ LỊCH SỬ / BẢN THIẾT KẾ HỌC THUẬT (HISTORICAL SPECIFICATION & RESEARCH ROADMAP)**
>
> - **Mục đích tài liệu**: Tài liệu này là bản đặc tả kỹ thuật gốc được thiết kế cho lộ trình nghiên cứu học thuật 24 tháng của đề tài tốt nghiệp.
> - **Phạm vi triển khai thực tế (Current Scoped Implementation)**: Phạm vi hệ thống thực tế đã triển khai và nghiệm thu bảo vệ được quy định chuẩn tại [`docs/scope.md`](../../scope.md).
> - **Các thành phần đã tinh giản (Scoped-out / Future Work)**:
>   1. **AI / TinyML / MLOps**: Module TinyML biên, mô hình IsolationForest server-side và MLOps đã được tinh gọn thành định hướng nghiên cứu mở rộng; hệ thống không còn API `/api/v1/anomaly` hay MQTT topic `ml/*`.
>   2. **Bộ giả lập Simulator**: Toàn bộ cụm simulator phần mềm (`simulate_fleet.py`, `simulate_device.py`) đã được loại bỏ; nghiệm thu và demo thực tế sử dụng 100% phần cứng ESP32 vật lý (xem [`docs/esp32_firmware_setup.md`](../../esp32_firmware_setup.md)).
>   3. **Phân quyền người dùng (RBAC)**: Đã loại bỏ vai trò `platform_engineer` và `tenant_engineer` cùng giao diện `/console/engineer` (xem báo cáo kỹ thuật [`docs/reports/engineer-removal-2026-10-03.md`](../../reports/engineer-removal-2026-10-03.md)). Hệ thống hiện tại vận hành chuẩn 3 vai trò: `admin`, `tenant_owner`, và `viewer` (xem [`docs/access_control.md`](../../access_control.md)).
>   4. **Hạ tầng bổ trợ & Thương mại**: Các dịch vụ Prometheus, Grafana, MLflow, cổng tài liệu API tùy biến, website quảng bá và giao diện billing thương mại đã được gỡ bỏ khỏi stack chạy chính.

# 19 – Requirements & Traceability

Tài liệu này gom tất cả yêu cầu chức năng (FR), phi chức năng (NFR) và test ID (TEST) thành danh sách đánh số. Mỗi yêu cầu có **Priority** rõ ràng. Đây là nguồn duy nhất khi cần truy vết: yêu cầu → service → API → test.

Đồng bộ với `docs/scope.md` §4–7:

- **MUST** ↔ scope M0 (MVP, bắt buộc).
- **SHOULD** ↔ scope M1 (Main, tạo chiều sâu kỹ thuật).
- **NICE** ↔ scope M2 (Optional, chỉ làm nếu còn thời gian).

## 1. Quy ước

- **MUST** (M0): bắt buộc làm để demo và bảo vệ.
- **SHOULD** (M1): nên làm; tạo chiều sâu kỹ thuật. Cắt 1–2 mục nếu trễ.
- **NICE** (M2): cắt đầu tiên khi trễ tiến độ.

Domain code: `REG` (device registry), `OTA`, `TEL` (telemetry), `MT` (multi-tenant), `INTEL` (edge intelligence — optional), `AUDIT`, `UI`, `SEC`, `OBS`, `DEPLOY`, `CICD`, `SIM`, `FW` (firmware).

---

## 2. Functional requirements – Multi-Tenant Platform

> Nhóm này là MUST vì đây là điểm nhấn demo chính (Phase 12 — completed 2026-05-20).

| ID | Priority | Mô tả | Service/Component | API/Route | Test |
|---|---|---|---|---|---|
| FR-MT-001 | MUST | Admin tạo tenant mới (name, slug, plan) | backend/tenants | `POST /api/v1/admin/tenants` | TEST-MT-001 |
| FR-MT-002 | MUST | Admin tạo tenant owner account cùng lúc tạo tenant (atomic) | backend/tenants | `POST /api/v1/admin/tenants` với owner fields | TEST-MT-002 |
| FR-MT-003 | MUST | Admin gán thiết bị cho tenant | backend/tenants | `POST /api/v1/admin/tenants/{id}/devices` | TEST-MT-003 |
| FR-MT-004 | MUST | Tenant owner đăng nhập, nhận JWT có tenant_id | auth | `POST /api/v1/auth/login` | TEST-MT-004 |
| FR-MT-005 | MUST | Tenant chỉ thấy thiết bị được gán cho tenant của mình | backend/client | `GET /api/v1/client/devices` | TEST-MT-005 |
| FR-MT-006 | MUST | Tenant upload firmware binary (.bin đã compile) | backend/client | `POST /api/v1/client/firmware/upload` | TEST-MT-006 |
| FR-MT-007 | MUST | Tenant tạo OTA campaign cho thiết bị của mình | backend/client | `POST /api/v1/client/ota-campaigns` | TEST-MT-007 |
| FR-MT-008 | MUST | Tenant theo dõi tiến trình OTA campaign | frontend/client | `/client/ota-campaigns/:id` | TEST-MT-008 |
| FR-MT-009 | MUST | tenant_id KHÔNG lấy từ request — luôn lấy từ JWT→DB | backend/core | `tenant.py` get_current_tenant_user | TEST-MT-009 |
| FR-MT-010 | SHOULD | Viewer role chỉ có quyền view, không tạo/xóa | backend/core | RBAC middleware | TEST-MT-015 |
| FR-MT-011 | SHOULD | Feature flag gating theo service plan | backend/client | `GET /api/v1/client/features` | TEST-MT-012 |
| FR-MT-012 | NICE | Billing / payment processing | – | – | – |
| FR-MT-013 | OUT | Source code upload + auto build firmware | – | – | – |

---

## 3. Functional requirements – Auth & RBAC

| ID | Priority | Mô tả | Service | API | Test |
|---|---|---|---|---|---|
| FR-AUTH-001 | MUST | Login với email/password, trả JWT | auth | `POST /api/v1/auth/login` | TEST-AUTH-001 |
| FR-AUTH-002 | MUST | JWT chứa role + tenant_id (nếu là tenant user) | auth | JWT payload | TEST-AUTH-002 |
| FR-AUTH-003 | MUST | Route guard: admin → Admin Console; tenant → Customer Workspace | frontend/backend | middleware | TEST-AUTH-003 |
| FR-AUTH-004 | MUST | Logout revoke token (session hoặc blacklist) | auth | `POST /api/v1/auth/logout` | TEST-AUTH-004 |
| FR-AUTH-005 | SHOULD | Refresh token flow | auth | `POST /api/v1/auth/refresh` | TEST-AUTH-005 |

---

## 4. Functional requirements – Device Registry

| ID | Priority | Mô tả | Service | API/Topic | Test |
|---|---|---|---|---|---|
| FR-REG-001 | MUST | Đăng ký device mới với `device_uid` unique | device-registry | `POST /api/v1/devices/register` | TEST-REG-001 |
| FR-REG-002 | MUST | Trả về `device_token` 1 lần khi đăng ký, hash lưu DB | device-registry | `POST /api/v1/devices/register` | TEST-REG-002 |
| FR-REG-003 | MUST | Heartbeat device cập nhật `last_seen_at`, `firmware_version`, `status=online` | device-registry | `POST /api/v1/devices/{uid}/heartbeat` | TEST-REG-003 |
| FR-REG-004 | MUST | Worker định kỳ đánh dấu device offline nếu `last_seen_at` quá ngưỡng (mặc định 10 phút) | device-registry | background worker | TEST-REG-004 |
| FR-REG-005 | MUST | List device hỗ trợ filter status/hardware_model + pagination | device-registry | `GET /api/v1/devices` | TEST-REG-005 |
| FR-REG-006 | SHOULD | Quarantine device theo lệnh admin | device-registry | `POST /api/v1/devices/{uid}/quarantine` | TEST-REG-006 |
| FR-REG-007 | SHOULD | Resolve target rollout theo `target_query` JSON | device-registry | internal API | TEST-REG-007 |
| FR-REG-008 | NICE | Xoay vòng credential, revoke token cũ | device-registry | `POST /api/v1/devices/{uid}/credentials/rotate` | TEST-REG-008 |

---

## 5. Functional requirements – OTA

| ID | Priority | Mô tả | Service | API/Topic | Test |
|---|---|---|---|---|---|
| FR-OTA-001 | MUST | Upload firmware `.bin` đã compile (≤ 2MB mặc định), compute sha256 server-side, lưu MinIO | ota-server | `POST /api/v1/firmwares` | TEST-OTA-001 |
| FR-OTA-002 | MUST | Reject duplicate `(version, target_hardware)` với 409 | ota-server | `POST /api/v1/firmwares` | TEST-OTA-002 |
| FR-OTA-003 | MUST | Reject SemVer không hợp lệ với 422 | ota-server | `POST /api/v1/firmwares` | TEST-OTA-003 |
| FR-OTA-004 | MUST | Trả firmware mới nhất theo device_uid/hardware_model/current_version | ota-server | `GET /api/v1/firmwares/latest` | TEST-OTA-004 |
| FR-OTA-005 | MUST | Download firmware với sha256 trong header/metadata | ota-server | `GET /api/v1/firmwares/{id}/download` | TEST-OTA-005 |
| FR-OTA-006 | MUST | Promote firmware: signed → staging → production | ota-server | `POST /api/v1/firmwares/{id}/promote` | TEST-OTA-006 |
| FR-OTA-007 | MUST | Tạo rollout/OTA campaign sinh OTA jobs theo target | ota-server | `POST /api/v1/rollouts` hoặc `/client/ota-campaigns` | TEST-OTA-007 |
| FR-OTA-008 | MUST | Update OTA job progress với validate state transition | ota-server | `POST /api/v1/ota/jobs/{id}/progress` | TEST-OTA-008 |
| FR-OTA-009 | MUST | MQTT publish `dev/{uid}/cmd` với command `update_firmware` khi campaign chạy | ota-server | MQTT publisher | TEST-OTA-009 |
| FR-OTA-010 | MUST | Auto-quarantine firmware khi failure rate vượt `failure_threshold_pct` | ota-server | background worker | TEST-OTA-010 |
| FR-OTA-011 | SHOULD | Pause/resume/cancel rollout | ota-server | `POST /api/v1/rollouts/{id}/{pause|resume|cancel}` | TEST-OTA-011 |
| FR-OTA-012 | SHOULD | HTTP Range download để hỗ trợ resumable | ota-server | `GET /api/v1/firmwares/{id}/download` | TEST-OTA-012 |
| FR-OTA-013 | NICE | Delta firmware update | ota-server | `GET /api/v1/firmwares/delta` | TEST-OTA-013 |

---

## 6. Functional requirements – Firmware ESP32

| ID | Priority | Mô tả | Component | Test |
|---|---|---|---|---|
| FR-FW-001 | MUST | Boot init NVS → load config → start Wi-Fi → start MQTT | app_state | TEST-FW-001 |
| FR-FW-002 | MUST | Wi-Fi reconnect với exponential backoff, max 60s | wifi_manager | TEST-FW-002 |
| FR-FW-003 | MUST | MQTT reconnect khi mất kết nối | mqtt_manager | TEST-FW-003 |
| FR-FW-004 | MUST | Publish telemetry mỗi 5s, health mỗi 60s | telemetry_task | TEST-FW-004 |
| FR-FW-005 | MUST | Subscribe `dev/{uid}/cmd`, dedupe theo `command_id` | command_handler | TEST-FW-005 |
| FR-FW-006 | MUST | OTA state machine: created/sent/downloading/flashing/rebooting/success/failed | ota_manager | TEST-FW-006 |
| FR-FW-007 | MUST | Verify sha256 trước khi flash | ota_manager | TEST-FW-007 |
| FR-FW-008 | MUST | Reject firmware sai target hardware hoặc version thấp hơn current | ota_manager | TEST-FW-008 |
| FR-FW-009 | MUST | Self-test sau reboot, gọi `esp_ota_mark_app_valid_cancel_rollback` khi pass | ota_manager + app_state | TEST-FW-009 |
| FR-FW-010 | MUST | Bootloader rollback nếu self-test fail/no heartbeat trong N phút | bootloader config | TEST-FW-010 |
| FR-FW-011 | MUST | Publish OTA progress: 0/sent/downloading/flashing/success/failed | ota_manager | TEST-FW-011 |
| FR-FW-012 | SHOULD | Verify Ed25519 signature trước khi flash | ota_manager | TEST-FW-012 |
| FR-FW-013 | SHOULD | Local edge inference (nếu device type có intelligence profile) | model_runtime | TEST-FW-013 |
| FR-FW-014 | SHOULD | Update intelligence model qua MQTT command, lưu vào SPIFFS | model_runtime | TEST-FW-014 |
| FR-FW-015 | NICE | Secure boot/flash encryption | bootloader | TEST-FW-015 |

---

## 7. Functional requirements – Telemetry & Health

| ID | Priority | Mô tả | Service | API/Topic | Test |
|---|---|---|---|---|---|
| FR-TEL-001 | MUST | Subscribe `dev/+/telemetry`, `dev/+/health`, `dev/+/status`, `dev/+/ota/progress` | telemetry-ingest | MQTT subscriber | TEST-TEL-001 |
| FR-TEL-002 | MUST | Validate `schema_version`; payload không match → log warning, không crash | telemetry-ingest | – | TEST-TEL-002 |
| FR-TEL-003 | MUST | Ghi telemetry vào `telemetry_events` (TimescaleDB) | telemetry-ingest | TimescaleDB | TEST-TEL-003 |
| FR-TEL-004 | MUST | Ghi health vào `device_health` | telemetry-ingest | TimescaleDB | TEST-TEL-004 |
| FR-TEL-005 | MUST | Ghi OTA progress vào `ota_jobs` (cập nhật status, progress_pct, error_code) | telemetry-ingest | PostgreSQL | TEST-TEL-005 |
| FR-TEL-006 | SHOULD | Forward event đến realtime-gateway (Redis pub/sub) | telemetry-ingest | internal | TEST-TEL-006 |
| FR-HEALTH-001 | SHOULD | Score health vector qua model server-side (optional, M1) | health-scorer | `POST /api/v1/health/score` | TEST-HEALTH-001 |
| FR-HEALTH-002 | SHOULD | Batch worker score device 1 phút/lần, ghi `health_scores` | health-scorer | background worker | TEST-HEALTH-002 |
| FR-HEALTH-003 | SHOULD | Tạo alert nếu device anomaly liên tục ≥ 5 phút | health-scorer | `alerts` table | TEST-HEALTH-003 |

---

## 8. Functional requirements – Optional Edge Intelligence

> **Đây là tính năng SHOULD (M1) — academic highlight, không bắt buộc cho MVP.**
> AIFOM hỗ trợ nhiều intelligence profile. Mỗi device type có thể có profile riêng hoặc không có ML.
> MVP demo chỉ một use case mẫu. Không giả định một model duy nhất cho tất cả thiết bị.

| ID | Priority | Mô tả | Service | API | Test |
|---|---|---|---|---|---|
| FR-INTEL-001 | SHOULD | Định nghĩa intelligence profile cho device type (rule-based hoặc model) | backend | `POST /api/v1/admin/intelligence-profiles` | TEST-INTEL-001 |
| FR-INTEL-002 | SHOULD | Gán intelligence profile cho device type | backend | `POST /api/v1/admin/device-types/{id}/intelligence-profile` | TEST-INTEL-002 |
| FR-INTEL-003 | SHOULD | Train sample model cho một device type (offline, một lần) | ai/training | – | TEST-INTEL-003 |
| FR-INTEL-004 | SHOULD | API list/get intelligence profile | backend | `GET /api/v1/admin/intelligence-profiles` | TEST-INTEL-004 |
| FR-INTEL-005 | SHOULD | Update intelligence model xuống device qua MQTT `update_model` command | backend/firmware | MQTT | TEST-INTEL-005 |
| FR-INTEL-006 | NICE | Drift detection tự động | ai/pipelines | scheduled job | TEST-INTEL-006 |
| FR-INTEL-007 | NICE | Closed-loop retrain pipeline | ai/pipelines | scheduled job | TEST-INTEL-007 |
| FR-INTEL-008 | OUT | Full MLOps platform (auto-training, model registry, CI/CD cho model) | – | – | – |

---

## 9. Functional requirements – Audit Log

| ID | Priority | Mô tả | Service | API | Test |
|---|---|---|---|---|---|
| FR-AUDIT-001 | MUST | Ghi audit log cho hành động Admin: tạo tenant, gán device, upload firmware, tạo rollout | backend/core | audit_log middleware | TEST-MT-016 |
| FR-AUDIT-002 | MUST | Ghi audit log cho hành động Tenant: upload firmware, tạo OTA campaign | backend/client | audit_log middleware | TEST-MT-016 |
| FR-AUDIT-003 | MUST | Ghi audit log cho auth events: login success/fail, logout | auth | audit_log middleware | TEST-AUDIT-003 |
| FR-AUDIT-004 | SHOULD | Admin xem audit log với filter (actor, action, tenant, date range) | admin UI | `GET /api/v1/admin/audit-logs` | TEST-AUDIT-004 |
| FR-AUDIT-005 | SHOULD | Export audit log dưới dạng CSV | admin UI | `GET /api/v1/admin/audit-logs?format=csv` | TEST-AUDIT-005 |

---

## 10. Functional requirements – Admin UI

| ID | Priority | Mô tả | Page | Test |
|---|---|---|---|---|
| FR-UI-001 | MUST | Login admin với JWT | `/login` | TEST-UI-001 |
| FR-UI-002 | MUST | Dashboard hiện total/online/offline/OTA success rate 24h | `/dashboard` | TEST-UI-002 |
| FR-UI-003 | MUST | Device table filter status/hardware, sort last_seen | `/devices` | TEST-UI-003 |
| FR-UI-004 | MUST | Upload firmware form: version, hardware, file, release_notes | `/firmwares` | TEST-UI-004 |
| FR-UI-005 | MUST | Trigger rollout với strategy chọn được | `/rollouts` | TEST-UI-005 |
| FR-UI-006 | SHOULD | OTA progress realtime qua WebSocket (M0 dùng polling) | `/rollouts/{id}` | TEST-UI-006 |
| FR-UI-007 | SHOULD | Device detail page có telemetry chart + health + OTA history | `/devices/:id` | TEST-UI-007 |
| FR-UI-008 | SHOULD | Alert/anomaly page (dùng chung cho health scoring và intelligence results) | `/alerts` | TEST-UI-008 |
| FR-UI-009 | MUST | Tenant management: list, create, detail, assign device | `/tenants` | TEST-UI-009 |
| FR-UI-010 | MUST | Audit log page với filter | `/audit-logs` | TEST-AUDIT-004 |
| FR-UI-011 | SHOULD | Client Portal UI Chrome Internationalization (vi/en) (Scope: PR1+PR2 only, PR3-5 deferred) | `/client/*` | TEST-UI-011 |

---

## 10b. Functional requirements – Customer Workspace & Datastreams

| ID | Priority | Mô tả | Page | Test |
|---|---|---|---|---|
| FR-DS-001 | MUST | Tenant cấu hình Virtual Pin (V0–V255) Blynk-style | `/projects/:id/datastreams` | TEST-DS-001 |
| FR-DS-002 | MUST | Cấu hình Preset Chế độ Chân (Digital, Analog, PWM, String, JSON...) | `/projects/:id/datastreams` | TEST-DS-002 |
| FR-DS-003 | MUST | Ràng buộc bo mạch tương thích (Supported Device Models) | `/projects/:id/datastreams` | TEST-DS-003 |
| FR-DS-004 | MUST | Kéo thả Widget và chọn Virtual Pin dropdown tương thích | `/projects/:id/editor` | TEST-DS-004 |
| FR-DS-005 | MUST | MQTT Dynamic Topic & State mapping theo Virtual Pin | backend/telemetry | TEST-DS-005 |

---

## 11. Functional requirements – DevOps/CI/CD/Simulator

| ID | Priority | Mô tả | Test |
|---|---|---|---|
| FR-DEPLOY-001 | MUST | `make dev-up` chạy được full stack local qua Docker Compose | TEST-DEPLOY-001 |
| FR-DEPLOY-002 | MUST | Alembic migration script cho toàn bộ schema | TEST-DEPLOY-002 |
| FR-DEPLOY-003 | NICE | K3s deployment manifest (kustomize overlay staging) — M2-K3S | TEST-DEPLOY-003 |
| FR-DEPLOY-004 | SHOULD | Backup script pg_dump + MinIO mirror | TEST-DEPLOY-004 |
| FR-CICD-001 | MUST | GitHub Action backend: lint + pytest + Docker build trên PR | TEST-CICD-001 |
| FR-CICD-002 | MUST | GitHub Action firmware: ESP-IDF build + size report trên PR | TEST-CICD-002 |
| FR-CICD-003 | SHOULD | GitHub Action frontend: typecheck + build | TEST-CICD-003 |
| FR-CICD-004 | SHOULD | Tag `fw-v*` → upload firmware artifact lên OTA server | TEST-CICD-004 |
| FR-CICD-005 | NICE | Trivy scan với gate critical CVE | TEST-CICD-005 |
| FR-SIM-001 | MUST | Simulator chạy ≥ 20 device đồng thời (mục tiêu ≥ 50) | TEST-SIM-001 |
| FR-SIM-002 | SHOULD | Simulator hỗ trợ fault profile: `heap_leak`, `rssi_drop`, `reboot_loop`, `ota_fail` | TEST-SIM-002 |
| FR-SIM-003 | MUST | Simulator nhận `update_firmware` và publish progress: 0/sent/downloading/flashing/success/failed | TEST-SIM-003 |

---

## 12. Non-functional requirements

### Security

| ID | Priority | Mô tả | Verify by |
|---|---|---|---|
| NFR-SEC-001 | MUST | Không secret thật trong git; `.env.example` placeholder | git-secrets pre-commit |
| NFR-SEC-002 | MUST | Firmware verify sha256 trước khi flash | TEST-FW-007 |
| NFR-SEC-003 | SHOULD | OTA download dùng HTTPS ở staging/production | smoke test |
| NFR-SEC-004 | MUST | Device token hash bằng bcrypt/argon2 trong DB | code review |
| NFR-SEC-005 | SHOULD | Firmware verify Ed25519 signature | TEST-FW-012 |
| NFR-SEC-006 | NICE | Mosquitto bật mTLS, cert per device — M2-MTLS | smoke test |
| NFR-SEC-007 | MUST | RBAC 3 roles: admin, tenant_owner, viewer | TEST-UI-001 |
| NFR-SEC-008 | NICE | Secure boot + flash encryption ESP32 | manual test |

### Performance

| ID | Priority | Mô tả | Target |
|---|---|---|---|
| NFR-PERF-001 | MUST | OTA 500KB firmware qua Wi-Fi local | < 60s end-to-end |
| NFR-PERF-002 | MUST | Telemetry ingest 50 device × 5s interval | ingest_lag P95 < 2s |
| NFR-PERF-003 | MUST | API P95 latency các endpoint chính | < 500ms |
| NFR-PERF-004 | SHOULD | TinyML inference trên ESP32 (nếu device type có intelligence profile) | < 200ms/frame |
| NFR-PERF-005 | SHOULD | Stress test 50 simulator device | OTA success rate ≥ 90% |
| NFR-PERF-006 | NICE | Stress 500/1000 device | ingest_lag P95 < 5s |

### Reliability

| ID | Priority | Mô tả | Verify |
|---|---|---|---|
| NFR-REL-001 | MUST | Service crash recover trong < 30s (Docker restart policy) | chaos test |
| NFR-REL-002 | MUST | Device rollback khi firmware mới crash | TEST-FW-009..010 |
| NFR-REL-003 | MUST | MQTT broker restart không mất nhiều hơn 1 message/device | chaos test |
| NFR-REL-004 | SHOULD | DB unavailable 1 phút → ingest queue + retry | chaos test |

### Observability

| ID | Priority | Mô tả |
|---|---|---|
| NFR-OBS-001 | MUST | Tất cả service expose `/healthz`, `/readyz`, `/metrics` |
| NFR-OBS-002 | MUST | Log JSON với `service`, `request_id`, `device_id` |
| NFR-OBS-003 | SHOULD | Grafana: Fleet Overview + OTA Status dashboard |
| NFR-OBS-004 | SHOULD | Alert: OTAFailureRateHigh, DeviceOffline, ServiceDown |
| NFR-OBS-005 | SHOULD | Grafana: Anomaly/Alert dashboard (nếu intelligence scoring bật) |
| NFR-OBS-006 | NICE | OpenTelemetry trace cho OTA flow |

### Maintainability

| ID | Priority | Mô tả |
|---|---|---|
| NFR-MAINT-001 | MUST | Backend coverage ≥ 60% (MUST) / ≥ 75% (SHOULD) |
| NFR-MAINT-002 | MUST | Mọi service có README module |
| NFR-MAINT-003 | MUST | Mọi quyết định kiến trúc lớn có ADR |
| NFR-MAINT-004 | SHOULD | Pre-commit ruff + black + private key detect |

---

## 13. Security rule — Tenant Isolation

**Tenant users phải không bao giờ truy cập được device, firmware, telemetry, hoặc OTA jobs thuộc tenant khác.**

Implement:

- `tenant_id` luôn lấy từ JWT → DB, không bao giờ từ request parameter.
- Mọi query của `/client/*` endpoints phải có `WHERE tenant_id = current_user.tenant_id`.
- Gọi resource của tenant khác trả `404` (không phải `403` để không leak resource existence).

---

## 14. Test traceability mapping

| TEST-ID | Tên | Cover FR |
|---|---|---|
| TEST-E2E-01 | First boot telemetry | FR-REG-001..003, FR-TEL-001..004 |
| TEST-E2E-02 | OTA success | FR-OTA-001..009, FR-FW-006..011 |
| TEST-E2E-03 | OTA bad checksum reject | FR-FW-007, FR-OTA-005 |
| TEST-E2E-04 | Rollback crash firmware | FR-FW-009..010, NFR-REL-002 |
| TEST-E2E-05 | Tenant self-service OTA (MVP) | FR-MT-001..009, FR-OTA-007..009 |
| TEST-E2E-06 | Tenant isolation check | FR-MT-005, FR-MT-009 |
| TEST-E2E-07 | Rollout auto-quarantine | FR-OTA-010, FR-OTA-011 |
| TEST-E2E-08 | Optional intelligence integration | FR-INTEL-001..003, FR-FW-013 |
| TEST-E2E-09 | Audit log verification | FR-AUDIT-001..004 |

---

## 15. Scope cut order khi trễ

**Mức 1 (trễ ≤ 1 tháng)** – cắt NICE:

1. FR-OTA-013 (delta OTA).
2. FR-INTEL-006..008 (drift detection, closed-loop retrain, full MLOps).
3. NFR-PERF-006 (stress 500+).
4. NFR-SEC-006 (mTLS), NFR-SEC-008 (secure boot), FR-FW-015.
5. FR-DEPLOY-003 (K3s).

**Mức 2 (trễ 1–2 tháng)** – cắt NICE + một phần SHOULD:

6. FR-HEALTH-001..003 (health-scorer).
7. FR-INTEL-003..005 (intelligence model training và update).
8. NFR-OBS-004 (alerting) — giữ dashboard.
9. FR-CICD-005 (Trivy).

**Mức 3 (trễ 2–3 tháng)** – tinh giản SHOULD:

10. FR-OTA-011 (pause/resume) — chỉ giữ rollout manual.
11. FR-INTEL-001..002 (intelligence profile API) — chỉ giữ hardcoded sample.
12. FR-SIM-002 fault profile — chỉ giữ telemetry generation.

**Mức 4 (trễ ≥ 3 tháng)**: hoãn bảo vệ 1 kỳ.

**Luôn giữ** (không bao giờ cắt):

- Toàn bộ MUST (M0).
- FR-MT-001..009 (multi-tenant core).
- FR-AUDIT-001..003 (audit log cơ bản).
- FR-UI-001..005 (Admin UI tối thiểu).
- FR-SIM-001, FR-SIM-003 (simulator cơ bản).
- NFR-SEC-001, NFR-SEC-002, NFR-SEC-004 (security cơ bản).

---

## 16. Acceptance criteria cuối đồ án

### MUST checklist (M0)

- [ ] FR-AUTH-001..004 (login, JWT, route guard, logout).
- [ ] FR-MT-001..009 (multi-tenant: tạo tenant, owner, gán device, scoped access, upload firmware, OTA campaign, progress, JWT security).
- [ ] FR-AUDIT-001..003 (audit log cho Admin và Tenant actions).
- [ ] FR-REG-001..005 (device registry CRUD + heartbeat + worker offline).
- [ ] FR-OTA-001..010 (upload, latest, download, promote, rollout, OTA jobs, progress, auto-quarantine).
- [ ] FR-FW-001..011 (boot, Wi-Fi, MQTT, telemetry, command, OTA SM, verify, rollback, progress).
- [ ] FR-TEL-001..005 (subscribe MQTT, validate, ghi telemetry/health/progress).
- [ ] FR-UI-001..005, FR-UI-009, FR-UI-010 (Admin UI + tenant management + audit log).
- [ ] FR-DEPLOY-001..002 (docker compose, alembic migration).
- [ ] FR-CICD-001..002 (CI backend + firmware).
- [ ] FR-SIM-001, FR-SIM-003 (simulator ≥ 20 device, OTA progress sim).
- [ ] NFR-SEC-001, NFR-SEC-002, NFR-SEC-004, NFR-SEC-007.
- [ ] NFR-PERF-001..003.
- [ ] NFR-REL-001..003.
- [ ] NFR-OBS-001..002.
- [ ] NFR-MAINT-001..003.

**AC-M0-8**: Tenant flow end-to-end demo được:
Admin tạo tenant → Tenant login → Tenant chỉ thấy device của mình → Upload firmware → Tạo OTA campaign → ESP32/Simulator nhận lệnh → Báo cáo progress → Dashboard hiển thị đúng.

### SHOULD checklist (M1) — mục tiêu ≥ 80%

- [ ] FR-REG-006..007, FR-OTA-011..012, FR-FW-012..014.
- [ ] FR-TEL-006, FR-HEALTH-001..003, FR-INTEL-001..005.
- [ ] FR-UI-006..008, FR-DEPLOY-004, FR-CICD-003..004.
- [ ] FR-AUDIT-004..005.
- [ ] NFR-SEC-003, NFR-SEC-005, NFR-PERF-004..005, NFR-REL-004, NFR-OBS-003..005, NFR-MAINT-004.

### NICE checklist (M2) — best effort

- [ ] FR-REG-008, FR-OTA-013, FR-FW-015, FR-INTEL-006..007, FR-DEPLOY-003, FR-CICD-005.
- [ ] NFR-SEC-006, NFR-SEC-008, NFR-PERF-006, NFR-OBS-006.
