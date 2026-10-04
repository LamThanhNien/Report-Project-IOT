# Kiến trúc dự án IoT

Cập nhật: 2026-10-03. Phạm vi chuẩn được ghi tại [scope.md](scope.md).

Backend là FastAPI modular monolith; frontend React/Vite; ESP32 giao tiếp qua Mosquitto MQTT. PostgreSQL/TimescaleDB lưu dữ liệu và MinIO lưu firmware.

## Các domain hoạt động

- `identity`: xác thực, tài khoản, quyền và MQTT authentication.
- `tenant_management`: tenant ownership/mapping, feature/quota dùng cho vận hành.
- `device_registry`: đăng ký, metadata, capability và presence.
- `device_groups`, `device_provisioning`: nhóm và onboarding thiết bị.
- `telemetry`: lưu/truy vấn số liệu cơ bản, cảnh báo vận hành.
- `firmware_ota`: firmware, secure download, OTA jobs/campaigns.
- `command_center`: gửi lệnh và theo dõi ACK/kết quả.
- `rule_engine`: điều kiện, hành động, builder và lịch sử Automation.
- `project_dashboard`: project scope, membership, device binding và datastream; không có page/widget builder.
- `shared`: audit, MQTT, SSE, health/readiness và xử lý lỗi.

Các alias trong `app/modules/` và `app/services/` vẫn được dùng bởi mã hiện tại. Metadata ORM của chức năng cũ có thể còn tồn tại để Alembic và database hiện có tương thích; không có API hay pipeline AI/TinyML hoạt động.

## Luồng thiết bị

1. Đăng ký UID và cấp thông tin MQTT, xác định ownership.
2. Thiết bị kết nối, publish capabilities/status/heartbeat và telemetry.
3. MQTT subscriber lưu dữ liệu, cập nhật presence và phát sự kiện trạng thái.
4. Rule Engine đánh giá telemetry/sự kiện và thực hiện hành động được cấp quyền.
5. Command publisher gửi lệnh; subscriber đối chiếu ACK với command đã theo dõi.
6. OTA gửi request, thiết bị tải firmware, kiểm tra và cập nhật trạng thái.

Các topic/payload còn hoạt động được ghi tại [MQTT contract](mqtt-device-contract.md). Project/workspace cố định giữ phạm vi thiết bị cho các thao tác hiện có.

## Dữ liệu và vận hành

Không thay đổi lịch sử migration hoặc xóa dữ liệu/volume. Giữ database, broker và MinIO trong Compose; không khởi chạy Prometheus/Grafana/MLflow. `/health` và `/ready` phục vụ chẩn đoán. Log và nhật ký thao tác được giữ.

Các vai trò còn hỗ trợ là Admin, Tenant Owner và Viewer. Backend kiểm tra vai trò, quyền và tenant; frontend feature flags không thay thế kiểm tra phân quyền.
