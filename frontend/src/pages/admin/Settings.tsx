import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, KeyRound, Bell, Cog, Users, Globe, Check, Sun, Moon } from "lucide-react";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Tabs } from "../../components/ui/Tabs";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { Modal } from "../../components/ui/Modal";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { changePassword } from "../../services/authApi";
import {
  createAdmin,
  getOtaPolicy,
  getSystemSettings,
  listAdmins,
  setAdminActive,
  updateOtaPolicy,
  updateAdmin,
  updateSystemSettings,
} from "../../services/settingsApi";
import { userSafeErrorMessage } from "../../lib/errorPresentation";
import { cn } from "../../lib/cn";

type Tab = "general" | "ota" | "security" | "account" | "admins";

export function Settings() {
  const [tab, setTab] = useState<Tab>("general");
  const { user } = useAuth();
  const { theme, toggle } = useTheme();
  const qc = useQueryClient();

  const settingsQ = useQuery({ queryKey: ["admin-settings"], queryFn: getSystemSettings });
  const otaQ = useQuery({ queryKey: ["admin-ota-policy"], queryFn: getOtaPolicy });
  const adminsQ = useQuery({ queryKey: ["admin-users"], queryFn: listAdmins });

  const [organizationName, setOrganizationName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Ho_Chi_Minh");
  const [locale, setLocale] = useState("vi");
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [maintenanceStart, setMaintenanceStart] = useState("02:00");
  const [maintenanceEnd, setMaintenanceEnd] = useState("05:00");
  const [rollbackThreshold, setRollbackThreshold] = useState(30);
  const [maxConcurrent, setMaxConcurrent] = useState(10);

  useEffect(() => {
    if (!settingsQ.data) return;
    setOrganizationName(settingsQ.data.organization_name);
    setTimezone(settingsQ.data.timezone);
    setLocale(settingsQ.data.default_locale);
    setEmailNotifications(settingsQ.data.email_notifications_enabled);
  }, [settingsQ.data]);

  useEffect(() => {
    if (!otaQ.data) return;
    setAutoUpdate(otaQ.data.auto_update_enabled);
    setMaintenanceStart(otaQ.data.maintenance_window_start);
    setMaintenanceEnd(otaQ.data.maintenance_window_end);
    setRollbackThreshold(otaQ.data.rollback_threshold);
    setMaxConcurrent(otaQ.data.max_concurrent_updates);
  }, [otaQ.data]);

  const settingsMutation = useMutation({
    mutationFn: () => updateSystemSettings({
      organization_name: organizationName,
      timezone,
      default_locale: locale,
      email_notifications_enabled: emailNotifications,
    }),
    onSuccess: (data) => {
      qc.setQueryData(["admin-settings"], data);
    },
  });

  const otaMutation = useMutation({
    mutationFn: () => updateOtaPolicy({
      auto_update_enabled: autoUpdate,
      maintenance_window_start: maintenanceStart,
      maintenance_window_end: maintenanceEnd,
      rollback_threshold: rollbackThreshold,
      max_concurrent_updates: maxConcurrent,
    }),
    onSuccess: (data) => {
      qc.setQueryData(["admin-ota-policy"], data);
    },
  });

  const tabs = [
    { key: "general", label: <span className="inline-flex items-center gap-1.5"><Cog className="h-3.5 w-3.5" /> Chung</span> },
    { key: "ota", label: <span className="inline-flex items-center gap-1.5"><Bell className="h-3.5 w-3.5" /> OTA</span> },
    { key: "security", label: <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Bảo mật</span> },
    { key: "account", label: <span className="inline-flex items-center gap-1.5"><KeyRound className="h-3.5 w-3.5" /> Tài khoản</span> },
    { key: "admins", label: <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Quản trị viên</span> },
  ];

  const loading = settingsQ.isLoading || otaQ.isLoading;
  if (loading) {
    return (
      <div className="space-y-4">
        <PageHeader title="Cài đặt" />
        <div className="h-64 animate-pulse rounded-2xl bg-surface-elevated border border-border-subtle" />
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      <PageHeader title="Cài đặt" subtitle="Quản trị hệ thống, chính sách OTA, bảo mật và tài khoản" />
      <Tabs tabs={tabs} active={tab} onChange={(key) => setTab(key as Tab)} />

      {tab === "general" && (
        <SettingsCard title="Cấu hình chung" error={settingsQ.error ?? settingsMutation.error} success={settingsMutation.isSuccess}>
          <SettingRow label="Tên tổ chức" hint="Hiển thị trên header và báo cáo">
            <input aria-label="Tên tổ chức" className="input max-w-md bg-surface dark:bg-surface-muted border-border-subtle" value={organizationName} onChange={(e) => setOrganizationName(e.target.value)} />
          </SettingRow>
          <SettingRow label="Múi giờ" hint="IANA timezone cho hiển thị thời gian">
            <select aria-label="Múi giờ" className="input max-w-md bg-surface dark:bg-surface-muted border-border-subtle" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              <option value="Asia/Ho_Chi_Minh">Asia/Ho_Chi_Minh (UTC+7)</option>
              <option value="UTC">UTC</option>
            </select>
          </SettingRow>
          <SettingRow label="Ngôn ngữ mặc định">
            <select aria-label="Ngôn ngữ mặc định" className="input max-w-md bg-surface dark:bg-surface-muted border-border-subtle" value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
            </select>
          </SettingRow>
          <SettingRow label="Thông báo email" hint="Gửi email khi phát sinh cảnh báo mức độ cao">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                aria-label="Thông báo email"
                type="checkbox"
                className="rounded border-border-subtle text-primary focus:ring-primary h-4 w-4"
                checked={emailNotifications}
                onChange={(e) => setEmailNotifications(e.target.checked)}
              />
              <span className="text-sm font-medium text-text-primary">Bật thông báo qua email</span>
            </label>
          </SettingRow>
          <SettingRow label="Giao diện" hint="Chuyển đổi chế độ Sáng / Tối">
            <button onClick={toggle} className="btn-secondary">
              {theme === "dark" ? <Moon className="h-4 w-4 text-sky-400" /> : <Sun className="h-4 w-4 text-amber-500" />}
              Đang dùng: {theme === "dark" ? "Tối" : "Sáng"}
            </button>
          </SettingRow>
          <SaveActions pending={settingsMutation.isPending} onSave={() => settingsMutation.mutate()} onCancel={() => settingsQ.refetch()} />
        </SettingsCard>
      )}

      {tab === "ota" && (
        <SettingsCard title="Chính sách OTA" error={otaQ.error ?? otaMutation.error} success={otaMutation.isSuccess}>
          <SettingRow label="Tự động cập nhật" hint="Tự động triển khai các bản firmware stable cho thiết bị">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                aria-label="Tự động cập nhật"
                type="checkbox"
                className="rounded border-border-subtle text-primary focus:ring-primary h-4 w-4"
                checked={autoUpdate}
                onChange={(e) => setAutoUpdate(e.target.checked)}
              />
              <span className="text-sm font-medium text-text-primary">Cho phép tự động cập nhật OTA</span>
            </label>
          </SettingRow>
          <SettingRow label="Cửa sổ bảo trì" hint="Khoảng thời gian cho phép thực hiện cập nhật OTA trong ngày">
            <div className="flex flex-wrap items-center gap-3">
              <input aria-label="Bắt đầu bảo trì" type="time" className="input w-36 bg-surface dark:bg-surface-muted border-border-subtle" value={maintenanceStart} onChange={(e) => setMaintenanceStart(e.target.value)} />
              <span className="text-text-muted text-xs font-medium">đến</span>
              <input aria-label="Kết thúc bảo trì" type="time" className="input w-36 bg-surface dark:bg-surface-muted border-border-subtle" value={maintenanceEnd} onChange={(e) => setMaintenanceEnd(e.target.value)} />
            </div>
          </SettingRow>
          <SettingRow label="Ngưỡng rollback (%)" hint="Tự động dừng và khôi phục nếu tỉ lệ thất bại vượt ngưỡng">
            <input aria-label="Ngưỡng rollback" type="number" min={1} max={100} className="input w-36 bg-surface dark:bg-surface-muted border-border-subtle" value={rollbackThreshold} onChange={(e) => setRollbackThreshold(Number(e.target.value))} />
          </SettingRow>
          <SettingRow label="Số OTA đồng thời tối đa" hint="Số lượng thiết bị tải OTA song song cùng một thời điểm">
            <input aria-label="Số OTA đồng thời tối đa" type="number" min={1} max={1000} className="input w-36 bg-surface dark:bg-surface-muted border-border-subtle" value={maxConcurrent} onChange={(e) => setMaxConcurrent(Number(e.target.value))} />
          </SettingRow>
          <SaveActions pending={otaMutation.isPending} onSave={() => otaMutation.mutate()} onCancel={() => otaQ.refetch()} />
        </SettingsCard>
      )}

      {tab === "security" && <SecurityCard />}
      {tab === "account" && <AccountCard user={user} />}
      {tab === "admins" && <AdminsCard currentUserId={user?.id ?? ""} admins={adminsQ.data ?? []} loading={adminsQ.isLoading} onChanged={() => qc.invalidateQueries({ queryKey: ["admin-users"] })} />}
    </div>
  );
}

function SettingsCard({ title, error, success, children }: { title: string; error: Error | null; success: boolean; children: React.ReactNode }) {
  return (
    <Card className="rounded-2xl border border-border-subtle bg-surface shadow-sm overflow-hidden">
      <CardHeader className="border-b border-border-subtle py-4 px-6">
        <CardTitle className="text-base font-bold text-text-primary">{title}</CardTitle>
      </CardHeader>
      <CardBody className="p-6 space-y-4">
        {children}
        {error && (
          <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs font-medium text-rose-600 dark:text-rose-400">
            {userSafeErrorMessage(error)}
          </div>
        )}
        {success && (
          <div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Đã lưu thay đổi.
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SaveActions({ pending, onSave, onCancel }: { pending: boolean; onSave: () => void; onCancel: () => void }) {
  return (
    <div className="flex justify-end gap-3 pt-4 border-t border-border-subtle">
      <button className="btn-secondary" onClick={onCancel}>Hủy thay đổi</button>
      <button className="btn-primary" disabled={pending} onClick={onSave}>{pending ? "Đang lưu…" : "Lưu thay đổi"}</button>
    </div>
  );
}

function SecurityCard() {
  return (
    <Card className="rounded-2xl border border-border-subtle bg-surface shadow-sm overflow-hidden">
      <CardHeader className="border-b border-border-subtle py-4 px-6">
        <CardTitle className="text-base font-bold text-text-primary">Bảo mật</CardTitle>
      </CardHeader>
      <CardBody className="p-6 space-y-4">
        <SettingRow label="Ký số firmware" hint="Xác thực tính toàn vẹn của tệp firmware tải lên">
          <StatusBadge tone="neutral" label="Kiểm tra chữ ký trong thư viện Firmware" />
        </SettingRow>
        <SettingRow label="Device token / certificate" hint="Xác thực thiết bị kết nối vào MQTT Broker">
          <StatusBadge tone="neutral" label="Theo cấu hình MQTT của môi trường" />
        </SettingRow>
        <SettingRow label="JWT cho admin" hint="Thuật toán mã hóa chữ ký token xác thực quản trị viên">
          <StatusBadge tone="neutral" label="Theo cấu hình xác thực của môi trường" />
        </SettingRow>
      </CardBody>
    </Card>
  );
}

function AccountCard({ user }: { user: ReturnType<typeof useAuth>["user"] }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validation, setValidation] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => changePassword({ current_password: currentPassword, new_password: newPassword }),
    onSuccess: () => {
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    },
  });
  const submit = () => {
    if (newPassword !== confirmPassword) return setValidation("Mật khẩu xác nhận không khớp.");
    if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) return setValidation("Mật khẩu mới cần ít nhất 8 ký tự, gồm chữ hoa, chữ thường và số.");
    setValidation(null); mutation.mutate();
  };
  return (
    <Card className="rounded-2xl border border-border-subtle bg-surface shadow-sm overflow-hidden">
      <CardHeader className="border-b border-border-subtle py-4 px-6">
        <CardTitle className="text-base font-bold text-text-primary">Tài khoản đăng nhập</CardTitle>
      </CardHeader>
      <CardBody className="p-6 space-y-4">
        <SettingRow label="Email">
          <span className="font-mono text-sm font-semibold text-text-primary">{user?.email}</span>
        </SettingRow>
        <SettingRow label="Mật khẩu hiện tại">
          <input aria-label="Mật khẩu hiện tại" type="password" className="input max-w-md bg-surface dark:bg-surface-muted border-border-subtle" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
        </SettingRow>
        <SettingRow label="Mật khẩu mới" hint="Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường và số">
          <input aria-label="Mật khẩu mới" type="password" className="input max-w-md bg-surface dark:bg-surface-muted border-border-subtle" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </SettingRow>
        <SettingRow label="Xác nhận mật khẩu">
          <input aria-label="Xác nhận mật khẩu" type="password" className="input max-w-md bg-surface dark:bg-surface-muted border-border-subtle" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </SettingRow>
        {mutation.error && <p role="alert" className="text-xs text-rose-500">{userSafeErrorMessage(mutation.error)}</p>}
        {validation && (
          <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs font-medium text-rose-600 dark:text-rose-400">
            {validation}
          </div>
        )}
        {mutation.isSuccess && (
          <div role="status" className="rounded-xl border border-emerald-500/20 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Đổi mật khẩu thành công.
          </div>
        )}
        <div className="flex justify-end pt-3 border-t border-border-subtle">
          <button className="btn-primary" disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending ? "Đang xử lý..." : "Đổi mật khẩu"}
          </button>
        </div>
      </CardBody>
    </Card>
  );
}

function AdminsCard({ currentUserId, admins, loading, onChanged }: { currentUserId: string; admins: Array<{ id: string; email: string; full_name: string | null; is_active: boolean }>; loading: boolean; onChanged: () => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [editAdmin, setEditAdmin] = useState<{ id: string; email: string } | null>(null);
  const [editName, setEditName] = useState("");
  const createMutation = useMutation({
    mutationFn: () => createAdmin({ email, full_name: fullName, password }),
    onSuccess: () => {
      setEmail(""); setFullName(""); setPassword(""); onChanged();
    },
  });
  const activeMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => setAdminActive(id, active),
    onSuccess: onChanged,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, full_name }: { id: string; full_name: string | null }) => updateAdmin(id, { full_name }),
    onSuccess: () => { onChanged(); setEditAdmin(null); },
  });

  return (
    <>
      <Card className="rounded-2xl border border-border-subtle bg-surface shadow-sm overflow-hidden">
        <CardHeader className="border-b border-border-subtle py-4 px-6">
          <CardTitle className="text-base font-bold text-text-primary">Quản trị viên hệ thống</CardTitle>
        </CardHeader>
        <CardBody className="p-6 space-y-6">
          <div className="rounded-2xl border border-border-subtle bg-surface-elevated p-4">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Tạo quản trị viên mới</h5>
            <div className="grid gap-3 md:grid-cols-4">
              <input aria-label="Email quản trị viên" className="input bg-surface dark:bg-surface-muted border-border-subtle" placeholder="admin@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input aria-label="Tên quản trị viên" className="input bg-surface dark:bg-surface-muted border-border-subtle" placeholder="Họ tên" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              <input aria-label="Mật khẩu tạm thời" type="password" className="input bg-surface dark:bg-surface-muted border-border-subtle" placeholder="Mật khẩu tạm thời" value={password} onChange={(e) => setPassword(e.target.value)} />
              <button className="btn-primary" disabled={createMutation.isPending || !email || !password} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? "Đang tạo..." : "Tạo quản trị viên"}
              </button>
            </div>
          </div>
          {(createMutation.error || activeMutation.error || updateMutation.error) && <p role="alert" className="text-xs text-rose-500">{userSafeErrorMessage(createMutation.error || activeMutation.error || updateMutation.error)}</p>}
          {loading ? <div className="h-24 animate-pulse rounded-2xl bg-surface-elevated" /> : (
            <div className="space-y-3">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-text-muted">Danh sách tài khoản ({admins.length})</h5>
              {admins.map((admin) => (
                <div key={admin.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-elevated/70 p-4 transition-all duration-150 hover:bg-surface-elevated hover:shadow-sm">
                  <div>
                    <div className="text-sm font-semibold text-text-primary">{admin.full_name || admin.email}</div>
                    <div className="font-mono text-xs text-text-muted mt-0.5">{admin.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={admin.is_active ? "success" : "danger"} label={admin.is_active ? "Active" : "Disabled"} />
                    <button className="btn-secondary text-xs h-8 px-3" disabled={updateMutation.isPending} onClick={() => { setEditAdmin({ id: admin.id, email: admin.email }); setEditName(admin.full_name ?? ""); }}>Sửa tên</button>
                    <button className="btn-secondary text-xs h-8 px-3" disabled={activeMutation.isPending || admin.id === currentUserId} onClick={() => activeMutation.mutate({ id: admin.id, active: !admin.is_active })}>{admin.is_active ? "Vô hiệu hóa" : "Kích hoạt"}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      <Modal
        open={Boolean(editAdmin)}
        onClose={() => setEditAdmin(null)}
        title="Sửa tên quản trị viên"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditAdmin(null)} disabled={updateMutation.isPending}>Hủy</button>
            <button className="btn-primary" onClick={() => editAdmin && updateMutation.mutate({ id: editAdmin.id, full_name: editName.trim() || null })} disabled={updateMutation.isPending}>Lưu</button>
          </>
        }
      >
        <label className="block text-sm space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">Tên quản trị viên</span>
          <input className="input w-full bg-surface dark:bg-surface-muted border-border-subtle" value={editName} onChange={(event) => setEditName(event.target.value)} autoFocus />
        </label>
      </Modal>
    </>
  );
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-3 border-b border-border-subtle py-3.5 last:border-0 md:grid-cols-3">
      <div>
        <div className="text-sm font-semibold text-text-primary">{label}</div>
        {hint && <div className="mt-1 text-xs text-text-muted leading-relaxed">{hint}</div>}
      </div>
      <div className="md:col-span-2 flex items-center">{children}</div>
    </div>
  );
}
