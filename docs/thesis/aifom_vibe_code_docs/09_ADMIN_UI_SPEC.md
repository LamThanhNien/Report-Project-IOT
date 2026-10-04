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

# 09 – Admin Console & Customer Workspace Specification

## 1. Mục tiêu UI

Nền tảng có hai mặt giao diện:

**Admin Console** (dành cho Platform Admin):
- Quản lý toàn nền tảng: tenant/khách hàng, device fleet, firmware toàn cục, OTA monitoring.
- Xem fleet có bao nhiêu device, device nào online/offline.
- Upload firmware (global), trigger OTA (global rollout).
- Xem health anomaly/alert.
- Xem audit log.
- Quản lý users và RBAC.
- System health và Prometheus/Grafana links.

**Customer Workspace** (dành cho Tenant Owner / Viewer):
- Chỉ thấy dữ liệu của mình: thiết bị được gán, firmware đã upload, OTA campaigns.
- Upload firmware `.bin` đã compile và tạo OTA campaign.
- Theo dõi tiến trình OTA, xem telemetry, alert.
- Tenant Owner: upload và tạo OTA, gửi commands, quản lý team. Viewer: xem-only.

## 2. Stack

- React 18
- Vite
- TypeScript
- TailwindCSS
- shadcn/ui (optional)
- React Query
- Recharts
- WebSocket client (M1 — polling ở M0)

## 3. Admin Console Routes

| Route | Mục đích |
|---|---|
| `/login` | Đăng nhập admin |
| `/dashboard` | Tổng quan fleet |
| `/tenants` | Danh sách tenant/khách hàng |
| `/tenants/:id` | Chi tiết tenant: users, devices, service plan |
| `/users` | Quản lý users và phân quyền RBAC |
| `/devices` | Danh sách thiết bị toàn nền tảng |
| `/devices/:id` | Chi tiết thiết bị |
| `/firmwares` | Quản lý firmware toàn cục |
| `/rollouts` | Rollout/OTA jobs toàn cục |
| `/telemetry` | Xem telemetry theo device/tenant |
| `/alerts` | Alert list — offline, OTA failure, anomaly |
| `/audit-logs` | Audit log hành động Admin và Tenant |
| `/system` | System health, Prometheus/Grafana links |
| `/settings` | Config nền tảng cơ bản |
| `/service-plans` | Quản lý service plan (feature flags) |

## 4. Admin Dashboard widgets

- Total devices
- Online devices
- Offline devices
- Total tenants active
- Firmware distribution pie/bar
- OTA success/failure last 24h
- Latest alerts (offline + OTA failure)
- Optional: Health anomaly top 10 (M1)

## 5. Admin Device table columns

| Column | Meaning |
|---|---|
| Device UID | ID thiết bị |
| Name | display name |
| Tenant | tenant được gán |
| Device Type | loại phần cứng |
| Status | online/offline/quarantined |
| Firmware | current firmware version |
| RSSI | latest Wi-Fi RSSI |
| Last seen | timestamp |
| Actions | detail, trigger OTA, quarantine |

## 6. Admin Tenant Management

### Tenant list page (`/tenants`)

- Danh sách tenant: name, slug, plan, device count, user count, status.
- Nút "Tạo Tenant" mở form/modal:
  - Tên tenant, Slug, Service plan, Contact email
  - (Optional) Tạo luôn tenant owner account: email, password, full name
- Row actions: view detail, suspend, delete.

### Tenant detail page (`/tenants/:id`)

Tabs:

1. **Overview**: plan info, created_at, status.
2. **Thiết bị**: danh sách device được gán. Nút "Gán thiết bị" chọn từ device chưa gán. Nút "Bỏ gán".
3. **Users**: danh sách user thuộc tenant (Owner/Engineer/Viewer). Nút "Tạo user".
4. **Service plan / Features**: hiển thị feature flags, override nếu cần.

## 7. Admin Firmware page

- Upload `.bin`, nhập version, hardware, release notes.
- Show sha256, size, status, created_at.
- Promote: signed → staging → production.
- Create rollout từ firmware đã chọn.

## 8. Admin Rollout page

- Rollout name, firmware target, strategy, total jobs.
- Success/fail/pending count, progress bar, failure rate.
- Pause/resume/cancel buttons (M1).

## 9. Admin Audit Log page (`/audit-logs`)

Hiển thị:

- Timestamp, actor (admin hoặc tenant user), action type, target resource, tenant context, IP, kết quả.
- Filter: by actor, by action type, by tenant, by date range.
- Export CSV.

Các action được log:

- Admin: tạo/sửa/xóa tenant, gán/bỏ gán device, upload firmware, tạo rollout.
- Tenant: upload firmware, tạo OTA campaign, cancel campaign.
- Auth: login success/fail, logout.

## 10. Admin Device detail page

Tabs:

1. Overview — firmware version, device type, intelligence profile (nếu có)
2. Telemetry chart
3. Health metrics
4. OTA history
5. Optional: Intelligence results (anomaly, prediction) — nếu device type có intelligence profile
6. Logs

## 11. WebSocket integration (M1)

Hook:

```ts
useRealtimeEvents({
  onDeviceStatusChanged,
  onOtaProgressUpdated,
  onAlertCreated,
});
```

UI behavior:

- OTA progress update không cần refresh.
- Alert toast khi có anomaly.
- Device status chuyển màu online/offline realtime.

M0 dùng polling thay thế (mỗi 10 giây).

## 12. Customer Workspace Routes

| Route | Mục đích |
|---|---|
| `/client/login` | Đăng nhập tenant user |
| `/client/dashboard` | Tổng quan: số device, OTA status, alerts gần đây |
| `/client/devices` | Danh sách thiết bị của tenant |
| `/client/devices/:id` | Chi tiết thiết bị |
| `/client/device-groups` | Nhóm thiết bị (nếu implement) |
| `/client/firmware` | Danh sách firmware của tenant |
| `/client/firmware/upload` | Upload firmware `.bin` mới |
| `/client/ota-campaigns` | Danh sách OTA campaigns |
| `/client/ota-campaigns/new` | Tạo OTA campaign mới |
| `/client/ota-campaigns/:id` | Chi tiết + tiến trình OTA |
| `/client/telemetry` | Xem telemetry theo device |
| `/client/alerts` | Cảnh báo thiết bị |
| `/client/intelligence` | Optional: kết quả TinyML/anomaly (feature-gated) |
| `/client/team` | Quản lý thành viên nhóm (Owner only) |

## 13. Customer Workspace — Firmware Upload flow

1. Tenant Engineer/Owner chọn file `.bin` (compiled firmware binary).
2. Nhập metadata: version (SemVer), target hardware (Device Type), release notes.
3. System tính SHA256, lưu MinIO, tạo firmware version record.
4. Firmware xuất hiện trong danh sách, có thể dùng để tạo OTA campaign.

**MVP**: chỉ upload `.bin` đã compile sẵn.
**Future work**: upload source code `.zip` → auto build (cần sandboxing, resource limits — OUT of scope MVP).

## 14. Customer Workspace — OTA Campaign flow

1. Tenant chọn firmware version đã upload.
2. Chọn target: device cụ thể, device group, hoặc tất cả thiết bị của tenant.
3. Tạo campaign → hệ thống publish MQTT command đến thiết bị.
4. Trang campaign hiển thị progress realtime: pending → sent → downloading → flashing → success/failed.
5. Tenant có thể cancel campaign (device chưa nhận lệnh sẽ bị bỏ qua).

## 15. Customer Workspace — Dashboard widgets

- Total devices assigned
- Online/offline devices
- Active OTA campaigns (count + overall progress)
- Latest alerts
- Recent firmware versions
- Optional: Intelligence results (nếu feature bật)

## 16. Customer Workspace — Navigation sidebar

```
Dashboard
My Devices
  Device Groups (nếu implement)
Firmware
  Upload Firmware
OTA Campaigns
Telemetry
Alerts
Intelligence  ← feature-gated, chỉ hiện nếu device type có intelligence profile
Team          ← Tenant Owner only
```

Nền tảng gồm 2 giao diện bảng điều khiển chính:
1. **Admin Console** (`/console/*`): Dành riêng cho Quản trị viên hệ thống (`admin`).
2. **Customer Workspace** (`/client/*`): Dành cho người dùng Tenant (`tenant_owner` quản trị và `viewer` chỉ xem).

*(Ghi chú: Toàn bộ bảng điều khiển kỹ sư `/console/engineer` đã được gỡ bỏ khỏi hệ thống vào ngày 03/10/2026).*

## 17. Feature gating theo service plan

| Feature key | Mô tả |
|---|---|
| `firmware_upload` | Cho phép tenant upload firmware |
| `ota_campaigns` | Cho phép tạo OTA campaign |
| `intelligence_results` | Hiển thị kết quả TinyML/anomaly (optional per device type) |
| `advanced_telemetry` | Bật chart telemetry nâng cao |
| `team_management` | Cho phép tenant owner quản lý team |

Frontend fetch `/api/v1/client/features` khi login, ẩn menu nếu feature bị tắt.

## 18. TypeScript types chính

```ts
export type DeviceStatus = 'unknown' | 'online' | 'offline' | 'maintenance' | 'quarantined';

export interface Device {
  id: string;
  device_uid: string;
  display_name?: string;
  hardware_model: string;
  device_type?: string;
  firmware_version?: string;
  intelligence_profile?: string; // optional — null nếu device type không có
  status: DeviceStatus;
  tenant_id: string;
  last_seen_at?: string;
}

export interface OtaCampaign {
  id: string;
  name: string;
  firmware_version: string;
  target_device_type?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  created_by: string;
  tenant_id: string;
  total_devices: number;
  success_count: number;
  failed_count: number;
  pending_count: number;
}
```

## 19. Acceptance criteria

**Admin Console:**

- Login được bằng admin account.
- Dashboard load số liệu thật từ API.
- Device table filter được online/offline.
- Upload firmware thành công.
- Trigger rollout cho 1 device.
- Tạo tenant và tenant owner thành công.
- Gán device cho tenant thành công.
- Audit log hiển thị hành động vừa làm.

**Customer Workspace:**

- Tenant login được với `tenant1@aifom.local` / `tenant1234`.
- Tenant chỉ thấy thiết bị được gán cho tenant mình.
- Tenant upload firmware `.bin` thành công.
- Tenant tạo OTA campaign và thiết bị nhận lệnh OTA.
- OTA progress hiển thị đúng trạng thái.
- Thử truy cập thiết bị của tenant khác → bị chặn (404/403).
- Viewer không thấy nút upload/create OTA.
