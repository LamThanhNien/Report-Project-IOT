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

# 11 – Security & OTA Safety

## 1. Mục tiêu bảo mật

Bảo mật trong đồ án cần tập trung vào những điểm có giá trị chứng minh cao:

- Device identity.
- Transport encryption.
- Firmware integrity.
- Firmware authenticity.
- Rollback safety.
- Secret management.
- Audit log.

Không cần làm bảo mật enterprise phức tạp, nhưng phải làm đúng nguyên tắc.

## 2. Threat model STRIDE rút gọn

| Threat | Ví dụ | Biện pháp |
|---|---|---|
| Spoofing | Thiết bị giả gửi telemetry | device token/mTLS, registry |
| Tampering | Sửa firmware trên đường truyền | HTTPS, sha256, signature |
| Repudiation | Admin phủ nhận đã rollout | audit log |
| Information disclosure | Lộ token/key | secrets, không log secret, TLS |
| Denial of Service | MQTT flood | rate limit, auth, alert |
| Elevation of privilege | User thường upload firmware production | RBAC |

## 3. Device identity theo giai đoạn

### Giai đoạn 1 – demo đơn giản

- Device có `device_uid` + `device_token`.
- Token lưu NVS.
- MQTT username/password hoặc token.

### Giai đoạn 2 – tốt hơn

- Mỗi device có client certificate.
- Mosquitto bật mTLS.
- Registry lưu cert fingerprint.

## 4. Firmware signing

Khuyến nghị dùng Ed25519 vì chữ ký nhỏ và nhanh.

Flow:

```txt
CI build firmware -> compute sha256 -> sign sha256/private key -> upload firmware + signature -> device download -> verify sha256 -> verify signature/public key -> flash
```

Public key nhúng vào firmware factory hoặc partition config chỉ đọc.

Private key chỉ nằm trong:

- GitHub Secret/self-hosted runner secret, hoặc
- máy ký release offline.

Không đưa private key vào AI.

## 5. Firmware metadata

```json
{
  "version": "1.2.3",
  "target_hardware": "esp32-devkit-v1",
  "size_bytes": 512000,
  "sha256": "hex",
  "signature_alg": "ed25519",
  "signature": "base64",
  "created_at": "2026-05-18T10:00:00Z"
}
```

## 6. OTA safety rules

Device phải reject update nếu:

- target hardware không khớp.
- version thấp hơn current, trừ khi command rollback hợp lệ.
- size lớn hơn partition.
- sha256 mismatch.
- signature invalid.
- URL không dùng HTTPS ở production/staging.
- device đang OTA job khác.

## 7. Rollback policy

Firmware mới sau reboot ở trạng thái `PENDING_VERIFY`.

Self-test tối thiểu:

- NVS đọc được.
- Wi-Fi init không crash.
- MQTT connect hoặc ít nhất network stack OK.
- Main tasks start được.
- Publish heartbeat success.

Nếu trong N phút không mark valid:

- bootloader rollback về partition cũ.
- device báo `rolled_back` khi online lại.

## 8. Server-side quarantine

Nếu rollout failure rate > threshold:

- Pause rollout.
- Firmware status -> `quarantined`.
- Không trả firmware này trong `/latest`.
- Alert admin.
- Tạo audit log.

## 9. Upload security

OTA server phải:

- Limit file size.
- Chỉ nhận `.bin`.
- Không trust filename.
- Lưu object key bằng UUID.
- Compute sha256 server-side.
- Validate metadata.
- Scan artifact optional.

## 10. Auth/RBAC Admin

Roles:

| Role | Permission |
|---|---|
| viewer | xem dashboard/device |
| operator | trigger rollout staging/canary |
| admin | upload/promote firmware/model, manage users |

Giai đoạn đầu có thể chỉ có admin, nhưng API nên thiết kế mở rộng.

## 11. Audit log actions

- user.login
- firmware.uploaded
- firmware.promoted
- rollout.created
- rollout.paused
- rollout.cancelled
- device.quarantined
- model.promoted
- secret.rotated

## 12. TLS/mTLS Mosquitto checklist

- Tạo CA riêng.
- Tạo server cert cho broker.
- Tạo client cert cho mỗi device.
- Mosquitto config require_certificate true.
- Map cert CN -> device_uid nếu có thể.
- Cert expiry có alert.

## 13. Secure boot/flash encryption

Chỉ bật sau khi OTA cơ bản ổn.

Cảnh báo: ESP32 eFuse là one-time programmable. Luôn test trên thiết bị dự phòng. Ghi rõ trong luận văn là tính năng này được đánh giá có kiểm soát, không bật đại trà nếu chưa chắc.

## 14. Acceptance criteria

- Firmware verify sha256 trước khi flash.
- Firmware verify signature trước khi flash.
- Firmware sai chữ ký bị reject.
- Firmware crash bị rollback.
- Server pause rollout khi failure rate vượt ngưỡng.
- Không có secret thật trong repo.
