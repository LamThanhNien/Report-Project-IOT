# Sprint Plan — 2026-05-27

**Date**: 2026-05-27
**Sprint**: 15
**Phase**: 13 (Audit Log completion) + 15 (Device Type + Intelligence Profile)
**Duration**: 2 weeks

---

## Current State (verified by codebase survey 2026-05-27)

### Phases 1-12: COMPLETE
- M0 multi-tenant core (FR-MT-001..009) done
- All four roles wired: admin, tenant_owner, tenant_engineer, viewer
- OTA state machine includes sent state (Phase 16 DONE)
- tenant_operator to tenant_engineer rename already done (Phase 14 partial DONE)

### Phase 13 (Audit Log): 80% COMPLETE
- AuditLog model exists (backend/app/modules/audit/model.py)
- GET /api/v1/admin/audit-logs API exists (backend/app/modules/audit/router.py)
- Admin UI page exists at /admin/audit-logs (frontend/src/pages/admin/AuditLogs.tsx)
- MISSING: Auto-logging middleware that records admin/tenant/auth actions (FR-AUDIT-001..003)
- MISSING: DB migration for audit_logs table (no Alembic infrastructure in repo)
- MISSING: Filter UI polish + CSV export (FR-AUDIT-004..005 SHOULD)

### Phase 14 (Viewer + Tenant Engineer): COMPLETE
- viewer role defined in auth model with require_tenant_write() guard
- TENANT_ROLES enforced with all three tenant roles
- Schema validates against all four roles
- VERIFY: Frontend Customer Workspace hides write buttons for viewer role

### Phase 15 (Device Type + Intelligence Profile): 0% NOT STARTED
- No device_type table/model (only free-text target_device_type on firmware)
- No intelligence_profile table/model/API
- These are SHOULD (M1) items academic highlight for thesis

### Phase 16 (OTA sent state): COMPLETE
- JOB_STATUS_SENT = sent in ota/model.py
- Full state machine: pending -> sent -> accepted -> downloading -> flashing -> rebooting -> success | failed

### Phase 17 (Thesis docs polish): NOT STARTED

---

## Sprint Goals

1. Close Phase 13 Wire audit log middleware so admin/tenant/auth actions are auto-logged (FR-AUDIT-001, FR-AUDIT-002, FR-AUDIT-003)
2. Start Phase 15 Create device_type table + model, and intelligence_profile table + CRUD API (FR-INTEL-001, FR-INTEL-002)
3. Verify Phase 14 QA check that viewer role is properly enforced in Customer Workspace UI
4. Docs sync Update schema and API docs for audit_logs, device_types, intelligence_profiles

---

## Task Breakdown

| # | Task | Agent | Priority | Dependencies | Scope |
|---|------|-------|----------|-------------|-------|
| 1 | Audit log auto-logging middleware | aifom-backend | P1 | None | Phase 13 |
| 2 | DB migration infrastructure (Alembic) | aifom-backend | P1 | None | Phase 13 |
| 3 | Audit log API tests | aifom-backend | P1 | Task 1 | Phase 13 |
| 4 | Audit log filter UI polish | aifom-frontend | P2 | Task 1 | Phase 13 |
| 5 | Audit log CSV export | aifom-backend + frontend | P2 | Task 1 | Phase 13 |
| 6 | Device Type model + CRUD API | aifom-backend | P1 | Task 2 | Phase 15 |
| 7 | Intelligence Profile model + CRUD API | aifom-backend | P1 | Task 6 | Phase 15 |
| 8 | Device Type admin UI | aifom-frontend | P2 | Task 6 | Phase 15 |
| 9 | Intelligence Profile admin UI | aifom-frontend | P2 | Task 7 | Phase 15 |
| 10 | QA review | aifom-qa | P1 | Tasks 1-7 | QA gate |
| 11 | Docs sync schema | aifom-docs | P2 | Tasks 2,6,7 | Docs |
| 12 | Docs sync API contracts | aifom-docs | P2 | Tasks 6,7 | Docs |
| 13 | Update AGENT_BOARD.md | aifom-coordinator | P2 | Task 10 | Board |

---

## Execution Order (DAG)

Phase A Backend Foundation (parallel):
  Task 2 (Alembic) -> Task 6 (device_type) -> Task 7 (intelligence_profile)
  Task 1 (audit middleware) -> Task 3 (audit tests)

Phase B Frontend (after backend APIs):
  Task 1 -> Task 4 (audit filter UI)
  Task 1 -> Task 5 (CSV export)
  Task 6 -> Task 8 (device type UI)
  Task 7 -> Task 9 (intelligence profile UI)

Phase C QA Gate: Tasks 1-7 -> Task 10

Phase D Docs + Board: Tasks 2,6,7 -> Task 11; Tasks 6,7 -> Task 12; Task 10 -> Task 13

Critical path: Task 2 -> Task 6 -> Task 7 -> Task 10

---

## Done Criteria

- Audit log middleware auto-logs admin/tenant/auth actions
- audit_logs table created via migration
- Audit middleware has >= 3 unit tests
- device_types table exists with CRUD API
- intelligence_profiles table exists with CRUD API
- Intelligence profile can be assigned to device type via API
- All existing tests still pass
- New backend tests cover new APIs
- Lint passes
- No secrets committed
- QA report at docs/agent-runs/qa-report-2026-05-27.md

---

## Priority Reminder

IoT + OTA first. TinyML second. K3s/mTLS last.
Phase 13 MUST items (FR-AUDIT-001..003) are the top priority this sprint.
Phase 15 items are SHOULD but needed for thesis depth.
Phase 14 and 16 are verified complete.
