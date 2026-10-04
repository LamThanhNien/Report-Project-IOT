# Report Project IoT

Nền tảng quản lý nhiều thiết bị IoT: đăng ký ESP32, giám sát online/offline, cấu hình từ xa, Command, Automation và cập nhật firmware OTA.

## Phạm vi hiện tại

- Device Registry, đăng ký/provisioning và nhóm thiết bị.
- MQTT telemetry, heartbeat, LWT, reconnect và cập nhật trạng thái qua SSE.
- Command: gửi lệnh, ACK, timeout, retry và lịch sử.
- Automation: điều kiện từ telemetry/sự kiện/trạng thái/OTA, hành động command và cảnh báo.
- Firmware/OTA: upload binary, lưu MinIO, kiểm tra tương thích, campaign, tiến độ và kết quả.
- Project/workspace cố định, thành viên và gán thiết bị để xác định phạm vi vận hành.
- Đăng nhập, phân quyền, tenant isolation và audit log.

Đã gỡ cụm simulator, AI/TinyML/MLOps, trình dựng trang/widget, website quảng bá, báo cáo phân tích nâng cao và cổng tài liệu API tùy biến. Prometheus, Grafana và MLflow không còn trong cấu hình triển khai.

## Khởi động trên Windows

Cần Docker Desktop (Linux containers), Node.js/npm và Python 3.11 trở lên nếu kiểm thử trên host.

1. Sao chép `.env.example` thành `.env`, đặt secrets và thông tin MQTT/MinIO.
2. Chạy `run-aifom.bat start` để khởi động backend, PostgreSQL/TimescaleDB, Mosquitto và MinIO.
3. Trong `frontend/`, chạy `npm ci` rồi `npm run dev`.
4. Tạo tài khoản quản trị với `make seed-admin` hoặc chạy `scripts/seed_admin.py` trong container API. Đặt `ADMIN_SEED_PASSWORD` trước khi seed.
5. Dùng giao diện quản trị để tạo tenant/tài khoản, đăng ký/gán thiết bị và dùng workspace vận hành.

| Thành phần | Địa chỉ mặc định |
|---|---|
| API và Swagger mặc định | http://localhost:8000/docs |
| Frontend | http://localhost:5173 |
| MinIO console | http://localhost:9001 |

Các cổng được cấu hình trong `.env`. ESP32 dùng IP LAN và cổng host; container dùng tên service và cổng nội bộ. Xem hướng dẫn [ESP32/mDNS](../docs/esp32_physical_demo_mdns.md).

## Kiến trúc

ESP32 ↔ Mosquitto MQTT ↔ FastAPI ↔ PostgreSQL/TimescaleDB.
Frontend React truy cập FastAPI qua HTTP/SSE. Firmware được lưu trong MinIO và tải qua API OTA.

| Thư mục | Nội dung |
|---|---|
| `backend/` | API, domain, MQTT, quyền truy cập, migration và tests |
| `frontend/` | Giao diện quản trị và workspace vận hành |
| `iot/` | Firmware ESP-IDF |
| `infrastructure/` | Docker Compose, database, broker và MinIO |
| `scripts/` | Seed admin, mDNS và công cụ vận hành |
| `tester/` | Kiểm thử API, MQTT và trình duyệt |
| `docs/` | Phạm vi, kiến trúc, hợp đồng và hướng dẫn demo |

## Kiểm thử

```powershell
cd backend
python -m pytest tests -q
cd ../frontend
npm run typecheck
npm test
npm run build
```

Các bộ kiểm thử tích hợp trong `tester/` cần hệ thống đang chạy. Build firmware cần ESP-IDF và board/config phù hợp.

## Tương thích dữ liệu

Không viết lại lịch sử Alembic, không xóa database/volume. Một số ORM/bảng cũ còn được giữ để migration và database hiện có tiếp tục hoạt động; chúng không khôi phục các chức năng đã gỡ. Lõi tenant/quota/feature và metadata thiết bị được giữ vì Command, Automation và OTA sử dụng chúng.

## Tài liệu

- [Phạm vi](../docs/scope.md)
- [Kiến trúc](../docs/architecture-guide.md)
- [MQTT contract](../docs/mqtt-device-contract.md)
- [Phân quyền](../docs/access_control.md)
- [Demo](../docs/demo/demo-script.md)
- [Checklist](../docs/demo/demo-checklist.md)

Yêu cầu đề tài có nêu Node-RED. Repo hiện chưa có tích hợp Node-RED; đây là hạng mục cần triển khai riêng nếu bắt buộc khi nghiệm thu.
