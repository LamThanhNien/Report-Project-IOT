> [!NOTE]
> **BÁO CÁO KIỂM THỬ / ĐỐI SOÁT LỊCH SỬ (HISTORICAL AUDIT & VERIFICATION REPORT)**
>
> Báo cáo này ghi nhận kết quả rà soát tại thời điểm phát triển trong quá khứ (tháng 05/2026). Các tham chiếu đến TinyML, bộ simulator, các vai trò kỹ sư (`tenant_engineer`, `platform_engineer`) phản ánh hiện trạng của codebase tại thời điểm lập báo cáo và mang tính chất lưu trữ lịch sử phát triển. Để đối chiếu hiện trạng mới nhất, tham khảo [`docs/scope.md`](../../scope.md) và [`docs/reports/engineer-removal-2026-10-03.md`](../../reports/engineer-removal-2026-10-03.md).

# P0/P1 Fix Validation Report

**Date:** 2026-05-21  
**Branch:** main  
**Author:** LamThanhNien  
**Status:** All P0/P1 issues resolved ✓

---

## Summary

This report documents the validation of all P0 (critical) and P1 (high-priority) fixes applied to the AIFOM platform following the initial CODE_DOCS_ALIGNMENT_AUDIT. Seven fixes were implemented across the backend and frontend, plus one additional P0 bug discovered during validation testing.

---

## A. Database / Migration Validation

| Migration | Status | Notes |
|-----------|--------|-------|
| `uploaded_by_tenant_id` column on `firmware_versions` | ✓ Added | Idempotent `DO $$ ... IF NOT EXISTS $$` in `main.py:lifespan` |
| FK index `ix_firmware_versions_uploaded_by_tenant_id` | ✓ Added | Created alongside column |
| `hardware_model`, `mac_address`, `description` on `devices` | ✓ Added | Same idempotent pattern |
| `audit_logs` table | ✓ Created | Via `Base.metadata.create_all` with `_audit_model` imported in `main.py` |

All migrations run at startup via `main.py` lifespan. Execution is idempotent — safe to restart without schema duplication.

---

## B. Tenant Firmware Isolation

### Backend (`firmware/repository.py : list_firmware`)

```python
if tenant_id is not None:
    stmt = stmt.where(
        or_(
            FirmwareVersion.uploaded_by_tenant_id == tenant_id,
            FirmwareVersion.uploaded_by_tenant_id.is_(None),   # admin-global
        )
    )
```

- **`GET /api/v1/client/firmware`** — passes `tenant_id=current_user.tenant_id`; tenants see only own + admin-global firmware.
- Admin route `GET /api/v1/firmware` — no `tenant_id` filter; returns all firmware as expected.

**Result: ✓ Implemented and syntactically verified.**

---

## C. OTA Firmware Ownership Validation (P0 Bug — Fixed in This Session)

### Previous gap

`client_create_ota_job` validated device ownership but not firmware ownership.  
A tenant could provide any firmware UUID (including another tenant's firmware) in the OTA request body.

### Fix applied (`router_client.py` lines 521–529)

```python
# Firmware must belong to this tenant OR be admin-global (uploaded_by_tenant_id IS NULL)
if (
    firmware.uploaded_by_tenant_id is not None
    and firmware.uploaded_by_tenant_id != current_user.tenant_id
):
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Firmware not accessible to your tenant",
    )
```

**Result: ✓ Fixed. Cross-tenant firmware usage in OTA jobs now returns HTTP 403.**

---

## D. Viewer Role Write Protection

### Backend (`core/tenant.py`)

```python
def require_tenant_write(current_user: User = Depends(get_current_tenant_user)) -> User:
    if current_user.role == "viewer":
        raise HTTPException(status_code=403, detail="Viewer role cannot perform write operations")
    return current_user
```

### Endpoints protected (changed from `require_tenant_owner`/`get_current_tenant_user` to `require_tenant_write`)

| Endpoint | File | Line approx |
|----------|------|-------------|
| `POST /client/devices` | `router_client.py` | ~310 |
| `DELETE /client/devices/{uid}` | `router_client.py` | ~340 |
| `POST /client/firmware` | `router_client.py` | ~390 |
| `POST /client/firmware/from-source` | `router_client.py` | ~440 |
| `POST /client/ota-jobs` | `router_client.py` | ~507 |

### Frontend

- `ClientDevices.tsx`: write buttons hidden when `user.role === "viewer"`
- `ClientOta.tsx`: "Upload firmware" and "Create OTA" buttons hidden for viewer role

**Result: ✓ Implemented. Backend enforces 403; frontend hides write UI.**

---

## E. Audit Log Validation

### Module structure

```
backend/app/modules/audit/
├── __init__.py       (empty, makes it a package)
├── model.py          (AuditLog ORM model → audit_logs table)
├── service.py        (log_event() — best-effort, never raises)
└── router.py         (GET /api/v1/admin/audit-logs — admin-only)
```

### AuditLog schema

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | auto-generated |
| `tenant_id` | UUID FK nullable | SET NULL on tenant delete |
| `user_id` | UUID FK nullable | SET NULL on user delete |
| `action` | VARCHAR(64) | indexed |
| `resource_type` | VARCHAR(64) nullable | |
| `resource_id` | VARCHAR(64) nullable | |
| `detail` | JSONB nullable | extra context |
| `created_at` | TIMESTAMPTZ | indexed |

### Events instrumented

| Action | Trigger |
|--------|---------|
| `login` | Successful login (`POST /auth/login`) |
| `create_tenant` | Admin creates a tenant |
| `assign_device` | Admin assigns device to tenant |
| `upload_firmware` | Tenant uploads firmware file |
| `upload_firmware_from_source` | Tenant uploads source-compiled firmware |
| `create_ota_job` | Tenant creates OTA job |

### Admin API

`GET /api/v1/admin/audit-logs` — filter by `action`, `tenant_id`, `limit`, `offset`.  
Protected by `require_admin` dependency.

### Frontend admin page

`/admin/audit-logs` — table with action badge, resource, tenant_id (truncated), timestamp, detail summary.  
Accessible via sidebar "Audit Logs" (ShieldCheck icon).

**Result: ✓ Implemented. Best-effort design ensures audit failures never break main flow.**

---

## F. Role Name Alignment

**Before:** `tenant_manager`, `tenant_viewer`  
**After:** `tenant_engineer`, `viewer`

### Backend changes

| File | Change |
|------|--------|
| `core/tenant.py` | `TENANT_ROLES = {"tenant_owner", "tenant_engineer", "viewer"}` |
| `tenants/schema.py` | `TenantUserCreate` validator: allowed = `{"tenant_owner", "tenant_engineer", "viewer"}` |

### Frontend changes

| File | Change |
|------|--------|
| `AuthContext.tsx` | `TENANT_ROLES = ["tenant_owner", "tenant_engineer", "viewer"]` |
| `FeatureContext.tsx` | `TENANT_ROLES = ["tenant_owner", "tenant_engineer", "viewer"]` |
| `ClientUsers.tsx` | `ROLE_OPTIONS` updated; default "viewer" |
| `ClientOta.tsx` | `isViewer = user?.role === "viewer"` |
| `ClientDevices.tsx` | `isViewer = user?.role === "viewer"` |
| `TenantDetail.tsx` | `ROLE_OPTIONS` and defaults updated |
| `ClientTopbar.tsx` | `roleLabel` map updated |
| `Login.tsx` | `tenantRoles` array updated |

**Result: ✓ All references to legacy role names removed. Grep confirmed zero remaining occurrences of `tenant_manager` or `tenant_viewer` in `/frontend/src/`.**

---

## G. JWT / Tenant-ID Documentation Fix

`docs/thesis/aifom_vibe_code_docs/05_API_CONTRACTS.md` updated:

- JWT payload contains only `sub` (user_id) and `role` — **no `tenant_id`**
- Server resolves `tenant_id` from DB via `users.tenant_id` column
- Added note: "tenant_id is NEVER accepted from request body — always server-side resolved"

**Result: ✓ Docs align with implementation.**

---

## H. Logout Endpoint

`POST /api/v1/auth/logout` added (`auth/router.py`).

- Stateless (JWT-based; server-side invalidation not required)
- Returns `{"detail": "logged out"}` with HTTP 200
- Authenticated endpoint — requires valid Bearer token (documents the intent)

**Result: ✓ Endpoint exists and matches documentation.**

---

## I. Missing Device Fields

Added to `devices/model.py`, `devices/schema.py`, `types/index.ts`:

| Field | Type | Backend | Frontend |
|-------|------|---------|----------|
| `hardware_model` | `str \| null` | `nullable=True` | `string \| null` (optional `?`) |
| `mac_address` | `str \| null` | `nullable=True` | `string \| null` (optional `?`) |
| `description` | `str \| null` | `nullable=True` | `string \| null` (optional `?`) |

TypeScript types made optional (`?`) to match nullable backend schema and avoid breaking existing test fixtures.

**Result: ✓ Fields added. TypeScript `Device` type build error fixed.**

---

## J. Frontend Build Validation

```
> aifom-web-admin@0.1.0 build
> tsc && vite build

✓ 2596 modules transformed.
dist/index.html                  0.40 kB │ gzip:   0.27 kB
dist/assets/index-BoluNrp0.css  50.92 kB │ gzip:   8.47 kB
dist/assets/index-Dh5CLMAW.js  878.22 kB │ gzip: 248.40 kB
✓ built in 5.62s
```

TypeScript compiled with zero errors. Build artifact produced successfully.

**Result: ✓ Frontend builds cleanly.**

---

## K. Backend Syntax Validation

All modified Python files parsed by `ast.parse` without errors:

| File | Result |
|------|--------|
| `audit/__init__.py` | ✓ OK |
| `audit/model.py` | ✓ OK |
| `audit/service.py` | ✓ OK |
| `audit/router.py` | ✓ OK |
| `tenants/router_client.py` | ✓ OK |
| `core/tenant.py` | ✓ OK |
| `firmware/model.py` | ✓ OK |
| `firmware/repository.py` | ✓ OK |
| `devices/model.py` | ✓ OK |
| `auth/router.py` | ✓ OK |
| `main.py` | ✓ OK |

**Result: ✓ No syntax errors in backend.**

---

## L. New Tests Added

### `tester/api/test_03_tenant_isolation.py` — Firmware Isolation

| Test | Validates |
|------|-----------|
| `test_tenant2_firmware_not_visible_to_tenant1` | Tenant2's firmware does not appear in Tenant1's list |
| `test_tenant1_cannot_create_ota_with_tenant2_firmware` | POST `/client/ota-jobs` with Tenant2 firmware → HTTP 403 |

### `tester/api/test_07_viewer_protection.py` — Viewer Write Protection

| Test | Expected |
|------|----------|
| `test_viewer_cannot_register_device` | POST `/client/devices` → 403 |
| `test_viewer_cannot_unassign_device` | DELETE `/client/devices/uid` → 403 |
| `test_viewer_cannot_upload_firmware` | POST `/client/firmware` → 403 |
| `test_viewer_cannot_create_ota_job` | POST `/client/ota-jobs` → 403 |
| `test_viewer_can_read_devices` | GET `/client/devices` → 200 (reads allowed) |
| `test_viewer_can_list_firmware` | GET `/client/firmware` → 200 (reads allowed) |

The viewer test fixture creates a temporary viewer user via Tenant1's owner credentials, runs all assertions, then deletes the user (idempotent / no state pollution).

**Note:** Integration tests require Docker services to be running. Run with:
```
cd tester && python -m pytest api/test_03_tenant_isolation.py api/test_07_viewer_protection.py -v
```

---

## M. Issues Remaining / Out of Scope

| Issue | Status |
|-------|--------|
| Audit log `actor_email`/`actor_role` not stored (only `user_id`) | Acceptable — user_id is a stable FK; email/role can be joined. No change needed. |
| Frontend chunk size warning (878 KB) | Pre-existing; not introduced by these fixes. |
| Backend integration tests (pytest) | Cannot run without Docker stack. Syntax validated instead. |

---

## Conclusion

All 7 original P0/P1 issues from the alignment audit are fixed. One additional P0 security bug (cross-tenant firmware in OTA jobs) discovered during validation was also fixed. Frontend builds cleanly. All modified backend files are syntactically correct. New integration tests covering the two most critical security invariants (firmware isolation, viewer write protection) have been added.
