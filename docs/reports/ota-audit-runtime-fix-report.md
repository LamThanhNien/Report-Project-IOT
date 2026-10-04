# Báo cáo sửa lỗi runtime OTA/Audit

Ngày: 2026-05-30

## Nguyên nhân gốc

- Migration `0005_database_improvements.py` tham chiếu sai cột `firmware_versions.tenant_id`. Schema thật dùng `firmware_versions.uploaded_by_tenant_id`, nên Alembic có thể fail trước khi thêm `audit_logs.ip_address` và `ota_jobs.tenant_id`.
- Khi migration fail nhưng API vẫn đánh dấu `/ready`, frontend tiếp tục gọi các endpoint đọc `OtaJob.tenant_id` và `AuditLog.ip_address`, gây lỗi 500 nếu DB còn schema cũ.
- OTA job mới chưa điền `tenant_id`; tenant API vẫn lọc theo device mapping nên an toàn, nhưng cột mới không được backfill cho dữ liệu mới.

## File đã thay đổi

- `backend/alembic/versions/0005_database_improvements.py`
- `backend/app/bounded_contexts/firmware_ota/infrastructure/ota_repositories.py`
- `backend/app/main.py`
- `backend/tests/test_api.py`
- `run-aifom.ps1`
- `docs/reports/ota-audit-runtime-fix-report.md`

## Migration

- Sửa index firmware tenant-scoped trong migration `0005` sang `uploaded_by_tenant_id`.
- Giữ `audit_logs.ip_address` nullable.
- Giữ `ota_jobs.tenant_id` nullable và backfill từ `tenant_device_mappings` khi chạy migration.
- `/ready` không còn báo ready nếu Alembic upgrade fail; `run-aifom.ps1` in cảnh báo rõ khi DB chưa sẵn sàng.

## API đã sửa

- `GET /api/v1/ota/jobs?limit=100`: tránh lỗi schema thiếu `ota_jobs.tenant_id` sau khi migration chạy đúng.
- `GET /api/v1/client/ota-jobs`: tiếp tục lọc tenant theo thiết bị được mapping; legacy rows `tenant_id = NULL` vẫn hiển thị nếu thiết bị thuộc tenant.
- `GET /api/v1/admin/audit-logs?limit=200`: chấp nhận audit rows có `ip_address = NULL`.
- `GET /api/v1/client/audit-logs?limit=200`: vẫn lọc theo `tenant_id`, không mở rộng quyền truy cập.

## Tests

- Thêm regression test cho migration `0005` không dùng cột sai `firmware_versions.tenant_id`.
- Thêm regression test OTA job mới tự set `tenant_id` từ device mapping.
- Thêm regression test tenant OTA list đọc được legacy job có `tenant_id = NULL` nếu device thuộc tenant.
- Thêm regression test admin audit log serialize được row có `ip_address = NULL`.

## Kết quả kiểm thử

- Backend targeted: `python -m pytest tests/test_api.py -k "ota_jobs or audit_logs or database_improvements_migration or create_ota_job_sets_tenant"` -> 10 passed.
- Backend full: `python -m pytest -q` -> 192 passed, 8 warnings.
- Frontend build: `npm run build` -> passed, Vite cảnh báo chunk lớn hiện hữu.
- Frontend typecheck: `npm run typecheck` -> passed.
- Compose config: `docker compose --env-file .env -p aifom -f infrastructure/docker-compose.dev.yml -f infrastructure/docker-compose.observability.yml config --quiet` -> passed.
- Launcher check: `run-aifom.bat status` -> passed.
- Alembic: `alembic heads` -> `0006 (head)`, container `alembic current` -> `0006 (head)`, `alembic upgrade head` -> succeeded.

## Xác minh thủ công

- `ota_jobs` đã có cột `tenant_id`.
- `audit_logs` đã có cột nullable `ip_address`.
- `GET /api/v1/ota/jobs?limit=100` bằng admin token -> 200.
- `GET /api/v1/admin/audit-logs?limit=200` bằng admin token -> 200.
- `GET /api/v1/client/ota-jobs` bằng tenant token -> 200.
- `GET /api/v1/client/audit-logs?limit=200` bằng tenant token -> 200.
- `GET /ready` -> `{"status":"ready","service":"aifom-api"}`.

## Rủi ro còn lại

- Mosquitto vẫn ghi `Client fffff ... not authorised`. API subscriber đã connect thành công; lỗi còn lại là một device/client dùng credential sai, không chặn 4 trang OTA/Audit.
