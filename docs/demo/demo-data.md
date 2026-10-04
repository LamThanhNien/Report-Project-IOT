# Dữ liệu demo

Chạy `run-aifom.bat seed-demo` để tạo bộ demo riêng trong môi trường development. Script chạy lặp không nhân bản dữ liệu, không reset tài khoản thật hoặc gán lại tenant hiện có.

Demo gồm tenant **AIFOM Demo Lab**, workspace **Demo Workspace** và tài khoản truy cập. Seed không tạo thiết bị, nhóm, capability, datastream, Automation hoặc telemetry giả. Đăng ký/gán ESP32 thật qua quy trình onboarding trước khi vận hành.

| Tài khoản | Quyền |
|---|---|
| `demo-admin@aifom.local` | Admin vận hành hệ thống |
| `demo-owner@aifom.local` | Tenant Owner quản lý tenant demo |
| `demo-viewer@aifom.local` | Viewer chỉ đọc tenant demo |

Mật khẩu ngẫu nhiên được lưu trong `.env` cục bộ và đồng bộ vào `frontend/.env`. Trang đăng nhập development hiển thị ba tài khoản; **Dùng** điền đúng email/mật khẩu. Panel không xuất hiện trong bản production. Không dùng mật khẩu admin thật trong biến Vite.

Để có trạng thái và telemetry trực tiếp, build/flash [firmware ESP32](../esp32_firmware_setup.md), cấu hình Wi-Fi/MQTT và gán UID thật vào tenant/workspace. Dùng [hướng dẫn LAN/mDNS](../esp32_physical_demo_mdns.md) để thiết bị tìm đúng broker. Không có tiến trình giả lập thiết bị chạy cùng launcher.

Đặt `AIFOM_AUTO_SEED_DEMO=1` trong `.env` nếu muốn launcher chuẩn bị tài khoản/workspace demo. `AUTO_OPEN_API_LOGS=1`, `AUTO_OPEN_MQTT_LOGS=1` mở log API/MQTT; `run-aifom.bat logs` mở log thủ công.

Upload firmware tương thích khi demo OTA trên board thật. Bộ seed không tạo firmware giả hoặc chiến dịch OTA đang chạy. Các ô bên trái trang đăng nhập mô tả kịch bản minh họa, không phải số liệu live; xem Dashboard để biết trạng thái hiện tại.

Không dùng binary ngẫu nhiên để flash board thật. Chỉ dùng binary build cho đúng board và cấu hình partition. Sau OTA, kiểm tra serial log và phiên bản đang chạy trên ESP32.

Telemetry và trạng thái đến từ ESP32 thật. Không có dữ liệu AI/anomaly hoặc widget trong phạm vi hiện tại. Seed defaults không xóa plan hiện có hoặc gán lại tenant.
