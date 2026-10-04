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

# 10 - DevOps & Deployment

This document reflects the current local deployment model after the May 2026
restructure.

## 1. Deployment Targets

| Target | Purpose | Status |
|---|---|---|
| Local dev | Daily development and demo rehearsal | Active |
| Observability overlay | Prometheus + Grafana over local dev | Active |
| ML overlay | MLflow over local dev dependencies | Active |
| K3s / Kubernetes | Later staging/demo deployment | Planned |

The project is Docker Compose first. Kubernetes material in `infrastructure/k8s`
is a future deployment track and should not block the local demo.

## 2. Active Compose Files

| File | Role |
|---|---|
| `infrastructure/docker-compose.dev.yml` | Core local stack: API, Postgres, Mosquitto, MinIO |
| `infrastructure/docker-compose.observability.yml` | Prometheus + Grafana overlay |
| `infrastructure/docker-compose.ml.yml` | MLflow overlay |

Use `.env.example` as the template and `.env` as the local runtime file.

## 3. Local Port Allocation

The launcher and compose files read host ports from `.env`. `run-aifom.bat`
can remap busy host ports automatically and prints the final URLs.

| Service | Container port | Default host port | Env var |
|---|---:|---:|---|
| FastAPI `api` | 8000 | 8000 | `API_HOST_PORT` |
| Frontend Vite | 5173 | 5173 | `WEB_HOST_PORT` |
| PostgreSQL | 5432 | 5432 | `POSTGRES_HOST_PORT` |
| Mosquitto MQTT | 1883 | 1883 | `MQTT_HOST_PORT` |
| MinIO API | 9000 | 9000 | `MINIO_HOST_PORT` |
| MinIO Console | 9001 | 9001 | `MINIO_CONSOLE_HOST_PORT` |
| Prometheus | 9090 | 9090 | `PROMETHEUS_HOST_PORT` |
| Grafana | 3000 | 3000 | `GRAFANA_HOST_PORT` |
| MLflow | 5000 | 5000 | `MLFLOW_HOST_PORT` |

## 4. Environment Variables

Core variables are maintained in the root `.env.example`.

```env
POSTGRES_USER=aifom
POSTGRES_PASSWORD=aifom
POSTGRES_DB=aifom
DATABASE_URL=postgresql+psycopg2://aifom:aifom@postgres:5432/aifom

MQTT_HOST=mosquitto
MQTT_PORT=1883

MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

JWT_SECRET=change-me-in-prod
JWT_ALGORITHM=HS256
JWT_EXPIRES_MIN=60

API_HOST_PORT=8000
WEB_HOST_PORT=5173
POSTGRES_HOST_PORT=5432
MQTT_HOST_PORT=1883
MINIO_HOST_PORT=9000
MINIO_CONSOLE_HOST_PORT=9001
PROMETHEUS_HOST_PORT=9090
GRAFANA_HOST_PORT=3000
MLFLOW_HOST_PORT=5000
```

Never commit a real `.env`.

## 5. Local Commands

Run from the repository root.

```bash
# Core stack
make dev-up
make logs
make dev-down

# Observability overlay
make obs-up
make obs-down

# Backend tests inside the api container
make test-api

# Frontend tests on the host
make test-web
```

Windows full launcher:

```powershell
cmd /c "D:\DATT\aifom\run-aifom.bat"
```

The launcher performs:

1. Docker availability check.
2. `.env` creation from `.env.example` when missing.
3. Host port conflict detection and remapping.
4. Compose config validation.
5. Core + observability stack startup.
6. Optional MLflow startup.
7. Frontend startup from `frontend/`.
8. API, Prometheus, and Grafana readiness checks.

## 6. Frontend Runtime

The frontend is not a compose service in the current local workflow. It runs on
the host from `frontend/`:

```bash
cd frontend
npm install
npm run dev -- --port 5173 --strictPort
```

The full launcher sets `WEB_HOST_PORT` and starts Vite with `--strictPort` so
the printed URL matches the actual running port.

## 7. Health Checks

```bash
curl http://localhost:8000/health
curl http://localhost:8000/ready
curl http://localhost:8000/metrics
```

For remapped ports, use the URL printed by `run-aifom.bat`.

## 8. Observability

Prometheus config lives at:

```txt
infrastructure/prometheus/prometheus.yml
```

Grafana provisioning and dashboards live under:

```txt
infrastructure/grafana/provisioning/
infrastructure/grafana/dashboards/
```

Default local credentials:

| Service | Credential |
|---|---|
| Web admin | `admin@aifom.local` / `admin1234` |
| Grafana | `admin` / `admin` |
| MinIO | values from `.env` |

## 9. Future Kubernetes Track

Kubernetes files belong under `infrastructure/k8s`. Keep this separate from
the active local Compose workflow. When K3s becomes active, add:

- namespace manifests,
- config maps and secrets templates,
- persistent volume strategy,
- ingress/TLS notes,
- deployment runbook,
- rollback runbook.

## 10. Operational Rules

- Use the root `Makefile` and `run-aifom.bat` as operational sources of truth.
- Do not introduce new `infra/` or `apps/` paths.
- New backend runtime code goes under `backend`.
- New UI runtime code goes under `frontend`.
- New firmware and simulator code goes under `iot`.
- New AI and MLOps code goes under `ai`.
- New infrastructure config goes under `infrastructure`.
