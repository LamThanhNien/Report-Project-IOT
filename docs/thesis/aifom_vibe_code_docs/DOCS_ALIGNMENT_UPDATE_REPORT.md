> [!NOTE]
> **BÁO CÁO KIỂM THỬ / ĐỐI SOÁT LỊCH SỬ (HISTORICAL AUDIT & VERIFICATION REPORT)**
>
> Báo cáo này ghi nhận kết quả rà soát tại thời điểm phát triển trong quá khứ (tháng 05/2026). Các tham chiếu đến TinyML, bộ simulator, các vai trò kỹ sư (`tenant_engineer`, `platform_engineer`) phản ánh hiện trạng của codebase tại thời điểm lập báo cáo và mang tính chất lưu trữ lịch sử phát triển. Để đối chiếu hiện trạng mới nhất, tham khảo [`docs/scope.md`](../../scope.md) và [`docs/reports/engineer-removal-2026-10-03.md`](../../reports/engineer-removal-2026-10-03.md).

# DOCS ALIGNMENT UPDATE REPORT

**Ngày cập nhật**: 2026-05-21
**Trạng thái**: Completed
**Scope**: Documentation-only — không thay đổi source code

---

## 1. Tóm tắt

Bộ tài liệu AIFOM đã được cập nhật để phản ánh đúng tầm nhìn sản phẩm:

- AIFOM là **nền tảng IoT đa khách hàng hạng nhẹ** (multi-tenant IoT device management platform), không phải "hệ thống TinyML phát hiện bất thường" hay "full MLOps platform".
- TinyML/rule-based intelligence là **khả năng tùy chọn và mở rộng được** per device type, không phải core product.
- OTA firmware binary upload và OTA campaign management là **MVP bắt buộc**.
- Source code auto-build và billing/subscription là **future work/out of scope**.

---

## 2. Files đã cập nhật

| File | Loại thay đổi |
|---|---|
| `README.md` | Viết lại hoàn toàn — mô tả, user roles, MVP demo flow, TinyML positioning, device type concept |
| `docs/scope.md` | Cập nhật §1.3 (mục tiêu không phải), §5.1 (M1-ML → intelligence profile per device type), §9.1 (đóng góp kỹ thuật) |
| `docs/thesis/aifom_vibe_code_docs/00_MASTER_CONTEXT.md` | Cập nhật định vị sản phẩm, roles (thêm tenant_engineer, viewer), device type hierarchy, TinyML repositioning |
| `docs/thesis/aifom_vibe_code_docs/01_PROJECT_CHARTER.md` | Cập nhật user roles (4 roles thay 3), loại bỏ "ML engineer" khỏi target user, thêm Viewer role, TinyML = optional academic highlight |
| `docs/thesis/aifom_vibe_code_docs/02_ARCHITECTURE.md` | Thêm Device Type → Firmware Profile → Intelligence Profile hierarchy; reframe model registry thành optional; thêm 4 role trong RBAC; cập nhật container diagram |
| `docs/thesis/aifom_vibe_code_docs/09_ADMIN_UI_SPEC.md` | Thêm Audit Log page, thêm /users /telemetry /system routes; cập nhật Customer Workspace navigation; thêm Viewer constraints; thêm Device Groups; Intelligence → feature-gated per device type |
| `docs/thesis/aifom_vibe_code_docs/14_TESTING_STRATEGY.md` | Thêm TEST-MT-015 (Viewer write → 403), TEST-MT-016 (audit log); thêm E2E-06 (tenant isolation), E2E-09 (audit log); cập nhật frontend test để kiểm tra Viewer role |
| `docs/thesis/aifom_vibe_code_docs/17_SPRINT_BACKLOG.md` | Cập nhật theo 11 Phase mới; Phase 10 = Optional Edge Intelligence; Phase 11 = Audit + Testing; loại bỏ references đến "full MLOps pipeline" |
| `docs/thesis/aifom_vibe_code_docs/19_REQUIREMENTS_AND_TRACEABILITY.md` | Thêm nhóm FR-AUTH, FR-AUDIT; thêm nhóm FR-INTEL (thay FR-MODEL); cập nhật FR-MT (thêm Viewer role); thêm Security Rule — Tenant Isolation section; cập nhật MUST checklist |
| `docs/thesis/aifom_vibe_code_docs/DOCS_ALIGNMENT_UPDATE_REPORT.md` | File mới — report này |

---

## 3. Thay đổi wording chính

| Wording cũ | Wording mới |
|---|---|
| "một mô hình TinyML phát hiện bất thường" | "optional edge intelligence profile per device type" |
| "AI Fleet & OTA Management + Edge MLOps" | "Lightweight Multi-Tenant IoT Platform" |
| "MLOps Layer" (primary layer) | "Optional Edge Intelligence" (secondary, feature-gated) |
| "ML engineer" (user role) | Academic/thesis role — không phải user type của platform |
| 3 roles: admin, tenant_owner, tenant_operator | 4 roles: admin, tenant_owner, tenant_engineer, viewer |
| "Model Registry" (primary service) | "Intelligence Profile API" (optional, SHOULD) |
| "Source code upload + auto build" (unclassified) | OUT of scope — explicitly marked |
| "Billing/payment" (unclassified) | OUT of scope / Future work |
| TinyML = core product | TinyML = academic highlight, optional, extensible per device type |

---

## 4. Tính năng được làm rõ là MVP

| Tính năng | Trạng thái trước | Trạng thái sau |
|---|---|---|
| Multi-tenant device management | MUST nhưng không rõ | MUST (M0) — explicitly first class |
| Admin Console | MUST | MUST — thêm Audit Logs, Users/RBAC, System Health |
| Customer Workspace | MUST | MUST — Tenant Owner + Engineer + Viewer roles |
| Device registry + assignment | MUST | MUST |
| Firmware binary upload (.bin compiled) | MUST | MUST — rõ ràng là chỉ binary, không build from source |
| OTA campaign management | MUST | MUST |
| MQTT-based OTA delivery | MUST | MUST |
| OTA progress tracking | MUST | MUST |
| Audit log | Không đề cập | MUST (M0) — thêm mới |
| Telemetry monitoring | MUST | MUST |
| 4 user roles | 3 roles | MUST — thêm Viewer và Tenant Engineer |

---

## 5. Tính năng được chuyển sang Future Work / Out of Scope

| Tính năng | Trạng thái trước | Trạng thái sau |
|---|---|---|
| Source code upload → auto build firmware | Unclassified/OUT | **OUT** — explicitly marked, require sandboxing |
| Full MLOps platform (auto-training, drift, CI/CD cho model) | "M2/SHOULD" | **Future work** — FR-INTEL-008 marked OUT |
| Billing/subscription | OUT nhưng không rõ | **Future work/OUT** — service plan chỉ là feature flag |
| Closed-loop retrain | M2/NICE | **Future work** — FR-INTEL-007 NICE |
| Advanced drift detection | M2/NICE | **Future work** — FR-INTEL-006 NICE |
| Mobile app | OUT | **OUT** |
| MLflow full pipeline | M2/NICE | **Optional (M2)** — không bắt buộc, không phải M1 |

---

## 6. Thay đổi TinyML positioning

| Aspect | Trước | Sau |
|---|---|---|
| Vị trí trong hệ thống | Central pillar ("Edge MLOps") | Optional extension layer |
| Phạm vi áp dụng | "Toàn bộ fleet" | Per device type — có thể null |
| Trong MVP | Required (M0) | SHOULD (M1) — academic highlight |
| Model scope | 1 model cho tất cả | Multiple profiles, each device type can differ |
| Wording | "TinyML anomaly detection system" | "Optional Edge Intelligence — rule-based or TinyML per device type" |
| Nếu bỏ | Hệ thống thiếu trục chính | Hệ thống vẫn hoàn chỉnh (multi-tenant OTA là core) |

---

## 7. Documentation-code mismatch phát hiện

| Mismatch | Mô tả | Hành động |
|---|---|---|
| `02_ARCHITECTURE.md` có "health-scorer" và "realtime-gateway" là required services | Trong code thực tế chỉ có 1 FastAPI app | Doc đã cập nhật: 2 services này là optional (M1/SHOULD) |
| `19_REQUIREMENTS.md` không có FR-AUTH group riêng | Auth requirements nằm rải rác | Đã thêm FR-AUTH-001..005 |
| `09_ADMIN_UI_SPEC.md` thiếu Audit Log page | Feature đã được yêu cầu nhưng chưa spec | Đã thêm `/audit-logs` route và spec |
| Roles: "tenant_operator" trong code nhưng "tenant_engineer" trong yêu cầu | Cần align | Doc đã dùng cả hai: tenant_engineer (create permission) + viewer (read-only). Code cần cập nhật role names |
| `FR-MODEL-*` (model registry) là SHOULD nhưng được đề cập rất prominent | Gây hiểu nhầm rằng MLOps là core | Đã đổi sang `FR-INTEL-*` và rõ ràng là SHOULD academic highlight |

---

## 8. Recommended next code tasks

Dựa trên documentation update, các task code cần thực hiện tiếp:

| Priority | Task | Lý do |
|---|---|---|
| MUST | Thêm `audit_logs` table và middleware | FR-AUDIT-001..003 là MUST nhưng chưa implement |
| MUST | Cập nhật role từ `tenant_operator` → `tenant_engineer` + thêm `viewer` role | Align với updated docs |
| MUST | Admin UI: thêm `/audit-logs` page | FR-UI-010 |
| MUST | Customer Workspace: implement Viewer role — ẩn upload/create buttons | FR-MT-010, NFR-SEC-007 |
| SHOULD | Thêm Device Type model và Intelligence Profile table | FR-INTEL-001..002 (SHOULD) |
| SHOULD | Admin UI: thêm `/users` page với RBAC management | FR-UI-009 mở rộng |
| SHOULD | Customer Workspace: thêm `/client/device-groups` | Architecture requirement |
| SHOULD | Cập nhật OTA state machine để bao gồm "sent" state | FR-FW-006 updated states |
| NICE | Intelligence Profile API | FR-INTEL-001..004 (SHOULD) |

---

## 9. Consistency check kết quả

Kiểm tra tất cả tài liệu đã cập nhật đều nhất quán với các điểm sau:

| Điểm kiểm tra | Kết quả |
|---|---|
| AIFOM là multi-tenant IoT device management và OTA platform | ✅ Tất cả files |
| TinyML là optional và extensible per device type/use case | ✅ Tất cả files |
| MVP demo chỉ one sample intelligence use case | ✅ 00, 01, 02, scope.md, 19 |
| Admin và Tenant Workspace là cả hai phần của platform | ✅ Tất cả files |
| Tenant isolation là mandatory | ✅ 02, 19 (Security Rule section) |
| OTA firmware binary upload là MVP | ✅ Tất cả files |
| Source-code upload và auto build là future work, không phải MVP | ✅ 01, 02, scope.md, 09, 19 |
| 4 user roles: admin, tenant_owner, tenant_engineer, viewer | ✅ 00, 01, 02, 09, 19 |
| Audit log là MUST | ✅ 09, 14, 17, 19 |
