> [!IMPORTANT]
> **LƯU Ý DÀNH CHO HỘI ĐỒNG BẢO VỆ VÀ PHẢN BIỆN (THESIS DEFENSE SCOPE NOTICE)**
>
> Bộ câu hỏi bảo vệ này bao gồm cả **Phạm vi triển khai thực tế (Current Scoped Implementation)** và **Định hướng nghiên cứu mở rộng (Historical Academic Research / Future Work)**:
> 1. **Phần triển khai thực tế (Live Demo & Codebase)**: Tập trung vào Quản lý thiết bị IoT đa khách hàng, Giao tiếp MQTT (telemetry, status, commands ACK), Quy trình OTA Firmware an toàn với xác thực SHA256/Token và bootloader rollback trên bo mạch ESP32 thật, Phân quyền 3 vai trò (`admin`, `tenant_owner`, `viewer`).
> 2. **Phần nghiên cứu mở rộng (Học thuật / Trả lời hội đồng)**: Các nội dung về TinyML/Anomaly detection, MLOps, bộ giả lập Simulator quy mô lớn, và ngăn xếp giám sát Prometheus/Grafana đóng vai trò kiến thức nghiên cứu hệ thống và giải pháp mở rộng trong tương lai, không nằm trong kịch bản demo trực tiếp của phiên bản phần mềm nghiệm thu.
> 3. **Tham chiếu phạm vi chuẩn**: Xem chi tiết tại [`docs/scope.md`](../scope.md) và [`docs/reports/engineer-removal-2026-10-03.md`](../reports/engineer-removal-2026-10-03.md).

# Defense Questions — AIFOM

Anticipated questions for the graduation defense, organized by topic.
Each question includes a concise answer and references to supporting evidence.

---

## 1. System Architecture

### Q: Why a modular monolith instead of microservices?

**A**: For a small-to-medium IoT platform, a modular monolith provides:
- Simpler deployment (single Docker Compose stack)
- Lower operational overhead (no service mesh, no distributed tracing)
- Easier local development (one repo, one container)
- Sufficient scalability for the target workload (hundreds of devices, not millions)

The codebase is organized into bounded contexts (`backend/app/bounded_contexts/`)
and legacy modules (`backend/app/modules/`), making future migration to
microservices possible if needed.

**Reference**: `docs/adr/ADR-001-modular-monolith.md`

### Q: Why TimescaleDB instead of plain PostgreSQL?

**A**: TimescaleDB extends PostgreSQL with:
- Automatic time-based partitioning (hypertables) for telemetry data
- Efficient time-range queries
- Built-in data retention policies
- Full SQL compatibility (no new query language)

Telemetry data is inherently time-series, and TimescaleDB handles this
naturally without sacrificing relational capabilities for device/user/OTA data.

### Q: How does the system handle multi-tenancy?

**A**: Multi-tenancy is implemented at the database level:
- Each user has a `tenant_id` foreign key
- All tenant-scoped queries filter by `tenant_id` resolved from the JWT token
- `tenant_id` is NEVER taken from the request body (security rule)
- Admin routes bypass tenant filtering
- Tenant isolation is verified by automated tests (`test_03_tenant_isolation.py`)

**Reference**: `backend/app/modules/auth/`, `tester/api/test_03_tenant_isolation.py`

---

## 2. MQTT and Device Communication

### Q: Why MQTT instead of HTTP for device communication?

**A**: MQTT is the standard IoT protocol because:
- Lightweight (minimal packet overhead, suitable for constrained devices)
- Publish/subscribe model (devices don't need to know the server address)
- QoS levels (0, 1, 2) for reliable delivery
- Last Will and Testament (LWT) for automatic offline detection
- Persistent connections (lower latency than HTTP polling)

### Q: How do devices discover the MQTT broker?

**A**: Two mechanisms:
1. **mDNS (primary)**: The host publishes `_aifom-mqtt._tcp.local` and
   `_mqtt._tcp.local` services. The ESP32 firmware queries mDNS to discover
   the broker IP and port automatically.
2. **Direct IP (fallback)**: If mDNS fails (e.g., on networks that block
   multicast), the firmware can be configured with a hardcoded broker IP.

**Reference**: `tools/aifom_mdns_publisher.py`, `iot/firmware/components/mqtt_client/`

### Q: What happens when a device goes offline?

**A**: The MQTT broker uses LWT (Last Will and Testament):
- On connect, the device sets a will message: `{"status": "offline"}` on
  `devices/{uid}/status` with QoS 1 and retain=true
- If the device disconnects unexpectedly, the broker publishes the will message
- The backend subscriber receives this and updates `devices.status = offline`
- The frontend reflects this in the dashboard (online/offline counts)

### Q: How does the system handle unknown devices?

**A**: Telemetry from unregistered device UIDs is dropped (not stored). The
API log emits `MQTT telemetry ignored unknown device_uid=...`. This prevents
data pollution and potential security issues from spoofed device UIDs.

---

## 3. OTA (Over-The-Air) Updates

### Q: Explain the OTA state machine.

**A**: The OTA job progresses through these states:
```
pending → sent → downloading → flashing → rebooting → success
                                                  → failed
```
1. **pending**: Job created in database
2. **sent**: MQTT message published to device
3. **downloading**: Device confirms it's downloading the firmware
4. **flashing**: Device is writing firmware to flash memory
5. **rebooting**: Device is restarting with new firmware
6. **success/failure**: Terminal state reported by device

The backend tracks `started_at` (at downloading) and `completed_at` (at
terminal state).

### Q: How is firmware integrity verified?

**A**: Three layers:
1. **SHA-256 checksum**: Computed server-side on upload, stored in the
   firmware record, and sent in the OTA payload. The device verifies the
   downloaded binary against this hash before flashing.
2. **Signed download tokens**: Firmware downloads require a short-lived JWT
   token (signed with `OTA_TOKEN_SECRET`), preventing unauthorized access.
3. **ESP32 bootloader rollback**: If the new firmware fails to call
   `mark_running_valid()` within 15 seconds, the bootloader rolls back to
   the previous image.

### Q: What if OTA fails during the demo?

**A**: See `docs/demo/ota-fallback-plan.md` for complete recovery procedures.
Key points:
- If the broker is down: restart it, create a new job
- If the ESP32 is offline: restore Wi-Fi/MQTT and verify the registered UID
- If download or verification fails: inspect device logs, firmware compatibility and the device-facing URL before retrying
- If all else fails: explain the architecture without live demo

---

## 4. Security

### Q: How are passwords stored?

**A**: Passwords are hashed with bcrypt (via `passlib`). The hash includes
a random salt, making rainbow table attacks infeasible. The backend never
stores or logs plaintext passwords.

### Q: How does JWT authentication work?

**A**:
1. User logs in with email/password
2. Backend verifies credentials, returns a JWT access token
3. Token contains `sub` (user ID), `role`, and `tenant_id` claims
4. All protected routes validate the JWT signature and expiry
5. A token blacklist (in-memory) supports immediate revocation on logout

**Security measures**:
- JWT secret must be ≥ 64 hex characters (validated at startup)
- Token expiry: 30 minutes (configurable)
- SameSite cookies for web UI
- Legacy token response disabled in production

### Q: How is tenant data isolated?

**A**: Every tenant-scoped API route:
1. Extracts `user_id` from JWT
2. Looks up `user.tenant_id` from the database
3. Filters all queries by `tenant_id`
4. Returns 404 (not 403) if a resource belongs to another tenant (prevents
   information leakage about resource existence)

Admin routes bypass tenant filtering. This is tested by
`test_03_tenant_isolation.py` (6 tests covering cross-tenant access denial).

### Q: What about the security audit findings?

**A**: The security audit found 30 issues:
- **2 Critical**: Committed credentials (SEC-001), Arduino compiler RCE (SEC-002)
- **6 High**: JWT in localStorage, hardcoded demo creds, MQTT spoofing, etc.
- **10 Medium**: No firmware signing, weak password policy, etc.

For the demo/thesis context:
- Committed `.env` is gitignored (`.env.example` has placeholders)
- Arduino compiler is disabled by default (`ENABLE_SOURCE_FIRMWARE_COMPILE=false`)
- Demo credentials are development-only (documented in README)
- MQTT uses authenticated connections (username/password)

**Reference**: `docs/reports/p0-security-patch-report.md`

---

## 5. Frontend and User Experience

### Q: Why React instead of a simpler framework?

**A**: React 18 with Vite provides:
- Component-based architecture for reusable UI elements
- TanStack Query for server state management (caching, refetching)
- React Router 6 for client-side routing
- TypeScript for type safety
- Fast development with HMR (Hot Module Replacement)

The frontend is a single-page application (SPA) that communicates with the
backend via REST API.

### Q: How does the frontend handle different user roles?

**A**: Role-based UI rendering:
- **Admin**: Full platform access (Dashboard, Devices, Firmware, OTA, Tenants, Audit Logs, System Settings)
- **Tenant Owner**: Customer Workspace (own devices, project canvas, datastreams, commands, automation, firmware, OTA, team management)
- **Viewer**: Read-only tenant access (inspect devices, telemetry, OTA history, alerts; no write or command actions)
*(Lưu ý: Các vai trò kỹ sư `platform_engineer` và `tenant_engineer` đã được lược bỏ khỏi hệ thống vào ngày 03/10/2026 để tinh gọn và tăng cường bảo mật).*

The frontend reads the user's role from `/api/v1/auth/me` and conditionally
renders navigation items and action buttons.

---

## 6. Testing

### Q: What is the test coverage?

**A**: The test suite includes:
- **69 API tests** (pytest, 10 files): health, auth, tenants, tenant isolation, devices, firmware, OTA, telemetry, viewer protection
- **13 MQTT tests** (3 files): broker connectivity, OTA publish, ESP32 contract validation
- **18 E2E tests** (Playwright, 3 specs): admin flow, tenant flow, OTA flow
- **Total**: 100 tests across 16 test files

All API tests run offline (no real Postgres/MQTT/MinIO needed) using test
fixtures and mocks.

### Q: How do you test MQTT without a real broker?

**A**: API tests mock the MQTT client. The MQTT test suite connects to a real
broker (running in Docker) to verify:
- Broker connectivity
- Topic subscription
- Message publish/subscribe
- OTA message format

**Reference**: `tester/mqtt/`, `tester/api/conftest.py`

---

## 7. IoT and Edge Computing

### Q: [Nghiên cứu học thuật / Future Work] What is TinyML's role in this system?

**A**: TinyML và Trí tuệ nhân tạo biên được định vị là **định hướng nghiên cứu học thuật mở rộng (Future Work)** — không nằm trong lõi vận hành thực tế của phiên bản phần mềm nghiệm thu hiện tại.
Trong nghiên cứu kiến trúc luận văn:
- Nền tảng được thiết kế hỗ trợ quản lý firmware chứa mô hình ML và phân phối OTA mô hình cập nhật xuống thiết bị.
- Mô hình hoá Device Type và Intelligence Profile APIs là bản thiết kế mở rộng dài hạn.
Sản phẩm cốt lõi đã triển khai và nghiệm thu tập trung vào **Quản lý thiết bị IoT đa khách hàng, Giao tiếp MQTT, Điều khiển từ xa, Rule Automation và Cập nhật Firmware OTA an toàn**.

### Q: [Nghiên cứu học thuật / Future Work] Why is anomaly detection server-side instead of on-device?

**A**: Đối với phạm vi nghiên cứu học thuật của luận văn:
- Mô hình phát hiện bất thường server-side sử dụng IsolationForest (scikit-learn) được triển khai như một nghiên cứu đối chiếu học thuật nhằm đánh giá độ trễ và tính khả thi giữa suy luận tập trung so với suy luận tại biên (edge inference).
- Trong phiên bản sản phẩm triển khai và nghiệm thu thực tế, module server-side IsolationForest không chạy trong production nhằm tối ưu hóa tài nguyên phần cứng và tinh giản hệ thống.
- Cả hai cơ chế (suy luận biên TinyML và phát hiện bất thường server-side) được bảo vệ và trình bày dưới dạng tài liệu nghiên cứu học thuật và định hướng phát triển tương lai.

### Q: How do you validate real hardware behavior?

**A**: Build and flash the ESP32 firmware, configure Wi-Fi/MQTT credentials,
register its UID and assign it to the correct tenant. Observe serial logs and
backend records for telemetry, presence, command results and OTA progress.
MQTT contract tests verify message handling; successful flashing and booting
require verification on the physical board.

**Reference**: [ESP32 setup](../esp32_firmware_setup.md)

---

## 8. Deployment and Operations

### Q: How is the system deployed?

**A**: Docker Compose for development and demonstration:
- `docker-compose.dev.yml`: 4 dịch vụ cốt lõi đang chạy thực tế: API backend (FastAPI), Cơ sở dữ liệu (PostgreSQL/TimescaleDB), MQTT Broker (Eclipse Mosquitto), Object Storage (MinIO).
- `docker-compose.observability.yml`: Prometheus & Grafana (ngăn xếp giám sát tùy chọn cho nghiên cứu học thuật).
- `docker-compose.ml.yml`: MLflow tracking server (ngăn xếp MLOps tùy chọn cho nghiên cứu học thuật).
- `docker-compose.prod.yml`: Cấu hình triển khai production.

For production, the same containers can be deployed to any Docker-compatible
host (cloud VM, Kubernetes, etc.).

### Q: How do database migrations work?

**A**: Alembic manages schema migrations:
- Migrations run automatically on API startup (`alembic upgrade head`)
- New migrations are created with `alembic revision --autogenerate`
- The system validates migration success before marking `/ready`

**Reference**: `backend/alembic/`, `Makefile` (`migrate`, `migrate-new`)

---

## 9. Limitations and Future Work

### Q: What are the main limitations?

**A**:
1. **Single-server deployment**: No horizontal scaling or load balancing
2. **In-memory token blacklist**: Lost on restart (acceptable for dev/demo)
3. **No firmware signing**: Only SHA-256 checksum, no cryptographic signatures
4. **MQTT plaintext**: No TLS in development (configurable for production)
5. **No real-time frontend updates**: Uses polling, not WebSocket/SSE
6. **Limited device types**: Only ESP32 currently supported

### Q: What would you do differently with more time?

**A**:
1. Implement firmware signing (Ed25519 or RSA)
2. Add WebSocket support for real-time dashboard updates
3. Implement proper token blacklist (Redis-backed)
4. Add MQTT TLS support
5. Support multiple device types (Arduino, Raspberry Pi, etc.)
6. Implement device groups and bulk OTA campaigns
7. Add audit logging for all write operations
8. Implement rate limiting per tenant

---

## 10. Demo-Specific Questions

### Q: What if a physical device is unavailable during the demo?

**A**: Use a spare ESP32 that has already been flashed and configured, or show
existing firmware/OTA history and explain which live checks could not be
performed. Without a connected board, telemetry and OTA success cannot be
demonstrated live.

### Q: How long does the full demo take?

**A**: Approximately 10-15 minutes:
1. Stack startup + seeding: ~2 minutes
2. Show devices and telemetry: ~2 minutes
3. Firmware upload: ~1 minute
4. OTA lifecycle: ~2 minutes
5. Remote Commands & Automation: ~2 minutes
6. Failure scenarios: ~2 minutes
7. Q&A: ongoing

See `docs/demo/demo-script.md` for the full walkthrough.
