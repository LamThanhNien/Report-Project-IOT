# AIFOM Full System Audit Report

> **Ngày audit**: 2026-05-29
> **Phạm vi**: Toàn bộ hệ thống AIFOM — Backend, Frontend, Firmware, Infrastructure, Database, Security, Testing
> **Phương pháp**: Đọc code trực tiếp, cross-reference với tài liệu spec, kiểm tra security patterns

---

## 1. Executive Summary

| Tiêu chí | Điểm | Ghi chú |
|---|---|---|
| **Kiến trúc** | 6/10 | DDD structure tồn tại nhưng bị trùng lặp với legacy modules/ |
| **Database** | 5/10 | Schema đủ cho MVP nhưng thiếu TimescaleDB hypertable, thiếu index |
| **Bảo mật** | 5/10 | Có JWT auth tốt nhưng thiếu rate limiting, OTA token secret yếu, nhiều default credentials |
| **Tính năng** | 7/10 | Đa số M0 đã implement, multi-tenant flow hoạt động |
| **UI/UX** | 7/10 | Admin + Client tách biệt rõ ràng, feature gating tốt |
| **Testing** | 3/10 | Rất ít test, không có integration test, không security test |
| **Sẵn sàng bảo vệ** | 5/10 | Cần fix security, thêm test, dọn code trước khi bảo vệ |

**Tổng kết**: Hệ thống có nền tảng kiến trúc tốt, đa số tính năng M0 đã hoạt động. Tuy nhiên còn nhiều vấn đề bảo mật cần fix ngay, test coverage rất thấp, và codebase có dấu hiệu AI-generated leftovers cần dọn dẹp.

---

## 2. Current System Understanding

AIFOM là nền tảng quản lý thiết bị IoT biên (edge) với các thành phần chính:

- **Backend**: FastAPI (Python 3.11) với kiến trúc DDD Modular Monolith
- **Frontend**: React 18 + Vite + TypeScript + TailwindCSS, tách Admin Console và Customer Workspace
- **Database**: PostgreSQL 16 + TimescaleDB (chưa sử dụng hypertable)
- **MQTT**: Eclipse Mosquitto broker, firmware và backend giao tiếp qua MQTT
- **Storage**: MinIO (S3-compatible) cho firmware binaries
- **Firmware**: ESP32 (PlatformIO + Arduino framework) với MQTT telemetry, OTA update
- **Infrastructure**: Docker Compose cho local dev, Prometheus + Grafana cho monitoring

Luồng hoạt động chính:
1. Admin tạo tenant → gán thiết bị → tenant owner login
2. Tenant upload firmware → tạo OTA campaign → backend publish MQTT command
3. ESP32 nhận lệnh OTA → download firmware qua HTTP → verify SHA256 → flash
4. ESP32 publish telemetry/health qua MQTT → backend ingest vào PostgreSQL
5. Frontend hiển thị dashboard, device status, telemetry charts

---

## 3. Architecture Assessment

### 3.1 Điểm tốt

- **DDD Bounded Contexts rõ ràng**: `identity`, `device_registry`, `firmware_ota`, `telemetry`, `tenant_management`, `project_dashboard`, `tinyml_model_management` — mỗi context có domain/application/infrastructure/presentation layers
- **Multi-tenant isolation**: Tenant_id resolve từ JWT, không từ request body
- **Feature gating**: Service plan-based feature flags với per-tenant overrides
- **Separation of concerns**: Admin router và Client router tách biệt
- **Event-driven**: MQTT subscriber chạy async với message queue và batch processing
- **Device presence monitoring**: Background task kiểm tra device online/offline status
- **Startup reconciliation**: Khi backend restart, đánh dấu tất cả device "online" thành "offline" rồi chờ MQTT message mới

### 3.2 Điểm xấu

- **Dual module structure**: `app/modules/` VÀ `app/bounded_contexts/` cùng tồn tại. Nhiều file trong `bounded_contexts/` chỉ là alias redirect tới `modules/` (ví dụ: `app/modules/auth/service.py` → `bounded_contexts.identity.application.services`)
- **Mixed imports**: Router trong `bounded_contexts` import trực tiếp từ `app/modules/` (ví dụ: `router_client.py` import `from app.modules.firmware import repository`)
- **Legacy compatibility layer**: `_legacy_router_helper()` trong `router_client.py` — monkeypatch/test compatibility code trong production
- **Circular dependency risk**: `bounded_contexts/identity/presentation/dependencies.py` import `from app.modules.auth.model import User` thay vì dùng domain entity
- **No clear domain events**: Không có event bus giữa bounded contexts, chỉ có MQTT messaging external
- **Duplicate dependency injection**: `app/core/security.py` và `bounded_contexts/identity/presentation/dependencies.py` đều define `get_current_user`, `require_admin`

### 3.3 Khuyến nghị

Quyết định: giữ `bounded_contexts/` XÓA `modules/` hoặc ngược lại. Không thể maintain cả hai.

---

## 4. Database Assessment

### 4.1 Tables hiện có

| Table | Mục đích | Đánh giá |
|---|---|---|
| `users` | Người dùng hệ thống | ✅ OK, có FK tới tenants |
| `tenants` | Tenant/workspace | ✅ OK |
| `service_plans` | Gói dịch vụ | ✅ OK, JSONB features |
| `tenant_feature_overrides` | Feature overrides per tenant | ✅ OK, có unique constraint |
| `tenant_device_mappings` | Gán thiết bị cho tenant | ✅ OK, composite PK |
| `devices` | Thiết bị IoT | ✅ OK |
| `device_types` | Loại thiết bị | ✅ OK |
| `telemetry` | Dữ liệu cảm biến | ⚠️ Không phải hypertable |
| `firmware_versions` | Firmware binaries | ✅ OK |
| `ota_jobs` | OTA update jobs | ✅ OK |
| `ota_campaigns` | OTA campaigns | ✅ OK |
| `project_pages` | Project dashboard pages | ✅ OK |
| `project_widgets` | Dashboard widgets | ✅ OK |
| `anomaly_events` | Anomaly detection events | ✅ OK |
| `audit_logs` | Audit trail | ✅ OK, thiếu IP field |

### 4.2 Vấn đề

| Vấn đề | Bảng/Field | Impact | Severity |
|---|---|---|---|
| Telemetry không dùng TimescaleDB hypertable | `telemetry` | Không có time-series optimization, query chậm khi data lớn | **High** |
| Thiếu composite index cho telemetry queries | `telemetry(device_id, timestamp, metric_name)` | Full table scan khi query theo device + time range | **High** |
| `ota_jobs` không có `tenant_id` | `ota_jobs` | Phải join qua devices → tenant_device_mappings để filter theo tenant | **Medium** |
| `firmware_versions` thiếu unique constraint | `(version, target_device_type, uploaded_by_tenant_id)` | Tenant có thể upload trùng version | **Medium** |
| `devices.offline_timeout_seconds` default 60s | `devices` | Quá ngắn cho thiết bị IoT thực tế (nên 300s) | **Low** |
| Không có retention policy cho telemetry | `telemetry` | Data sẽ phình vô hạn | **Medium** |
| `audit_logs` không có IP address field | `audit_logs` | Không trace được ai làm gì từ đâu | **Medium** |

### 4.3 Khuyến nghị Database

1. **Convert `telemetry` sang TimescaleDB hypertable**
2. **Thêm composite index**: `(device_id, timestamp DESC, metric_name)`
3. **Thêm `tenant_id` vào `ota_jobs`** để giảm join
4. **Thêm unique constraint** cho `firmware_versions`
5. **Thêm `ip_address` field vào `audit_logs`**
6. **Implement retention policy** 90 ngày

---

## 5. Feature Completeness Matrix

### 5.1 M0 (MVP) — Bắt buộc

| Area | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| Firmware | ESP32 boot + WiFi + MQTT | **Done** | P0 | PlatformIO + Arduino framework |
| Firmware | Publish telemetry mỗi 5s | **Done** | P0 | |
| Firmware | Publish health mỗi 60s | **Done** | P0 | |
| Firmware | Nhận lệnh OTA qua MQTT | **Done** | P0 | |
| Firmware | Verify SHA256 trước khi flash | **Done** | P0 | |
| Firmware | Rollback tự động | **Partial** | P0 | Chưa thấy code rollback rõ ràng trong firmware PlatformIO |
| Backend | Device registry CRUD | **Done** | P0 | |
| Backend | Upload firmware + compute SHA256 | **Done** | P0 | |
| Backend | GET /firmwares/latest | **Done** | P0 | |
| Backend | Trigger OTA rollout | **Done** | P0 | |
| Backend | OTA job status tracking | **Done** | P0 | |
| Telemetry | MQTT ingest → DB | **Done** | P0 | Batch processing, queue-based |
| Telemetry | Handle invalid payload | **Done** | P0 | |
| Admin UI | Dashboard online/offline | **Done** | P0 | |
| Admin UI | Device list with filter | **Done** | P0 | |
| Admin UI | Upload firmware | **Done** | P0 | |
| Admin UI | Trigger OTA | **Done** | P0 | |
| Admin UI | OTA progress | **Done** | P0 | Polling-based |
| Simulator | 20-50 devices | **Partial** | P0 | Cần verify tester/ folder |
| Deploy | docker compose up | **Done** | P0 | |
| Deploy | .env.example đầy đủ | **Done** | P0 | |
| Deploy | Alembic migration | **Done** | P0 | 3 migration files |
| CI | GitHub Actions | **Partial** | P0 | Cần verify workflow |
| Multi-tenant | Admin tạo tenant | **Done** | P0 | |
| Multi-tenant | Admin gán thiết bị | **Done** | P0 | |
| Multi-tenant | Tenant login + JWT | **Done** | P0 | |
| Multi-tenant | Tenant scoped devices | **Done** | P0 | |
| Multi-tenant | Tenant upload firmware | **Done** | P0 | |
| Multi-tenant | Tenant tạo OTA campaign | **Done** | P0 | |
| Multi-tenant | Tenant theo dõi OTA | **Done** | P0 | |

### 5.2 M1 (Main) — Nên có

| Area | Feature | Status | Priority | Notes |
|---|---|---|---|---|
| Security | JWT auth | **Done** | P1 | |
| Security | Device provisioning token | **Done** | P1 | |
| Security | Firmware signature | **Partial** | P1 | Schema có field nhưng chưa verify trong firmware |
| Security | Mosquitto username/password | **Done** | P1 | |
| Observability | Prometheus metrics | **Done** | P1 | |
| TinyML | Intelligence profile | **Partial** | P1 | Có model management nhưng chưa inference |
| Feature Control | Service plan features | **Done** | P1 | 12 feature keys, 4 plan tiers |
| Feature Control | Per-tenant overrides | **Done** | P1 | |
| Project Dashboard | Widget system | **Done** | P1 | Drag-and-drop grid |
| Real-time | SSE device status | **Done** | P1 | |

### 5.3 Missing features

| Feature | Status | Priority | Notes |
|---|---|---|---|
| Rate limiting | **Missing** | P0 | Không có rate limit trên bất kỳ endpoint nào |
| Password complexity | **Missing** | P1 | Không validate password strength |
| Token refresh | **Missing** | P1 | JWT 24h, không có refresh token |
| Telemetry retention policy | **Missing** | P1 | Data sẽ phình vô hạn |
| TimescaleDB hypertable | **Missing** | P1 | Theo spec yêu cầu |
| Error boundaries frontend | **Missing** | P2 | |
| WebSocket telemetry | **Missing** | P2 | Hiện dùng polling |
| Canary rollout | **Missing** | M1-ROLL | Chưa implement |
| Alert notifications | **Partial** | M1-OBS | Có anomaly events nhưng chưa alert |

---

## 6. Security Findings

| Severity | Finding | Location | Impact | Recommended Fix |
|---|---|---|---|---|
| **Critical** | OTA token secret default yếu, không validator | `config.py:82` | Attacker forge OTA download token | Thêm validator giống JWT secret |
| **Critical** | Không có rate limiting | Toàn bộ API | Brute force login, DoS | Thêm `slowapi` middleware |
| **High** | JWT 24h expiry, không refresh | `config.py:78` | Token leak = 24h access | Giảm 30min + refresh token |
| **High** | Provisioning secret hardcoded | `.env.example:80` + `platformio.ini:42` | Attacker register device任意 | Rotate per-deployment |
| **High** | MQTT passwords weak defaults | `.env.example:24-27` | Unauthorized MQTT access | Generate random |
| **High** | MinIO credentials weak | `.env.example:34-35` | Unauthorized firmware access | Generate random |
| **High** | Admin password weak | `.env.example:83` | Unauthorized admin | Force change on first login |
| **Medium** | SSE JWT trong query param | `router_client.py:1256` | JWT visible trong logs | SSE-specific token |
| **Medium** | Debug endpoint active | `debug_router.py` | Information disclosure | Verify production disabled |
| **Medium** | MQTT không TLS | `mosquitto.conf` | Plaintext traffic | Enable TLS |
| **Medium** | firmware_max_size 32MB | `config.py:56` | Upload DoS | Giảm 4-8MB |
| **Low** | No password complexity | `identity/router.py` | Weak passwords | Add validation |
| **Low** | CORS overly permissive | `main.py:289-290` | All methods/headers | Restrict |

---

## 7. Reliability and Performance Findings

| Severity | Finding | Location | Impact | Recommended Fix |
|---|---|---|---|---|
| **High** | Telemetry không phải hypertable | Telemetry model | Query chậm | Convert TimescaleDB |
| **High** | Thiếu composite index | `telemetry` table | Full table scan | Add `(device_id, timestamp, metric_name)` |
| **Medium** | MQTT batch partial fail | `mqtt_subscriber.py:260-293` | Rollback cả batch | Per-message commit |
| **Medium** | Device monitor 5s | `config.py:37` | Quá nhiều DB queries | Tăng 30-60s |
| **Medium** | Alembic timeout 30s | `main.py:88-133` | Migration timeout | Run separately |
| **Medium** | MQTT queue drop khi full | `mqtt_subscriber.py:176-182` | Silent message loss | Log metric |
| **Medium** | Frontend polling OTA | Frontend | Không real-time | Switch SSE/WebSocket |

---

## 8. UI/UX Findings

| Severity | Finding | Location | Impact | Recommended Fix |
|---|---|---|---|---|
| **Medium** | Không có Error Boundary | `App.tsx` | React crash = trắng màn hình | Thêm ErrorBoundary |
| **Medium** | Loading chỉ spinner | `ProtectedRoute.tsx` | User không biết chờ gì | Thêm skeleton screens |
| **Medium** | Feature gating frontend-only | `FeatureContext.tsx` | Thấy menu nhưng bị 403 | Disable locked features |
| **Medium** | Không có toast notification | Frontend | Không biết action success/fail | Thêm react-hot-toast |
| **Low** | Vietnamese inconsistency | Nhiều files | Mix EN/VN | Standardize |
| **Low** | Không có mobile layout | `ClientLayout.tsx` | Mobile UX kém | Responsive breakpoints |
| **Low** | Dark mode partial | `ThemeContext.tsx` | Chưa test all pages | Audit |

---

## 9. Code Quality Findings

| Severity | Finding | Location | Impact | Recommended Fix |
|---|---|---|---|---|
| **High** | Dual module structure | `backend/app/` | Confusion, duplication | Chọn 1, xóa kia |
| **High** | 8+ alias files | `app/modules/*/` | Import confusion | Xóa aliases |
| **Medium** | `_legacy_router_helper()` | `router_client.py:615` | Production test compat | Remove |
| **Medium** | Duplicate `_ota_job_read()` | `router_client.py` + `router_admin.py` | Code duplication | Shared utility |
| **Medium** | `utc_now()` in 10+ files | Every model | Code duplication | Shared utility |
| **Low** | `router_client.py` 1283 lines | `router_client.py` | Hard to maintain | Split by feature |

---

## 10. Testing Gaps

| Area | Current | Gap | Priority |
|---|---|---|---|
| Auth | Happy path | Invalid creds, inactive, disabled tenant | **P0** |
| RBAC | Stubbed admin | Non-admin, tenant roles, viewer | **P0** |
| Tenant isolation | Not tested | Cross-tenant access | **P0** |
| Device CRUD | Happy path | Duplicate UID, invalid data | **P1** |
| Telemetry | Not tested | Invalid payload, unknown device | **P1** |
| Firmware upload | Not tested | Size limits, MinIO failure | **P1** |
| OTA creation | Not tested | Tenant ownership | **P1** |
| Security | None | IDOR, brute force, token forgery | **P0** |
| Load | None | Concurrent devices | **P2** |

---

## 11. Missing MVP Requirements

| Requirement | Status | Action |
|---|---|---|
| Rate limiting | **Missing** | Implement `slowapi` |
| OTA token validation | **Missing** | Add validator in `config.py` |
| TimescaleDB hypertable | **Missing** | Migration |
| Composite index | **Missing** | Migration |
| Firmware rollback | **Partial** | Verify ESP32 code |
| Simulator | **Partial** | Verify tester/ |
| Password complexity | **Missing** | Add validation |

---

## 12. Over-scoped / Should Defer

| Feature | Reason |
|---|---|
| K3s deployment (M2-K3S) | Docker Compose đủ |
| mTLS Mosquitto (M2-MTLS) | Username/password đủ |
| Delta firmware (M2-DELTA) | Quá phức tạp |
| MLflow (M2-MLFLOW) | File metadata đủ |
| Loki/Tempo (M2-LOKI) | Prometheus + Grafana đủ |
| Drift detection (M2-DRIFT) | Cần data nhiều |

---

## 13. Recommended Architecture Improvements

### Ngắn hạn (trước khi bảo vệ)

1. Chọn 1 architecture: giữ `bounded_contexts/`, migrate từ `modules/`, xóa alias files
2. Extract shared utilities: `utc_now()`, `_ota_job_read()`
3. Remove `_legacy_router_helper()`
4. Split `router_client.py` theo feature
5. Consolidate security dependencies

### Trung hạn (sau khi bảo vệ)

1. Domain events giữa bounded contexts
2. Repository pattern consistency
3. Application service layer

---

## 14. Recommended Database Improvements

### Cần migration ngay

1. Convert `telemetry` sang TimescaleDB hypertable
2. Thêm composite index `(device_id, timestamp DESC, metric_name)`
3. Retention policy 90 ngày
4. `ip_address` vào `audit_logs`
5. Unique constraint `firmware_versions`

### Nên làm sau

1. `tenant_id` vào `ota_jobs`
2. Partitioning `audit_logs`
3. Materialized view dashboard

---

## 15. Recommended Security Hardening Plan

### Immediate P0 (trong tuần)

1. OTA token secret validator
2. Rate limiting login/register
3. Rotate default credentials
4. JWT expiry 30 phút

### Short-term P1 (trong tháng)

1. Password complexity
2. IP audit logging
3. SSE-specific tokens
4. CORS production
5. Security headers

### Later P2/P3

1. Token refresh flow
2. Account lockout
3. Firmware Ed25519 verify
4. TLS cho MQTT

---

## 16. Recommended Development Roadmap

### Stage 1: Stabilize (1 tuần)

- OTA token validator
- Rate limiting
- Rotate credentials
- TimescaleDB hypertable
- Verify rollback

### Stage 2: Security (1 tuần)

- JWT 30min
- Password complexity
- Security tests (20+ cases)

### Stage 3: Database (1 tuần)

- Retention policy
- Unique constraints
- Test 50 devices

### Stage 4: UI/UX (1 tuần)

- ErrorBoundary
- Toast notifications
- Responsive layout

### Stage 5: Tests (2 tuần)

- Unit tests (15+ cases)
- Integration tests (10+ cases)
- Security tests (10+ cases)

### Stage 6: Polish (1 tuần)

- Demo script
- Slide bảo vệ
- Video backup
- 30 câu hỏi phản biện

---

## 17. Files Requiring Attention

### Cần refactor ngay

| File | Issue |
|---|---|
| `backend/app/modules/` (30+ files) | Legacy, duplicate |
| `router_client.py` | 1283 lines, legacy helper |
| `config.py:82` | OTA token weak |
| ~10 model files | Duplicate `utc_now()` |

### Cần review security

| File | Issue |
|---|---|
| `.env.example` | Default credentials weak |
| `platformio.ini` | Hardcode provisioning token |
| `router_client.py:1254` | JWT in SSE query |
| `config.py` | OTA token no validator |

### Cần migrate và xóa

| File | Reason |
|---|---|
| `app/modules/auth/service.py` | Alias |
| `app/modules/auth/model.py` | Alias |
| `app/modules/anomaly/model.py` | Alias |
| `app/modules/telemetry/model.py` | Alias |
| `app/modules/firmware/model.py` | Alias |
| `app/modules/devices/model.py` | Alias |
| `app/modules/ota/model.py` | Alias |
| `app/modules/tenants/model.py` | Alias |

---

## 18. Final Verdict

### 18.1 Dự án hiện tại có dùng được không?

**Có** — hệ thống hoạt động được cho mục đích demo. Multi-tenant flow end-to-end đã implement và có thể demo.

### 18.2 Có đủ an toàn cho demo không?

**Cần fix trước** — default credentials quá yếu, không rate limiting, OTA token secret không validator. Demo trên local thì tạm chấp nhận, nhưng phải:
- Đổi tất cả default credentials
- Thêm rate limiting login
- Thêm OTA token secret validator

### 18.3 Sẵn sàng bảo vệ tốt nghiệp chưa?

**Chưa** — cần hoàn thành:
1. Fix 3 security P0 issues
2. Thêm tests (20-30 cases)
3. Dọn code (1 architecture)
4. TimescaleDB hypertable
5. Verify firmware rollback
6. Demo script + slide

Ước tính: 3-4 tuần còn lại.

### 18.4 Top 10 tasks phải làm tiếp

| # | Task | Priority | Effort |
|---|---|---|---|
| 1 | OTA token validator + rotate credentials | P0 | 1 giờ |
| 2 | Rate limiting login/register | P0 | 2 giờ |
| 3 | TimescaleDB hypertable + index | P0 | 2 giờ |
| 4 | Security tests (20+ cases) | P0 | 2 ngày |
| 5 | JWT 30min + refresh token | P1 | 4 giờ |
| 6 | Password complexity + IP audit | P1 | 2 giờ |
| 7 | Quyết định architecture | P1 | 1 ngày |
| 8 | ErrorBoundary + toast + UX | P1 | 4 giờ |
| 9 | Integration tests MQTT + OTA | P1 | 2 ngày |
| 10 | Verify rollback + demo script | P1 | 2 ngày |

---

**Tác giả**: Claude Code Full System Audit
**Ngày**: 2026-05-29
**Phương pháp**: Static code analysis, cross-reference với spec documents, security pattern review
**Trạng thái**: Bản audit đầy đủ — cần review bởi sinh viên thực hiện
