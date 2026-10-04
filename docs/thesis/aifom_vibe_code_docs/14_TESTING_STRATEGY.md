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

# 14 – Testing Strategy

## 1. Testing pyramid

```txt
                Manual demo
              E2E / smoke
      API + integration tests
        Unit / component tests
 Static analysis / lint / typecheck
```

AIFOM không cần automation 100%, nhưng các logic dễ vỡ của tenant isolation, OTA state machine và firmware flow bắt buộc phải có test.

## 2. Backend unit tests

Test các lớp:

- Schema validation
- Service logic
- Repository basic CRUD
- Tenant guard / feature gate
- OTA state machine
- Firmware version comparison
- Rollout target selection
- Health scoring input validation (M1)
- Audit log creation on action

Ví dụ test case unit:

| Case | Expected |
|---|---|
| Upload empty file | 400 |
| Upload duplicate version/hardware | 409 |
| Invalid semver | 422 |
| Latest firmware when current older | `has_update=true` |
| Latest firmware when current equal | `has_update=false` |
| Progress invalid transition | 400 |
| Feature bị tắt theo plan | 403 |
| Tenant user không có `tenant_id` | 403 |
| Admin action → audit log được tạo | audit_log row exists |
| Tenant action → audit log được tạo với đúng tenant_id | audit_log row with tenant_id |

## 3. Backend integration tests

Use Docker Compose test stack: PostgreSQL, TimescaleDB, MinIO, Mosquitto.

Test:

- Upload firmware → file tồn tại trong MinIO → metadata có trong DB.
- MQTT health payload → row xuất hiện trong TimescaleDB.
- Create rollout → OTA jobs được tạo đúng số lượng.
- OTA progress MQTT → `ota_jobs` được cập nhật đúng trạng thái.
- Tenant tạo OTA campaign → chỉ sinh job cho device đã được gán.
- Admin tạo tenant → audit_log record được tạo.
- Tenant upload firmware → audit_log record có tenant_id đúng.

## 4. API tests

API tests phải cover:

- Auth success/fail
- RBAC role matrix: admin / tenant_owner / viewer
- Feature gating
- Tenant isolation
- Status code: `401/403/404`
- Admin namespace vs client namespace

Cần test cả 2 bề mặt:

- Admin APIs: `/api/v1/admin/*`
- Customer Workspace APIs: `/api/v1/client/*`

## 5. Frontend tests

Frontend test tập trung vào hành vi người dùng:

- Login redirect đúng theo role (admin → dashboard, tenant → /client/dashboard, viewer → /client/dashboard read-only)
- Route guard admin vs tenant
- Customer Workspace chỉ render menu khi feature bật
- Upload firmware form validate lỗi cơ bản
- OTA campaign form chỉ cho chọn thiết bị thuộc tenant
- Dashboard hiển thị trạng thái OTA success/failed/in-progress
- Viewer không thấy nút upload/create
- Debug logger chỉ bật trong development mode

## 6. Firmware / IoT tests

### Unit/component tests

Tách logic có thể test native:

- Version compare
- Command JSON parse
- SHA256 compare
- OTA state transition
- Health metric aggregation

### Device / simulator tests

- Wi-Fi connect.
- MQTT connect.
- Publish telemetry.
- Receive update_firmware command.
- OTA success.
- OTA invalid checksum → reject, không flash.
- Rollback crash firmware.
- Publish OTA progress: 0 / sent / downloading / flashing / success / failed.

## 7. Multi-tenant & OTA self-service test catalog

Các test dưới đây trace trực tiếp tới `FR-MT-*` trong `19_REQUIREMENTS_AND_TRACEABILITY.md`.

| TEST-ID | Nhóm test | Mô tả | Kết quả mong đợi | Cover FR |
|---|---|---|---|---|
| TEST-MT-001 | API + Integration | Admin tạo tenant mới | `201`, tenant row được tạo, slug unique, query lại được qua admin detail API | FR-MT-001 |
| TEST-MT-002 | API + Integration | Admin tạo tenant owner account | `201`, user role=`tenant_owner`, `user.tenant_id` khớp tenant vừa tạo | FR-MT-002 |
| TEST-MT-003 | API + Integration | Admin gán device cho tenant | `201`, row trong `tenant_device_mappings`, device xuất hiện trong `GET /api/v1/client/devices` của tenant đó | FR-MT-003 |
| TEST-MT-004 | API | Tenant login thành công | `200`, JWT/session chứa role tenant và tenant context; `GET /api/v1/client/me` trả đúng tenant info | FR-MT-004 |
| TEST-MT-005 | API + Security | Tenant không truy cập được device của tenant khác | Device lạ không xuất hiện trong list; gọi detail trực tiếp trả `404` | FR-MT-005, FR-MT-009 |
| TEST-MT-006 | API + Integration | `tenant_owner` upload firmware binary `.bin` | `201`, artifact lưu MinIO, metadata firmware mang `tenant_id` đúng | FR-MT-006 |
| TEST-MT-007 | API + Integration | `tenant_owner` tạo OTA campaign cho thiết bị đã được gán | `201`, OTA jobs chỉ sinh cho device thuộc tenant, backend publish MQTT command | FR-MT-007 |
| TEST-MT-008 | API + Security | Tenant không tạo được OTA campaign cho thiết bị chưa được gán | `403` hoặc `404`, không sinh OTA job, không publish MQTT | FR-MT-005, FR-MT-007, FR-MT-009 |
| TEST-MT-009 | Firmware/IoT + Integration | Device nhận OTA command | Simulator/ESP32 nhận đúng payload `update_firmware` trên topic của device | FR-MT-007 |
| TEST-MT-010 | Firmware/IoT + Integration | Device report OTA progress | `ota_jobs` chuyển trạng thái hợp lệ, progress tăng dần, dashboard cập nhật được | FR-MT-008 |
| TEST-MT-011 | Frontend + E2E | Dashboard hiển thị OTA success/failure | Tenant Portal hiện count/table đúng khi job `success` hoặc `failed` | FR-MT-008 |
| TEST-MT-012 | Unit + API | Feature permission/service plan hoạt động đúng | Feature bật → API `200`; feature tắt → `403`; quota vượt giới hạn → `403` kèm message rõ | FR-MT-011 |
| TEST-MT-013 | API + Security | `401/403/404` được xử lý đúng | Không token → `401`; sai role → `403`; tài nguyên khác tenant → `404` | FR-MT-005, FR-MT-009 |
| TEST-MT-014 | Frontend + Dev | Terminal/debug logging hoạt động trong development mode | `VITE_DEBUG_LOGS=true` → log hiện; production → disabled | NFR-OBS-002 |
| TEST-MT-015 | API + Integration | Viewer không thực hiện được write action | Viewer gọi upload/create OTA → `403` | FR-MT-010 |
| TEST-MT-016 | API + Integration | Audit log được tạo sau hành động Admin/Tenant | Sau mỗi create/assign/upload → audit_log row exists với actor, action, tenant_id | FR-AUDIT-001..003 |

## 8. Phân loại TEST-MT theo nhóm thực thi

### Unit tests

- `TEST-MT-012`, `TEST-MT-013` (guard/dependency)

### Integration tests

- `TEST-MT-001`, `TEST-MT-002`, `TEST-MT-003`
- `TEST-MT-006`, `TEST-MT-007`, `TEST-MT-009`, `TEST-MT-010`, `TEST-MT-016`

### API tests

- `TEST-MT-001` đến `TEST-MT-008`, `TEST-MT-013`, `TEST-MT-015`

### Frontend tests

- `TEST-MT-011`, `TEST-MT-014`

### End-to-end demo tests

- `TEST-MT-007`, `TEST-MT-009`, `TEST-MT-010`, `TEST-MT-011`

## 9. E2E test scenarios

### TEST-E2E-01: First boot telemetry

1. Start stack.
2. Start simulator 10 devices.
3. Devices register + heartbeat.
4. Admin UI shows online devices.
5. TimescaleDB has telemetry rows.

### TEST-E2E-02: OTA success

1. Upload firmware v1.0.1.
2. Create rollout/campaign for 10 devices.
3. Devices report progress.
4. Jobs success.
5. Dashboard shows new firmware distribution.

### TEST-E2E-03: OTA bad checksum reject

1. Tamper firmware binary.
2. Device rejects — không flash.
3. Job failed with checksum error.
4. Device remains on old version.

### TEST-E2E-04: Rollback crash firmware

1. Upload firmware designed to crash.
2. OTA to one device.
3. Device reboots/crashes.
4. Bootloader rolls back.
5. Server marks rolled_back/failed.

### TEST-E2E-05: Tenant self-service OTA (chính — MVP)

1. Admin tạo tenant.
2. Admin tạo tenant owner account.
3. Admin gán 1 device hoặc 1 simulator cho tenant.
4. Tenant login vào Customer Workspace.
5. Tenant chỉ thấy thiết bị của mình.
6. Tenant upload firmware binary `.bin`.
7. Tenant tạo OTA campaign cho device vừa được gán.
8. Device nhận lệnh OTA, report progress.
9. Tenant dashboard hiển thị success hoặc failed đúng trạng thái.
10. Kiểm tra: tenant không thấy device/OTA của tenant khác.

### TEST-E2E-06: Tenant isolation check

1. Tạo 2 tenant (A và B) với device riêng.
2. Tenant A login → chỉ thấy device của A.
3. Tenant A thử gọi device detail của B → `404`.
4. Tenant A thử tạo OTA campaign cho device của B → `403`.

### TEST-E2E-07: Rollout auto-quarantine (M1)

1. Upload firmware với intentional self-test fail.
2. Create rollout 100% trên 10 simulator devices.
3. Failure rate vượt threshold 5%.
4. Rollout pause, firmware → quarantined.
5. Alert xuất hiện.

### TEST-E2E-08: Optional intelligence integration (M1 — academic highlight)

1. Simulator inject anomaly telemetry cho device type có intelligence profile.
2. Health scorer detects anomaly.
3. Alert is created.
4. UI shows device in anomaly/alert list.
5. Kiểm tra: device type không có intelligence profile → không ảnh hưởng.

### TEST-E2E-09: Audit log verification

1. Admin tạo tenant → audit log record.
2. Admin gán device → audit log record.
3. Tenant upload firmware → audit log record.
4. Tenant tạo OTA → audit log record.
5. Admin xem `/audit-logs` → thấy đầy đủ hành động.

## 10. Simulator tests

Device simulator phải mô phỏng:

- N devices online.
- Telemetry publish interval.
- Health publish interval.
- OTA progress state machine.
- Random network failure.
- Fault injection (M1).

CLI example:

```bash
python iot/simulator/device_simulator.py \
  --count 50 \
  --mqtt-host localhost \
  --fault-profile rssi_drop \
  --duration 30m
```

## 11. Test data management

- Seed admin user.
- Seed tối thiểu 2 tenant demo.
- Seed 1 tenant owner account per tenant.
- Seed 3–5 demo devices và gán rõ ràng cho từng tenant.
- Seed sample firmware metadata cho ít nhất 2 tenant.
- Provide reset script.

## 12. Acceptance criteria

- Backend test coverage ≥ 60% (MUST) / ≥ 75% (SHOULD) by final.
- Tenant guard và OTA state machine được cover.
- Simulator chạy được tối thiểu 50 devices.
- Có đủ `TEST-MT-001..016`.
- Có ít nhất `TEST-E2E-01..06` được document và demoable.
- Stress test report lưu ở CSV/Markdown.
- Audit log tests pass.
