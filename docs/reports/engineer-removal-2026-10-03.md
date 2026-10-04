# Loại bỏ chức năng Engineer — 2026-10-03

AGENT: aifom-orchestrator; các phiên chuyên môn backend_canvas, engineer_ui_all, qa_ui_all, retire_legacy_rls và review_retired_rls.

TASK: Loại bỏ toàn bộ chức năng và quyền của Platform Engineer và Tenant Engineer; giữ Admin, Tenant Owner, Viewer.

CURRENT LOGIC: Backend và frontend chỉ chấp nhận ba vai trò còn hỗ trợ. Tài khoản có vai trò cũ vẫn được lưu trong database nhưng không thể đăng nhập, refresh, dùng token cũ hoặc nhận quyền mặc định thay thế.

ROOT CAUSE / DESIGN: Engineer tồn tại ở console riêng, quản lý tài khoản Admin, API, permission presets, member selector, demo và các chính sách PostgreSQL cũ. Gỡ các chức năng ứng dụng, chặn vai trò không hỗ trợ ở mọi đường xác thực, và dùng migration bổ sung để thu hồi nhánh RLS mà không sửa lịch sử.

FILES CHANGED: AuthContext/route guards, App routes, navigation, services/types/permissions, member/account UI, demo login/config, seed/launcher, backend identity/tenant/security/API composition và các kiểm thử liên quan. Xóa các trang/layout/sidebar/API Engineer và trang Admin quản lý Engineer. Thêm migrations 0012/0013, snapshot rollback chính sách và các script kiểm thử độc lập.

CONTRACTS PRESERVED: Owner giữ canvas/widget, thiết bị, Datastreams, Command, OTA và Automation. Viewer chỉ đọc, kể cả khi dữ liệu quyền cũ chứa quyền ghi. Admin giữ quyền tài nguyên nền tảng và giới hạn chỉ xem tài nguyên tenant. JWT, CSRF, token blacklist, tenant isolation và dữ liệu hiện có được giữ.

TESTS RUN: Frontend 274/274 tests, 47 files; typecheck, build và i18n đạt. Backend độc lập SQLite: 7 kiểm thử xác thực/phân quyền và 7 canvas đạt; 9 kiểm thử migration legacy offline đạt. Không chạy pytest backend với database thật. Kiểm tra runtime: /ready thành công, route Engineer trả 404, cả ba vai trò đăng nhập và đọc dữ liệu đúng phạm vi. PostgreSQL thực tế ở revision 0013, 45 policy tenant_isolation_policy vẫn tồn tại, không còn literal vai trò Engineer trong các biểu thức policy.

RESULT: Migration 0012 thu hồi bypass Engineer trong 37 chính sách đã biết. Migration 0013 xử lý thêm 71 policy legacy: 48 policy riêng Engineer trở thành FALSE, 23 policy hỗn hợp giữ các nhánh quyền hợp lệ. Không sửa người dùng, ownership hay dữ liệu tài nguyên. Policy thiếu trên bản cài mới được bỏ qua; policy có định nghĩa ngoài snapshot bị từ chối thay vì ghi đè.

RISKS: Tài khoản vai trò cũ và metadata lịch sử vẫn tồn tại để giữ dữ liệu; chúng không còn khả năng truy cập ứng dụng. Downgrade 0013 khôi phục chính xác các biểu thức policy cũ đang tồn tại và không tạo policy mới trên database sạch. Lint toàn backend vẫn có lỗi storage_response không được định nghĩa trong router_firmware.py đã tồn tại trước thay đổi này; không thuộc phần Engineer và chưa sửa.

DEPENDENCIES / RUNTIME: Đã khôi phục Docker Desktop bị lỗi socket tạm bằng đổi tên hai thư mục socket sang bản sao dự phòng. Khôi phục CustomWslDistroDir về D:\Docker\DockerDesktopWSL sau khi xác nhận ổ VHDX cũ 35 GB; không di chuyển hoặc xóa ổ dữ liệu. Cấu hình trước thay đổi được sao lưu tại C:\Users\Admin\AppData\Roaming\Docker\settings-store.before-aifom-storage-restore-20261003.json. Các container core và volume cũ được giữ; chỉ restart API để áp dụng migrations. Frontend chạy tại http://localhost:5173. Không commit hoặc push trong tác vụ này.
