> [!NOTE]
> **TÀI LIỆU HƯỚNG DẪN LUẬN VĂN TỐT NGHIỆP — ĐÁNH DẤU PHẠM VI HỆ THỐNG**
>
> - **Phạm vi triển khai thực tế**: Quy định tại [`docs/scope.md`](../scope.md). Hệ thống tập trung vào Core IoT, MQTT Communication, Remote Commands (ACK), Automation, Firmware/OTA an toàn trên ESP32 thật và Multi-tenancy 3 vai trò (`admin`, `tenant_owner`, `viewer`).
> - **Tài liệu lịch sử / Nghiên cứu học thuật**: Thư mục `aifom_vibe_code_docs/` chứa bản đặc tả 24 tháng ban đầu. Các nội dung về AI/TinyML, Simulator phần mềm, vai trò Kỹ sư (`platform_engineer`, `tenant_engineer`), Prometheus/Grafana, Custom ApiDocs, Billing và Public Site thuộc phạm vi nghiên cứu học thuật/định hướng mở rộng, đã được tinh giản trong mã nguồn thực tế.

# Tài liệu đặc tả — AIFOM

Tài liệu kỹ thuật chi tiết cho luận văn tốt nghiệp và AI coding agent.

## Cấu trúc repo hiện tại

| Thành phần | Đường dẫn |
|---|---|
| FastAPI backend | `backend/` |
| React/Vite frontend | `frontend/` |
| ESP32 firmware | `iot/` |
| AI, TinyML, MLOps | `ai/` |
| Docker Compose + hạ tầng | `infrastructure/` |
| Script seed / tiện ích | `scripts/` |

## Tài liệu chính trong thesis

| Tài liệu | File |
|---|---|
| Scope / phạm vi đề tài | [`../scope.md`](../scope.md) |
| Master context | [`aifom_vibe_code_docs/00_MASTER_CONTEXT.md`](aifom_vibe_code_docs/00_MASTER_CONTEXT.md) |
| Project charter | [`aifom_vibe_code_docs/01_PROJECT_CHARTER.md`](aifom_vibe_code_docs/01_PROJECT_CHARTER.md) |
| Architecture | [`aifom_vibe_code_docs/02_ARCHITECTURE.md`](aifom_vibe_code_docs/02_ARCHITECTURE.md) |
| Database schema | [`aifom_vibe_code_docs/04_DATABASE_SCHEMA.md`](aifom_vibe_code_docs/04_DATABASE_SCHEMA.md) |
| API contracts | [`aifom_vibe_code_docs/05_API_CONTRACTS.md`](aifom_vibe_code_docs/05_API_CONTRACTS.md) |
| Backend services | [`aifom_vibe_code_docs/06_BACKEND_SERVICES_SPEC.md`](aifom_vibe_code_docs/06_BACKEND_SERVICES_SPEC.md) |
| UI specification | [`aifom_vibe_code_docs/09_ADMIN_UI_SPEC.md`](aifom_vibe_code_docs/09_ADMIN_UI_SPEC.md) |
| Testing strategy | [`aifom_vibe_code_docs/14_TESTING_STRATEGY.md`](aifom_vibe_code_docs/14_TESTING_STRATEGY.md) |
| Sprint backlog | [`aifom_vibe_code_docs/17_SPRINT_BACKLOG.md`](aifom_vibe_code_docs/17_SPRINT_BACKLOG.md) |
| Requirements traceability | [`aifom_vibe_code_docs/19_REQUIREMENTS_AND_TRACEABILITY.md`](aifom_vibe_code_docs/19_REQUIREMENTS_AND_TRACEABILITY.md) |

## Mapping chủ đề mới của AIFOM

| Chủ đề | Tài liệu nên đọc | Backend path liên quan | Frontend path liên quan |
|---|---|---|---|
| Tenant / customer module | `04_DATABASE_SCHEMA.md`, `05_API_CONTRACTS.md`, `06_BACKEND_SERVICES_SPEC.md`, `19_REQUIREMENTS_AND_TRACEABILITY.md` | `backend/app/modules/tenants/`, `backend/app/core/tenant.py`, `backend/app/modules/auth/` | `frontend/src/services/tenantAdminApi.ts`, `frontend/src/contexts/AuthContext.tsx`, `frontend/src/contexts/FeatureContext.tsx` |
| Customer Workspace | `02_ARCHITECTURE.md`, `05_API_CONTRACTS.md`, `09_ADMIN_UI_SPEC.md`, `06_BACKEND_SERVICES_SPEC.md` | `backend/app/modules/tenants/router_client.py` | `frontend/src/components/layout/ClientLayout.tsx`, `frontend/src/components/layout/ClientSidebar.tsx`, `frontend/src/pages/client/` |
| OTA self-service flow | `05_API_CONTRACTS.md`, `06_BACKEND_SERVICES_SPEC.md`, `14_TESTING_STRATEGY.md` | `backend/app/modules/ota/`, `backend/app/modules/tenants/router_client.py`, `backend/app/services/mqtt_publisher.py` | `frontend/src/pages/client/ClientOta.tsx`, `frontend/src/services/clientApi.ts`, `frontend/src/services/otaApi.ts` |
| Firmware upload flow | `05_API_CONTRACTS.md`, `06_BACKEND_SERVICES_SPEC.md`, `11_SECURITY_OTA.md` | `backend/app/modules/firmware/`, `backend/app/services/minio_client.py` | `frontend/src/pages/Firmware.tsx`, `frontend/src/pages/client/ClientOta.tsx`, `frontend/src/services/firmwareApi.ts` |
| Multi-tenant access control | `00_MASTER_CONTEXT.md`, `05_API_CONTRACTS.md`, `06_BACKEND_SERVICES_SPEC.md`, `19_REQUIREMENTS_AND_TRACEABILITY.md` | `backend/app/core/security.py`, `backend/app/core/tenant.py`, `backend/app/modules/auth/model.py` | `frontend/src/components/ProtectedRoute.tsx`, `frontend/src/pages/Login.tsx`, `frontend/src/contexts/AuthContext.tsx` |
| Admin Console vs Tenant Portal | `02_ARCHITECTURE.md`, `05_API_CONTRACTS.md`, `09_ADMIN_UI_SPEC.md`, `06_BACKEND_SERVICES_SPEC.md` | `backend/app/modules/tenants/router_admin.py`, `backend/app/modules/tenants/router_client.py` | `frontend/src/components/layout/AppShell.tsx`, `frontend/src/components/layout/ClientLayout.tsx`, `frontend/src/pages/admin/`, `frontend/src/pages/client/` |

## Cách đọc nhanh theo nhu cầu

| Nếu cần tìm | Đọc file nào trước |
|---|---|
| Phạm vi MVP và cắt scope | `../scope.md`, `19_REQUIREMENTS_AND_TRACEABILITY.md` |
| Kiến trúc tổng thể hệ thống | `02_ARCHITECTURE.md` |
| Thiết kế DB | `04_DATABASE_SCHEMA.md` |
| Endpoint và contract request/response | `05_API_CONTRACTS.md` |
| Backend service responsibility | `06_BACKEND_SERVICES_SPEC.md` |
| UI/Admin Console/Tenant Portal | `09_ADMIN_UI_SPEC.md` |
| Test plan, TEST-MT, E2E | `14_TESTING_STRATEGY.md` |
| Mapping requirement -> test -> service | `19_REQUIREMENTS_AND_TRACEABILITY.md` |

## Mapping tên cũ -> tên hiện tại trong repo

Một số tài liệu trong `aifom_vibe_code_docs/` vẫn dùng tên đường dẫn cũ:

| Tên cũ | Tên hiện tại |
|---|---|
| `apps/api/` | `backend/` |
| `apps/web-admin/` | `frontend/` |
| `services/device-registry/` | `backend/app/modules/devices/` |
| `services/ota-server/` | `backend/app/modules/ota/` + `backend/app/modules/firmware/` |
| `services/telemetry-ingest/` | `backend/app/modules/telemetry/` |
| `services/health-scorer/` | `backend/app/modules/anomaly/` |
| `services/tenant-management/` | `backend/app/modules/tenants/` |
| `services/common/` | `backend/app/core/` + `backend/app/services/` |
| `firmware/` | `iot/firmware/` |
| `ml/` | `ai/` |
| `infra/` | `infrastructure/` |

## Ghi chú thuật ngữ RBAC

Hệ thống chuẩn hóa trên **3 roles** đang hoạt động:

| Role | Area | Quyền |
|---|---|---|
| `admin` | Admin Console (`/console/*`) | Full platform access (platform devices, firmware, OTA, tenants, audit logs) |
| `tenant_owner` | Customer Workspace (`/client/*`) | Quản lý toàn diện tài nguyên tenant: thiết bị, canvas, datastreams, commands, automation, firmware, OTA, quản lý thành viên |
| `viewer` | Customer Workspace (`/client/*`) | Chỉ đọc (read-only) dữ liệu trong tenant; không thể gửi lệnh hay thay đổi cấu hình |

*(Lưu ý lịch sử: Các vai trò `platform_engineer` và `tenant_engineer` xuất hiện trong các bản thiết kế ban đầu đã chính thức được loại bỏ khỏi hệ thống vào ngày 03/10/2026).*

**Quan trọng**: `tenant_id` KHÔNG được lấy từ request — luôn lấy từ JWT → DB.

## Phase đã hoàn thành

| Phase | Mô tả |
|---|---|
| 1 | Core infrastructure (Docker Compose, FastAPI, PostgreSQL, MQTT, MinIO, React) |
| 2 | Device registration + MQTT telemetry ingestion |
| 3 | Firmware metadata + OTA backend |
| 4 | Real OTA flow (ESP32 OTA client + rollback) |
| 5 | Multi-device fleet simulator + telemetry filters |
| 6 | Anomaly detection server-side (IsolationForest) |
| 7 | Demo preparation (seed script, Makefile targets) |
| 8 | Tests + quality checks |
| 9 | Observability (Prometheus + Grafana + structured logging) |
| 10 | Authentication & Security (JWT, bcrypt, RBAC) |
| 11 | Web Admin UI redesign (React production console) |
| 12 | Multi-tenant Customer Workspace + OTA self-service |

## Phase tiếp theo (planned)

| Phase | Mô tả | Priority |
|---|---|---|
| 13 | Audit log (MUST) | MUST |
| 14 | Viewer role (MUST) | MUST |
| 15 | Device Type + Intelligence Profile API (optional, M1) | SHOULD |
| 16 | OTA state machine update (thêm "sent" state) | MUST |
| 17 | Thesis writing + documentation polish | MUST |
