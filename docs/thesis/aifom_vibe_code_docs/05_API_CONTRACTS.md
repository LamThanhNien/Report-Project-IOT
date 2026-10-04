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

# 05 – API Contracts

## 1. Quy ước chung

### Base URL theo service (local dev)

| Service | Base URL |
|---|---|
| device-registry | `http://localhost:8001/api/v1` |
| ota-server | `http://localhost:8002/api/v1` |
| telemetry-ingest | `http://localhost:8003/api/v1` (chỉ healthz/metrics) |
| model-registry | `http://localhost:8004/api/v1` |
| health-scorer | `http://localhost:8005/api/v1` |
| realtime-gateway | `ws://localhost:8006/ws/events` |

Khi deploy K3s phía sau Ingress, các path được prefix theo `10_DEVOPS_DEPLOYMENT.md` §7. Admin UI luôn gọi qua Ingress, không gọi trực tiếp pod.

### Response thành công

JSON. Mọi response 2xx phải bao gồm header `X-Request-ID` echo lại request ID hoặc do server sinh.

### Response lỗi chuẩn

```json
{
  "error": {
    "code": "FIRMWARE_NOT_FOUND",
    "message": "Firmware not found",
    "details": {}
  },
  "request_id": "req_abc123"
}
```

### Header

```txt
Authorization: Bearer <admin-jwt>     (admin endpoints)
X-Device-Token: <device-token>        (device endpoints)
X-Request-ID: <uuid>                  (optional, server sinh nếu thiếu)
```

### Error code convention

Mã lỗi viết HOA + snake_case, prefix domain. Mỗi service có một danh sách finite, không sinh động:

| Code | HTTP | Domain |
|---|---:|---|
| `VALIDATION_ERROR` | 422 | common |
| `UNAUTHORIZED` | 401 | common |
| `FORBIDDEN` | 403 | common |
| `NOT_FOUND` | 404 | common |
| `CONFLICT` | 409 | common |
| `RATE_LIMITED` | 429 | common |
| `INTERNAL_ERROR` | 500 | common |
| `DEVICE_NOT_FOUND` | 404 | registry |
| `DEVICE_DUPLICATE` | 409 | registry |
| `DEVICE_TOKEN_INVALID` | 401 | registry |
| `FIRMWARE_NOT_FOUND` | 404 | ota |
| `FIRMWARE_DUPLICATE` | 409 | ota |
| `FIRMWARE_INVALID_SEMVER` | 422 | ota |
| `FIRMWARE_TOO_LARGE` | 413 | ota |
| `FIRMWARE_SHA_MISMATCH` | 422 | ota |
| `FIRMWARE_SIGNATURE_INVALID` | 422 | ota |
| `OTA_JOB_NOT_FOUND` | 404 | ota |
| `OTA_INVALID_TRANSITION` | 400 | ota |
| `ROLLOUT_NOT_FOUND` | 404 | ota |
| `ROLLOUT_INVALID_STATE` | 400 | ota |
| `MODEL_NOT_FOUND` | 404 | model |
| `MODEL_DUPLICATE` | 409 | model |
| `MODEL_PROMOTION_BLOCKED` | 422 | model |

Service tự thêm code khi cần, nhưng phải document trong README service và unit test có check `error.code`.

## 1b. API Groups theo vai trò

| Group | Base path | Ai dùng | Auth |
|---|---|---|---|
| Auth | `/api/v1/auth/*` | Tất cả | – |
| Admin APIs | `/api/v1/admin/*` | Platform Admin | JWT role=admin |
| Client APIs | `/api/v1/client/*` | Tenant Owner / Viewer | JWT role=tenant_owner hoặc viewer |
| Device APIs | `/api/v1/devices/*` | Device/ESP32 + Admin | Device token hoặc Admin JWT |
| Firmware | `/api/v1/firmwares/*` | Admin (upload), Device (download) | JWT / Device token |
| OTA | `/api/v1/rollouts/*`, `/api/v1/ota/*` | Admin | Admin JWT |

### Platform Engineer API — [RETIRED]

> Ghi chú: Giao diện và API hỗ trợ kỹ sư nền tảng (`/api/v1/platform/engineer/*`) đã được thu hồi và gỡ bỏ hoàn toàn vào ngày 03/10/2026. Mọi yêu cầu gọi tới endpoint này trả về HTTP 404 Not Found.

### Admin API — Quản lý Tenant

```http
# Tạo tenant (+ optional: tạo luôn tenant owner account)
POST /api/v1/admin/tenants
Authorization: Bearer <admin-jwt>

{
  "name": "Công ty ABC",
  "slug": "abc",
  "plan_id": "uuid",
  "contact_email": "admin@abc.com",
  "owner_email": "owner@abc.com",
  "owner_password": "secret123",
  "owner_full_name": "Nguyễn Văn A"
}
```

```http
GET /api/v1/admin/tenants                            # list all tenants
GET /api/v1/admin/tenants/{id}                       # tenant detail + user count
POST /api/v1/admin/tenants/{id}/devices              # assign device to tenant
DELETE /api/v1/admin/tenants/{id}/devices/{device_id} # unassign device
GET /api/v1/admin/tenants/{id}/devices               # list tenant's devices
```

### Client API — Customer Workspace

```http
# Profile
GET /api/v1/client/me                         # profile + tenant info + features

# Devices (chỉ thiết bị được gán cho tenant)
GET /api/v1/client/devices
GET /api/v1/client/devices/{device_uid}
POST /api/v1/client/devices                   # register + self-assign (tenant_owner only)
DELETE /api/v1/client/devices/{device_uid}    # unassign (tenant_owner only)

# Telemetry & Alerts
GET /api/v1/client/devices/{device_uid}/telemetry
GET /api/v1/client/alerts
GET /api/v1/client/ai-events

# Firmware (tenant-scoped: own firmware + admin-uploaded global firmware)
GET /api/v1/client/firmware
POST /api/v1/client/firmware                  # upload .bin (tenant_owner only)
POST /api/v1/client/firmware/from-source      # submit .ino source (tenant_owner only)

# OTA Jobs
GET /api/v1/client/ota-jobs
POST /api/v1/client/ota-jobs                  # create OTA job (tenant_owner only)

# Users (tenant team management)
GET /api/v1/client/users
POST /api/v1/client/users                     # create user (tenant_owner only)
DELETE /api/v1/client/users/{user_id}         # delete user (tenant_owner only)

# Feature flags (từ service plan)
GET /api/v1/client/features
GET /api/v1/client/plan

# Datastreams (Virtual Pins)
GET /api/v1/client/datastreams                  # list datastreams
POST /api/v1/client/datastreams                 # create datastream (tenant_owner only)
PUT /api/v1/client/datastreams/{id}             # update datastream (tenant_owner only)
DELETE /api/v1/client/datastreams/{id}          # delete datastream (tenant_owner only)
```

> **Security note**: `tenant_id` KHÔNG được lấy từ request body/query. Backend luôn resolve từ
> `JWT sub (user_id) → DB users.tenant_id`. JWT payload chỉ chứa `sub` và `role` —
> `tenant_id` KHÔNG nằm trong JWT. Đây là thiết kế có chủ ý để ngăn tenant_id bị giả mạo từ phía client.
>
> **Write protection**: Vai trò `viewer` không được thực hiện thao tác ghi (POST/DELETE).
> Backend trả 403 nếu role == "viewer" cố tạo OTA, upload firmware, hay đăng ký thiết bị.

## 2. Device Registry API

### Register device

```http
POST /devices/register
Content-Type: application/json
```

Request:

```json
{
  "device_uid": "esp32-001",
  "hardware_model": "esp32-devkit-v1",
  "firmware_version": "0.1.0",
  "mac_address": "AA:BB:CC:DD:EE:FF",
  "metadata": {
    "board": "ESP32-WROOM-32",
    "location": "lab"
  }
}
```

Response:

```json
{
  "id": "uuid",
  "device_uid": "esp32-001",
  "device_token": "one-time-token-or-jwt",
  "mqtt": {
    "host": "mqtt.local",
    "port": 8883,
    "client_id": "esp32-001"
  }
}
```

### List devices

```http
GET /devices?status=online&hardware_model=esp32-devkit-v1&page=1&page_size=50
```

Response:

```json
{
  "items": [
    {
      "id": "uuid",
      "device_uid": "esp32-001",
      "display_name": "Lab ESP32 001",
      "hardware_model": "esp32-devkit-v1",
      "firmware_version": "1.0.0",
      "model_version": "gesture-v1",
      "status": "online",
      "last_seen_at": "2026-05-18T10:00:00Z"
    }
  ],
  "page": 1,
  "page_size": 50,
  "total": 1
}
```

### Device heartbeat

```http
POST /devices/{device_uid}/heartbeat
```

Request:

```json
{
  "firmware_version": "1.0.0",
  "model_version": "gesture-v1",
  "uptime_sec": 12345,
  "free_heap": 123456,
  "wifi_rssi": -55
}
```

## 3. OTA Server API

### Upload firmware

```http
POST /firmwares
Content-Type: multipart/form-data
```

Fields:

| Field | Type | Required |
|---|---|---|
| file | binary `.bin` | yes |
| version | string SemVer | yes |
| target_hardware | string | yes |
| git_sha | string | no |
| release_notes | string | no |

Response:

```json
{
  "id": "uuid",
  "version": "1.2.3",
  "target_hardware": "esp32-devkit-v1",
  "sha256": "...",
  "size_bytes": 512000,
  "status": "signed",
  "download_url": "/api/v1/firmwares/uuid/download"
}
```

### Get latest firmware for device/hardware

```http
GET /firmwares/latest?device_uid=esp32-001&hardware_model=esp32-devkit-v1&current_version=1.0.0
```

Response khi có update:

```json
{
  "has_update": true,
  "firmware": {
    "id": "uuid",
    "version": "1.2.3",
    "target_hardware": "esp32-devkit-v1",
    "size_bytes": 512000,
    "sha256": "...",
    "signature": "base64-ed25519-signature",
    "download_url": "https://ota.local/api/v1/firmwares/uuid/download"
  }
}
```

Response khi không có update:

```json
{
  "has_update": false,
  "firmware": null
}
```

### Create rollout

```http
POST /rollouts
```

Request:

```json
{
  "name": "Rollout firmware 1.2.3 canary",
  "firmware_id": "uuid",
  "strategy": "canary",
  "percentage": 10,
  "target_query": {
    "hardware_model": "esp32-devkit-v1",
    "status": "online"
  },
  "failure_threshold_pct": 5.0
}
```

### Promote firmware

```http
POST /firmwares/{id}/promote
```

Request: `{ "stage": "production", "reason": "Smoke test passed on 5 canary devices" }`. `stage` ∈ `signed | staging | production | deprecated`.

### Quarantine firmware

```http
POST /firmwares/{id}/quarantine
```

Request: `{ "reason": "High failure rate in rollout xyz" }`. Sau khi quarantine, endpoint `/firmwares/latest` không trả firmware này. Audit log bắt buộc.

### Pause / resume / cancel rollout

```http
POST /rollouts/{id}/pause
POST /rollouts/{id}/resume
POST /rollouts/{id}/cancel
```

Request body optional `{ "reason": "..." }`. Validate state transition:

- `draft → running → paused → running → completed`
- `running/paused → cancelled`
- `running → failed` (tự động khi quarantine firmware)

### Report OTA progress

```http
POST /ota/jobs/{job_id}/progress
X-Device-Token: <token>
```

Lưu ý: device thường publish progress qua MQTT topic `dev/{uid}/ota/progress`. HTTP endpoint này là **backup** khi device không gửi được qua MQTT (ví dụ phase rebooting). Backend phải merge cả hai nguồn.

Request:

```json
{
  "device_uid": "esp32-001",
  "status": "downloading",
  "progress_pct": 50,
  "message": "Downloaded 256KB/512KB",
  "error_code": null
}
```

## 4. Model Registry API

### Register model metadata

```http
POST /models
```

Request:

```json
{
  "name": "gesture-cnn-int8",
  "version": "1.0.0",
  "mlflow_run_id": "abc123",
  "target_hardware": "esp32-devkit-v1",
  "task_type": "gesture",
  "input_shape": [200, 6],
  "output_labels": ["up", "down", "left", "right"],
  "tensor_arena_size": 32768,
  "accuracy": 0.91,
  "size_bytes": 85000,
  "sha256": "..."
}
```

### Promote model

```http
POST /models/{model_id}/promote
```

Request:

```json
{
  "stage": "production",
  "reason": "Accuracy improved from 0.89 to 0.91"
}
```

### Get latest model

```http
GET /models/latest?device_uid=esp32-001&task_type=gesture&hardware_model=esp32-devkit-v1&current_version=0.9.0
```

Response khi có update:

```json
{
  "has_update": true,
  "model": {
    "id": "uuid",
    "name": "gesture-cnn-int8",
    "version": "1.0.0",
    "task_type": "gesture",
    "target_hardware": "esp32-devkit-v1",
    "tensor_arena_size": 32768,
    "size_bytes": 85000,
    "sha256": "...",
    "signature": "base64-ed25519",
    "download_url": "https://model.local/api/v1/models/uuid/download"
  }
}
```

Response khi không có update: `{"has_update": false, "model": null}`.

### Download model artifact

```http
GET /models/{id}/download
Authorization: Bearer <token>  OR  X-Device-Token: <token>
```

Response: octet-stream với header:

```txt
Content-Type: application/octet-stream
Content-Length: <size_bytes>
X-Model-Sha256: <hex>
X-Model-Signature: <base64>
X-Model-Version: 1.0.0
```

Hỗ trợ `Range:` cho resumable.

### Report model deployment

```http
POST /models/{id}/deployments
```

Request:

```json
{
  "device_uid": "esp32-001",
  "status": "active",
  "previous_model_version": "0.9.0",
  "error_message": null
}
```

`status` ∈ `pending | downloading | active | failed | rolled_back`.

## 5. Anomaly Model API

### GET /api/v1/anomaly/models

Returns metadata about the server-side IsolationForest anomaly model artifact. Never raises — always returns a status dict.

Response:

```json
{
  "name": "isoforest-anomaly-detector",
  "model_type": "IsolationForest",
  "status": "loaded",
  "model_version": "v20260515",
  "metric_names": ["temperature", "humidity", "voltage"],
  "feature_columns": ["value", "rolling_mean", "rolling_std", "delta"],
  "model_path": "/workspace/ai/models/anomaly_model.joblib",
  "file_size_bytes": 4096,
  "inference_mode": "manual",
  "last_modified_at": "2026-05-15T10:00:00Z",
  "note": "Server-side anomaly scoring only. Trigger via POST /api/v1/anomaly/run/{device_uid}."
}
```

`status` ∈ `loaded | not_loaded | error`. If `not_loaded`, `model_version` is null and `metric_names` is empty — train the model via `ml/training/train_anomaly_model.py` first.

### POST /api/v1/anomaly/run/{device_uid}

Runs inference on the last N telemetry records for one device. Returns a summary of scored rows.

### GET /api/v1/anomaly/devices/{device_uid}

Lists scored anomaly events for a device.

---

## 6. Health Scorer API

```http
POST /health/score
```

Request:

```json
{
  "device_uid": "esp32-001",
  "features": {
    "free_heap": 120000,
    "min_free_heap": 90000,
    "uptime_sec": 3600,
    "wifi_rssi": -60,
    "cpu_idle_pct": 78.5,
    "mqtt_publish_rate": 1.0,
    "error_count_1h": 0,
    "ota_fail_count": 0,
    "reboot_count_24h": 1,
    "temp_chip": 43.2,
    "task_high_watermark": 2048
  }
}
```

Response:

```json
{
  "device_uid": "esp32-001",
  "model_name": "fleet-health-iforest",
  "model_version": "1.0.0",
  "anomaly_score": -0.12,
  "is_anomaly": false,
  "reason": {
    "top_features": ["wifi_rssi", "free_heap"]
  }
}
```

## 6. MQTT topic contract

### Topic naming

| Topic | Hướng | Producer | Consumer | QoS đề xuất |
|---|---|---|---|---:|
| `dev/{uid}/telemetry` | up | device | telemetry-ingest | 0 |
| `devices/{uid}/telemetry/ch_v{pin}` | up | device | telemetry-ingest | 0 |
| `dev/{uid}/status` | up | device | telemetry-ingest | 1 |
| `dev/{uid}/health` | up | device | telemetry-ingest | 0 |
| `dev/{uid}/log` | up | device | telemetry-ingest | 0 |
| `dev/{uid}/prediction` | up | device | telemetry-ingest | 0 |
| `dev/{uid}/ota/progress` | up | device | telemetry-ingest | 1 |
| `dev/{uid}/cmd` | down | ota-server / admin | device | 1 |
| `devices/{uid}/commands/ch_v{pin}` | down | backend | device | 1 |
| `dev/{uid}/cmd/ack` | up | device | ota-server / admin | 1 |
| `fleet/{hw_model}/cmd` | down | admin | device subset | 1 |

LWT (Last Will Testament) cho mỗi device: topic `dev/{uid}/status` payload `{"event":"offline_lwt","ts":..., "schema_version":"1.0"}`, retain=false, QoS=1.

### Telemetry payload

```json
{
  "schema_version": "1.0",
  "ts": "2026-05-18T10:00:00Z",
  "sensor_type": "temperature",
  "value": 30.5,
  "unit": "C",
  "seq": 123
}
```

### Health payload

```json
{
  "schema_version": "1.0",
  "ts": "2026-05-18T10:00:00Z",
  "free_heap": 120000,
  "min_free_heap": 90000,
  "uptime_sec": 3600,
  "wifi_rssi": -60,
  "cpu_idle_pct": 78.5,
  "mqtt_publish_rate": 1.0,
  "error_count_1h": 0,
  "ota_fail_count": 0,
  "reboot_count_24h": 1,
  "temp_chip": 43.2,
  "task_high_watermark": 2048
}
```

### Status payload (`dev/{uid}/status`)

```json
{
  "schema_version": "1.0",
  "ts": "2026-05-18T10:00:00Z",
  "event": "online",
  "firmware_version": "1.0.0",
  "model_version": "gesture-cnn-int8@1.0.0",
  "boot_reason": "power_on",
  "ip_address": "192.168.1.42"
}
```

`event` ∈ `online | offline_graceful | rebooting | factory_reset`.

### Command payload (`dev/{uid}/cmd`)

Envelope chung cho mọi command:

```json
{
  "schema_version": "1.0",
  "command_id": "uuid",
  "type": "<command_type>",
  "issued_at": "2026-05-18T10:00:00Z",
  "issued_by": "user:admin@example.com",
  "payload": { }
}
```

`type` ∈ `ping | reboot | update_firmware | update_model | set_config | collect_sample`.

#### type=update_firmware

```json
{
  "payload": {
    "firmware_id": "uuid",
    "version": "1.2.3",
    "target_hardware": "esp32-devkit-v1",
    "size_bytes": 512000,
    "download_url": "https://ota.local/api/v1/firmwares/uuid/download",
    "sha256": "hex",
    "signature": "base64-ed25519",
    "required": false
  }
}
```

#### type=update_model

```json
{
  "payload": {
    "model_id": "uuid",
    "name": "gesture-cnn-int8",
    "version": "1.0.0",
    "task_type": "gesture",
    "target_hardware": "esp32-devkit-v1",
    "size_bytes": 85000,
    "tensor_arena_size": 32768,
    "download_url": "https://model.local/api/v1/models/uuid/download",
    "sha256": "hex",
    "signature": "base64-ed25519"
  }
}
```

#### type=reboot

```json
{
  "payload": { "delay_sec": 5 }
}
```

#### type=set_config

```json
{
  "payload": {
    "telemetry_interval_sec": 5,
    "health_interval_sec": 60
  }
}
```

### Command ack (`dev/{uid}/cmd/ack`)

Device publish sau khi xử lý xong (hoặc bắt đầu xử lý nếu lâu):

```json
{
  "schema_version": "1.0",
  "command_id": "uuid",
  "result": "accepted",
  "ts": "2026-05-18T10:00:01Z",
  "message": null
}
```

`result` ∈ `accepted | rejected | duplicate | completed | failed`. Khi `rejected/failed` thêm `error_code` và `message`.

### OTA progress payload

```json
{
  "schema_version": "1.0",
  "command_id": "uuid",
  "job_id": "uuid",
  "status": "downloading",
  "progress_pct": 50,
  "message": "Downloaded 256KB/512KB",
  "error_code": null
}
```

### Prediction payload

```json
{
  "schema_version": "1.0",
  "ts": "2026-05-18T10:00:00Z",
  "model_name": "gesture-cnn-int8",
  "model_version": "1.0.0",
  "predicted_label": "left",
  "confidence": 0.93,
  "latency_ms": 22.4
}
```

## 7. WebSocket events cho Admin UI

Endpoint:

```txt
/ws/events
```

Event envelope:

```json
{
  "type": "device.status.changed",
  "ts": "2026-05-18T10:00:00Z",
  "payload": {}
}
```

Event types và payload schema:

| Event | Payload |
|---|---|
| `device.status.changed` | `{device_uid, old_status, new_status, ts}` |
| `device.telemetry.received` | `{device_uid, sensor_type, value, ts}` (throttle) |
| `ota.progress.updated` | `{job_id, device_uid, status, progress_pct, error_code}` |
| `ota.job.completed` | `{job_id, device_uid, firmware_version}` |
| `ota.job.failed` | `{job_id, device_uid, error_code, error_message}` |
| `rollout.status.changed` | `{rollout_id, old_status, new_status, success_count, failure_count}` |
| `model.deployment.updated` | `{device_uid, model_name, model_version, status}` |
| `health.anomaly.detected` | `{device_uid, score, model_version, top_features}` |
| `alert.created` | `{alert_id, severity, source, message, resource_type, resource_id}` |

Client gửi `{"type":"subscribe","filters":{"device_uid":"esp32-001"}}` để filter theo device. Server broadcast tất cả nếu không filter.
