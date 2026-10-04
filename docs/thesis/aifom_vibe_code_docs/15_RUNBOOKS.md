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

# 15 – Runbooks

## 1. Start local system

```bash
cp .env.example .env
make up
make logs
```

Check:

```bash
curl http://localhost:8000/healthz
curl http://localhost:8001/healthz
open http://localhost:5173
open http://localhost:3000 # Grafana if mapped
```

## 2. Run migrations

```bash
cd backend/app/modules/devices
alembic upgrade head

cd ../ota-server
alembic upgrade head
```

## 3. Create admin user

```bash
python ops/scripts/create_admin.py --email admin@example.com --password admin123
```

## 4. Start simulator

```bash
python ops/scripts/device_simulator.py --count 10 --mqtt-host localhost --api-base http://localhost:8000
```

## 5. Upload firmware manually

```bash
curl -X POST http://localhost:8001/api/v1/firmwares   -H "Authorization: Bearer $TOKEN"   -F "file=@firmware/build/aifom.bin"   -F "version=1.0.1"   -F "target_hardware=esp32-devkit-v1"   -F "release_notes=Demo OTA release"
```

## 6. Trigger rollout

```bash
curl -X POST http://localhost:8001/api/v1/rollouts   -H "Authorization: Bearer $TOKEN"   -H "Content-Type: application/json"   -d '{
    "name":"Demo rollout",
    "firmware_id":"<firmware-id>",
    "strategy":"canary",
    "percentage":10,
    "target_query":{"hardware_model":"esp32-devkit-v1","status":"online"}
  }'
```

## 7. Debug OTA failure

Checklist:

1. Check OTA job error_code.
2. Check device serial monitor.
3. Check ota-server logs.
4. Check firmware sha256 in DB.
5. Check MinIO object exists.
6. Check device target hardware.
7. Check firmware partition size.
8. Check TLS/cert if HTTPS enabled.

Common fixes:

| Error | Fix |
|---|---|
| OTA_NETWORK_TIMEOUT | kiểm tra Wi-Fi, URL, DNS/IP |
| OTA_SHA256_MISMATCH | upload lại artifact, kiểm tra binary đúng |
| OTA_SIGNATURE_INVALID | kiểm tra public/private key pair |
| OTA_SIZE_EXCEEDED | tăng partition hoặc giảm firmware size |
| OTA_FLASH_FAILED | kiểm tra partition table/flash |

## 8. Pause bad rollout

```bash
curl -X POST http://localhost:8001/api/v1/rollouts/<id>/pause   -H "Authorization: Bearer $TOKEN"
```

## 9. Quarantine firmware

```bash
curl -X POST http://localhost:8001/api/v1/firmwares/<id>/quarantine   -H "Authorization: Bearer $TOKEN"   -H "Content-Type: application/json"   -d '{"reason":"High OTA failure rate"}'
```

## 10. Backup DB

```bash
mkdir -p backups
pg_dump "$DATABASE_URL" > backups/aifom_$(date +%F_%H%M).sql
```

## 11. Restore DB

```bash
psql "$DATABASE_URL" < backups/aifom_2026-05-18_1000.sql
```

## 12. Demo script 10 phút

1. Mở dashboard: cho thấy fleet online.
2. Mở device detail: telemetry/health realtime.
3. Upload firmware mới.
4. Trigger OTA cho 1 device/simulator.
5. Theo dõi progress realtime.
6. Device chuyển version mới.
7. Inject anomaly từ simulator.
8. Grafana/UI hiện alert.
9. Mở MLflow/model registry nếu demo TinyML.
10. Kết luận về CI/CD + observability.

## 13. Demo failure recovery runbook

Khi đang demo bảo vệ mà có thứ hỏng, ưu tiên giữ flow. Không sửa code live. Chuẩn bị sẵn fallback dưới đây.

### 13.1 ESP32 thật không kết nối Wi-Fi

- Triệu chứng: serial monitor báo `WIFI_MANAGER: reconnect attempt=N`.
- Recovery (30 giây):
  1. Reset bằng nút EN.
  2. Nếu vẫn fail, chuyển sang simulator: `python ops/scripts/device_simulator.py --count 1 --device-uid esp32-001 --mqtt-host localhost`.
  3. Trên Admin UI, tiếp tục flow OTA bằng device simulator này.
- Backup video clip: `docs/demo/backup_real_esp32_ota.mp4`.

### 13.2 OTA download fail giữa demo

- Triệu chứng: progress dừng tại ≤ 75%, error_code = `OTA_NETWORK_TIMEOUT`.
- Recovery:
  1. Kiểm tra MinIO container chạy: `docker ps | grep minio`.
  2. Pause rollout: `POST /rollouts/{id}/pause`.
  3. Chạy lại rollout cho 1 device backup từ simulator.
- Không cố tải lại trên real device giữa demo — quá lâu.

### 13.3 Admin UI trắng / không gọi được API

- Triệu chứng: dashboard load nhưng số liệu = 0.
- Recovery:
  1. Mở DevTools → Network. Xem request fail tại endpoint nào.
  2. `docker compose logs <service>` cho service tương ứng.
  3. Nếu service down: `docker compose restart <service>`. Khôi phục ~10s.
  4. Backup: dùng terminal mở sẵn curl các endpoint cho ban giám khảo xem.

### 13.4 Grafana không có dữ liệu

- Recovery:
  1. Mở Prometheus `/targets` xem service nào down.
  2. Refresh dashboard, đổi time range về "Last 15m".
  3. Nếu vẫn không có: chuyển slide "kiến trúc observability" → giải thích bằng screenshot trong báo cáo, không cố fix.

### 13.5 MLflow UI không mở được

- Recovery:
  1. `docker compose restart mlflow`.
  2. Backup: chuyển sang slide model card + screenshot MLflow đã chụp trước.

### 13.6 Simulator crash giữa stress test

- Recovery: chạy lại với count thấp hơn:
  ```bash
  python ops/scripts/device_simulator.py --count 20 --mqtt-host localhost --duration 5m
  ```
- Giải thích trong demo rằng đây là giới hạn của môi trường demo, không phải của hệ thống.

### 13.7 Database connection refused

- Triệu chứng: tất cả API 500.
- Recovery:
  1. `docker compose ps postgres timescaledb` xem container healthy không.
  2. `docker compose restart postgres timescaledb`.
  3. Đợi healthcheck pass (~15s) rồi restart backend.

### 13.8 Backup demo plan (nếu hỏng nặng)

Nếu > 2 thành phần fail và không restore được trong 3 phút:

1. Stop trying live demo.
2. Chuyển sang playback video `docs/demo/full_e2e_demo.mp4` (đã chuẩn bị ở Sprint 45).
3. Tiếp tục thuyết trình kiến trúc + bảo vệ. Nói thẳng "thành phần X gặp sự cố trong môi trường demo, video xác nhận kịch bản chạy đúng trong điều kiện ổn định".

### 13.9 Pre-demo checklist (chạy trước 30 phút)

- [ ] `make up` → tất cả container healthy.
- [ ] `curl http://localhost:8001..8006/healthz` → tất cả 200.
- [ ] Login admin UI thành công.
- [ ] Upload firmware test thành công.
- [ ] Trigger rollout cho 1 simulator → progress đến 100%.
- [ ] Grafana dashboard có dữ liệu.
- [ ] Wi-Fi router demo bật, ESP32 thật kết nối được.
- [ ] Video backup mở được, ổn định kết nối projector.
- [ ] Pin laptop > 50%, cắm sạc.

## 14. Incident template

```md
# Incident: [title]

## Time
Start:
End:

## Impact

## Root cause

## Detection

## Resolution

## What went well

## What went wrong

## Action items
```
