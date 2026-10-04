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

# 01 – Project Charter

## 1. Tên dự án

**Tên chính (rút gọn cho triển khai)**:
**AIFOM – Hệ thống quản lý thiết bị IoT biên với cập nhật firmware từ xa và tích hợp mô hình TinyML**

Charter này dùng tên rút gọn để bám sát phạm vi thực tế. Trục chính là **IoT + OTA + Multi-tenant**; TinyML/edge intelligence là **điểm nhấn học thuật tùy chọn**, không phải trục chính.

**Định vị sản phẩm**: AIFOM là một nền tảng IoT đa khách hàng hạng nhẹ, tập trung vào quản lý thiết bị biên, cập nhật firmware OTA từ xa, và tách biệt workspace khách hàng. Nền tảng gồm hai mặt:

- **Admin Console**: vận hành toàn nền tảng — quản lý tenant, thiết bị, firmware toàn cục, OTA toàn cục, alert, audit log.
- **Customer Workspace**: tự phục vụ — upload firmware đã compile, tạo OTA campaign, theo dõi thiết bị của mình.

TinyML/rule-based intelligence là khả năng **tùy chọn và mở rộng được** — mỗi loại thiết bị có thể gắn intelligence profile khác nhau, hoặc không cần ML.

## 2. Vấn đề cần giải quyết

Trong hệ thống IoT có nhiều thiết bị biên và nhiều khách hàng:

- Không biết thiết bị nào đang online/offline.
- Không biết thiết bị đang chạy firmware version nào.
- Cập nhật firmware thủ công dễ lỗi, không có rollback.
- Nhiều dự án/khách hàng dùng chung hạ tầng nhưng cần tách biệt hoàn toàn dữ liệu.

Đề tài xây dựng một **hệ thống tham khảo** (reference system) giải quyết các vấn đề trên ở quy mô đồ án tốt nghiệp cá nhân.

## 3. Người dùng mục tiêu

| Role | Area | Nhu cầu |
|---|---|---|
| **Platform Admin** | Admin Console | Quản lý toàn bộ nền tảng: tạo tenant, gán device, quản lý firmware toàn cục, giám sát OTA/alert của tất cả tenant, xem audit log |
| **Tenant Owner** | Customer Workspace | Quản lý workspace riêng: upload firmware `.bin`, tạo OTA campaign, xem telemetry/alert của thiết bị mình, quản lý team |
| **Viewer** | Customer Workspace | Xem dashboard, telemetry, trạng thái thiết bị, OTA history, alert — không thực hiện write action |

> Developer firmware và ML engineer là vai trò học thuật trong đề tài — không phải user type của platform trong MVP.

## 4. Phạm vi tổng quát (chi tiết tại `docs/scope.md`)

| Tầng | Vai trò | Cắt được không |
|---|---|---|
| **M0 – MVP** | Bắt buộc để bảo vệ | Không |
| **M1 – Main** | Tạo chiều sâu kỹ thuật | Cắt 1–2 mục nếu trễ |
| **M2 – Optional** | Điểm nhấn nếu còn thời gian | Cắt toàn bộ nếu trễ |
| **OUT** | Không làm | – |

### Có làm (M0 — MVP)

- Multi-tenant cơ bản: Admin tạo tenant/owner, gán device, Customer Workspace tự phục vụ OTA.
- Device registry + OTA server + telemetry-ingest.
- Firmware ESP32: Wi-Fi, MQTT, OTA + verify SHA256 + rollback.
- Admin UI: dashboard, list device, upload firmware, trigger OTA, quản lý tenant.
- Customer Workspace: list device, upload firmware, tạo OTA campaign, theo dõi tiến trình.
- Simulator 20–50 device.
- Docker Compose local + CI/CD GitHub Actions.
- Audit log cho hành động quan trọng.

### Nên làm (M1 — Academic highlight)

- Optional edge intelligence / TinyML profile per device type (một use case mẫu).
- Auth admin (JWT) + signature firmware Ed25519.
- Canary rollout + auto-quarantine.
- Prometheus + Grafana với 2 dashboard chính.
- Health anomaly server-side (IsolationForest đơn giản).

### Tùy chọn (M2)

K3s, mTLS Mosquitto, MLflow full, delta OTA, drift detection, Loki/Tempo, stress 200+ devices, secure boot.

### Ngoài phạm vi (OUT)

- Source code upload + auto build firmware (cần sandboxing phức tạp).
- Billing/payment phức tạp (service plan chỉ là feature flag demo).
- Blockchain, federated learning, 5G/NB-IoT, FPGA, PCB, mobile native, MLOps đầy đủ.

## 5. KPI thực tế

| Nhóm | KPI | Mức bắt buộc |
|---|---|---|
| Fleet | Simulator chạy đồng thời | ≥ 20 (MUST) / ≥ 50 (SHOULD) |
| Hardware thật | ESP32 thật | ≥ 1 device (MUST) |
| OTA | Firmware ~500KB qua Wi-Fi LAN | < 90s end-to-end (MUST) |
| OTA reliability | Tỷ lệ thành công simulator 50 device | ≥ 90% (SHOULD) |
| Rollback | Thời gian rollback sau crash | < 5 phút (MUST) |
| TinyML (optional) | Inference latency ESP32 | < 200ms/sample (SHOULD) |
| TinyML (optional) | Accuracy int8 trên test set | ≥ 85% (SHOULD) |
| Backend | Test coverage final | ≥ 60% (MUST) / ≥ 75% (SHOULD) |
| Tenant flow | Demo end-to-end | Admin → Tenant login → Upload firmware → OTA → Progress (MUST) |

## 6. Kiến trúc logic theo lớp

```
Portal Layer:   Admin Console (React/Vite, /)
                Customer Workspace (React/Vite, /client/*)

Device Layer:   ESP32, sensor, firmware, OTA client
                Optional: edge intelligence (rule-based hoặc TinyML)

Messaging:      MQTT broker — topic telemetry/status/cmd/health/progress

Backend:        FastAPI (device-registry, ota-server, telemetry-ingest, auth, tenant)
                API phân nhóm: /api/v1/admin/* (Platform Admin)
                               /api/v1/client/* (Tenant Owner/Viewer)

Storage:        PostgreSQL (metadata, users, tenants, OTA jobs)
                TimescaleDB (telemetry time-series)
                MinIO (firmware binary artifacts)

Ops (M1):       Docker Compose (M0/M1); K3s (M2); Prometheus/Grafana (M1)
```

## 7. Roadmap 24 tháng

| Giai đoạn | Tháng | Mục tiêu chính | Tương ứng scope |
|---|---:|---|---|
| **GĐ1** | 1–6 | MVP chạy được end-to-end | Hoàn thành 100% M0 |
| **GĐ2** | 7–12 | OTA an toàn + UI + observability cơ bản | M1-SEC, M1-ROLL, M1-OBS, M1-SIM |
| **GĐ3** | 13–18 | Optional edge intelligence + health anomaly | M1-ML, M1-MODEL, M1-HEALTH |
| **GĐ4** | 19–24 | Tối ưu, viết luận văn, demo, bảo vệ | Tối đa 1 mục M2; viết luận văn |

Chi tiết deliverable từng tháng nằm ở `17_SPRINT_BACKLOG.md`.

## 8. Quy tắc cắt scope khi trễ

**Mức 1 (trễ ≤ 1 tháng)**: cắt một phần M2 (delta, drift, mTLS, secure boot).
**Mức 2 (trễ 1–2 tháng)**: cắt toàn M2; cắt M1-HEALTH; cắt M1-OBS alerting.
**Mức 3 (trễ 2–3 tháng)**: cắt M1-ROLL canary; cắt int8 quantization; cắt fault profile simulator.
**Mức 4 (trễ ≥ 3 tháng)**: hoãn bảo vệ một kỳ.

**Luôn giữ**: toàn bộ M0 + M1-SEC cơ bản + Admin UI tối thiểu + simulator ≥ 20 device.
TinyML là SHOULD — có thể cắt nếu trễ nặng, nhưng nên demo ít nhất float32 inference.

## 9. Ràng buộc cứng

- Không thêm: blockchain, federated learning, 5G/NB-IoT, FPGA, PCB, mobile native.
- Không mô tả TinyML là core product hay bắt buộc cho tất cả thiết bị.
- Không đổi stack chính trừ khi có ADR.
- Không hardcode secret trong git.
- Không sinh code không có test.
- Không kéo dài deadline để cố làm M2.

## 10. Trách nhiệm cá nhân khi dùng AI coding agent

- AI hỗ trợ sinh code, **không thay thế hiểu biết kỹ thuật**.
- Mọi code do AI sinh phải được review, test và giải thích được trong phản biện.
- Mọi quyết định kiến trúc lớn phải có ADR do tác giả viết.
- Luận văn phải ghi rõ phần nào AI hỗ trợ, phần nào tác giả tự làm.
