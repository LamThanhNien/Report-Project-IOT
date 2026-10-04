> [!NOTE]
> **BÁO CÁO KIỂM THỬ / ĐỐI SOÁT LỊCH SỬ (HISTORICAL AUDIT & VERIFICATION REPORT)**
>
> Báo cáo này ghi nhận kết quả rà soát tại thời điểm phát triển trong quá khứ (tháng 05/2026). Các tham chiếu đến TinyML, bộ simulator, các vai trò kỹ sư (`tenant_engineer`, `platform_engineer`) phản ánh hiện trạng của codebase tại thời điểm lập báo cáo và mang tính chất lưu trữ lịch sử phát triển. Để đối chiếu hiện trạng mới nhất, tham khảo [`docs/scope.md`](../../scope.md) và [`docs/reports/engineer-removal-2026-10-03.md`](../../reports/engineer-removal-2026-10-03.md).

# CODE-DOCS ALIGNMENT AUDIT REPORT

**AIFOM — Lightweight Multi-Tenant IoT Platform**

**Audit Date**: 2026-05-21  
**Auditor**: Claude Code (automated code-documentation alignment analysis)  
**Branch**: main  
**Scope**: Full codebase vs. documentation alignment check  

---

## A. Executive Summary

### Overall Alignment Status: **Mostly Aligned**

The AIFOM codebase is substantially implemented and mostly aligned with the documentation. The core MVP multi-tenant IoT platform flow (admin creates tenant → tenant uploads firmware → tenant creates OTA → MQTT delivery → device OTA progress) is **fully implemented and verified by test reports**. The project has a functioning full-stack system with FastAPI backend, React frontend, MQTT integration, MinIO storage, and a comprehensive tester suite.

### Top 5 Biggest Mismatches

1. **Role Name Mismatch (P1)**: Documentation specifies 4 roles: `admin`, `tenant_owner`, `tenant_engineer`, `viewer`. Code uses `admin`, `tenant_owner`, `tenant_manager`, `tenant_viewer`. The names `tenant_engineer` and `viewer` (docs) are not in code; instead `tenant_manager` and `tenant_viewer` are used. `DOCS_ALIGNMENT_UPDATE_REPORT.md` explicitly flags this as a known pending task.

2. **Audit Logs Not Implemented (P0)**: `FR-AUDIT-001..003` are marked MUST. `09_ADMIN_UI_SPEC.md` specifies an `/audit-logs` page. No `audit_logs` table exists in the DB models. No audit log middleware exists in the backend. No `/admin/audit-logs` API endpoint. No Audit Log page in the frontend. This is the largest unclosed MUST requirement.

3. **API Route Naming Mismatch (P1)**: Documentation (`05_API_CONTRACTS.md`) specifies client firmware upload as `POST /api/v1/client/firmware/upload` and OTA as `POST /api/v1/client/ota-campaigns`. The actual backend routes are `POST /api/v1/client/firmware` (no `/upload` suffix) and `POST /api/v1/client/ota-jobs`. The frontend `clientApi.ts` calls `/client/ota-jobs` (matching code), but the docs say `/client/ota-campaigns`. Inconsistency between docs and code/frontend.

4. **Device Model Missing Key Fields (P1)**: Documentation (`04_DATABASE_SCHEMA.md`) specifies `devices` table with `hardware_model`, `model_version`, `ip_address`, `mac_address`, `metadata JSONB`, `device_type`. The actual `Device` ORM model (`backend/app/modules/devices/model.py`) only has `id`, `device_uid`, `name`, `firmware_version`, `status`, `last_seen_at`. Missing: `hardware_model`, `mac_address`, `ip_address`, `metadata`, `device_group_id`. This also means the `device_type`/`hardware_model` concept is not tracked per device.

5. **OTA State Machine Incomplete (P1)**: Documentation specifies OTA states: `created → sent → downloading → flashing → rebooting → success/failed`. The code (`ota/model.py`) does define these states including `sent`. However, the MQTT topic for OTA publish uses `aifom/devices/{uid}/ota/request` while documentation specifies `dev/{uid}/cmd`. The simulator (`simulate_device.py`) subscribes to `aifom/devices/{uid}/ota/request`. The documentation topic format `dev/{uid}/cmd` is not used in code.

### MVP Readiness Assessment

**MVP is demo-ready for core flow.** The FULL_TEST_REPORT.md (2026-05-21) confirms 84/85 tests passing. The core tenant self-service OTA flow works end-to-end. However, 3 MUST requirements remain unimplemented: audit logs (FR-AUDIT-001..003), Viewer role write protection (FR-MT-010), and the `/audit-logs` admin page (FR-UI-010).

### Demo Readiness Assessment

**Demo is ready with caveats.** The primary demo script (admin login → create tenant → assign device → tenant login → upload firmware → create OTA → device receives MQTT → reports progress) works. Gaps: audit log page shows no data (not implemented), models/intelligence page uses mock data, `tenant_engineer` role name mismatch may confuse demo.

### Critical P0 Blockers

1. **Audit Logs table and API missing** — `FR-AUDIT-001..003` are MUST but have zero code implementation.
2. **JWT token does NOT embed `tenant_id`** — The JWT payload (`create_access_token` in `auth/service.py`) only embeds `sub` (user_id) and `role`. It does NOT embed `tenant_id`. The docs require `tenant_id` in JWT. The backend resolves `tenant_id` via DB lookup on every request (correct security-wise), but the JWT contract documented in `05_API_CONTRACTS.md` says JWT contains `tenant_id` field. This is not a runtime security issue but a documentation contract mismatch.

### AIFOM Vision Alignment

**Code matches the updated AIFOM vision.** The codebase correctly positions multi-tenant IoT management and OTA as core product. TinyML/anomaly detection is implemented as an optional server-side IsolationForest (not TFLite Micro on-device), which aligns with the SHOULD/M1 scope. The `from-source` endpoint in `router_client.py` implements Arduino `.ino` compilation (via arduino-cli), which is flagged as OUT-of-scope in documentation — this is an over-implementation that should be noted.

---

## B. Feature Alignment Matrix

| Feature / Requirement | Doc Expectation | Code Implementation Found | Status | Evidence (file:function) | Severity | Recommended Action |
|---|---|---|---|---|---|---|
| Admin login | JWT login, role=admin | Implemented | **ALIGNED** | `backend/app/modules/auth/router.py:login` | — | None |
| Tenant login | JWT login, role in TENANT_ROLES | Implemented | **ALIGNED** | `backend/app/modules/auth/router.py:login`, `backend/app/core/tenant.py:get_current_tenant_user` | — | None |
| RBAC (4 roles: admin, tenant_owner, tenant_engineer, viewer) | 4 roles enforced | Code has `admin`, `tenant_owner`, `tenant_manager`, `tenant_viewer` — NOT `tenant_engineer`/`viewer` | **PARTIAL** | `backend/app/modules/auth/model.py:15-18`, `backend/app/core/tenant.py:9` | P1 | Rename `tenant_manager` → `tenant_engineer`, `tenant_viewer` → `viewer` in code |
| Admin creates tenant | `POST /api/v1/admin/tenants` | Implemented | **ALIGNED** | `backend/app/modules/tenants/router_admin.py:create_tenant` | — | None |
| Admin creates tenant owner user | Atomic with tenant creation or separately | Both paths implemented | **ALIGNED** | `backend/app/modules/tenants/router_admin.py:create_tenant`, `create_tenant_user` | — | None |
| Admin assigns devices to tenant | `POST /api/v1/admin/tenants/{id}/devices` | Implemented with cross-tenant duplicate check | **ALIGNED** | `backend/app/modules/tenants/router_admin.py:assign_device_to_tenant` | — | None |
| Tenant sees only assigned devices | Scoped via JWT→DB tenant_id | Implemented via `list_tenant_devices()` | **ALIGNED** | `backend/app/modules/tenants/router_client.py:client_list_devices` | — | None |
| Tenant telemetry isolation | Tenant can only read own device telemetry | Implemented — validates device belongs to tenant first | **ALIGNED** | `backend/app/modules/tenants/router_client.py:client_device_telemetry` | — | None |
| Tenant firmware isolation | Tenant firmware upload tracked, list is global | `GET /client/firmware` returns ALL firmware (not tenant-scoped) | **PARTIAL** | `backend/app/modules/tenants/router_client.py:client_list_firmware` (calls `list_firmware` without tenant filter) | P2 | Add `uploaded_by_tenant_id` field to firmware_versions; scope GET to tenant |
| Tenant OTA isolation | Only tenant devices can be OTA targets | Validated: `get_tenant_device()` check before creating job | **ALIGNED** | `backend/app/modules/tenants/router_client.py:client_create_ota_job:488` | — | None |
| Device registry / CRUD | devices table with full metadata | Implemented but missing hardware_model, mac_address, ip_address, metadata | **PARTIAL** | `backend/app/modules/devices/model.py:Device` | P1 | Add missing fields to Device model |
| Device type support | Per device_type firmware profiles | `target_device_type` exists in FirmwareVersion; no DeviceType ORM table | **PARTIAL** | `backend/app/modules/firmware/model.py:FirmwareVersion` | P2 | Create DeviceType table (SHOULD/M1 — not blocking MVP) |
| Device group support | Tenant can create device groups | No DeviceGroup model or API exists | **MISSING** | — | P3 | Future work (SHOULD/M1) |
| Telemetry ingestion (MQTT) | Subscribe dev/+/telemetry, validate, write DB | Implemented; uses `aifom/devices/+/telemetry` topic | **ALIGNED** | `backend/app/services/mqtt_subscriber.py:_handle_telemetry` | Note: topic prefix differs from doc | None blocking |
| Telemetry dashboard | Frontend shows telemetry charts | Telemetry page exists; DeviceDetail has telemetry section | **ALIGNED** | `frontend/src/pages/Telemetry.tsx`, `frontend/src/pages/DeviceDetail.tsx` | — | None |
| Firmware binary upload (MinIO) | Upload .bin, compute SHA256, store MinIO | Fully implemented | **ALIGNED** | `backend/app/modules/firmware/router.py:upload_firmware`, `backend/app/services/minio_client.py` | — | None |
| Firmware metadata/versioning | version, target_hardware, sha256, release_notes | Implemented (uses `target_device_type` not `target_hardware`) | **ALIGNED** | `backend/app/modules/firmware/model.py:FirmwareVersion` | — | None |
| Firmware ownership (per tenant) | Firmware created by tenant is tenant-owned | Firmware has no `tenant_id` field; client list returns all firmware | **PARTIAL** | `backend/app/modules/firmware/model.py` (no tenant_id), `router_client.py:client_list_firmware` | P2 | Add tenant_id to FirmwareVersion |
| OTA campaign creation | Tenant creates campaign via /client/ota-campaigns | Route is `/client/ota-jobs` (not `/client/ota-campaigns`) | **PARTIAL** | `backend/app/modules/tenants/router_client.py:client_create_ota_job` | P2 (cosmetic) | Rename route or update docs to match |
| OTA target validation (device belongs to tenant) | Validate device is assigned to tenant | Implemented | **ALIGNED** | `backend/app/modules/tenants/router_client.py:client_create_ota_job:488` | — | None |
| MQTT OTA command publishing | Publish to `dev/{uid}/cmd` | Publishes to `aifom/devices/{uid}/ota/request` | **PARTIAL** | `backend/app/services/mqtt_publisher.py:publish_ota_request` | P2 (topic naming) | Align topic with docs or update docs |
| Device/simulator OTA command receiving | Simulator subscribes and responds | Simulator subscribes to `aifom/devices/+/ota/request` | **ALIGNED** | `iot/simulator/simulate_device.py` (implicit via `run_simulator`) | — | None (topic matches code) |
| OTA progress tracking | Device publishes progress; backend updates job | MQTT subscriber handles `ota/result`; updates OtaJob status | **ALIGNED** | `backend/app/services/mqtt_subscriber.py:_handle_ota_result` | — | None |
| OTA logs/events | Per-job event log | No OtaProgressEvent table; only OtaJob status field updated | **PARTIAL** | `backend/app/modules/ota/model.py:OtaJob` | P2 | Add ota_progress_events table for fine-grained history |
| Admin global OTA monitoring | Admin sees all OTA jobs | `GET /api/v1/ota/jobs` returns all jobs (admin only) | **ALIGNED** | `backend/app/modules/ota/router.py:list_ota_jobs` | — | None |
| Tenant own OTA monitoring | Tenant sees own device OTA jobs | `GET /api/v1/client/ota-jobs` filters by tenant device IDs | **ALIGNED** | `backend/app/modules/tenants/router_client.py:client_ota_jobs` | — | None |
| Audit logs | `audit_logs` table, middleware, admin page | **NOT IMPLEMENTED** — no table, no API, no UI page | **MISSING** | — | **P0** | Create audit_logs model, middleware, `/admin/audit-logs` endpoint and page |
| Alerts/anomaly results | AnomalyEvent table, client alerts endpoint | Implemented (IsolationForest server-side) | **ALIGNED** | `backend/app/modules/anomaly/`, `backend/app/modules/tenants/router_client.py:client_alerts` | Model not loaded without training | Train model for demo |
| TinyML / rule-based intelligence profile | Optional per device type, SHOULD (M1) | IsolationForest server-side only; no on-device TFLite | **PARTIAL** | `backend/app/modules/anomaly/service.py` | P3 | On-device TinyML is M1/SHOULD — not blocking MVP |
| Model/intelligence versioning | model_version tracked in anomaly events | `model_version` field in AnomalyEvent | **ALIGNED** | `backend/app/modules/anomaly/model.py:AnomalyEvent` | — | None |
| System health dashboard | System page with API/DB/MQTT/MinIO health | System page exists in frontend | **ALIGNED** | `frontend/src/pages/System.tsx` | — | None |
| Tester folder API tests | pytest test files for all modules | 62 tests passing (84/85 total) | **ALIGNED** | `tester/api/test_01_auth.py` through `test_08_alerts_anomaly.py` | — | None |
| MQTT tests | pytest MQTT connectivity and OTA publish | 5 tests passing | **ALIGNED** | `tester/mqtt/` | — | None |
| E2E Playwright tests | admin_flow, tenant_flow, ota_flow | 17/18 passing (1 skip: firmware upload button) | **MOSTLY ALIGNED** | `tester/e2e/tests/` | P3 (minor) | Fix firmware upload UI test |
| run-aifom.bat startup workflow | One-command full stack startup | Fully implemented with port conflict detection | **ALIGNED** | `run-aifom.bat` | — | None |

---

## C. API Alignment Matrix

| Documented API | Actual Route Found | HTTP Method | Auth Dependency | Admin-only? | Tenant Isolation? | Status | File Path | Notes |
|---|---|---|---|---|---|---|---|---|
| `POST /api/v1/admin/tenants` | `/api/v1/admin/tenants` | POST | `require_admin` | Yes | N/A | **ALIGNED** | `router_admin.py:create_tenant` | Works; optional owner creation |
| `GET /api/v1/admin/tenants` | `/api/v1/admin/tenants` | GET | `require_admin` | Yes | N/A | **ALIGNED** | `router_admin.py:list_tenants` | — |
| `GET /api/v1/admin/tenants/{id}` | `/api/v1/admin/tenants/{tenant_id}` | GET | `require_admin` | Yes | N/A | **ALIGNED** | `router_admin.py:get_tenant` | — |
| `POST /api/v1/admin/tenants/{id}/devices` | `/api/v1/admin/tenants/{tenant_id}/devices` | POST | `require_admin` | Yes | N/A | **ALIGNED** | `router_admin.py:assign_device_to_tenant` | Cross-tenant check added |
| `POST /api/v1/admin/tenants/{id}/users` (implied) | `/api/v1/admin/tenants/{tenant_id}/users` | POST | `require_admin` | Yes | N/A | **ALIGNED** | `router_admin.py:create_tenant_user` | — |
| `/api/v1/admin/devices` | No admin devices route under `/admin/` prefix | — | — | — | — | **MISMATCH** | `router.py` routes devices to `/api/v1/devices` not `/api/v1/admin/devices` | Docs say `/admin/devices` but code has `/devices` (admin only) |
| `/api/v1/admin/firmware` | No route under `/admin/firmware` | — | — | — | — | **MISMATCH** | Code routes to `/api/v1/firmware` (admin only) | Doc vs code path naming |
| `/api/v1/admin/ota-jobs` | No route under `/admin/ota-jobs` | — | — | — | — | **MISMATCH** | Code routes to `/api/v1/ota/jobs` (admin only) | Doc vs code path naming |
| `/api/v1/admin/telemetry` | No route under `/admin/telemetry` | — | — | — | — | **MISMATCH** | Code routes to `/api/v1/telemetry` (admin only) | Doc vs code path naming |
| `GET /api/v1/client/devices` | `/api/v1/client/devices` | GET | `get_current_tenant_user` + `require_feature("device_management")` | No | Yes (tenant scoped) | **ALIGNED** | `router_client.py:client_list_devices` | Properly scoped |
| `GET /api/v1/client/telemetry` | `/api/v1/client/devices/{uid}/telemetry` (nested) | GET | `get_current_tenant_user` + `require_feature("telemetry_view")` | No | Yes | **PARTIAL** | `router_client.py:client_device_telemetry` | Doc shows flat `/client/telemetry`; code uses nested path |
| `GET /api/v1/client/firmware` | `/api/v1/client/firmware` | GET | `get_current_tenant_user` + `require_feature("firmware_history")` | No | No (returns all firmware) | **PARTIAL** | `router_client.py:client_list_firmware` | Missing tenant scope on list |
| `POST /api/v1/client/firmware/upload` | `POST /api/v1/client/firmware` (no `/upload`) | POST | `get_current_tenant_user` + `require_feature("ota_update")` | No | Yes (logs tenant) | **PARTIAL** | `router_client.py:client_upload_firmware` | Route path differs from doc |
| `POST /api/v1/client/ota-campaigns` | `POST /api/v1/client/ota-jobs` | POST | `get_current_tenant_user` + `require_feature("ota_update")` | No | Yes (validates device ownership) | **PARTIAL** | `router_client.py:client_create_ota_job` | Route name mismatch (campaigns vs jobs) |
| `GET /api/v1/client/ota-campaigns` | `GET /api/v1/client/ota-jobs` | GET | `get_current_tenant_user` + `require_feature("ota_update")` | No | Yes (filters by tenant device IDs) | **PARTIAL** | `router_client.py:client_ota_jobs` | Route name mismatch |
| `GET /api/v1/client/alerts` | `/api/v1/client/alerts` | GET | `get_current_tenant_user` + `require_feature("alert_management")` | No | Yes (tenant device filter) | **ALIGNED** | `router_client.py:client_alerts` | — |
| `GET /api/v1/client/anomalies` | `/api/v1/client/ai-events` | GET | `get_current_tenant_user` + `require_feature("ai_anomaly_detection")` | No | Yes | **PARTIAL** | `router_client.py:client_ai_events` | Endpoint named differently than doc |
| `POST /api/v1/auth/login` | `/api/v1/auth/login` | POST | None | No | No | **ALIGNED** | `auth/router.py:login` | — |
| `GET /api/v1/auth/me` | `/api/v1/auth/me` | GET | `get_current_user` | No | No | **ALIGNED** | `auth/router.py:me` | — |
| `GET /api/v1/admin/audit-logs` | **NOT IMPLEMENTED** | — | — | — | — | **MISSING** | — | P0: audit log endpoint missing |
| `POST /api/v1/auth/logout` | **NOT IMPLEMENTED** | — | — | — | — | **MISSING** | — | FR-AUTH-004: logout endpoint missing |
| **DANGER: POST /api/v1/client/firmware/from-source** | `/api/v1/client/firmware/from-source` | POST | `get_current_tenant_user` + `require_feature("ota_update")` | No | Partial | **OVER-SCOPED** | `router_client.py:client_upload_firmware_from_source` | Source code compile endpoint is OUT-of-scope per docs; exists in code with arduino-cli integration |

**Security Note on Route Danger**: No dangerous routes found where tenant users can access global admin data. All admin-prefixed routes use `require_admin`. The `/api/v1/devices` (admin only) returns 403 for tenant users as confirmed by test_03. The `/api/v1/client/*` routes are properly scoped to tenant via JWT→DB resolution.

---

## D. Database Schema Alignment Matrix

| Entity/Table | Doc Purpose | Actual Implementation | Important Fields | Missing Fields | Relationships | Tenant Isolation | Status | Recommended Action |
|---|---|---|---|---|---|---|---|---|
| `users` | Platform and tenant users with roles | `auth/model.py:User` — id, email, hashed_password, role, tenant_id, is_active, full_name | tenant_id FK to tenants | `disabled_at` (doc has it, code uses `is_active` bool instead) | tenant FK | Yes (tenant_id nullable) | **ALIGNED** | Minor field naming difference |
| `tenants` | Tenant/customer organizations | `tenants/model.py:Tenant` — id, name, slug, plan_id, is_active | `contact_email` (missing in code), `status ENUM` (code uses `is_active` bool) | contact_email, status ENUM | plan, device_mappings | N/A | **PARTIAL** | Add contact_email; doc uses status ENUM, code uses boolean |
| `tenant_device_mappings` | Maps devices to tenants | `tenants/model.py:TenantDeviceMapping` — composite PK (tenant_id, device_id) | — | `assigned_at` (doc has it, code does not) | tenant, device | Yes | **PARTIAL** | Add assigned_at timestamp |
| `devices` | IoT device registry | `devices/model.py:Device` — id, device_uid, name, firmware_version, status, last_seen_at | — | hardware_model, model_version, ip_address, mac_address, metadata JSONB, device_type | telemetry_records | Indirect via tenant_device_mappings | **PARTIAL** | Add hardware_model, mac_address, metadata fields |
| `device_types` | Device type definitions | **NOT IMPLEMENTED** | — | All fields | — | — | **MISSING** | SHOULD (M1) — create DeviceType model |
| `telemetry` (was `telemetry_events`) | Time-series telemetry per device | `telemetry/model.py:Telemetry` — uses relational PostgreSQL not TimescaleDB hypertable | timestamp, device_id (FK), metric_name, metric_value | — | device FK | Indirect | **PARTIAL** | Doc specifies TimescaleDB hypertable; code uses plain PostgreSQL table |
| `firmware_versions` (was `firmwares`) | Firmware binary metadata | `firmware/model.py:FirmwareVersion` — version, target_device_type, sha256, object_key | `source_type`, `source_code`, `board_fqbn` (over-implementation) | tenant_id (no firmware ownership), `git_sha`, `signature`, `status ENUM` | — | No tenant scope | **PARTIAL** | Add tenant_id; `source_type/source_code` are over-scope |
| `ota_jobs` | Per-device OTA job tracking | `ota/model.py:OtaJob` — id, device_id, firmware_version_id, status, timestamps | — | `rollout_id`, `progress_pct`, `error_code`, `previous_firmware_version` | device, firmware_version | Indirect | **PARTIAL** | Add progress_pct, error_code fields; add rollout support |
| `ota_job_targets` / `rollouts` | Rollout campaign grouping | **NOT IMPLEMENTED** | — | All fields | — | — | **MISSING** | SHOULD — add rollout grouping table |
| `ota_progress_events` | Fine-grained OTA state history | **NOT IMPLEMENTED** | — | All fields | — | — | **MISSING** | SHOULD — add for OTA audit trail |
| `audit_logs` | Platform action audit trail | **NOT IMPLEMENTED** | — | All fields | — | — | **MISSING (P0)** | MUST — implement immediately |
| `service_plans` | Feature flag / plan definitions | `tenants/model.py:ServicePlan` — id, name, max_devices, max_users, features JSONB | `telemetry_retention_days` (exists) | `tier ENUM` (doc has plan_tier ENUM; code uses plain string name) | tenants | N/A | **MOSTLY ALIGNED** | Minor: doc has plan_tier ENUM |
| `tenant_feature_overrides` | Per-tenant feature flag overrides | `tenants/model.py:TenantFeatureOverride` — uses `feature_name` column | — | Doc uses `feature_key`, code uses `feature_name` | tenant | — | **MOSTLY ALIGNED** | Naming difference only |
| `anomaly_events` | Anomaly detection results | `anomaly/model.py:AnomalyEvent` — id, device_id, timestamp, metric_name, anomaly_score, is_anomaly, model_version | — | Doc has `health_scores` as TimescaleDB table; code uses PostgreSQL `anomaly_events` | device FK | Indirect | **PARTIAL** | Naming/structure differs from doc |
| `alerts` | Platform-wide alert records | **NOT IMPLEMENTED** as standalone table | — | All fields | — | — | **MISSING** | Anomaly events partially substitute; proper alerts table needed |
| `model_profiles` / `intelligence_profiles` | Device type intelligence profiles | **NOT IMPLEMENTED** | — | All fields | — | — | **MISSING** | SHOULD (M1) — not blocking MVP |
| `device_credentials` | Per-device authentication tokens | **NOT IMPLEMENTED** | — | All fields | — | — | **MISSING** | SHOULD — device token auth not fully implemented |

---

## E. Frontend/UI Alignment Matrix

| UI Module | Doc Expectation | Actual Component Found | API Used | Role Visibility | Status | Missing Behavior | Recommended Action |
|---|---|---|---|---|---|---|---|
| Admin Dashboard | Total devices, online/offline, OTA success rate, tenant count | `Dashboard.tsx` — exists | `deviceApi`, `otaApi` | Admin only (`AdminRoute`) | **ALIGNED** | OTA success rate may be placeholder | Verify dashboard data sourcing |
| Admin Tenants | List tenants, create tenant+owner, tenant detail | `Tenants.tsx`, `TenantDetail.tsx` | `tenantAdminApi.ts` | Admin only | **ALIGNED** | — | None |
| Admin Tenant Owner Creation | Create tenant owner inline on tenant create form | Implemented in tenant creation modal in `Tenants.tsx` | `tenantAdminApi.createTenant` | Admin only | **ALIGNED** | — | None |
| Admin Users/RBAC | Global user management page | **No `/users` page in admin routes** | — | — | **MISSING** | No user list/management in admin console | Add admin users page (SHOULD) |
| Admin Devices | Device table with filter | `Devices.tsx` exists | `deviceApi.ts` | Admin only | **ALIGNED** | No hardware_model column (field missing in Device model) | Add hardware_model to Device model |
| Admin Device Assignment | Assign device to tenant from admin | In `TenantDetail.tsx` — tab "Thiết bị" | `tenantAdminApi.assignDevice` | Admin only | **ALIGNED** | — | None |
| Admin Firmware | Upload firmware, list, version management | `Firmware.tsx` exists | `firmwareApi.ts` | Admin only | **ALIGNED** | No promote/quarantine UI | Add promote stage UI (SHOULD) |
| Admin OTA Jobs | Create/view/monitor OTA jobs | `OtaJobs.tsx`, `OtaWizard.tsx` exists | `otaApi.ts` | Admin only | **ALIGNED** | No pause/resume/cancel buttons | Add campaign management (SHOULD) |
| Admin Telemetry | View telemetry across devices | `Telemetry.tsx` exists | `telemetryApi.ts` | Admin only | **ALIGNED** | — | None |
| Admin Alerts/Anomaly | Alert list, anomaly scores | `Alerts.tsx` exists (shows anomaly events as alerts) | `alertApi.ts`, `anomalyApi.ts` | Admin only | **MOSTLY ALIGNED** | No dedicated alerts table backend; uses anomaly_events | Acceptable for MVP |
| Admin Audit Logs | `/audit-logs` page with filter | **NOT IMPLEMENTED** — no route in `App.tsx`, no page | — | — | **MISSING (P0)** | Entire page missing | Implement immediately (MUST) |
| Admin System Health | System health, Prometheus/Grafana links | `System.tsx` exists | `systemApi.ts` | Admin only | **ALIGNED** | — | None |
| Admin Settings | Platform config | `Settings.tsx` exists | — | Admin only | **ALIGNED** | — | None |
| Admin Service Plans | Manage feature flags / plans | `ServicePlans.tsx` exists | `tenantAdminApi.ts` | Admin only | **ALIGNED** | — | None |
| Admin Feature Control | Per-tenant feature overrides | `FeatureControl.tsx` exists | `tenantAdminApi.ts` | Admin only | **ALIGNED** | — | None |
| Tenant Dashboard | Devices, OTA status, alerts | `ClientDashboard.tsx` exists | `clientApi.ts` | Tenant roles | **ALIGNED** | — | None |
| Tenant My Devices | List own devices, device detail | `ClientDevices.tsx`, `ClientDeviceDetail.tsx` exists | `clientApi.ts` | Tenant roles | **ALIGNED** | — | None |
| Tenant Device Groups | Group management | **No client device groups route** | — | — | **MISSING** | No device group page | Add (SHOULD/M1) |
| Tenant Firmware Upload | Upload .bin, list firmware | In `ClientOta.tsx` (combined with OTA) | `clientApi.ts:uploadFirmware` | tenant_owner, tenant_manager | **MOSTLY ALIGNED** | E2E test skip: upload button not found in Playwright | Fix UI selector |
| Tenant OTA Campaigns | Create OTA, monitor progress | `ClientOta.tsx` exists | `clientApi.ts` | tenant_owner, tenant_manager | **ALIGNED** | No cancel campaign button | Add cancel (SHOULD) |
| Tenant OTA Progress | Real-time progress tracking | OTA status shown in `ClientOta.tsx` (polling) | `clientApi.ts:listOtaJobs` | Tenant roles | **ALIGNED** | No per-job progress %; only status | Add progress_pct to OtaJob |
| Tenant Alerts | Tenant alerts/anomaly | `ClientAlerts.tsx` exists | `clientApi.ts:getAlerts` | Tenant roles | **ALIGNED** | — | None |
| Tenant Team/Users | Manage team members | `ClientUsers.tsx` exists | `clientApi.ts` | tenant_owner only | **ALIGNED** | — | None |
| Tenant AI/Anomaly | Optional: TinyML/anomaly results | `ClientAI.tsx` exists (feature-gated) | `clientApi.ts:getAiEvents` | tenant roles, feature-gated | **ALIGNED** | Anomaly model not loaded without training | Train model or note as demo setup |
| Tenant Billing/Plan | View plan details | `ClientBilling.tsx` exists | `clientApi.ts:getPlan` | tenant roles, feature-gated | **ALIGNED** | Billing = feature flag only (no payment) | Expected per docs |
| Tenant Device Onboarding | Self-service device registration | `ClientDeviceOnboarding.tsx` exists | `clientApi.ts:registerDevice`, `getMqttConfig` | Tenant roles | **ALIGNED** | — | None |
| Viewer role write protection | Viewer cannot see write buttons | Viewer role is `tenant_viewer` in code; no UI enforcement found | **PARTIAL** | `frontend/src/contexts/FeatureContext.tsx` | P1 | Add viewer-specific write button suppression |

---

## F. Security and Tenant Isolation Audit

### F1. Admin Route Protection

| Route | Dependency | Admin-only enforced? | Finding | Severity |
|---|---|---|---|---|
| `GET /api/v1/devices` | `Depends(require_admin)` | Yes | Tenant calling returns 403 (verified by test_03) | PASS |
| `POST /api/v1/devices` | `Depends(require_admin)` | Yes | Admin only | PASS |
| `GET /api/v1/telemetry` | `Depends(require_admin)` | Yes | Tenant calling returns 403 | PASS |
| `GET /api/v1/firmware` | `Depends(require_admin)` | Yes | Tenant calling returns 403 | PASS |
| `GET /api/v1/ota/jobs` | `Depends(require_admin)` | Yes | Tenant calling returns 403 | PASS |
| `GET /api/v1/anomaly/...` | `Depends(require_admin)` | Yes | Tenant blocked | PASS |
| `POST /api/v1/admin/tenants` | Router-level `dependencies=[Depends(require_admin)]` | Yes | All admin/* routes protected at router level | PASS |

**Finding**: All admin-only routes are properly protected. No bypass found.

### F2. Tenant Isolation via JWT→DB (NOT request body)

**File**: `backend/app/core/tenant.py:get_current_tenant_user`

The function correctly:
1. Calls `get_current_user()` which decodes JWT and loads user from DB.
2. Checks `current_user.tenant_id is None` — rejects platform admins.
3. Returns the `User` object whose `tenant_id` came from DB, not request.

**Finding**: `tenant_id` is resolved server-side from JWT sub → DB user. The request body cannot inject a different `tenant_id`. **PASS**.

### F3. Cross-Tenant Device Access

**File**: `backend/app/modules/tenants/router_client.py:client_get_device` (line 140-146)

```python
device = repository.get_tenant_device(db, current_user.tenant_id, device_uid)
if device is None:
    raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Device not found")
```

`get_tenant_device` performs a JOIN against `tenant_device_mappings` to ensure the device belongs to the current user's tenant. Returns 404 (not 403) — correct per security spec (do not reveal resource existence).

**Finding**: Cross-tenant device access correctly blocked. Test_03 verifies Tenant1 cannot access Tenant2 device. **PASS**.

### F4. Device Assignment to Multiple Tenants

**Finding from FULL_TEST_REPORT.md**: A critical bug was found and fixed. `assign_device()` now checks if a device is already assigned to a different tenant before creating a mapping. **Fixed — PASS**.

### F5. JWT Token Content

**File**: `backend/app/modules/auth/service.py:create_access_token`

```python
payload: dict = {"sub": subject, "exp": expire}
if role:
    payload["role"] = role
```

**Finding**: JWT contains `sub` (user_id), `role`, `exp`. It does NOT contain `tenant_id`. The documentation says "JWT chứa role + tenant_id (nếu là tenant user)". This is a documentation contract mismatch (FR-AUTH-002). The backend correctly resolves `tenant_id` from DB on each request — this is actually the secure pattern. However, it creates a mismatch with the documented JWT payload spec.

**Severity**: P2 (security behavior is correct; documentation claim is technically wrong about JWT content).

### F6. Debug Endpoint Exposure

**File**: `backend/app/modules/debug/router.py`

The debug endpoint `POST /api/v1/debug/log` accepts log data from frontend. It:
- Is disabled in production (`app_env == "production"`)
- Masks sensitive fields (`password`, `token`, `access_token`, etc.)
- Is excluded from OpenAPI schema (`include_in_schema=False`)
- Is excluded from HTTP access log (`_SKIP_PATHS`)

**Finding**: Debug endpoint has reasonable protections. However it's accessible to anyone (no auth required) in non-production environments. An unauthenticated caller could send arbitrary log data to the server console.

**Severity**: P3 (low impact in dev; disable in staging if using public URL).

### F7. Default JWT Secret

**File**: `backend/app/core/config.py:41`

```python
jwt_secret: str = "changeme-replace-with-a-long-random-secret"
```

**Finding**: Hardcoded default JWT secret. If `.env` is not configured, this default is used. A proper `.env.example` should prompt this. This is a known risk flagged in NFR-SEC-001.

**Severity**: P1 (demo risk if `.env` not configured with real secret).

### F8. Firmware Download Auth

**File**: `backend/app/modules/firmware/router.py:download_firmware`

The download endpoint `GET /api/v1/firmware/{firmware_id}/download` has **no authentication dependency**. Any unauthenticated user can download firmware if they know the UUID.

**Finding**: Firmware binary downloads are unauthenticated. This is likely intentional to allow ESP32 devices to download firmware without complex auth, but it should be documented as a known security trade-off.

**Severity**: P2 (acceptable for demo; document as known limitation).

### Summary Security Table

| Issue | Classification | Status |
|---|---|---|
| Admin route protection | P0 | PASS — all admin routes require admin role |
| Tenant isolation via JWT→DB | P0 | PASS — no request-body tenant_id trust |
| Cross-tenant device access | P0 | PASS — 404 returned, verified by tests |
| Multi-tenant device assignment bug | P0 | FIXED — cross-tenant check added |
| JWT does not embed tenant_id | P2 | Minor doc mismatch; behavior is correct |
| Debug endpoint unauthenticated | P3 | Acceptable in dev; review for staging |
| Default JWT secret hardcoded | P1 | Requires .env configuration |
| Firmware download unauthenticated | P2 | Known trade-off; document it |
| Audit logs missing | P0 | NOT IMPLEMENTED — MUST requirement |

---

## G. TinyML / Intelligence Profile Alignment

| Aspect | Finding | Classification |
|---|---|---|
| `model_profile` or `intelligence_profile` concept in code | No `IntelligenceProfile` ORM model exists. Only `AnomalyEvent` stores results. | Documentation Only (for the profile concept) |
| TinyML hardcoded to one fixed anomaly model | Yes — `anomaly/service.py` uses a single IsolationForest joblib artifact. No per-device-type routing. | Partially Implemented |
| Anomaly results tied to device/tenant | Results in `anomaly_events` tied to `device_id`. Tenant isolation via device ownership check. | Implemented |
| `model_version` stored | Yes — `AnomalyEvent.model_version` field exists and is populated from the loaded model's version. | Implemented |
| Frontend displaying mock anomaly data | `ClientAI.tsx` and `Alerts.tsx` call real APIs. When model is not loaded, API returns 503 or empty list. Not mocked. | Implemented (real API, no mock) |
| TinyML only documented or also implemented | Server-side IsolationForest is implemented. On-device TFLite Micro is NOT implemented. | Partially Implemented (server-side only) |
| Implementation type | Rule-based: No. Actual TFLite Micro: No. Server-side IsolationForest scikit-learn: Yes (when model file present). | Server-side ML — not TinyML |
| Intelligence profile per device type | No device-type-aware profile routing. Single model applied to all devices. | Not Implemented |
| Model training pipeline | `ml/training/train_anomaly_model.py` presumed to exist (referenced in API 503 message), but not in the files list read. | Exists outside audit scope |

**Overall TinyML classification**: **Partially Implemented (server-side mock/demo level)**. The implementation is a single server-side IsolationForest that requires the model file to be trained and placed at `/workspace/ai/models/anomaly_model.joblib`. On-device TFLite Micro inference is future work. This is acceptable per scope (M1/SHOULD) but should be clearly communicated in thesis.

---

## H. Test Coverage Audit

### Test Files Found

| Test File | Coverage | Runnable? | Notes |
|---|---|---|---|
| `tester/api/test_00_health_ready.py` | Health and ready endpoints | Yes | 2 tests |
| `tester/api/test_01_auth.py` | Login, JWT, me endpoint, role check | Yes | 8 tests |
| `tester/api/test_02_admin_tenants.py` | Full admin tenant management flow | Yes | 9 tests |
| `tester/api/test_03_tenant_isolation.py` | Cross-tenant access prevention | Yes | 6 tests; requires 2 tenants with devices |
| `tester/api/test_04_devices.py` | Device CRUD, register, MQTT config | Yes (implied) | Verified in report |
| `tester/api/test_05_firmware.py` | Firmware upload, download, SHA256 | Yes | Covers tenant and admin paths |
| `tester/api/test_06_ota.py` | OTA job create, list, invalid device | Yes | Tenant scoping verified |
| `tester/api/test_07_telemetry.py` | Telemetry CRUD and tenant scoping | Yes | Includes cross-tenant test |
| `tester/api/test_08_alerts_anomaly.py` | Anomaly model info, alerts, AI events | Yes | Model 503 is expected |
| `tester/mqtt/test_mqtt_connection.py` | MQTT broker reachability | Yes | Basic connectivity |
| `tester/mqtt/test_ota_mqtt_publish.py` | OTA MQTT publish payload verification | Yes | Verifies correct payload format |
| `tester/e2e/tests/admin_flow.spec.ts` | Admin login, navigation, tenant pages | Yes (Playwright) | 8 tests pass |
| `tester/e2e/tests/tenant_flow.spec.ts` | Tenant login, device access, isolation | Yes | 6 tests pass |
| `tester/e2e/tests/ota_flow.spec.ts` | OTA page, job list, firmware upload | Mostly yes | 1 skip: firmware upload button |
| `backend/tests/test_api.py` | Internal backend API tests | Needs verification | Located in backend/ |

### Coverage Gaps

1. **Audit log tests**: No tests for audit log CRUD (FR-AUDIT-001..003) — because the feature is not implemented.
2. **Viewer role write protection test**: No test verifying `tenant_viewer` cannot create OTA/upload firmware.
3. **Firmware ownership scope test**: No test verifying `GET /client/firmware` returns only tenant-owned firmware (currently it returns all).
4. **OTA state machine test**: No test for state transition validation (e.g., `success → downloading` should fail).
5. **Device offline worker test**: No test for background worker marking devices offline after inactivity timeout.
6. **Logout endpoint test**: No test for `POST /api/v1/auth/logout` — endpoint does not exist.

### Test Commands

```bash
# API tests (from tester/)
python -m pytest api/ mqtt/ -v --tb=short

# E2E tests
cd tester/e2e && npx playwright test --reporter=list

# Backend unit tests
cd backend && python -m pytest tests/ -v
```

---

## I. Demo Readiness Checklist

| Demo Step | Status | Evidence / Notes |
|---|---|---|
| Can admin login? | **PASS** | test_01 passes; admin@aifom.local / admin1234 seeded |
| Can tenant login? | **PASS** | test_01 passes; tenant1@aifom.local / tenant1234 |
| Can admin create tenant? | **PASS** | test_02 passes; UI tested in E2E |
| Can admin create tenant owner? | **PASS** | test_02 passes; both API and UI verified |
| Can admin assign device? | **PASS** | test_02 passes; cross-tenant bug fixed |
| Can tenant see only assigned devices? | **PASS** | test_03 passes; 404 on other tenant's device |
| Can tenant upload firmware .bin? | **PASS** | test_05 passes; SHA256 verified |
| Can tenant create OTA campaign? | **PASS** | test_06 passes; job created, MQTT published |
| Can MQTT/simulator receive OTA command? | **PASS** | MQTT test verifies publish; simulator subscribes to correct topic |
| Can device report OTA progress? | **PARTIAL** | MQTT subscriber handles `ota/result` topic; simulator handles OTA flow manually |
| Can admin view OTA progress? | **PASS** | `GET /api/v1/ota/jobs` returns all jobs with status |
| Can tenant view own OTA progress? | **PASS** | `GET /api/v1/client/ota-jobs` returns tenant-scoped jobs |
| Can telemetry be shown? | **PASS** | API tests pass; UI Telemetry page exists |
| Can anomaly/alert result be shown? | **PARTIAL** | Alerts show anomaly_events; anomaly model returns 503 without training — needs model file for demo |
| Are audit logs visible? | **FAIL** | Audit log page does not exist; audit_logs table not implemented |
| Are seed scripts working? | **PASS** | seed_admin.py and seed_tenant_demo.py verified by test run |
| Does run-aifom.bat start correctly? | **PASS** | Port conflict detection + full stack startup implemented |

---

## J. Prioritized Fix Plan

### P0 — Before Demo (Critical Blockers)

1. **Implement audit_logs table and middleware** (FR-AUDIT-001..003)
   - Create `AuditLog` SQLAlchemy model with: `id`, `actor_user_id`, `action`, `resource_type`, `resource_id`, `tenant_id`, `ip_address`, `metadata`, `created_at`
   - Add audit log calls in key endpoints: `create_tenant`, `assign_device`, `upload_firmware`, `create_ota_job`, `login`
   - File: new `backend/app/modules/audit/` module

2. **Add `/admin/audit-logs` API endpoint** (FR-AUDIT-004, FR-UI-010)
   - `GET /api/v1/admin/audit-logs` with filter params: actor, action, tenant_id, date_range
   - File: `backend/app/modules/audit/router.py`

3. **Add Admin Console Audit Log page** (FR-UI-010)
   - New route `/audit-logs` in `App.tsx` under AdminRoute
   - New page `frontend/src/pages/AuditLogs.tsx`

4. **Train and include anomaly model for demo** (demo enabler)
   - Run `ml/training/train_anomaly_model.py` and include the `.joblib` file, or add a fallback demo mode

### P1 — Important but not Demo-Blocking

5. **Align role names** (from `DOCS_ALIGNMENT_UPDATE_REPORT.md` §8)
   - Rename `tenant_manager` → `tenant_engineer` (or `tenant_operator`)
   - Rename `tenant_viewer` → `viewer`
   - Update `TENANT_ROLES` in `backend/app/core/tenant.py` and `frontend/src/contexts/AuthContext.tsx`
   - Update seed scripts and any existing users in DB

6. **Implement Viewer role write protection** (FR-MT-010)
   - Add `require_tenant_owner_or_engineer` dependency to write endpoints
   - Add `viewer_only` UI check in frontend to hide Create/Upload/Cancel buttons

7. **Add `POST /api/v1/auth/logout` endpoint** (FR-AUTH-004)
   - Even if just client-side token invalidation, endpoint should exist per contract

8. **Add missing Device fields** (hardware_model, mac_address, metadata)
   - Add to `Device` ORM model via Alembic migration

9. **Scope `GET /client/firmware` to tenant** (firmware isolation)
   - Add `tenant_id` to `FirmwareVersion` model
   - Filter firmware list by `created_by_tenant_id = current_user.tenant_id`

### P2 — Useful but Not Demo-Blocking

10. **Align MQTT topic naming** — docs use `dev/{uid}/cmd`; code uses `aifom/devices/{uid}/ota/request`. Either update topic scheme or update docs to reflect code.

11. **Add firmware download authentication** — Document as known limitation or add optional device token auth.

12. **Add `progress_pct` and `error_code` to OtaJob** — For better OTA monitoring in UI.

13. **Remove or clearly document `from-source` endpoint** — This is OUT-of-scope per docs but exists in code. Either remove it or add an ADR explaining the decision.

14. **Update JWT contract in docs** — Document that `tenant_id` is NOT in JWT, it is resolved server-side from DB. Update `05_API_CONTRACTS.md` §1b.

### P3 — Polish/Future

15. Add Device Group model and client API (SHOULD/M1)
16. Add DeviceType model for intelligence profile (SHOULD/M1)
17. Add OTA progress events table for fine-grained history
18. Add on-device TFLite Micro firmware integration (SHOULD/M1)
19. Fix Playwright E2E firmware upload test (find correct button selector)
20. Add admin `/users` management page
21. Add OTA rollout/campaign grouping (rollout_id concept)

---

## K. Final Recommendations

### What Should Be Fixed First

1. **Audit Logs (P0)** — This is a MUST requirement with zero implementation. It blocks the thesis demo completeness checklist and is the single largest gap. Estimated effort: 1 day.

2. **Role name alignment (P1)** — The `DOCS_ALIGNMENT_UPDATE_REPORT.md` already flagged this. Simple rename in code; low risk but needed for consistency with all documentation.

3. **Viewer write protection (P1)** — Security requirement NFR-SEC-007 requires 4 roles with distinct permissions. Currently viewer can call write endpoints (not UI-blocked). Low effort.

### What Should NOT Be Built Yet

- **On-device TFLite Micro** — This is SHOULD/M1; the thesis demo does not require it. Server-side IsolationForest is sufficient.
- **OTA rollout campaigns / canary** — SHOULD/M1; the current single-job OTA model is sufficient for demo.
- **Device Type / Intelligence Profile API** — SHOULD/M1; the anomaly detection works without it.
- **Source code upload / arduino-cli compile** — This is explicitly OUT-of-scope per docs. The existing `from-source` endpoint should be removed or disabled unless there is a deliberate decision to include it. An ADR should document this.
- **Delta OTA, mTLS, K3s** — NICE/M2; not for thesis MVP.

### What Docs Should Be Corrected

1. **`05_API_CONTRACTS.md` §1b**: JWT payload description says "JWT chứa role + tenant_id". Code does NOT put `tenant_id` in JWT — it resolves it from DB. This is the secure pattern; correct the documentation.

2. **`05_API_CONTRACTS.md` §1b Client APIs**: The documented client firmware upload path is `/api/v1/client/firmware/upload`; actual route is `/api/v1/client/firmware`. OTA campaigns path in docs is `/api/v1/client/ota-campaigns`; actual is `/api/v1/client/ota-jobs`. These should be aligned (either update docs or rename routes).

3. **`05_API_CONTRACTS.md` Base URLs**: The doc shows separate services (8001/8002/8003/8004/8005). The actual system is a single FastAPI app on port 8000. This is a known design simplification documented in `02_ARCHITECTURE.md` §5 but not reflected in `05_API_CONTRACTS.md`.

4. **`04_DATABASE_SCHEMA.md`**: The `users` table schema in docs uses `disabled_at TIMESTAMPTZ`; code uses `is_active BOOLEAN`. The `firmwares` table in docs uses `target_hardware`; code uses `target_device_type`. The `tenant_device_mapping` in docs has `assigned_at`; code does not. These field-level differences should be reconciled.

5. **MQTT Topic Docs**: `05_API_CONTRACTS.md` uses `dev/{uid}/cmd` and `dev/{uid}/ota/progress`. Code uses `aifom/devices/{uid}/ota/request` and `aifom/devices/{uid}/ota/result`. This is a significant topic naming mismatch between docs and code.

### What Code Needs Implementing

Priority order:
1. `audit_logs` table, model, middleware, API endpoint, admin page
2. Role name alignment (`tenant_manager`→`tenant_engineer`, `tenant_viewer`→`viewer`)
3. Viewer write protection (frontend hide + optional backend check)
4. `POST /api/v1/auth/logout` (even if no-op on backend)
5. `tenant_id` on `FirmwareVersion` for proper firmware isolation

### Is the Project Ready for a Graduation Thesis Demo?

**YES, with one critical fix required.**

The AIFOM MVP core flow is implemented and tested (84/85 tests passing). The multi-tenant device management, firmware upload, OTA MQTT delivery, and telemetry pipeline all work. The system demonstrates the thesis value proposition clearly.

**However**, to be fully defensible in front of the graduation committee:

- **Audit logs (MUST/P0)** must be implemented — this is a listed MUST requirement in `19_REQUIREMENTS_AND_TRACEABILITY.md` §16 MUST checklist. The absence of a MUST requirement in a thesis demo is a committee risk.
- The role name mismatch between docs and code should be fixed to avoid confusion during defense.

With these two fixes, the project meets all M0 MUST requirements and is ready for graduation thesis presentation.

**Estimated remaining work for full M0 compliance**: 2–3 days of focused implementation.

---

## Appendix: Evidence Summary

| File Path | Key Finding |
|---|---|
| `backend/app/modules/auth/model.py:15-18` | Role comments list 5 roles including legacy "viewer"; active roles are `admin`, `tenant_owner`, `tenant_manager`, `tenant_viewer` |
| `backend/app/core/tenant.py:9` | `TENANT_ROLES = {"tenant_owner", "tenant_manager", "tenant_viewer"}` — mismatch with docs |
| `backend/app/modules/auth/service.py:17-22` | JWT does NOT contain `tenant_id` |
| `backend/app/modules/devices/model.py:Device` | Missing hardware_model, mac_address, metadata fields |
| `backend/app/modules/firmware/model.py:FirmwareVersion` | Missing tenant_id; has extra source_type/source_code/board_fqbn columns (out-of-scope) |
| `backend/app/modules/ota/model.py:OtaJob` | Missing progress_pct, error_code, rollout_id fields |
| `backend/app/modules/tenants/router_client.py:282-286` | `client_list_firmware` calls `firmware_repo.list_firmware()` without tenant filter |
| `backend/app/modules/tenants/router_admin.py:33` | `router = APIRouter(dependencies=[Depends(require_admin)])` — all admin routes protected at router level |
| `backend/app/services/mqtt_publisher.py:17` | Topic: `aifom/devices/{device_uid}/ota/request` — differs from docs `dev/{uid}/cmd` |
| `backend/app/services/mqtt_subscriber.py:19-22` | Topics: `aifom/devices/+/telemetry`, `status`, `heartbeat`, `ota/result` — different prefix from docs |
| `backend/app/modules/debug/router.py:38-53` | Debug endpoint has no auth; masked secrets; disabled in production |
| `backend/app/core/config.py:46` | `jwt_secret: str = "changeme-replace-with-a-long-random-secret"` — default insecure |
| `frontend/src/app/App.tsx` | No `/audit-logs` route defined |
| `frontend/src/contexts/AuthContext.tsx:8` | `TENANT_ROLES = ["tenant_owner", "tenant_manager", "tenant_viewer"]` |
| `tester/reports/FULL_TEST_REPORT.md` | 84/85 tests pass; 1 critical isolation bug found and fixed |
| `docs/thesis/aifom_vibe_code_docs/DOCS_ALIGNMENT_UPDATE_REPORT.md:§8` | Known pending tasks including audit_log, role rename, viewer write protection |

---

*Report generated by automated code-documentation alignment audit.*  
*Audit scope: 60+ source files read across backend, frontend, IoT, tester, and docs directories.*
