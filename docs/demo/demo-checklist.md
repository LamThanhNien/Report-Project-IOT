# Checklist demo IoT

- [ ] Docker Desktop chạy Linux containers; `.env` có secrets và thông tin kết nối.
- [ ] API, database, MQTT và MinIO khởi động; `/health` và `/ready` thành công.
- [ ] Frontend đăng nhập được và hiển thị dashboard cố định.
- [ ] Có ít nhất hai thiết bị đã đăng ký/gán đúng tenant.
- [ ] ESP32 thật publish telemetry, heartbeat và trạng thái.
- [ ] Ngắt thiết bị và quan sát offline/last_seen.
- [ ] Gửi command, quan sát ACK/kết quả/lịch sử.
- [ ] Automation thử điều kiện và thực thi đúng action, có execution log.
- [ ] Upload firmware tương thích và theo dõi OTA đến trạng thái cuối.
- [ ] Tenant khác không truy cập được tài nguyên; viewer không ghi dữ liệu.
- [ ] IP LAN/cổng host và URL tải firmware đúng với mạng ESP32.
- [ ] Có ESP32 dự phòng đã flash/config và phương án [OTA fallback](ota-fallback-plan.md).

Không cần AI model, MLflow, Prometheus hay Grafana cho kịch bản này. Không xóa database hoặc volume trước buổi demo.
