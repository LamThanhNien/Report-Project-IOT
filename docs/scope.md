# Phạm vi đề tài — quản lý nhiều thiết bị IoT

Cập nhật: 2026-10-03.

Yêu cầu: đăng ký thiết bị, giám sát online/offline và cấu hình từ xa trên ESP32/MQTT. Theo quyết định của chủ dự án, giữ nguyên OTA, Command và Automation.

## Chức năng giữ lại

1. Đăng ký và định danh thiết bị, provisioning, gán tenant/project và nhóm thiết bị.
2. MQTT telemetry, heartbeat, LWT, reconnect; trạng thái online/offline và last_seen.
3. Command có ACK, timeout/retry và lịch sử; cấu hình từ xa qua đường command.
4. Automation/Rule Engine, builder và các hành động đang được hỗ trợ.
5. Firmware/OTA, MinIO, kiểm tra tương thích, campaign và tiến độ/kết quả.
6. Dashboard cố định; project/workspace, thành viên, datastream và capability cần cho vận hành.
7. Đăng nhập, phân quyền, tenant isolation, audit và log/health/readiness.
8. Firmware ESP32 và tests cho các hợp đồng còn hoạt động.

## Chức năng đã gỡ

- Cụm simulator, wrapper tự khởi động và công cụ giả lập thiết bị chạy độc lập.
- AI/TinyML/MLOps, training, inference, model deployment và anomaly scoring.
- Dashboard/page/widget builder tùy biến.
- Website quảng bá, pricing/features/solutions/public demo.
- Báo cáo và phân tích sức khỏe/AI nâng cao.
- Cổng quản trị tài liệu API tùy biến; giữ Swagger mặc định của FastAPI.
- Giao diện billing, service-plan marketing và feature-control thương mại.
- Các service Prometheus, Grafana, MLflow và cấu hình khởi chạy tương ứng.
- Toàn bộ vai trò kỹ sư (platform_engineer, tenant_engineer) và các API/giao diện liên quan (/console/engineer).

## Phần phụ thuộc giữ để tránh hồi quy

Tenant ownership/mapping, quota/feature gates, nhóm thiết bị, metadata platform/model và project scope còn được dùng bởi chức năng giữ lại. Không thay đổi quyền truy cập để đơn giản hóa giao diện. Hệ thống duy trì 3 vai trò hoạt động chuẩn: Admin, Tenant Owner và Viewer. Toàn bộ vai trò, API và giao diện của Platform Engineer và Tenant Engineer đã được gỡ bỏ.

Lịch sử Alembic và metadata ORM tương thích được giữ. Không drop bảng hoặc xóa volume trong đợt tinh gọn này. PostgreSQL/TimescaleDB được giữ, không chuyển database.

## Tiêu chí kiểm tra

- Thiết bị đăng ký/gán đúng phạm vi; tenant khác không truy cập được.
- MQTT vẫn lưu telemetry và cập nhật presence, không chạy ML.
- Command vẫn nhận ACK; Automation vẫn đánh giá điều kiện và thực hiện hành động.
- OTA vẫn sử dụng đúng firmware, token, checksum và cập nhật trạng thái.
- Frontend typecheck/build và regression tests vượt qua.
- Swagger không đăng ký API chức năng đã gỡ.

Node-RED có trong yêu cầu đề tài nhưng chưa được tích hợp trong repo. Cần triển khai riêng nếu đây là tiêu chí bắt buộc.
