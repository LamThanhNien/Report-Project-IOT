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

# AIFOM – Bộ tài liệu đầu vào cho AI Vibe Code

> Current repository note: this split document set has been imported from the
> old `Document` folder. Use `docs/thesis/README.md` and
> `03_REPO_AND_CODE_STANDARDS.md` for the current path mapping before
> implementing code.

**Tên đề tài (rút gọn để triển khai)**:
**AIFOM – Hệ thống quản lý thiết bị IoT biên với cập nhật firmware từ xa và tích hợp mô hình TinyML**

Tên đầy đủ cho bìa luận văn: *"Hệ thống quản lý tập trung và cập nhật từ xa firmware/mô hình AI cho mạng lưới thiết bị IoT biên dựa trên nền tảng MLOps"*. Trục chính của đề tài là **IoT + OTA**; TinyML/MLOps là **điểm nhấn học thuật**, không phải trục chính.

Mục tiêu trong 24 tháng: xây dựng hệ thống end-to-end quản lý thiết bị ESP32, OTA firmware an toàn, demo cập nhật model TinyML, giám sát fleet ở mức cơ bản, đủ để bảo vệ đồ án.

Scope chính được chia 4 tầng (chi tiết tại `../scope.md`):

| Tầng | Vai trò | Cắt được không |
|---|---|---|
| **M0 – MVP** | Bắt buộc bảo vệ | Không |
| **M1 – Main** | Chiều sâu kỹ thuật | Cắt 1–2 mục nếu trễ |
| **M2 – Optional** | Điểm nhấn nếu còn thời gian | Cắt toàn bộ khi trễ |
| **OUT** | Không làm | – |

Nguyên tắc thiết kế quan trọng:

1. **Khả thi trước khi hoành tráng**. M0 phải chạy được end-to-end trước khi đụng M1.
2. **OTA firmware là xương sống**, không phải MLOps.
3. **TinyML/MLOps là điểm nhấn**, không được làm hỏng core IoT.
4. **K3s, drift detection, delta update, closed-loop retrain, OC-SVM on-device, mTLS, secure boot** đều là **NICE (M2)** — không bao giờ làm trước M0+M1.
5. Mọi module phải có test, tài liệu, logging và tiêu chí nghiệm thu.
6. Không đưa secret/key thật cho AI coding agent.
7. Không để AI sinh một khối code quá lớn không kiểm soát được.
8. Mọi quyết định kiến trúc lớn phải có ADR.
9. Khi trễ → cắt scope theo `scope.md` §11.2, **không** kéo dài deadline.


## Cách dùng bộ tài liệu này với AI Vibe Code / Cursor / Copilot / Claude Code

### Thứ tự đọc bắt buộc cho AI coding agent

Mỗi sprint, đưa lần lượt theo thứ tự sau (không bỏ qua):

1. `00_MASTER_CONTEXT.md` – vai trò, ràng buộc, format phản hồi.
2. `19_REQUIREMENTS_AND_TRACEABILITY.md` – ID yêu cầu MUST/SHOULD/NICE đang làm.
3. `01_PROJECT_CHARTER.md` – mục tiêu/KPI/scope.
4. `02_ARCHITECTURE.md` – kiến trúc + sequence diagrams.
5. `04_DATABASE_SCHEMA.md` – DDL.
6. `05_API_CONTRACTS.md` – REST/MQTT/WebSocket contract + error codes.
8. `10_DEVOPS_DEPLOYMENT.md` – port/env/compose.
9. `11_SECURITY_OTA.md` – nếu chạm OTA/auth.
10. `14_TESTING_STRATEGY.md` + `18_DEFINITION_OF_DONE.md` – tiêu chí Done.
11. `16_PROMPT_PACK.md` – prompt mẫu cho module đang làm.

Quy trình:

1. Đưa context theo thứ tự trên.
2. Chỉ rõ FR/NFR ID đang implement (ví dụ "Sprint này làm FR-OTA-001..005, NFR-SEC-002").
3. Yêu cầu AI sinh từng phần nhỏ: model, repository, service, router, test, Dockerfile. Không yêu cầu sinh toàn bộ project trong một lần.
4. Sau mỗi lần AI sinh code, bắt buộc chạy test/lint/build.
5. Mọi thay đổi vượt khỏi scope phải ghi vào `docs/adr/`.

## Cấu trúc bộ tài liệu

| File | Mục đích |
|---|---|
| `00_MASTER_CONTEXT.md` | Prompt tổng cho AI coding agent, vai trò, ràng buộc, chuẩn làm việc |
| `01_PROJECT_CHARTER.md` | Mục tiêu, phạm vi, KPI, lộ trình 24 tháng |
| `02_ARCHITECTURE.md` | Kiến trúc tổng thể, C4, luồng OTA/model/telemetry |
| `03_REPO_AND_CODE_STANDARDS.md` | Cấu trúc repo, coding convention, branch, commit, review |
| `04_DATABASE_SCHEMA.md` | Domain model, bảng DB, DDL PostgreSQL/TimescaleDB |
| `05_API_CONTRACTS.md` | API contract REST/WebSocket/MQTT topic |
| `06_BACKEND_SERVICES_SPEC.md` | Chi tiết từng backend service FastAPI |
| `07_FIRMWARE_ESP32_SPEC.md` | Firmware ESP32: Wi-Fi, MQTT, OTA, model update, rollback |
| `09_ADMIN_UI_SPEC.md` | UI quản trị React/Vite, màn hình, component, state |
| `10_DEVOPS_DEPLOYMENT.md` | Docker Compose, K3s, Helm/Kustomize, môi trường triển khai |
| `11_SECURITY_OTA.md` | mTLS, signing, secure boot, threat model, rollback policy |
| `13_CICD_PIPELINES.md` | GitHub Actions cho firmware, backend, UI, model |
| `14_TESTING_STRATEGY.md` | Unit, integration, E2E, simulator, stress, chaos |
| `15_RUNBOOKS.md` | Lệnh vận hành, xử lý lỗi, backup/restore, demo script |
| `16_PROMPT_PACK.md` | Prompt mẫu đưa trực tiếp vào AI để sinh code theo module |
| `17_SPRINT_BACKLOG.md` | Backlog 48 sprint chia 4 giai đoạn × 6 tháng, gắn với M0/M1/M2 |
| `18_DEFINITION_OF_DONE.md` | Checklist Done cho code, firmware, model, DevOps, luận văn |
| `19_REQUIREMENTS_AND_TRACEABILITY.md` | FR/NFR/TEST ID, priority MUST/SHOULD/NICE, traceability matrix |
| `DOCS_REVIEW_REPORT.md` | Báo cáo review/sửa tài liệu (kết quả pass cuối) |

## Thứ tự ưu tiên triển khai (đồng bộ scope.md §12)

| Giai đoạn | Tháng | Trọng tâm | Scope tier |
|---|---:|---|---|
| GĐ1 | 1–6 | Core IoT + OTA + UI cơ bản + simulator + Docker Compose + CI tối thiểu | M0 |
| GĐ2 | 7–12 | Auth, signing Ed25519, canary rollout, Prometheus+Grafana, fault simulator | M1 (sec/roll/obs/sim) |
| GĐ3 | 13–18 | TinyML inference + model update từ xa + health anomaly | M1 (ai/model/health) |
| GĐ4 | 19–24 | Viết luận văn, demo, tối đa **1** mục M2 | M2 + thesis |

## Quy tắc cắt scope khi trễ (rút gọn, đầy đủ tại `scope.md` §11.2)

- **Mức 1 (trễ ≤ 1 tháng)**: cắt delta OTA, drift, closed-loop retrain, mTLS, secure boot, K3s.
- **Mức 2 (trễ 1–2 tháng)**: cắt toàn M2 + health-scorer + alerting.
- **Mức 3 (trễ 2–3 tháng)**: cắt canary, int8 quantization, fault profile simulator.
- **Mức 4 (≥ 3 tháng)**: hoãn bảo vệ 1 kỳ.

**Luôn giữ**: toàn bộ M0 + signature firmware + 1 bài TinyML float32 + Admin UI tối thiểu + simulator ≥ 20 device.
