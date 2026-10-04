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

# 18 – Definition of Done

## 1. Done cho backend feature

- [ ] API đúng contract.
- [ ] Schema validation rõ.
- [ ] Business logic nằm trong service/use-case.
- [ ] Repository tách DB access.
- [ ] Unit test happy path.
- [ ] Unit test ít nhất 2 edge cases.
- [ ] Integration test nếu chạm DB/storage/MQTT.
- [ ] Log có request_id và resource id.
- [ ] Metrics nếu feature quan trọng.
- [ ] Không hardcode secret.
- [ ] README module cập nhật.

## 2. Done cho firmware feature

- [ ] Build pass `idf.py build`.
- [ ] Không warning nghiêm trọng.
- [ ] Có log state/error.
- [ ] Có retry/backoff nếu chạm network.
- [ ] Không block task quan trọng vô hạn.
- [ ] Có test hoặc kịch bản test thủ công.
- [ ] Có error code khi fail.
- [ ] Không flash firmware nếu verify fail.
- [ ] Không log password/token.

## 3. Done cho OTA

- [ ] Upload firmware thành công.
- [ ] Metadata lưu DB.
- [ ] Artifact lưu MinIO.
- [ ] SHA256 tính đúng.
- [ ] Latest endpoint trả đúng version.
- [ ] Device tải và flash được.
- [ ] Progress hiển thị.
- [ ] Bad checksum bị reject.
- [ ] Rollback test pass.

## 4. Done cho ML model

- [ ] Dataset version rõ.
- [ ] Validation dữ liệu pass.
- [ ] Train script reproducible seed.
- [ ] Metrics log MLflow.
- [ ] Model card có limitations.
- [ ] Quantized model evaluate lại.
- [ ] Size/latency/RAM đo hoặc ghi TODO rõ.
- [ ] Model chỉ promote nếu vượt gate.

## 5. Done cho DevOps

- [ ] Dockerfile build được.
- [ ] Container non-root nếu có thể.
- [ ] Healthcheck/ready check.
- [ ] Config qua env.
- [ ] Resource request/limit khi lên K3s.
- [ ] Secret không commit.
- [ ] Có runbook deploy/rollback.

## 6. Done cho UI

- [ ] Page chạy không lỗi console nghiêm trọng.
- [ ] Loading/error/empty states.
- [ ] API client tách riêng.
- [ ] TypeScript type rõ.
- [ ] Form validate input.
- [ ] Realtime event không làm crash UI.

## 7. Done cho tài liệu đồ án

- [ ] Có mục tiêu và phạm vi rõ.
- [ ] Có kiến trúc/sơ đồ.
- [ ] Có giải thích quyết định kỹ thuật.
- [ ] Có số liệu đo.
- [ ] Có hạn chế trung thực.
- [ ] Có hướng phát triển.
- [ ] Có reference nếu dùng ý tưởng/công nghệ từ nguồn khác.

## 8. Done cuối cùng trước bảo vệ

- [ ] Clone repo + làm theo README chạy được core demo.
- [ ] Demo OTA live hoặc video backup.
- [ ] Demo TinyML/model update.
- [ ] Demo alert/anomaly.
- [ ] Slide không quá chữ.
- [ ] Có backup plan nếu mạng/thiết bị lỗi.
- [ ] Có trả lời sẵn cho câu hỏi: “Điểm mới của đề tài là gì?”, “Nếu firmware lỗi thì sao?”, “Làm sao biết model tốt?”, “Hệ thống mở rộng thế nào?”
