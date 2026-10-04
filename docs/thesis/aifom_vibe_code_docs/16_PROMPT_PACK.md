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

# 16 – Prompt Pack cho AI Vibe Code

## 1. Prompt khởi tạo phiên làm việc

```txt
Bạn là AI coding agent cho dự án AIFOM – IoT OTA + Edge MLOps + DevOps. Hãy đọc 00_MASTER_CONTEXT.md, 02_ARCHITECTURE.md, 03_REPO_AND_CODE_STANDARDS.md trước. Không sinh toàn bộ project một lần. Luôn chia thành file nhỏ, có test, có cách chạy. Không hardcode secret. Nếu thiếu thông tin, chọn mặc định đơn giản và ghi TODO rõ.
```

## 2. Prompt sinh skeleton repo

```txt
Dựa trên tài liệu repo structure, hãy tạo skeleton repository AIFOM. Chỉ tạo thư mục, README module rỗng có mục tiêu, .env.example, Makefile, docker-compose.dev.yml tối thiểu và pyproject template cho một FastAPI service mẫu. Không viết business logic ở bước này. Sau khi tạo xong, liệt kê cây thư mục và cách chạy make up.
```

## 3. Prompt sinh device-registry

```txt
Dựa trên 04_DATABASE_SCHEMA.md, 05_API_CONTRACTS.md và 06_BACKEND_SERVICES_SPEC.md, hãy triển khai device-registry FastAPI service. Phạm vi lần này chỉ gồm:
1. SQLAlchemy model Device và DeviceCredential.
2. Pydantic schemas RegisterDeviceRequest, DeviceResponse, HeartbeatRequest.
3. DeviceRepository.
4. DeviceService với register_device, heartbeat, list_devices.
5. Router /devices/register, /devices/{device_uid}/heartbeat, /devices.
6. pytest unit tests cho duplicate device, heartbeat update last_seen, filter status.
Không triển khai auth thật ở bước này, chỉ để TODO dependency.
```

## 4. Prompt sinh OTA upload/download

```txt
Triển khai ota-server giai đoạn đầu. Phạm vi:
1. Firmware SQLAlchemy model theo schema.
2. FirmwareUpload schema/response.
3. StorageService interface và MinIO implementation.
4. FirmwareService upload: validate SemVer, file size, compute sha256, store object, insert DB.
5. Download endpoint /firmwares/{id}/download.
6. Latest endpoint /firmwares/latest.
7. Tests: empty file, duplicate version, invalid SemVer, latest update/no update.
Tuân thủ lỗi chuẩn {error:{code,message,details},request_id}.
```

## 5. Prompt sinh OTA state machine

```txt
Hãy triển khai OTA job state machine trong ota-server. Dựa trên trạng thái pending, notified, downloading, verifying, flashing, rebooting, success, failed, rolled_back, cancelled. Tạo hàm validate_transition(old,new). Viết test đầy đủ cho transition hợp lệ và không hợp lệ. Sau đó tích hợp vào endpoint POST /ota/jobs/{job_id}/progress.
```

## 6. Prompt sinh telemetry-ingest

```txt
Triển khai telemetry-ingest service. Phạm vi:
1. MQTT subscriber dùng paho-mqtt hoặc asyncio-mqtt.
2. Subscribe dev/+/telemetry, dev/+/health, dev/+/status, dev/+/prediction, dev/+/ota/progress.
3. Parse topic lấy device_uid và topic_type.
4. Validate JSON payload theo schema_version 1.0.
5. Ghi telemetry/health vào TimescaleDB.
6. Log invalid payload nhưng không crash.
7. Metrics mqtt_messages_received_total và mqtt_messages_invalid_total.
8. Tests cho parse topic và validate payload.
```

## 7. Prompt sinh ESP32 Wi-Fi + MQTT

```txt
Dựa trên 07_FIRMWARE_ESP32_SPEC.md, hãy sinh code ESP-IDF cho components wifi_manager và mqtt_manager. Phạm vi:
1. wifi_manager init/connect/reconnect với exponential backoff.
2. mqtt_manager connect/subscribe dev/{device_uid}/cmd và fleet/{hardware_model}/cmd.
3. publish status JSON.
4. log rõ trạng thái.
5. Không hardcode Wi-Fi trong code, đọc từ menuconfig hoặc NVS placeholder.
6. Kèm hướng dẫn đặt vào project ESP-IDF và cách build.
```

## 8. Prompt sinh ESP32 OTA manager

```txt
Hãy sinh component ota_manager cho ESP-IDF. Phạm vi giai đoạn đầu:
1. Nhận metadata firmware gồm url, version, sha256, size_bytes.
2. Check target version khác current version.
3. Download bằng esp_https_ota.
4. Publish progress qua mqtt_manager callback.
5. Mark app valid sau self-test placeholder.
6. Handle error codes OTA_NETWORK_TIMEOUT, OTA_SHA256_MISMATCH, OTA_FLASH_FAILED.
7. Chưa cần signature ở bước này, nhưng để TODO rõ ở hàm verify_signature.
```

## 9. Prompt sinh device simulator

```txt
Hãy viết Python device simulator cho AIFOM. Yêu cầu:
1. Dùng asyncio.
2. Mô phỏng N devices.
3. Mỗi device publish telemetry mỗi 5s, health mỗi 60s.
4. Subscribe dev/{id}/cmd.
5. Khi nhận update_firmware, publish ota progress 0/25/50/75/100 và cập nhật firmware_version.
6. Có option --fault-profile normal|heap_leak|rssi_drop|reboot_loop|ota_fail.
7. Dockerfile và hướng dẫn chạy.
8. Unit test cho payload generation.
```

## 10. Prompt sinh ML training baseline

```txt
1. argparse.
2. Load train/val/test npz.
3. CNN 1D nhỏ <= 50K params.
4. Train, evaluate accuracy/f1/confusion matrix.
5. Log MLflow params/metrics/artifacts.
6. Save TensorFlow SavedModel.
7. Có seed reproducibility.
8. Có README cách chạy.
```

## 11. Prompt sinh quantization script

```txt
Viết script quantize_tflite.py nhận SavedModel và representative dataset, export TFLite int8. Sau khi export, chạy evaluation int8 trên test set và sinh report JSON gồm float32_accuracy, int8_accuracy, model_size_bytes. Không dùng code giả; nếu phần evaluate cần helper, tạo helper rõ.
```

## 12. Prompt sinh health-scorer

```txt
Triển khai health-scorer FastAPI service. Phạm vi:
1. HEALTH_FEATURES cố định theo tài liệu.
2. Pydantic schema ScoreRequest/ScoreResponse.
3. ModelLoader load joblib model từ local path trước, MLflow để TODO.
4. Endpoint POST /health/score.
5. Batch worker skeleton đọc latest health từ TimescaleDB và ghi health_scores.
6. Tests missing feature, normal vector, anomaly vector với fake model.
```

## 13. Prompt sinh Admin UI dashboard

```txt
Triển khai Admin UI React/Vite/TypeScript giai đoạn đầu. Phạm vi:
1. Layout sidebar.
2. Dashboard page có cards total/online/offline/ota failure.
3. Devices page table với filter status.
4. Firmware page upload form.
5. Rollout progress component.
6. API client tách riêng.
7. Mock fallback nếu API chưa sẵn.
8. Không dùng màu mè phức tạp, ưu tiên rõ và demo tốt.
```

## 14. Prompt sinh GitHub Actions backend

```txt
Hãy tạo .github/workflows/backend.yml cho services Python. Yêu cầu:
1. Trigger PR/push main khi paths backend/**.
2. Setup Python 3.11.
3. Install dependencies.
4. Run ruff, black --check, pytest.
5. Build Docker image cho service thay đổi nếu có thể.
6. Trivy scan image.
7. Không push image trên PR từ fork.
```

## 15. Prompt sinh tài liệu ADR

```txt
Dựa trên quyết định sau: [mô tả quyết định], hãy viết ADR theo template của dự án. Phải có Context, Decision, Alternatives, Consequences, Validation plan. Văn phong kỹ thuật, không quảng cáo, không nói quá.
```

## 16. Prompt review code AI sinh

```txt
Hãy review đoạn code sau theo vai trò senior engineer. Tập trung vào bug, security, edge case, test thiếu, maintainability. Không khen chung chung. Trả về bảng: vấn đề, mức độ, file/dòng, cách sửa. Sau đó đề xuất patch nhỏ nếu cần.
```

## 17. Prompt phản biện cuối sprint

```txt
Đóng vai hội đồng phản biện đồ án. Dựa trên phần đã làm trong sprint này: [mô tả], hãy đặt 10 câu hỏi khó về kiến trúc, bảo mật, kiểm thử, dữ liệu, khả năng mở rộng và tính thực tế. Sau mỗi câu hỏi, gợi ý câu trả lời ngắn nhưng không né tránh hạn chế.
```
