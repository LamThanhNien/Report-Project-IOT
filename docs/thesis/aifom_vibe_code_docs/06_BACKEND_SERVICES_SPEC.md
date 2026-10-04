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

# 06 – Backend Services Specification

## 1. Mục tiêu tài liệu

Tài liệu này mô tả đặc tả backend cho hướng sản phẩm hiện tại của AIFOM:

- Nền tảng IoT đa tenant hạng nhẹ.
- Admin Console quản lý toàn nền tảng.
- Customer Workspace (Tenant Portal) cho tenant tự phục vụ OTA.
- Luồng MVP chính:
  `Admin tạo tenant -> tạo tenant owner -> gán device -> tenant login -> upload firmware binary -> tạo OTA campaign -> device update -> dashboard theo dõi progress`.

Phạm vi tài liệu này **không** mở rộng AIFOM thành full SaaS thương mại:

- Service plan/feature permission chỉ dùng để bật/tắt tính năng và quota cơ bản.
- Billing/payment không phải core flow.
- Upload source code và auto-build firmware là **Future Work / Out of Scope** của MVP.

## 2. Nguyên tắc backend chung

Mỗi FastAPI module/service phải có:

- `/healthz`: kiểm tra process còn sống.
- `/readyz`: kiểm tra DB/broker/storage dependency.
- `/metrics`: Prometheus metrics.
- JSON structured logging.
- Config qua environment variables.
- Dockerfile multi-stage.
- Unit test + integration test tối thiểu cho happy path và edge case.

Nguyên tắc bảo mật bắt buộc:

- Backend **không tin** `tenant_id` từ frontend body/query/header.
- `tenant_id` luôn được resolve từ JWT/session rồi đối chiếu DB user hiện tại.
- Query tenant-scoped luôn filter bằng `current_user.tenant_id`.
- Resource không thuộc tenant hiện tại phải trả `404` hoặc `403` tùy ngữ cảnh, không làm lộ dữ liệu tenant khác.

## 3. Ranh giới service/module hiện tại

> **Cập nhật 2026-05-27:** Backend đã refactor sang Modular Monolith với DDD bounded contexts. Bảng dưới đây cập nhật mapping giữa domain và bounded context hiện tại.

Trong repo hiện tại, AIFOM dùng một FastAPI backend dạng **Modular Monolith**. Ranh giới domain được map qua bounded contexts:

| Domain | Trách nhiệm chính | Bounded Context | Legacy Module |
|---|---|---|---|
| Auth/RBAC | login, JWT, current user, admin guard | `identity` | `modules/auth/`, `core/security.py` |
| Tenant core | tenant, service plan, feature overrides, tenant-device mapping | `tenant_management` | `modules/tenants/`, `core/tenant.py` |
| Device registry | đăng ký thiết bị, metadata, heartbeat, device types, capabilities | `device_registry` | `modules/devices/` |
| Firmware | metadata firmware, upload/download artifact, firmware profiles | `firmware_ota` | `modules/firmware/`, `services/minio_client.py` |
| OTA | OTA job, campaign, publish MQTT command, progress state | `firmware_ota` | `modules/ota/`, `services/mqtt_publisher.py` |
| Telemetry | ingest telemetry, health, device status, telemetry schemas | `telemetry` | `modules/telemetry/`, `services/mqtt_subscriber.py` |
| Project Dashboard | tenant projects, pages, widgets, device capabilities, commands | `project_dashboard` | `modules/projects/` |
| TinyML/Anomaly | anomaly events, ML model registry, predictions, health scores | `tinyml_model_management` | `modules/anomaly/` |
| Audit | audit logs | `shared/cross-cutting` | `modules/audit/` |
| Alerts | server-side alerts | `shared/cross-cutting` | `modules/alerts/` |
| Debug/dev logging | nhận log từ frontend khi chạy dev | (legacy) | `modules/debug/` |

### Kiến trúc Modular Monolith

Backend KHÔNG phải microservices. Tất cả bounded contexts nằm trong một FastAPI deployable:

```
backend/app/
  bounded_contexts/    ← DDD bounded contexts (mới)
  shared/              ← Cross-cutting concerns
  modules/             ← Legacy modules (vẫn hoạt động)
  api/v1/router.py     ← Central router import từ bounded_contexts
  main.py              ← App entrypoint
```

Mỗi bounded context có 4 layer: `domain/`, `application/`, `infrastructure/`, `presentation/`.

Old modules vẫn tồn tại làm compatibility wrapper. Bounded context routers import từ old modules qua module reference để đảm bảo test monkeypatch hoạt động.

### Shared/Cross-Cutting Concerns

| Concern | Location | Purpose |
|---------|----------|---------|
| DB session | `shared/infrastructure/db/session.py` | SessionLocal, get_db |
| Base model | `shared/infrastructure/db/base.py` | SQLAlchemy DeclarativeBase |
| Config | `shared/infrastructure/config.py` | Settings re-export |
| Logging | `shared/infrastructure/logging.py` | configure_logging |
| Metrics | `shared/infrastructure/metrics.py` | Prometheus counters |
| Domain events | `shared/domain/events.py` | Event base classes |
| Domain exceptions | `shared/domain/exceptions.py` | EntityNotFoundError, etc. |
| Value objects | `shared/domain/value_objects.py` | DeviceUID, TenantSlug, SemVer, EmailAddress |
| Unit of Work | `shared/application/unit_of_work.py` | Abstract UoW interface |
| Pagination | `shared/application/pagination.py` | Page[T] generic |
| Error codes | `shared/application/errors.py` | ErrorCode enum |
| Dependencies | `shared/presentation/dependencies.py` | Auth, tenant, get_db |
| Error handlers | `shared/presentation/error_handlers.py` | Domain exception → HTTP response |

### TimescaleDB Compatibility

TimescaleDB usage là **defensive** — app phải hoạt động với normal PostgreSQL tables:

- `device_status_events`, `device_health`: bảng bình thường, có thể convert sang hypertable.
- `model_predictions`, `health_scores`: bảng bình thường, hypertable optional.
- Migration dùng `create_hypertable(..., if_not_exists => TRUE)` wrapped trong try/except.
- Test/dev environments không có TimescaleDB vẫn hoạt động bình thường.

### tenant_id Nullable Rules

- `tenant_id = NULL`: chỉ dành cho platform/global records do admin tạo.
- Tenant/client endpoints LUÔN filter bằng `current_user.tenant_id` từ JWT.
- Không bao giờ lấy `tenant_id` từ request body/query.

## 4. Tenant Management Service

### Trách nhiệm

- Tạo/sửa/disable tenant.
- Gán tenant vào service plan.
- Trả thống kê `device_count`, `user_count`.
- Lưu `slug`, `is_active`, `plan_id`.
- Là đầu mối admin-side cho Customer Workspace lifecycle.

### API trách nhiệm

Các API admin-side chuẩn:

- `GET /api/v1/admin/tenants`
- `POST /api/v1/admin/tenants`
- `GET /api/v1/admin/tenants/{tenant_id}`
- `PUT /api/v1/admin/tenants/{tenant_id}`
- `PATCH /api/v1/admin/tenants/{tenant_id}/status`

### Quy tắc nghiệp vụ

- Chỉ `admin` được tạo tenant.
- `slug` unique toàn hệ thống.
- `is_active=false` phải chặn tenant login hoặc chặn tenant gọi API protected.
- Khi tạo tenant có thể kèm tạo luôn tenant owner account.
- Nếu chọn flow "create tenant + create owner", thao tác nên mang tính atomic ở mức nghiệp vụ.

### Bắt buộc cho MVP

- **Admin có thể tạo tenant và tenant owner account.**
- Response phải trả đủ thông tin để Admin Console chuyển sang bước gán device ngay sau khi tạo.

## 5. Tenant User Management Service

### Trách nhiệm

- Tạo tenant owner ban đầu.
- Quản lý user nội bộ của tenant.
- Phân role cho tenant user.
- Kiểm soát quota `max_users` nếu service plan bật giới hạn.

### API trách nhiệm

Admin-side:

- `GET /api/v1/admin/tenants/{tenant_id}/users`
- `POST /api/v1/admin/tenants/{tenant_id}/users`
- `DELETE /api/v1/admin/tenants/{tenant_id}/users/{user_id}`

Tenant-side:

- `GET /api/v1/client/users`
- `POST /api/v1/client/users`
- `DELETE /api/v1/client/users/{user_id}`

### Quy tắc nghiệp vụ

- `admin` có thể tạo user cho bất kỳ tenant nào.
- `tenant_owner` có thể tạo/xóa user trong tenant của mình.
- `viewer` chỉ được xem dữ liệu, không có quyền tạo/xóa user hoặc thao tác ghi.
- Email unique toàn hệ thống để tránh trùng account giữa nhiều tenant.

### Ghi chú đồng bộ thuật ngữ

Hệ thống chuẩn hóa trên 3 vai trò đang hoạt động:

- `admin`
- `tenant_owner`
- `viewer`

*(Lưu ý lịch sử: Các biến thể vai trò cũ như `tenant_operator`, `tenant_manager`, `tenant_engineer`, `platform_engineer` đã được tinh giản và loại bỏ hoàn toàn khỏi codebase vào ngày 03/10/2026).*

## 6. Tenant Device Assignment Service

### Trách nhiệm

- Gán device vào tenant qua bảng mapping.
- Bỏ gán khi cần.
- Truy vấn danh sách device thuộc tenant.
- Cung cấp nền tảng cho tenant isolation ở mọi module khác.

### API trách nhiệm

Admin-side:

- `GET /api/v1/admin/tenants/{tenant_id}/devices`
- `POST /api/v1/admin/tenants/{tenant_id}/devices`
- `DELETE /api/v1/admin/tenants/{tenant_id}/devices/{device_id}`

Tenant-side:

- `GET /api/v1/client/devices`
- `GET /api/v1/client/devices/{device_uid}`
- `GET /api/v1/client/devices/{device_uid}/telemetry`

### Quy tắc nghiệp vụ

- **Admin gán device cho tenant** qua `tenant_device_mappings`.
- Một device ở MVP chỉ nên thuộc **một tenant tại một thời điểm**.
- **Tenant chỉ truy cập được device đã được gán cho tenant của mình**.
- Nếu tenant gọi detail của device không thuộc mình, backend trả `404`.
- Device onboarding self-service của tenant chỉ hợp lệ khi feature `device_management` bật.

### Quy tắc query

Mọi truy vấn tenant device phải đi theo logic:

```txt
current_user -> current_user.tenant_id -> tenant_device_mappings -> devices
```

Không cho phép frontend gửi `tenant_id` để tự scope danh sách thiết bị.

## 7. Customer Workspace APIs

### Trách nhiệm

Customer Workspace là bề mặt API cho tenant sử dụng hằng ngày:

- xem profile + plan + feature
- xem dashboard tenant
- xem device list/detail/telemetry
- upload firmware binary
- tạo OTA campaign cho thiết bị của tenant
- theo dõi OTA jobs/progress

### Nhóm API tenant-side

- `GET /api/v1/client/me`
- `GET /api/v1/client/features`
- `GET /api/v1/client/dashboard`
- `GET /api/v1/client/devices`
- `GET /api/v1/client/devices/{device_uid}`
- `GET /api/v1/client/devices/{device_uid}/telemetry`
- `POST /api/v1/client/firmware/upload`
- `GET /api/v1/client/firmware`
- `GET /api/v1/client/firmware/{id}`
- `POST /api/v1/client/ota-campaigns`
- `GET /api/v1/client/ota-campaigns`
- `GET /api/v1/client/ota-campaigns/{campaign_id}`
- `GET /api/v1/client/ota-jobs`

### Quy tắc nghiệp vụ bắt buộc

- Tenant Portal chỉ phục vụ tài nguyên thuộc tenant hiện tại.
- Trong Customer Workspace, `tenant_owner` có toàn quyền quản trị và thực hiện các thao tác mutate (upload firmware, tạo OTA campaign, gửi lệnh điều khiển), trong khi `viewer` ở chế độ chỉ đọc (read-only).
- API tenant-side không được cho phép override `tenant_id`.
- Nếu feature tương ứng bị tắt theo plan/override, API trả `403`.

## 8. Firmware Upload Service

### Trách nhiệm

- Nhận file firmware `.bin` đã compile sẵn.
- Validate size, loại file, version, target hardware.
- Compute SHA256 server-side.
- Lưu artifact vào object storage.
- Tạo metadata firmware version trong PostgreSQL.

### Input/Output chính

Input tối thiểu:

- `file`
- `version`
- `target_hardware`
- `release_notes` (optional)

Output tối thiểu:

- `firmware_id`
- `version`
- `target_hardware`
- `size_bytes`
- `checksum_sha256`
- `storage_key`
- `uploaded_by`
- `tenant_id`

### Quy tắc nghiệp vụ

- **Tenant có thể upload firmware binary** của riêng họ.
- Trong MVP, role tenant-side mặc định được phép upload là `tenant_owner`.
- Artifact nên lưu theo prefix có tenant để dễ kiểm soát:
  `tenants/{tenant_id}/firmware/{firmware_id}/{filename}`.
- Không hỗ trợ upload source code `.zip` để backend tự build trong MVP.
- File rỗng, sai extension, vượt kích thước giới hạn phải bị reject.
- `tenant_id` của firmware record lấy từ user hiện tại, không lấy từ request body.

## 9. Firmware Version Service

### Trách nhiệm

- Quản lý metadata version firmware theo tenant.
- List/history firmware của tenant.
- Tìm bản firmware hợp lệ để tạo OTA campaign.
- Quản lý trạng thái lifecycle nếu cần: `draft`, `active`, `deprecated`, `quarantined`.

### Quy tắc nghiệp vụ

- Version nên unique trong phạm vi hợp lý:
  tối thiểu theo `(tenant_id, version, target_hardware)`.
- Tenant A không được nhìn thấy firmware metadata của tenant B.
- Admin có thể xem toàn cục tất cả firmware versions để hỗ trợ vận hành.
- Download endpoint cho device có thể dùng device token/signed URL, không nhất thiết đi qua tenant auth.

## 10. OTA Campaign Service

### Trách nhiệm

- Tạo campaign rollout từ tenant portal hoặc admin console.
- Validate target device list.
- Tạo OTA jobs.
- Publish MQTT command tới thiết bị.

### API trách nhiệm

Admin-side:

- `POST /api/v1/rollouts`
- `POST /api/v1/rollouts/{id}/{pause|resume|cancel}`

Tenant-side:

- `POST /api/v1/client/ota-campaigns`
- `GET /api/v1/client/ota-campaigns`
- `GET /api/v1/client/ota-campaigns/{campaign_id}`

### Quy tắc nghiệp vụ bắt buộc

- **Tenant chỉ tạo OTA campaign cho thiết bị của tenant mình.**
- **Tenant không được tạo campaign cho device chưa được admin gán.**
- **Admin có thể tạo campaign toàn cục hoặc hỗ trợ tenant khi cần vận hành.**
- Trong MVP, role mặc định để tạo campaign tenant-side là `tenant_owner`.
- Firmware dùng cho campaign tenant-side phải thuộc cùng tenant.
- Khi campaign được chấp nhận, backend tạo OTA jobs rồi publish MQTT command `update_firmware`.

### Validation tối thiểu

- `device_uid`/`device_id` phải thuộc tenant hiện tại.
- `firmware_id` phải thuộc tenant hiện tại và target hardware phù hợp.
- Không tạo campaign nếu device đang có OTA job non-terminal khác, trừ khi policy cho phép.

## 11. OTA Progress Tracking Service

### Trách nhiệm

- Nhận progress từ device qua MQTT/API ingest.
- Đồng bộ trạng thái vào `ota_jobs`.
- Tính summary thành công/thất bại cho dashboard.
- Cho tenant xem history rollout của mình.

### State machine tối thiểu

```txt
pending -> notified -> downloading -> verifying -> flashing -> rebooting -> success
pending/notified/downloading/verifying/flashing/rebooting -> failed
rebooting -> rolled_back
any non-terminal -> cancelled
```

### Quy tắc nghiệp vụ

- Device/simulator là bên report progress; tenant portal chỉ đọc.
- Tenant chỉ xem được jobs của device thuộc tenant mình.
- Dashboard tenant phải thấy được:
  tổng số device trong campaign, success, failed, in-progress, last update time.
- Admin dashboard có thể xem cross-tenant summary.

## 12. Feature Permission / Service Plan Access

Trong MVP, service plan **không** nhằm làm billing engine. Nó chỉ có 3 vai trò:

- quota cơ bản (`max_devices`, `max_users`)
- bật/tắt feature
- hỗ trợ demo phân tầng quyền truy cập giữa tenant

### Nguồn dữ liệu

- `service_plans.features`
- `tenant_feature_overrides`
- `tenant_service.get_effective_features(...)`

### Feature điển hình

- `device_management`
- `ota_update`
- `firmware_history`
- `telemetry_view`
- `alert_management`
- `ai_anomaly_detection`
- `user_management`
- `billing_view`
- `audit_log`

### Quy tắc áp dụng

- Nếu feature bị tắt ở plan và không override bật lại, API tenant-side phải trả `403`.
- Quota `max_devices` và `max_users` được check ở service layer.
- Admin có thể chỉnh override theo tenant để phục vụ demo/triển khai học thuật.

## 13. Tenant Isolation Rules

### Rule 1 – Backend không trust tenant_id từ frontend

Đây là rule quan trọng nhất:

```txt
frontend -> JWT/session -> backend resolve current_user -> current_user.tenant_id -> DB filter
```

Không chấp nhận:

- `POST /api/v1/client/ota-campaigns` với body chứa `tenant_id`
- `GET /api/v1/client/devices?tenant_id=...`
- bất kỳ hidden field nào từ UI cố gắng ép tenant context

### Rule 2 – Resource tenant-scoped phải join qua mapping

- Devices: qua `tenant_device_mappings`
- Firmware: qua `firmware_versions.tenant_id`
- OTA campaign/job: qua `device_id` hoặc `campaign.tenant_id`
- Tenant users: qua `users.tenant_id`

### Rule 3 – Admin API và tenant API tách namespace

- Admin: `/api/v1/admin/*`
- Tenant: `/api/v1/client/*`
- Device/system endpoint: `/api/v1/devices/*`, `/api/v1/firmwares/*`, `/api/v1/ota/*` theo token phù hợp

### Rule 4 – Không để lộ existence của tenant khác

Ví dụ:

- Tenant A gọi `/api/v1/client/devices/{uid-cua-tenant-B}` -> `404 Device not found`
- Tenant A tạo campaign với firmware của tenant B -> `404 Firmware not found` hoặc `403 Forbidden`, nhưng không trả metadata của tenant B

## 14. Auth/RBAC Rules

### Ma trận quyền chuẩn cho luận văn

| Role | Phạm vi | Quyền chính |
|---|---|---|
| `admin` | Toàn nền tảng | Quản trị hệ thống: tạo tenant, gán thiết bị, cấu hình nền tảng, xem audit log |
| `tenant_owner` | Trong tenant của mình | Quản lý tài nguyên tenant: thiết bị, canvas datastreams, commands, upload firmware, tạo OTA campaign, quản lý thành viên |
| `viewer` | Trong tenant của mình | Read-only: xem dashboard, telemetry, trạng thái thiết bị, lịch sử OTA, alerts |

*(Lưu ý: Các vai trò cũ như `tenant_operator`, `tenant_manager`, `tenant_engineer` đã được gỡ bỏ hoàn toàn).*

### Quy tắc xử lý auth

- Không có token hoặc token sai -> `401 Unauthorized`
- Có token nhưng sai role/feature -> `403 Forbidden`
- Có token đúng nhưng resource không thuộc tenant hiện tại -> `404 Not Found`
- Account `is_active=false` -> `403 Forbidden`

## 15. Admin vs Tenant API Responsibility

### Admin API

Admin chịu trách nhiệm thao tác platform-wide:

- tạo tenant
- tạo tenant owner account
- gán/thu hồi device cho tenant
- cấu hình service plan / feature overrides
- quan sát OTA toàn hệ thống

### Tenant API

Tenant chịu trách nhiệm self-service trong workspace của mình:

- xem device đã được gán
- xem telemetry của device mình
- upload firmware binary
- tạo OTA campaign cho device mình
- xem OTA progress và kết quả

### Thiết bị / ingest / system API

Các endpoint cho device hoặc ingest không thuộc Admin Console hay Tenant Portal trực tiếp:

- register/heartbeat device
- download firmware cho OTA client
- report OTA progress
- MQTT subscriber / background worker

## 16. Luồng MVP chuẩn

```txt
1. Admin tạo tenant
2. Admin tạo tenant owner account
3. Admin gán devices cho tenant
4. Tenant owner login vào /client/*
5. Tenant upload firmware .bin
6. Backend tạo firmware version record scoped theo tenant
7. Tenant tạo OTA campaign cho một hoặc nhiều device đã được gán
8. Backend tạo ota_jobs + publish MQTT command
9. Device/simulator nhận lệnh, tải firmware, report progress
10. Tenant dashboard và OTA page hiển thị success/failed/progress
```

Đây là flow chính để demo bảo vệ. Các flow khác chỉ là phụ trợ.

## 17. Files AI/dev nên ưu tiên chạm khi triển khai Phase 12

```txt
backend/app/core/tenant.py
backend/app/modules/auth/model.py
backend/app/modules/tenants/model.py
backend/app/modules/tenants/schema.py
backend/app/modules/tenants/repository.py
backend/app/modules/tenants/service.py
backend/app/modules/tenants/router_admin.py
backend/app/modules/tenants/router_client.py
backend/app/modules/firmware/model.py
backend/app/modules/firmware/router.py
backend/app/modules/ota/model.py
backend/app/modules/ota/router.py
backend/app/modules/telemetry/router.py
backend/app/services/minio_client.py
backend/app/services/mqtt_publisher.py
```

## 18. Acceptance criteria của đặc tả backend Phase 12

- Admin tạo được tenant và tenant owner account.
- Admin gán được device cho tenant.
- Tenant chỉ nhìn thấy device đã được gán.
- Tenant upload được firmware binary `.bin`.
- Tenant tạo được OTA campaign chỉ cho device của mình.
- Device nhận lệnh OTA và report progress.
- Backend không bao giờ trust `tenant_id` từ frontend.
- `tenant_id` luôn được derive từ JWT/session.
- Feature gating hoạt động nếu bật service plan/override.
- Namespace admin và tenant được tách rõ trong API.
