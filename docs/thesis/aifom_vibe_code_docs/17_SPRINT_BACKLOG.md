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

# 17 – Sprint Backlog

Backlog bám theo `docs/scope.md` §12 và `01_PROJECT_CHARTER.md` §7. Mỗi sprint = 2 tuần. Tổng 24 tháng ≈ 48 sprint.

Mỗi sprint có:

- **Mục tiêu** (1–2 câu).
- **Deliverable** với mã FR/NFR ID từ `19_REQUIREMENTS_AND_TRACEABILITY.md`.
- **Done criteria** đo được.
- **Priority**: MUST / SHOULD / NICE.

Quy tắc:

- Không bắt đầu sprint mới nếu MUST của sprint trước chưa pass Done criteria.
- Nếu trễ → kích hoạt §11.2 của `scope.md` (cắt M2 → cắt phần M1).
- Sprint NICE có thể bỏ hoàn toàn không cần biện minh.

---

## Giai đoạn 1 (Tháng 1–6, Sprint 1–12) – MVP chạy được

**Mục tiêu giai đoạn**: hoàn thành 100% M0. Cuối tháng 6 phải có bản demo OTA + multi-tenant flow end-to-end.

### Sprint 1 — Phase 1: Core Infrastructure (M0, MUST)

- Mục tiêu: bootstrap repo, môi trường, tài liệu.
- Deliverable:
  - Repo skeleton.
  - `.env.example`, `Makefile`, `.pre-commit-config.yaml`.
  - Docker Compose: postgres, timescaledb, minio, mosquitto.
  - CI hello-world GitHub Action.
- Done: `make dev-up` chạy containers healthy; CI xanh.

### Sprint 2 — Phase 1 (M0, MUST)

- Mục tiêu: SRS đánh số FR/NFR; ADR công nghệ chính.
- Deliverable:
  - Xác nhận `19_REQUIREMENTS_AND_TRACEABILITY.md`.
  - ADR-0001 FastAPI, ADR-0002 MQTT, ADR-0003 PostgreSQL+TimescaleDB.
- Done: tài liệu commit vào `docs/`.

### Sprint 3 — Phase 2: Authentication & RBAC (M0, MUST)

- Mục tiêu: users table, JWT login/logout, role guard.
- Deliverable: FR-MT-004, NFR-SEC-001..004. Alembic migration `users`. Unit test auth guard.
- Done: `POST /api/v1/auth/login` trả JWT; route guard chặn đúng role.

### Sprint 4 — Phase 2: RBAC roles (M0, MUST)

- Mục tiêu: 3 role hoạt động: admin, tenant_owner, viewer (vai trò engineer đã được lược bỏ trong bản tinh gọn).
- Deliverable: FR-MT-009, FR-MT-010. Middleware tenant resolution từ JWT.
- Done: tenant_id luôn lấy từ JWT → không thể fake; viewer gọi write → 403.

### Sprint 5 — Phase 3: Tenant Management (M0, MUST)

- Mục tiêu: Admin tạo tenant + owner account.
- Deliverable: FR-MT-001, FR-MT-002. Alembic migration `tenants`, `service_plans`. API admin tenants.
- Done: Admin tạo tenant + owner atomic; owner login được ngay.

### Sprint 6 — Phase 3: Tenant detail (M0, MUST)

- Mục tiêu: Admin xem/sửa tenant, suspend, delete.
- Deliverable: FR-MT-001. Admin Console tenant list/detail page.
- Done: Admin Console hiển thị tenant list, tenant detail với tabs.

### Sprint 7 — Phase 4: Device Registry & Assignment (M0, MUST)

- Mục tiêu: device-registry CRUD + heartbeat + gán device cho tenant.
- Deliverable: FR-REG-001..005, FR-MT-003. Alembic migration `devices`, `tenant_device_mappings`.
- Done: `pytest backend/ -q` pass; Admin gán device cho tenant thành công.

### Sprint 8 — Phase 5: Tenant Workspace & Isolation (M0, MUST)

- Mục tiêu: Customer Workspace route guard; tenant chỉ thấy device của mình.
- Deliverable: FR-MT-005, TEST-MT-005. API `/client/devices` scoped.
- Done: tenant1 không thấy device của tenant2; gọi detail device của tenant2 → 404.

### Sprint 9 — Phase 6: Telemetry Ingest (M0, MUST)

- Mục tiêu: telemetry-ingest subscribe MQTT, validate, ghi TimescaleDB.
- Deliverable: FR-TEL-001..005. MQTT subscriber + TimescaleDB rows.
- Done: simulator publish telemetry → row trong `telemetry_events` và `device_health`.

### Sprint 10 — Phase 7: Firmware Binary Upload (M0, MUST)

- Mục tiêu: Admin và Tenant upload firmware `.bin`, lưu MinIO.
- Deliverable: FR-OTA-001..003, FR-MT-006. Alembic migration `firmware_packages`.
- Done: upload thành công, artifact có trong MinIO, metadata có SHA256 đúng; dup version → 409.

### Sprint 11 — Phase 8: OTA Campaign Management (M0, MUST)

- Mục tiêu: Tenant tạo OTA campaign cho device của mình; backend publish MQTT.
- Deliverable: FR-OTA-006..009, FR-MT-007, FR-MT-008. Alembic migration `ota_jobs`, `ota_job_targets`.
- Done: Tenant tạo campaign → MQTT command publish đến đúng device; job có trong DB.

### Sprint 12 — Phase 9: MQTT Simulator & OTA Progress (M0, MUST) — **MILESTONE GĐ1**

- Mục tiêu: Device simulator nhận OTA command, publish progress; Tenant Portal theo dõi.
- Deliverable: FR-SIM-001..003, FR-MT-008. Simulator + OTA state machine.
- Done: AC-M0-8 đạt — Admin → Tenant → Upload → OTA → ESP32/Simulator nhận lệnh + Progress displayed.

---

## Giai đoạn 2 (Tháng 7–12, Sprint 13–24) – OTA an toàn + UI + Observability

**Mục tiêu giai đoạn**: hoàn thành M1-SEC + M1-ROLL + M1-OBS + M1-SIM. Refine M0 nếu cần.

### Sprint 13 — Phase 10: Optional Edge Intelligence (M1-ML, SHOULD)

- Mục tiêu: Demo một intelligence profile mẫu cho một device type.
- Deliverable: FR-INTEL-001..002. Chọn 1 device type, define intelligence profile, sample anomaly detection.
- Done: Device type có profile → anomaly detection chạy; device type không có → không ảnh hưởng.

### Sprint 14 — Phase 10 (M1-ML, SHOULD)

- Mục tiêu: Train một model nhỏ (IsolationForest hoặc simple CNN), tích hợp làm sample profile.
- Deliverable: FR-INTEL-003. Model joblib hoặc TFLite, accuracy có thể đo được.
- Done: Sample model chạy được trên telemetry data của device type đã chọn.

### Sprint 15 (M1-SEC, SHOULD)

- Mục tiêu: Authentication admin (JWT) thực sự + device bootstrap token.
- Deliverable: FR-REG-002, NFR-SEC-001..004.
- Done: Login JWT → cookie/Bearer; device đổi token sau register đầu; old token bị reject.

### Sprint 16 (M1-SEC, SHOULD)

- Mục tiêu: Firmware signing Ed25519.
- Deliverable: FR-OTA-001 thêm signature; NFR-SEC-005.
- Done: Firmware sai signature bị reject; pass khi signature đúng.

### Sprint 17 (M1-ROLL, SHOULD)

- Mục tiêu: Canary rollout + auto-quarantine.
- Deliverable: FR-OTA-010, FR-OTA-011. UI hiển thị canary progress.
- Done: Rollout 10 device, inject 1 fail → rollout pause; firmware → quarantined.

### Sprint 18 (M1-SIM, SHOULD)

- Mục tiêu: Simulator fault profile.
- Deliverable: FR-SIM-002 mở rộng (heap_leak, rssi_drop, reboot_loop, ota_fail).
- Done: Chọn `--fault-profile heap_leak` → health metric drift đúng kiểu.

### Sprint 19 (M1-OBS, SHOULD)

- Mục tiêu: Prometheus + structured logging.
- Deliverable: NFR-OBS-001..002. Tất cả service expose `/metrics`. JSON log.
- Done: `curl prometheus:9090` thấy targets up.

### Sprint 20 (M1-OBS, SHOULD)

- Mục tiêu: Grafana 2 dashboard chính.
- Deliverable: NFR-OBS-003. Fleet Overview + OTA Status dashboard.
- Done: Dashboard có dữ liệu thật khi chạy simulator + OTA.

### Sprint 21 (M1-OBS, SHOULD)

- Mục tiêu: Alert cơ bản.
- Deliverable: NFR-OBS-004. Alert: DeviceOffline, OTAFailureRateHigh.
- Done: Trigger điều kiện → alert xuất hiện.

### Sprint 22 (M1-UI, SHOULD)

- Mục tiêu: Realtime UI (WebSocket) thay polling.
- Deliverable: FR-UI-006, FR-TEL-006.
- Done: OTA progress cập nhật trong UI không cần refresh.

### Sprint 23 (M0 refactor, MUST)

- Mục tiêu: Stress test 50 device; fix bug tích lũy; viết báo cáo.
- Deliverable: NFR-PERF-005; báo cáo stress.
- Done: 50 device chạy 1h không crash; OTA success ≥ 90%.

### Sprint 24 (M1, MUST) — **MILESTONE GĐ2**

- Mục tiêu: Demo M1 ops/sec/obs + báo cáo giữa kỳ 2.
- Deliverable: AC-M1-4..5..7 + báo cáo có screenshot dashboard.
- Done: Bản ghi demo canary rollout + alert + dashboard.

---

## Giai đoạn 3 (Tháng 13–18, Sprint 25–36) – Audit, Testing, polish

**Mục tiêu giai đoạn**: Phase 11 — audit log, test coverage, thesis documentation.

### Sprint 25 — Phase 11: Audit Log (M0, MUST)

- Mục tiêu: Audit log cho tất cả hành động quan trọng của Admin và Tenant.
- Deliverable: FR-AUDIT-001..003. Alembic migration `audit_logs`. Middleware ghi log.
- Done: Admin tạo tenant → audit row; Tenant upload firmware → audit row; API `/audit-logs` trả được.

### Sprint 26 — Phase 11: Test coverage (M0, MUST)

- Mục tiêu: Tăng test coverage ≥ 60%.
- Deliverable: NFR-MAINT-001. TEST-MT-001..016 đủ.
- Done: `pytest --cov` báo ≥ 60%; tất cả TEST-MT pass.

### Sprint 27 (M1-HEALTH, SHOULD)

- Mục tiêu: Health anomaly service-side (IsolationForest).
- Deliverable: FR-HEALTH-001..003.
- Done: Batch worker mỗi 60s ghi `health_scores`; alert khi anomaly ≥ 5 phút.

### Sprint 28 (M1-UI, SHOULD)

- Mục tiêu: Anomaly/alert page + device detail nâng cao.
- Deliverable: FR-UI-009, FR-UI-007.
- Done: UI hiển thị top 10 device anomaly; toast khi có alert mới.

### Sprint 29 (M1-MODEL, SHOULD) — intelligence profile API

- Mục tiêu: API quản lý intelligence profile per device type.
- Deliverable: FR-INTEL-004. API register/list/assign intelligence profile.
- Done: Device type A gán profile X; device type B không có profile → behavior khác nhau.

### Sprint 30 (refine, MUST)

- Mục tiêu: Fix bug tích lũy, ghi số liệu thực nghiệm.
- Deliverable: Bảng đo accuracy, latency (nếu có TinyML), throughput telemetry, OTA success rate.
- Done: Dataset đo công khai trong repo `docs/measurements/`.

### Sprint 31 (M1, SHOULD)

- Mục tiêu: Model update qua MQTT (nếu có intelligence profile với model binary).
- Deliverable: FR-INTEL-005. MQTT `update_model` command.
- Done: Device swap model blob không reboot; publish active model version.

### Sprint 32..35 (refine + thesis prep, MUST)

- Viết tài liệu kỹ thuật đầy đủ (ADR, runbook, measurements).
- Chuẩn bị số liệu cho luận văn.

### Sprint 36 (M1, MUST) — **MILESTONE GĐ3**

- Mục tiêu: Demo intelligence integration end-to-end; báo cáo giữa kỳ 3.
- Deliverable: Demo sample intelligence profile cho 1 device type; báo cáo.
- Done: Bản ghi demo — device type A với intelligence → anomaly detected; device type B không có → OK.

---

## Giai đoạn 4 (Tháng 19–24, Sprint 37–48) – Viết luận văn, demo, bảo vệ

**Mục tiêu giai đoạn**: viết luận văn, làm demo. **Không** thêm tính năng lớn.

### Sprint 37 (M2, NICE) — chọn **1** mục tùy chọn

Lựa chọn: M2-K3S **hoặc** M2-DELTA **hoặc** M2-MTLS. Bỏ sprint này nếu trễ.

### Sprint 38 (refine, SHOULD)

- Chaos test: kill MQTT, restart MinIO, DB unavailable 1 phút.
- Done: Hệ thống tự recover; có postmortem.

### Sprint 39 (refine, SHOULD)

- Stress test cuối + backup/restore drill.
- Done: Backup pg_dump + MinIO mirror khôi phục được trên máy mới.

### Sprint 40 (thesis, MUST)

- Viết chương "Tổng quan" + "Kiến trúc".
- Done: Tự đọc lại không sai logic; có hình C4/sequence.

### Sprint 41 (thesis, MUST)

- Viết chương "Triển khai" + "Bảo mật".

### Sprint 42 (thesis, MUST)

- Viết chương "Thực nghiệm" + bảng số liệu.
- Done: Mỗi số đo có nguồn từ `docs/measurements/`.

### Sprint 43 (thesis, MUST)

- Viết chương "Đánh giá" + "Hạn chế" + "Kết luận".
- Done: Đọc lại trung thực với scope đã làm.

### Sprint 44 (demo, MUST)

- Video demo end-to-end 10 phút.

### Sprint 45 (demo, MUST)

- Slide bảo vệ ≤ 20 slide.

### Sprint 46 (demo, MUST)

- 30 câu hỏi phản biện + câu trả lời mẫu.

### Sprint 47 (review, MUST)

- Format luận văn theo template trường.
- Done: PDF nộp hoàn chỉnh với mục lục, danh mục hình/bảng, reference.

### Sprint 48 (buffer, MUST) — **MILESTONE BẢO VỆ**

- Buffer cuối, tập demo, fix bug nhỏ.
- Done: Bảo vệ xong.

---

## Phase mapping tổng quát

| Phase | Sprint | Mục tiêu | Scope |
|---|---|---|---|
| **Phase 1**: Core Infrastructure | 1–2 | Docker Compose, FastAPI, PostgreSQL, MQTT, MinIO, React | M0 |
| **Phase 2**: Auth & RBAC | 3–4 | JWT, 4 roles, tenant guard | M0 |
| **Phase 3**: Tenant Management | 5–6 | Tạo tenant, tenant owner, admin tenant UI | M0 |
| **Phase 4**: Device Registry & Assignment | 7 | Device CRUD, heartbeat, gán device | M0 |
| **Phase 5**: Tenant Workspace & Isolation | 8 | /client/* routes, tenant scope | M0 |
| **Phase 6**: Telemetry | 9 | MQTT ingest, TimescaleDB | M0 |
| **Phase 7**: Firmware Upload | 10 | Upload .bin, MinIO, SHA256 | M0 |
| **Phase 8**: OTA Campaign | 11 | Tạo campaign, MQTT delivery, job tracking | M0 |
| **Phase 9**: Simulator & OTA Progress | 12 | Simulator, OTA progress, demo | M0 |
| **Phase 10**: Optional Edge Intelligence | 13–14 | Sample intelligence profile per device type | M1 (SHOULD) |
| **Phase 11**: Audit, Testing, Docs | 25–26 | Audit log, test coverage, thesis polish | M0/M1 |
| Future work | – | Source-code auto-build, billing, MLOps full, K8s | OUT/M2 |

---

## Phase 12 — Multi-tenant Customer Workspace & OTA Self-Service (completed)

Phase này đã implement MVP multi-tenant:

- Admin tạo tenant.
- Admin tạo owner account.
- Admin gán device.
- Tenant đăng nhập Customer Workspace.
- Tenant upload firmware `.bin`.
- Tenant tạo OTA campaign cho device được gán.
- Device update và dashboard theo dõi progress.

Out of scope của phase này:

- Billing/payment thực thụ.
- Source-code upload + auto-build firmware.
- Full commercial SaaS workflow.

### Backlog Phase 12 (completed items)

| Task ID | Mô tả | Priority | Acceptance criteria |
|---|---|---|---|
| P12-01 | Tenant data model: `tenants`, `tenant_device_mappings`, `users.tenant_id`, `service_plans` | MUST | Schema hỗ trợ tenant, plan, mapping; migration chạy được |
| P12-02 | Admin tạo tenant + owner account | MUST | Admin tạo tenant thành công; owner login được ngay |
| P12-03 | Admin assign devices to tenant | MUST | Device gán/thu hồi qua Admin Console; tenant chỉ thấy device đã gán |
| P12-04 | Tenant login và route guard | MUST | Tenant role vào `/client/*`; admin không dùng nhầm layout tenant |
| P12-05 | Tenant dashboard | MUST | Card tổng số device, online/offline, OTA summary |
| P12-06 | Tenant device list/detail | MUST | Tenant xem được danh sách; URL sang device tenant khác bị chặn |
| P12-07 | Tenant firmware upload UI/API | MUST | Tenant upload được `.bin`; backend trả metadata firmware vừa tạo |
| P12-08 | Firmware artifact storage | MUST | Artifact lưu MinIO; SHA256 tính server-side; file hỏng bị reject |
| P12-09 | Firmware version metadata | MUST | List/history firmware theo tenant; version, target, checksum hiển thị được |
| P12-10 | Tenant OTA campaign creation | MUST | Tenant tạo campaign; không tạo được cho device ngoài tenant |
| P12-11 | OTA progress tracking | MUST | OTA jobs cập nhật trạng thái; Tenant Portal hiển thị progress |
| P12-12 | Tenant isolation testing | MUST | TEST-MT-001..013 core pass |
| P12-13 | Debug logging (dev mode) | SHOULD | Frontend log trong dev mode; production không bật |
| P12-14 | Demo script | MUST | Script demo ngắn: admin tạo tenant → tenant upload → OTA → dashboard thấy progress |
