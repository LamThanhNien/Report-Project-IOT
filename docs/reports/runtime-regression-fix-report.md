# Báo cáo sửa lỗi Runtime Regression — 2026-05-30

## Tóm tắt lỗi

Sau khi merge các thay đổi gần đây, hệ thống xuất hiện nhiều lỗi 500 trên UI:
- Admin OTA Campaigns → 500
- Admin TinyML / Anomaly Model → 500
- Admin Audit Logs → 500
- Tenant OTA / Firmware → 500
- Session không giữ được sau khi F5 (logout ngay sau refresh)

## Nguyên nhân gốc

### 1. Migration database chưa được áp dụng (NGUYÊN NHÂN CHÍNH)

Migration `0005_database_improvements.py` và `0006_token_blacklist.py` tồn tại trong code nhưng **chưa bao giờ được áp dụng** vào database đang chạy.

**Hậu quả:**
- Cột `ota_jobs.tenant_id` không tồn tại → mọi query ORM chạm bảng `ota_jobs` đều fail
- Cột `audit_logs.ip_address` không tồn tại → mọi INSERT vào `audit_logs` đều fail
- Bảng `blacklisted_tokens` không tồn tại → query kiểm tra token blacklist fail

### 2. Session poisoning (tác nhân gây 500 cascade)

Khi PostgreSQL gặp lỗi "column does not exist" hoặc "relation does not exist", transaction bị đánh dấu **aborted**. Mọi query tiếp theo trong cùng session đều fail với lỗi "current transaction is aborted, commands ignored until end of transaction block".

**Chuỗi lỗi cụ thể:**
1. Request `/api/v1/auth/me` → `get_current_user` gọi `is_token_blacklisted()`
2. `is_token_blacklisted()` query bảng `blacklisted_tokens` → bảng không tồn tại → exception
3. Exception được catch, trả về `False` (đúng), NHƯNG session đã bị poison
4. `repo.get_by_id(user_id)` query bảng `users` → fail vì session bị aborted → **500**

### 3. MQTT credentials không khớp

File `.env` có `MQTT_USERNAME=` và `MQTT_PASSWORD=` (rỗng), nhưng Mosquitto cấu hình `allow_anonymous false` với password file chứa user `aifom_backend`. Backend kết nối MQTT không có credentials → bị Mosquitto từ chối.

### 4. Frontend gọi sai API path cho Model

`modelApi.ts` gọi `/anomaly/models` thay vì `/api/v1/anomaly/models` → thiếu prefix `/api/v1`.

## File đã thay đổi

### Backend

| File | Thay đổi |
|------|----------|
| `backend/alembic/versions/0005_database_improvements.py` | Làm idempotent: kiểm tra cột/index tồn tại trước khi thêm |
| `backend/alembic/versions/0006_token_blacklist.py` | Làm idempotent: kiểm tra bảng tồn tại trước khi tạo |
| `backend/app/bounded_contexts/identity/application/services.py` | Thêm `db_session.rollback()` trong `is_token_blacklisted()` exception handler để khôi phục session |
| `.env` | Set `MQTT_USERNAME=aifom_backend` và `MQTT_PASSWORD=aifom_backend_pass` |
| `backend/tests/test_api.py` | Thêm 10 regression tests |

### Frontend

| File | Thay đổi |
|------|----------|
| `frontend/src/services/modelApi.ts` | Fix path: `/anomaly/models` → `/api/v1/anomaly/models` |
| `frontend/src/services/authApi.ts` | Thêm `refresh_token` vào `TokenResponse`, thêm `refreshAccessToken()` |
| `frontend/src/contexts/AuthContext.tsx` | Thêm refresh token flow: lưu refresh_token, thử refresh khi getMe() fail |
| `frontend/src/services/apiClient.ts` | Xóa auto-redirect 401 (giao cho AuthContext xử lý), thêm `isUnauthorized()` helper |

## Chi tiết sửa lỗi

### Phase 2: Fix Database Schema

**Migration 0005** — Làm idempotent bằng cách kiểm tra trước khi thêm:
```python
def _column_exists(table, column) -> bool:
    # Query information_schema.columns

def _index_exists(index_name) -> bool:
    # Query pg_indexes

# Chỉ thêm cột nếu chưa tồn tại
if not _column_exists("ota_jobs", "tenant_id"):
    op.add_column("ota_jobs", ...)

if not _column_exists("audit_logs", "ip_address"):
    op.add_column("audit_logs", ...)
```

**Migration 0006** — Làm idempotent:
```python
def _table_exists(table_name) -> bool:
    # Query information_schema.tables

if not _table_exists("blacklisted_tokens"):
    op.create_table("blacklisted_tokens", ...)
```

### Phase 3+4: Fix Session Poisoning

```python
# services.py — is_token_blacklisted()
except Exception:
    # CRITICAL: Roll back session to clear aborted transaction state
    try:
        db_session.rollback()
    except Exception:
        pass
    return False
```

### Phase 5: Fix auth/me và F5 Session

**Backend:** Session poisoning fix (ở trên) đảm bảo `/auth/me` không trả 500 nữa.

**Frontend:** Thêm refresh token flow:
1. Lưu `refresh_token` vào localStorage khi login/register
2. Khi `getMe()` fail → thử `refreshAccessToken()` → lấy access_token mới
3. Nếu refresh cũng fail → clean logout

### Phase 6: Fix TinyML / Anomaly Model

Fix frontend `modelApi.ts` path: `/anomaly/models` → `/api/v1/anomaly/models`

### Phase 7: Fix MQTT Authorization

Set credentials trong `.env`:
```
MQTT_USERNAME=aifom_backend
MQTT_PASSWORD=aifom_backend_pass
```

Đây là default credentials khớp với password file đã commit trong `infrastructure/mosquitto/config/passwd`.

## Tests đã thêm

| Test | Mô tả |
|------|--------|
| `test_admin_ota_jobs_list_returns_200` | Admin OTA list trả 200 với list rỗng |
| `test_admin_ota_jobs_list_returns_jobs` | Admin OTA list trả data khi có jobs |
| `test_client_ota_jobs_list_returns_200_empty` | Client OTA list trả 200 khi không có devices |
| `test_admin_audit_logs_returns_200` | Admin audit logs trả 200 |
| `test_client_audit_logs_returns_200_empty` | Client audit logs trả 200 với list rỗng |
| `test_auth_me_returns_user_for_valid_token` | auth/me trả user data với token hợp lệ |
| `test_auth_me_returns_401_for_missing_token` | auth/me trả 401 khi không có token |
| `test_is_token_blacklisted_recovers_from_missing_table` | Session không bị poison khi bảng không tồn tại |
| `test_anomaly_model_info_returns_200_not_loaded` | Model info trả 200 với status not_loaded |
| `test_anomaly_model_info_returns_200_with_error_status` | Model info trả 200 ngay cả khi load error |
| `test_login_returns_refresh_token` | TokenResponse chứa refresh_token field |

## Kết quả kiểm tra

| Kiểm tra | Kết quả |
|----------|---------|
| Backend tests (188 tests) | ✅ PASS |
| TypeScript check | ✅ PASS |
| Frontend build | ✅ PASS |
| Migration 0005 idempotent | ✅ Kiểm tra cột/index tồn tại |
| Migration 0006 idempotent | ✅ Kiểm tra bảng tồn tại |
| Session poisoning fix | ✅ Rollback sau error |

## Cách verify trên Docker

```bash
# 1. Start stack
make dev-up

# 2. Verify migrations applied
docker compose exec api alembic current
# Expected: 0006 (head)

# 3. Verify MQTT connection
docker compose logs mosquitto --tail=20
# Expected: aifom-api-subscriber connected (no "not authorised")

# 4. Manual UI verification
# - Login admin → F5 → vẫn đăng nhập
# - Admin OTA Campaigns → load thành công
# - Admin TinyML → load thành công (status: not_loaded hoặc loaded)
# - Admin Audit Logs → load thành công
# - Tenant login → F5 → vẫn đăng nhập
# - Tenant OTA → load thành công
```

## Rủi ro còn lại

1. **Nếu database đã chạy migration 0001 nhưng chưa 0002/0003/0004**: Migration chain sẽ fail ở 0005 vì `down_revision = "0004"`. Cần chạy `alembic upgrade head` từ đầu hoặc stamp đúng version.

2. **Password file Mosquitto**: Nếu password file bị xóa, docker-entrypoint.sh sẽ tạo lại với default passwords. Cần đảm bảo `.env` khớp.

3. **Refresh token flow**: Cần test kỹ trên môi trường Docker để đảm bảo access token hết hạn đúng cách và refresh token hoạt động.
