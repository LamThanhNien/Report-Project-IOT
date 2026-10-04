# Báo cáo sửa lỗi: Health Check chậm và Login 500

**Ngày:** 2026-05-30
**Trạng thái:** ĐÃ SỬA

---

## 1. Tóm tắt vấn đề

Sau đợt tối ưu gần nhất, dự án AIFOM gặp 2 lỗi runtime:

1. **Health check chậm (~1 phút):** `run-aifom.bat` bị treo tại bước "Running health checks" khoảng 60-90 giây.
2. **Login 500:** Frontend hiển thị "500 Internal Server Error" khi đăng nhập.

---

## 2. Nguyên nhân gốc (Root Cause)

### 2.1. Health check chậm

**File:** `run-aifom.ps1` dòng 489

```powershell
Wait-HttpEndpoint -Name "API /ready" -Url "$apiUrl/ready" -TimeoutSeconds 90 -IntervalSeconds 2
```

Script kiểm tra endpoint `/ready` với timeout 90 giây. Endpoint `/ready` (main.py:418-427) trả về HTTP 503 cho đến khi **tất cả** startup tasks hoàn thành (Alembic migrations, seed data, MinIO bucket, MQTT init, mDNS, device presence monitor).

Trong khi đó, endpoint `/health` (main.py:413-415) trả về 200 **ngay lập tức** — không phụ thuộc vào bất kỳ startup task nào.

**Kết quả:** Script chờ `/ready` chuyển sang 200, nhưng nếu startup chậm hoặc container crash, timeout 90 giây hết mà không có thông báo lỗi rõ ràng.

### 2.2. Login 500 — Container API crash do JWT_SECRET không an toàn

**File:** `backend/app/core/config.py` dòng 126-168

Hàm `_validate_secrets` (model validator) gọi `sys.exit(1)` khi phát hiện secret không an toàn:

```python
_INSECURE_JWT_SECRETS = frozenset({
    "changeme-replace-with-a-long-random-secret",
    ...
})

@model_validator(mode="after")
def _validate_secrets(self) -> "Settings":
    if self.jwt_secret.strip().lower() in _INSECURE_JWT_SECRETS:
        logger.critical("SECURITY: JWT_SECRET is set to an insecure default.")
        sys.exit(1)  # ← CRASH container
```

File `.env` có:
```
JWT_SECRET=changeme-replace-with-a-long-random-secret
```

Giá trị này nằm trong danh sách `_INSECURE_JWT_SECRETS` → container API gọi `sys.exit(1)` ngay khi khởi động → container crash → Docker restart loop.

Ngoài ra, `.env` thiếu `OTA_TOKEN_SECRET`, khiến giá trị mặc định `"changeme-ota-token-secret"` được dùng — cũng nằm trong danh sách `_INSECURE_OTA_SECRETS` → thêm một lý do crash.

**Kết quả:** Container API không thể khởi động → frontend gửi request login → nhận connection refused → hiển thị "500 Internal Server Error".

### 2.3. Thiếu cột `ip_address` trong audit_logs (nguyên nhân phụ)

**File:** `backend/alembic/versions/0005_database_improvements.py` dòng 79

Migration 0005 thêm cột `ip_address` vào bảng `audit_logs`. ORM model (`audit_models.py` dòng 37) tham chiếu cột này. Nếu database chỉ chạy đến migration 0004, cột `ip_address` chưa tồn tại.

Dù `audit_service.log_event` có try/except bắt lỗi, session SQLAlchemy có thể bị corrupt sau khi commit thất bại, gây lỗi không mong muốn ở các thao tác tiếp theo.

---

## 3. Các file đã thay đổi

| # | File | Thay đổi |
|---|------|----------|
| 1 | `.env` | Thay `JWT_SECRET` bằng giá trị an toàn (64-char hex). Thêm `OTA_TOKEN_SECRET` và `DEVICE_PROVISIONING_SECRET`. |
| 2 | `run-aifom.ps1` | Đổi health check từ `/ready` sang `/health` (nhanh). Giảm timeout từ 90s xuống 30s. Thêm fallback và hướng dẫn debug khi health check thất bại. |
| 3 | `backend/app/bounded_contexts/identity/presentation/router.py` | Bọc `audit_service.log_event` trong try/except ở endpoint `/login` và `/register`. Rollback session nếu audit thất bại. Đảm bảo login/register không bao giờ trả 500 do audit lỗi. |

---

## 4. Chi tiết sửa lỗi

### 4.1. `.env` — Secret an toàn

```diff
- JWT_SECRET=changeme-replace-with-a-long-random-secret
+ JWT_SECRET=4f447a991a5432e86c3eb24003e963ff20e75c0584bf2548e5cdd2830a8babee

+ OTA_TOKEN_SECRET=4ba44928be07729ee2223130033448e5919c40e5f5cf42e3b021585f34946cb2
+ OTA_TOKEN_EXPIRE_MINUTES=30
+ DEVICE_PROVISIONING_SECRET=
```

**Lưu ý:** `.env` đã nằm trong `.gitignore` — secret sẽ không bị commit vào repository.

### 4.2. `run-aifom.ps1` — Health check nhanh

```diff
  Write-Step "Running health checks"
  $apiUrl = "http://localhost:$($settings.API_HOST_PORT)"
- Wait-HttpEndpoint -Name "API /ready" -Url "$apiUrl/ready" -TimeoutSeconds 90 -IntervalSeconds 2 | Out-Null
+ # Fast check: /health responds immediately (no startup-task dependency).
+ $apiHealthy = Wait-HttpEndpoint -Name "API /health" -Url "$apiUrl/health" -TimeoutSeconds 30 -IntervalSeconds 2
+ if (-not $apiHealthy) {
+     Write-Warning "API health check failed. The API container may have crashed."
+     Write-Host "[HINT] Run 'run-aifom.bat logs' to inspect API container logs." -ForegroundColor Yellow
+     Write-Host "[HINT] Common cause: insecure JWT_SECRET or OTA_TOKEN_SECRET in .env file." -ForegroundColor Yellow
+ }
+ # Deep check: /ready confirms all startup tasks completed.
+ Wait-HttpEndpoint -Name "API /ready" -Url "$apiUrl/ready" -TimeoutSeconds 30 -IntervalSeconds 2 | Out-Null
```

**Thay đổi:**
- Kiểm tra `/health` trước (phản hồi ngay lập tức, không phụ thuộc startup tasks)
- Giảm timeout từ 90s → 30s cho cả `/health` và `/ready`
- In hướng dẫn debug khi health check thất bại
- Không treo script vô thời hạn

### 4.3. `router.py` — Login/Register an toàn

```diff
  token = token_svc.create_access_token(str(user.id), user.role)
  refresh = create_refresh_token(str(user.id))
  logger.info("[AUTH] login email=%s role=%s", user.email, user.role)
- audit_service.log_event(
-     db,
-     action="login",
-     ...
- )
+ try:
+     audit_service.log_event(
+         db,
+         action="login",
+         ...
+     )
+ except Exception:
+     logger.warning("[AUTH] Audit logging failed for login (non-fatal)", exc_info=True)
+     try:
+         db.rollback()
+     except Exception:
+         pass
```

**Thay đổi:**
- Bọc `audit_service.log_event` trong try/except
- Nếu audit thất bại: log warning, rollback session, tiếp tục trả response
- Login/Register không bao giờ trả 500 do audit logging lỗi

---

## 5. Kết quả kiểm thử

### Backend tests

```
171 passed, 8 warnings in 200.53s
```

Tất cả 171 tests pass — không có regression.

### Backend lint

```
All checks passed!
```

File `router.py` đã sửa passes ruff lint. (1 lỗi lint pre-existing ở `router_ota.py` — không liên quan.)

### Frontend TypeScript

```
npx tsc --noEmit — no errors
```

Frontend compile thành công, không có type error.

---

## 6. Hướng dẫn xác nhận thủ công

Sau khi sửa, chạy lại dự án:

```powershell
# 1. Dừng container cũ
run-aifom.bat down

# 2. Khởi động lại
run-aifom.bat

# 3. Kiểm tra health check nhanh (< 30 giây)
curl http://localhost:8000/health

# 4. Kiểm tra login
curl -X POST http://localhost:8000/api/v1/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"admin@aifom.local\",\"password\":\"admin1234\"}"

# 5. Kiểm tra login sai mật khẩu (phải trả 401, không phải 500)
curl -X POST http://localhost:8000/api/v1/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"admin@aifom.local\",\"password\":\"wrong\"}"

# 6. Kiểm tra API logs
run-aifom.bat logs
```

---

## 7. Rủi ro còn lại

| Rủi ro | Mức độ | Ghi chú |
|---------|--------|---------|
| Secret trong `.env` là development-only | Thấp | `.env` đã gitignore. Production cần secret riêng. |
| Pre-existing lint error ở `router_ota.py` | Thấp | Lỗi unused import, không ảnh hưởng runtime. |
| Migration 0005 có thể chưa chạy trên DB cũ | Thấp | `main.py` chạy `alembic upgrade head` khi startup. Nếu DB cũ, migration sẽ tự chạy. |
| Rate limit 5/minute cho login | Thấp | Đúng hành vi — không phải lỗi. |

---

## 8. Tóm tắt

| Vấn đề | Nguyên nhân gốc | File sửa | Trạng thái |
|---------|-----------------|----------|------------|
| Health check chậm ~1 phút | Script check `/ready` (chờ tất cả startup tasks) với timeout 90s | `run-aifom.ps1` | ✅ ĐÃ SỬA |
| Login 500 | `JWT_SECRET` insecure → `sys.exit(1)` → container crash | `.env` | ✅ ĐÃ SỬA |
| Login 500 (phụ) | Audit log có thể corrupt session | `router.py` | ✅ ĐÃ SỬA |
