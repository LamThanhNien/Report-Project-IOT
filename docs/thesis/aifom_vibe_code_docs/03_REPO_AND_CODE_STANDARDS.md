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

# 03 - Repo Structure & Coding Standards

This document reflects the current AIFOM repository after the May 2026
restructure. The project is no longer split into separate backend
microservice folders. The active backend is a FastAPI modular monolith under
`backend/app/modules`.

## 1. Current Repository Structure

```txt
aifom/
|-- README.md
|-- Makefile
|-- .env.example
|-- run-aifom.bat
|-- backend/
|   |-- app/
|   |   |-- api/v1/
|   |   |-- core/
|   |   |-- db/
|   |   |-- modules/
|   |   |   |-- auth/
|   |   |   |-- devices/
|   |   |   |-- telemetry/
|   |   |   |-- firmware/
|   |   |   |-- ota/
|   |   |   `-- anomaly/
|   |   |-- repositories/
|   |   |-- schemas/
|   |   |-- services/
|   |   `-- main.py
|   |-- alembic/
|   |-- tests/
|   |-- pyproject.toml
|   `-- Dockerfile
|-- frontend/
|   |-- src/
|   |   |-- app/
|   |   |-- components/
|   |   |-- contexts/
|   |   |-- lib/
|   |   |-- pages/
|   |   |-- services/
|   |   |-- styles/
|   |   `-- types/
|   |-- package.json
|   `-- vite.config.ts
|-- iot/
|   |-- firmware/
|   |-- simulator/
|   `-- mqtt-examples/
|-- ai/
|   |-- datasets/
|   |-- training/
|   |-- evaluation/
|   |-- export/
|   |-- mlflow/
|   `-- notebooks/
|-- infrastructure/
|   |-- docker-compose.dev.yml
|   |-- docker-compose.observability.yml
|   |-- docker-compose.ml.yml
|   |-- postgres/
|   |-- mosquitto/
|   |-- minio/
|   |-- prometheus/
|   |-- grafana/
|   `-- k8s/
|-- docs/
|-- scripts/
|-- _needs_review/
`-- .github/workflows/
```

`_needs_review/` is a holding area for files moved during the restructure that
do not yet have a confirmed active home. Do not build new features there.

## 2. Active Path Mapping

| Old document path | Current project path |
|---|---|
| `apps/api/` | `backend/` |
| `apps/web-admin/` or `admin-ui/` | `frontend/` |
| `services/device-registry/` | `backend/app/modules/devices/` |
| `services/ota-server/` | `backend/app/modules/ota/` |
| `services/telemetry-ingest/` | `backend/app/modules/telemetry/` |
| `services/model-registry/` | `backend/app/modules/firmware/` and `ai/export/` |
| `services/health-scorer/` | `backend/app/modules/anomaly/` |
| `services/common/` | `backend/app/core/`, `backend/app/services/` |
| `firmware/` | `iot/firmware/` |
| `ml/` | `ai/` |
| `infra/` | `infrastructure/` |
| root `tests/` | `backend/tests/` and colocated frontend tests |

## 3. Makefile Commands

Use the root `Makefile` as the source of truth.

```makefile
dev-up:
	docker compose --env-file .env -f infrastructure/docker-compose.dev.yml up -d

dev-down:
	docker compose --env-file .env -f infrastructure/docker-compose.dev.yml down

logs:
	docker compose --env-file .env -f infrastructure/docker-compose.dev.yml logs -f

obs-up:
	docker compose --env-file .env \
	  -f infrastructure/docker-compose.dev.yml \
	  -f infrastructure/docker-compose.observability.yml up -d

test-api:
	cd /workspace/backend && pytest tests/ -q

test-web:
	cd frontend && npm run test
```

The Windows launcher `run-aifom.bat` starts the compose stacks, remaps host
ports when needed, starts the frontend from `frontend/`, and prints the active
URLs.

## 4. Branching Model

Use trunk-based development:

- `main` must remain runnable.
- Keep feature branches short: `feat/ota-upload`, `fix/mqtt-reconnect`.
- Use tags for release artifacts:
  - Firmware: `fw-v1.2.3`
  - Backend/API: `api-v1.2.3`
  - Model: `model-v1.2.3`

## 5. Commit Message Style

Use Conventional Commits:

```txt
feat(ota): add firmware upload endpoint
fix(firmware): handle ota download timeout
test(devices): add registration edge cases
docs(adr): choose mosquitto for local broker
ci(firmware): add esp-idf build workflow
```

## 6. ADR Template

```md
# ADR-000X - [Decision title]

## Status
Accepted | Proposed | Deprecated | Superseded

## Context
Problem and constraints.

## Decision
The chosen approach.

## Alternatives Considered
- Option A
- Option B
- Option C

## Consequences
### Positive
### Negative
### Risks

## Validation Plan
How the decision will be verified.
```

## 7. Backend Coding Standard

The backend is one FastAPI application with feature modules.

```txt
backend/
|-- app/
|   |-- main.py
|   |-- api/v1/router.py
|   |-- core/
|   |-- db/
|   |-- modules/<feature>/
|   |   |-- model.py
|   |   |-- schema.py
|   |   |-- repository.py
|   |   |-- router.py
|   |   `-- service.py        # only when the feature has business logic
|   `-- services/             # infrastructure adapters: MQTT, MinIO, workers
`-- tests/
```

Rules:

- Routers handle HTTP concerns only.
- Repositories handle database access.
- Service/use-case code owns business workflow.
- Pydantic schemas validate request and response contracts.
- Shared configuration, metrics, logging, and security live in `backend/app/core`.
- MQTT, MinIO, and background worker adapters live in `backend/app/services`.
- Tests for backend behavior live in `backend/tests`.

## 8. Firmware Coding Standard

Firmware lives under `iot/firmware`.

| Component | Responsibility |
|---|---|
| `config_manager` | NVS config, device UID, server URL, certificates, bootstrap token |
| `wifi_manager` | Connect/reconnect, event handling, exponential backoff |
| `mqtt_client` | Publish status/telemetry/logs and receive commands |
| `ota_client` | Check update, download, verify, flash, rollback |
| `telemetry` | Normalize telemetry payloads |
| `tinyml_runtime` | Local inference runtime |
| `device_identity` | Stable device identity and credentials |

Rules:

- Every OTA state must be logged.
- Do not block the main loop for long operations.
- Network operations need bounded retry.
- Verification failure must never flash firmware.
- Firmware build metadata should be generated by CI when CI is added.

## 9. Frontend Coding Standard

Frontend lives under `frontend`.

- Use TypeScript strict mode.
- API access belongs in `frontend/src/services`.
- Shared helpers belong in `frontend/src/lib`.
- Pages should compose services and UI components, not duplicate fetch logic.
- Shared UI primitives live in `frontend/src/components/ui`.
- User-facing copy is Vietnamese; code identifiers remain English.
- Keep mock data isolated and tagged with `TODO(backend)` until backend endpoints exist.

## 10. AI / TinyML Coding Standard

AI and MLOps files live under `ai`.

- Training code: `ai/training`.
- Evaluation code: `ai/evaluation`.
- Export code: `ai/export`.
- MLflow notes/configuration: `ai/mlflow`.
- Raw and processed datasets: `ai/datasets`.

Do not place new ML code under the old `ml/` path.

## 11. Review Checklist

Before merge:

- [ ] Relevant tests are added or updated.
- [ ] No real secret is committed.
- [ ] API contract changes are documented.
- [ ] Database changes include migration notes.
- [ ] Firmware changes do not exceed device constraints.
- [ ] Logs do not contain tokens or keys.
- [ ] Module README is updated when behavior changes.
- [ ] Architecture changes have an ADR.
