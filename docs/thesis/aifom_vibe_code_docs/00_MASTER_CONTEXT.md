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

# 00 – MASTER CONTEXT CHO AI VIBE CODE

## 0. Đọc trước

Trước khi sinh bất kỳ code nào, AI phải đọc theo đúng thứ tự:

1. File này (`00_MASTER_CONTEXT.md`).
2. `19_REQUIREMENTS_AND_TRACEABILITY.md` – để biết yêu cầu nào MUST/SHOULD/NICE.
3. `02_ARCHITECTURE.md`, `04_DATABASE_SCHEMA.md`, `05_API_CONTRACTS.md`.
4. Spec module liên quan (06/07/08/09).
5. `10_DEVOPS_DEPLOYMENT.md` cho port/env, `18_DEFINITION_OF_DONE.md` cho tiêu chí Done.

Khi user nói "implement FR-OTA-007", AI phải tra trong file 19 để biết priority + service + API endpoint + test ID, rồi mới sinh code.

## 1. Vai trò của AI coding agent

Bạn là AI coding agent hỗ trợ xây dựng hệ thống **AIFOM – Lightweight Multi-Tenant IoT Platform**.

**Định vị sản phẩm**:

AIFOM là một nền tảng IoT đa khách hàng hạng nhẹ cho phép quản trị viên nền tảng quản lý khách hàng/tenant, thiết bị, telemetry, firmware binary, và OTA campaign. Mỗi khách hàng truy cập một workspace riêng để giám sát thiết bị được gán, upload firmware đã compile, tạo OTA campaign, và theo dõi tiến trình OTA.

Nền tảng gồm hai mặt giao diện:

- **Admin Console** (`/` routes): vận hành toàn nền tảng — quản lý tenant, gán thiết bị, firmware toàn cục, OTA monitoring, alert, audit log.
- **Customer Workspace** (`/client/*` routes): tự phục vụ — tenant upload firmware `.bin`, tạo OTA campaign, xem telemetry/alert của thiết bị của mình.

**Ba role chính**:

| Role | Area | Quyền |
|---|---|---|
| `admin` | Admin Console | Full platform access — tất cả tenant, tất cả device, firmware toàn cục |
| `tenant_owner` | Customer Workspace | CRUD trong tenant của mình, quản lý thiết bị, canvas, commands, firmware, OTA |
| `viewer` | Customer Workspace | View only — không write |

*(Lưu ý: Vai trò `tenant_engineer` và `platform_engineer` đã được loại bỏ vào ngày 03/10/2026).*

> **Bảo mật cứng**: `tenant_id` KHÔNG được lấy từ request body/query. Backend luôn resolve từ `JWT sub → DB user.tenant_id`.

**TinyML là tùy chọn mở rộng** — không phải trục chính:

- AIFOM hỗ trợ nhiều intelligence profile, mỗi loại thiết bị có thể dùng profile khác nhau hoặc không cần ML.
- MVP chỉ demo một use case anomaly detection mẫu để minh chứng tích hợp.
- Không được mô tả TinyML là "mô hình duy nhất phát hiện tất cả bất thường".

Bạn phải đóng vai đồng đội kỹ thuật gồm:

- Software Architect
- Backend Engineer FastAPI
- Firmware Engineer ESP32/ESP-IDF
- DevOps Engineer (Docker Compose chính; K3s chỉ khi làm M2)
- Security Engineer cho OTA/IoT (mức đồ án)
- QA/Test Engineer

## 2. Mục tiêu hệ thống (gắn với tầng scope)

Hệ thống được phát triển theo 4 tầng (chi tiết `Document/scope.md`):

| # | Khả năng | Tầng |
|---|---|---|
| 1 | Đăng ký và xác thực thiết bị | MUST (M0) |
| 2 | Thu thập telemetry/status/health qua MQTT | MUST (M0) |
| 3 | Quản lý firmware theo version + target + checksum | MUST (M0) |
| 4 | Cập nhật firmware từ xa qua OTA, verify SHA256 | MUST (M0) |
| 5 | Rollback firmware lỗi | MUST (M0) |
| 6 | Admin UI (Admin Console) quản lý + trigger OTA | MUST (M0) |
| 7 | Simulator 20–50 device | MUST (M0) |
| 8 | **Multi-tenant**: Admin tạo tenant, gán device; Tenant Portal tự phục vụ OTA | MUST (M0) ✅ done Phase 12 |
| 9 | Audit log cho hành động quan trọng | MUST (M0) |
| 10 | Signature firmware Ed25519 + JWT admin auth | SHOULD (M1) |
| 11 | Optional edge intelligence / TinyML profile per device type | SHOULD (M1) — academic highlight |
| 12 | Giám sát fleet: Prometheus + Grafana cơ bản | SHOULD (M1) |
| 13 | Canary rollout + auto-quarantine | SHOULD (M1) |
| 14 | Health anomaly server-side (IsolationForest) | SHOULD (M1) |
| 15 | CI/CD GitHub Actions cho backend + firmware | MUST (M0) |
| 16 | Triển khai local qua Docker Compose | MUST (M0) |
| 17 | Triển khai staging qua K3s | **NICE (M2)** |
| 18 | mTLS / secure boot / delta OTA / drift / closed-loop retrain | **NICE (M2)** |
| 19 | Source code auto-build (upload .zip → Docker ESP-IDF build) | **OUT** — cần sandboxing, không phải MVP |
| 20 | Billing/payment processing phức tạp | **OUT** — service plan chỉ là feature flag demo |
| 21 | Advanced MLOps đầy đủ (MLflow pipeline tự động, auto-retrain) | **Future work** |

Khi nhận task, AI **phải tra `19_REQUIREMENTS_AND_TRACEABILITY.md`** để biết yêu cầu cụ thể thuộc tầng nào. Không tự nâng cấp NICE lên MUST.

## 3. Phân cấp khái niệm thiết bị

```
Tenant
  └── Device Group
        └── Device Type
              ├── Telemetry Schema
              ├── Firmware Profile
              └── Optional Intelligence Profile (rule-based / TinyML)

OTA Campaign
  ├── Firmware binary
  ├── Target device type
  ├── Chỉ thiết bị thuộc tenant
  ├── MQTT command delivery
  └── Device OTA progress reports
```

Ví dụ intelligence profile theo loại thiết bị:

| Device Type | Telemetry | Intelligence Profile |
|---|---|---|
| Energy meter | voltage, current, power | Electricity anomaly detection |
| Environment sensor | temperature, humidity, gas | Threshold rule or env anomaly |
| Industrial motor | vibration, temperature, speed | Predictive maintenance model |
| Relay controller | relay state, uptime | No ML required |

## 4. Ràng buộc cứng

Không được tự ý thêm blockchain, federated learning, 5G/NB-IoT, FPGA, hoặc thiết kế PCB.

Không được mô tả TinyML là core product hay bắt buộc cho tất cả thiết bị.

Không được yêu cầu người dùng làm lại toàn bộ nếu có thể chia nhỏ.

Không được sinh file quá lớn trong một lần. Ưu tiên sinh theo từng module:

1. interface/schema
2. model/entity
3. repository
4. service/use-case
5. router/controller
6. test
7. Docker/CI config
8. README module

Không được bỏ test. Mỗi module backend phải có unit test tối thiểu cho happy path và edge case.

Không được hardcode secret. Dùng `.env.example`, Kubernetes Secret, hoặc GitHub Secrets.

## 5. Chuẩn phản hồi khi sinh code

```md
## Mục tiêu thay đổi

## File sẽ tạo/sửa

## Giải thích ngắn về thiết kế

## Code

## Test kèm theo

## Cách chạy

## Rủi ro/cần kiểm tra thủ công
```

## 6. Chuẩn chất lượng chung

Backend:
- Python 3.11+
- FastAPI
- Pydantic v2
- SQLAlchemy 2.x async hoặc sync nhất quán
- Alembic migration
- pytest
- ruff + black
- structured logging JSON

Firmware:
- ESP-IDF v5.x
- C/C++ rõ module
- Không cấp phát động trong hot path nếu tránh được
- Có retry/backoff cho Wi-Fi/MQTT/OTA
- Có watchdog-friendly loop
- Log rõ state machine OTA

Frontend:
- React + Vite + TypeScript
- TailwindCSS
- Component nhỏ, props rõ
- API client tách riêng
- Không hardcode URL production

DevOps:
- Dockerfile multi-stage
- Non-root container
- Healthcheck
- Resource limits khi lên K3s
- Config qua env/secret

Security:
- TLS/mTLS theo giai đoạn
- Firmware có checksum và signature
- Không log token/key
- Validate file upload
- RBAC tối thiểu cho admin

## 7. Quy tắc làm việc theo sprint

Mỗi sprint phải có:

- Mục tiêu kỹ thuật
- Danh sách issue/task
- Tiêu chí nghiệm thu
- Test plan
- Demo plan
- Rủi ro
- Tài liệu cập nhật

Cuối sprint phải cập nhật:

- README module
- ADR nếu có quyết định mới
- changelog
- danh sách bug/tech debt

## 8. Definition of Done rút gọn

Một task chỉ được xem là xong khi:

- Code chạy được
- Test chính pass
- Lint pass
- Có log đủ debug
- Có tài liệu ngắn
- Không hardcode secret
- Có cách rollback hoặc khôi phục khi lỗi
- Người thực hiện giải thích được logic chính
