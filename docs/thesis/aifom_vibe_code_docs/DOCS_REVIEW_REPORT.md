> [!NOTE]
> **BÁO CÁO KIỂM THỬ / ĐỐI SOÁT LỊCH SỬ (HISTORICAL AUDIT & VERIFICATION REPORT)**
>
> Báo cáo này ghi nhận kết quả rà soát tại thời điểm phát triển trong quá khứ (tháng 05/2026). Các tham chiếu đến TinyML, bộ simulator, các vai trò kỹ sư (`tenant_engineer`, `platform_engineer`) phản ánh hiện trạng của codebase tại thời điểm lập báo cáo và mang tính chất lưu trữ lịch sử phát triển. Để đối chiếu hiện trạng mới nhất, tham khảo [`docs/scope.md`](../../scope.md) và [`docs/reports/engineer-removal-2026-10-03.md`](../../reports/engineer-removal-2026-10-03.md).

# DOCS REVIEW REPORT – AIFOM

**Ngày review**: 2026-05-18
**Reviewer**: AI Senior Software Architect + DevOps + IoT + MLOps + Tech Writer
**Phạm vi**: toàn bộ `aifom_vibe_code_docs/` (19 file gốc → 20 file sau review).

## 1. Tóm tắt kết quả

Bộ tài liệu gốc đã có **cấu trúc tốt** và phủ hầu hết mặt cần thiết (architecture, schema, API, firmware, ML, DevOps, security, observability, CI/CD, testing, runbook, prompt pack). Tuy nhiên vẫn còn các **gap quan trọng** cản trở việc dùng trực tiếp làm input cho AI vibe coding agent:

- Thiếu hệ thống **requirement ID** (FR/NFR/TEST) và phân loại MUST/SHOULD/NICE → AI không biết cắt gì khi trễ.
- Một số **API endpoint quan trọng bị thiếu** (model download, promote/quarantine firmware, pause rollout).
- **Inconsistency** về port, path, tên component giữa các file.
- Thiếu **sequence diagram** cho device registration, model update full flow, anomaly scoring, CI/CD firmware release.
- Thiếu **error code convention** tập trung.
- Thiếu **demo failure recovery runbook**.

Tất cả các điểm trên đã được sửa trong pass review này.

## 2. File đã sửa

| File | Loại sửa |
|---|---|
| `00_MASTER_CONTEXT.md` | Thêm section "Đọc trước" và thứ tự đọc |
| `02_ARCHITECTURE.md` | Thêm bảng port, fix path `/firmwares/latest`, thêm 3 sequence diagrams mới (device registration, anomaly scoring, CI/CD firmware release) |
| `03_REPO_AND_CODE_STANDARDS.md` | Đồng bộ tên component firmware (mqtt_manager thay cho mqtt_client_wrapper, thêm command_handler, app_state, health_monitor) |
| `04_DATABASE_SCHEMA.md` | Thêm enum `model_deployment_status`, `alert_severity`, `alert_status`. Bổ sung bảng `alerts`, mở rộng `model_deployments` (previous_model_version, progress_pct, error_code, rolled_back_at). Ghi chú denormalized cache. |
| `05_API_CONTRACTS.md` | Thêm bảng base URL per service. Thêm error code convention tập trung. Thêm endpoint `GET /models/{id}/download`, `POST /models/{id}/deployments`, `POST /firmwares/{id}/promote`, `/quarantine`, `/rollouts/{id}/{pause,resume,cancel}`. Thêm MQTT payload cho `update_model`, `status`, `cmd_ack`. Thêm bảng topic + QoS + LWT. Thêm payload schema cho WebSocket event. |
| `07_FIRMWARE_ESP32_SPEC.md` | Thêm chi tiết "Model update flow" 11 bước, thêm bảng model update error codes. |
| `10_DEVOPS_DEPLOYMENT.md` | Thêm bảng port allocation đầy đủ (single source of truth). Mở rộng `.env.example` với 25+ biến. Compose mở rộng có đủ 6 backend service + redis + mlflow + 4 service observability + healthcheck. Sửa Ingress paths. Đổi smoke test sang đúng port. |
| `14_TESTING_STRATEGY.md` | Đổi E2E-NN → TEST-E2E-NN. Thêm TEST-E2E-07 (rollout auto-quarantine). Link tới file 19. |
| `15_RUNBOOKS.md` | Thêm section 13 "Demo failure recovery runbook" với 9 sub-runbook + pre-demo checklist 30 phút. |
| `README.md` | Cập nhật thứ tự đọc + danh sách file. |
| **NEW** `19_REQUIREMENTS_AND_TRACEABILITY.md` | Tạo mới. ~85 ID FR/NFR/TEST có priority. Mapping FR ↔ service ↔ API ↔ test. Scope cut order. Acceptance kết thúc đồ án. |
| **NEW** `DOCS_REVIEW_REPORT.md` | Báo cáo này. |

## 3. Vấn đề/yếu điểm lớn đã phát hiện

### 3.1 Inconsistency

| Vấn đề | Ở đâu | Sửa thế nào |
|---|---|---|
| Path firmware latest khác nhau | architecture sequence vs API contract | Chuẩn hóa về `GET /api/v1/firmwares/latest?...` |
| Tên component MQTT khác nhau | repo standards = `mqtt_client_wrapper` vs firmware spec = `mqtt_manager` | Chuẩn hóa `mqtt_manager` |
| Port không rõ | nhiều file khác nhau nhắc port khác nhau, runbook curl `localhost:8000` và `8001` lung tung | Thêm bảng port duy nhất ở `10_DEVOPS` và `02_ARCH` |
| Base URL chung mơ hồ | `05_API` ghi `localhost:8000/api/v1` nhưng có 6 service | Thêm bảng base URL per service |

### 3.2 Thiếu nội dung

- Không có hệ thống requirement ID (FR-…/NFR-…/TEST-…) → khi AI sinh code không thể trace yêu cầu. **Đã thêm 85 ID trong file 19**.
- Không phân loại MUST/SHOULD/NICE → khi trễ tiến độ không biết cắt gì. **Đã phân loại trong file 19**.
- Không có endpoint download model artifact → model update flow firmware không khớp API. **Đã thêm `GET /models/{id}/download`**.
- Không có MQTT payload cho `update_model` command → firmware spec không biết parse cái gì. **Đã thêm**.
- Không có payload schema cho WebSocket events → UI dev đoán. **Đã thêm bảng đầy đủ**.
- Không có cmd ack channel → device-server không close loop được command. **Đã thêm `dev/{uid}/cmd/ack`**.
- Không có `alerts` table trong DB schema, dù 12_OBSERVABILITY có nhắc alert. **Đã thêm**.
- Không có rollback support cho model deployment. **Đã thêm `previous_model_version`, `rolled_back_at`**.
- Không có error code table tập trung → mỗi service tự định nghĩa khác nhau. **Đã thêm trong `05_API`**.
- Không có demo failure runbook → demo bảo vệ rủi ro cao. **Đã thêm 9 sub-runbook + checklist**.

### 3.3 Mơ hồ về kiến trúc

- **Realtime gateway lấy event từ đâu?** Doc nói "in-process connection manager" nhưng telemetry-ingest cần forward event. → Đã chỉ rõ dùng Redis pub/sub channel `aifom.events`.
- **Heartbeat HTTP vs MQTT health**: API có `POST /heartbeat` nhưng device cũng publish `dev/{uid}/health`. → Đã ghi rõ: health qua MQTT mỗi 60s; heartbeat HTTP optional cho health check ngoài MQTT.
- **OTA progress HTTP vs MQTT**: cả hai đều có. → Đã ghi rõ MQTT là chính, HTTP là backup phase rebooting.
- **Bootstrap token vs device token**: chưa rõ flow đăng ký lần đầu. → Đã giải thích trong device registration sequence.

## 4. Phần vẫn còn rủi ro / cần user tự quyết

Các điểm sau **chưa quyết được** vì cần preference của user:

1. **Có dùng Redis cho event bus không, hay chỉ in-process?**
   - Hiện tại docs đề xuất Redis vì K3s sẽ multi-replica. Nhưng nếu Sprint 1–12 chỉ chạy 1 replica có thể bỏ qua. → Quyết định: giữ Redis ngay từ đầu vì compose đã có sẵn, code path đồng nhất.
   - Cần user xác nhận: có đồng ý thêm Redis không? Tôi đã thêm vào compose. Nếu muốn cắt → xóa khỏi `10_DEVOPS` và đổi realtime-gateway thành in-process.

2. **Bootstrap device token**: hiện docs đề xuất nhúng compile-time trong factory firmware. An toàn hơn là cấp token từ một QR/serial manual. → Cần user chọn ở Sprint 5 trước khi viết firmware.

3. **MQTT auth**: docs nói "Giai đoạn 1 dùng username/password, Giai đoạn 2 mTLS". Chưa rõ chuyển đổi vào Sprint nào. Đề xuất Sprint 27 (đã có trong backlog).

4. **Số sprint thực tế**: charter nói 24 tháng, backlog có 48 sprint (2 tuần/sprint). Nếu thực tế chỉ làm 1 tuần/sprint cá nhân → cần cắt scope mạnh hơn. → User tự xem lại `17_SPRINT_BACKLOG.md`.

5. **Hardware thật**: docs giả định có ít nhất 1 ESP32 thật. Nếu không có → cần phụ thuộc 100% simulator, demo sẽ kém thuyết phục. → User cần xác nhận đã có hardware.

6. **MLflow phiên bản**: docs để v2.13.0 trong compose, mặc định ok nhưng cần test kết nối với S3-compatible MinIO.

7. **Sprint 22 health-scorer hay sớm hơn**: vì health-scorer phụ thuộc telemetry-ingest ổn định + dataset health, sprint 22 hợp lý. Nếu user muốn demo anomaly sớm, có thể đẩy lên sprint 12 với mock IsolationForest.

8. **Coverage 75%**: là target cuối, không phải sprint 1. AI có thể tạm bỏ qua nếu sprint mới bắt đầu, nhưng phải đạt trước Sprint 30.

## 5. Checklist bắt đầu Sprint 1 (gợi ý)

Đã cập nhật. Trước khi yêu cầu AI sinh code Sprint 1, hoàn thành các bước sau:

### 5.1 Chuẩn bị môi trường

- [ ] Cài Docker Desktop / Docker Engine + Compose v2.
- [ ] Cài Python 3.11 (qua pyenv hoặc miniconda).
- [ ] Cài Node.js 20 LTS + pnpm/npm.
- [ ] Cài ESP-IDF v5.2 (export `IDF_PATH`).
- [ ] Mua/lấy ESP32 DevKit V1 (tối thiểu 1 cái) + MPU6050 + DHT22.
- [ ] Tạo GitHub repo private, push README.md gốc.

### 5.2 Bootstrap repo (Sprint 1 prompt đầu tiên)

Đưa cho AI vibe coding agent:

1. `00_MASTER_CONTEXT.md`
2. `03_REPO_AND_CODE_STANDARDS.md`
3. `10_DEVOPS_DEPLOYMENT.md`
4. `16_PROMPT_PACK.md` §2 ("Prompt sinh skeleton repo")

Yêu cầu AI tạo:

- [ ] Cây thư mục theo §1 của `03_REPO_AND_CODE_STANDARDS.md`.
- [ ] `.env.example` đúng theo `10_DEVOPS` §3.
- [ ] `Makefile` tối thiểu.
- [ ] `infrastructure/docker-compose.dev.yml` skeleton với postgres + timescaledb + minio + mosquitto + redis (4 service đủ chạy được, các service backend chưa cần).
- [ ] `.gitignore` đầy đủ.
- [ ] `.pre-commit-config.yaml`.
- [ ] `backend/app/core/` skeleton với `config.py`, `logging.py`, `errors.py`.
- [ ] README cấp 1 cho repo.

Acceptance Sprint 1:

- [ ] `make up` chạy được 5 container dependency (không có backend code business).
- [ ] `docker compose ps` → tất cả healthy.
- [ ] `backend/app/core` import được trong python REPL.

### 5.3 Sprint 2 (sau khi Sprint 1 ổn)

Đưa cho AI: `04_DATABASE_SCHEMA.md` + `05_API_CONTRACTS.md` + `06_BACKEND_SERVICES_SPEC.md` §3 + `19_REQUIREMENTS_AND_TRACEABILITY.md` §2 (FR-REG-001..005, MUST tier).

Yêu cầu AI sinh `device-registry` service:

- [ ] Alembic init + migration đầu tiên (devices, device_credentials, users, audit_logs).
- [ ] SQLAlchemy model.
- [ ] Pydantic schema.
- [ ] Repository + Service + Router.
- [ ] Test unit cho register/heartbeat/list.
- [ ] Dockerfile multi-stage.
- [ ] Healthcheck/readyz/metrics.
- [ ] README service.

Acceptance: `pytest backend/tests/ -q` pass. `curl http://localhost:8001/api/v1/devices` trả `{"items":[]...}`.

## 6. Sửa lớn không thực hiện (vì ngoài scope review)

- Không động vào `17_SPRINT_BACKLOG.md` 48 sprint nội dung (chỉ note ở section 4.4 ở trên). User tự cập nhật nếu cắt scope.
- Không sinh OpenAPI spec file YAML/JSON. Có thể sinh tự động từ FastAPI app sau Sprint 2.
- Không sinh Helm chart hay Kustomize manifest cụ thể. Sẽ làm trong Sprint 25–26 (K3s phase).
- Không vẽ ERD chi tiết hơn mermaid hiện tại. Nếu cần đẹp hơn cho luận văn → dùng dbdiagram.io vào Sprint 43.

## 7. Khuyến nghị quan trọng

1. **Luôn cập nhật file 19** khi yêu cầu thay đổi. File 19 là nguồn truth cho scope.
2. **Không cho AI sinh code mà không tham chiếu FR/NFR ID**. Mỗi prompt phải nêu ID đang implement.
3. **Mỗi PR phải link tới ít nhất 1 FR ID** trong description.
4. **Mỗi service mới phải cập nhật bảng port** trong `10_DEVOPS` §2.
5. **Mỗi MQTT topic mới hoặc payload thay đổi phải bump `schema_version`** và update `05_API` §6.

---

**Kết luận**: bộ tài liệu hiện tại đã sẵn sàng để bắt đầu Sprint 1. Khuyến cáo user đọc lại §4 và xác nhận các quyết định mở.
