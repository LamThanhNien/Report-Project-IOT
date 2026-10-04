# Demo quản lý nhiều thiết bị IoT

## Chuẩn bị

Bật Docker Desktop, cấu hình `.env`, chạy `run-aifom.bat start`. Trong `frontend/`, chạy `npm ci` và `npm run dev`.

Seed admin bằng `make seed-admin` với `ADMIN_SEED_EMAIL`/`ADMIN_SEED_PASSWORD` đã cấu hình. Tạo tenant/tài khoản và thiết bị bằng giao diện hoặc Swagger của API. Không giả định repo có bộ dữ liệu demo được seed sẵn.

## Kịch bản

1. Đăng nhập admin, mở tổng quan và danh sách thiết bị.
2. Đăng ký/gán ít nhất hai ESP32 thật, kiểm tra định danh và ownership.
3. Kết nối các thiết bị bằng thông tin MQTT đã cấp, quan sát telemetry và online.
4. Ngắt một thiết bị, chờ LWT/presence timeout và kiểm tra offline/last_seen trên UI.
5. Gửi Command đến thiết bị online, kiểm tra tác động và ACK/lịch sử.
6. Tạo Automation theo telemetry hoặc trạng thái, dùng công cụ thử điều kiện, bật rule rồi quan sát action và execution log.
7. Upload firmware phù hợp, tạo OTA job/campaign và quan sát tiến độ/kết quả.
8. Đăng nhập tenant khác và kiểm tra không nhìn thấy tài nguyên của tenant đầu.

Project/workspace chỉ dùng để tổ chức phạm vi thiết bị, datastream và các thao tác vận hành; không có kéo thả page/widget.

## Chẩn đoán

- `/health` kiểm tra process; `/ready` kiểm tra các điều kiện sẵn sàng.
- Xem log API/MQTT khi telemetry, command hoặc OTA không đến.
- ESP32 cần IP LAN/cổng host, không dùng tên service Docker như `api` hoặc `mosquitto`.
- Không chạy reset/xóa volume để khắc phục lỗi demo khi chưa có chủ đích xóa dữ liệu.

Xem [checklist](demo-checklist.md), [thiết lập ESP32](../esp32_firmware_setup.md) và [OTA fallback](ota-fallback-plan.md).
