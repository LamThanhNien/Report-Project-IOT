# Công cụ vận hành

- `seed_admin.py`: tạo admin nếu chưa có. Đặt `ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD`, `ADMIN_SEED_FULLNAME` trước khi chạy.
- `aifom_mdns_publisher.py`, `start_mdns_publisher.bat`: quảng bá MQTT cho ESP32 trên mạng LAN.
- `check_mdns_mqtt.py`, `check_mdns.bat`, `check_aifom_network.ps1`: kiểm tra discovery/kết nối mạng.
- `generate_mqtt_passwords.sh`, `rotate_mqtt_certs.sh`: công cụ cấu hình broker; đọc script trước khi dùng.
- `fix_device.py`: công cụ sửa dữ liệu thiết bị thủ công.
- `reset_service_plans.py`: seed các mặc định còn thiếu, giữ nguyên plan và tenant bindings hiện có; quota/feature core vẫn phục vụ chức năng vận hành.

Không còn cụm simulator hoặc công cụ promote/deploy ML trong phạm vi này.

- `seed_demo.py`: tạo bộ dữ liệu/tài khoản test riêng cho development, chạy lặp và giữ dữ liệu ngoài demo. Chạy `run-aifom.bat seed-demo`; xem [dữ liệu demo](../docs/demo/demo-data.md).
- `test_launcher.ps1`: kiểm tra visibility cửa sổ log, toggle `.env` và đồng bộ account helper; không mở cửa sổ test thực.

```bash
make seed-admin
```

Hoặc chạy trong container API:

```bash
python /workspace/scripts/seed_admin.py
```

Không dùng công cụ reset khi cần bảo toàn dữ liệu hiện có.
