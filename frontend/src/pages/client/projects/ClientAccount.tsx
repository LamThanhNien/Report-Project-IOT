import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CheckCircle2, Loader2, Save, UserCog } from "lucide-react";
import { ClientSectionNav, SETTINGS_SECTION_NAV } from "../../../components/layout/ClientSectionNav";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { TenantLoadingState } from "../../../components/ui/TenantUi";
import { useAuth } from "../../../contexts/AuthContext";
import { getClientMe } from "../../../services/clientApi";

function roleLabel(role: string | undefined, t: (key: string, fallback: string) => string): string {
  switch (role) {
    case "tenant_owner":
      return t("account:roles.owner", "Owner");
    case "viewer":
      return t("account:roles.viewer", "Viewer");
    default:
      return role ?? "-";
  }
}

function cleanError(error: unknown, t: (key: string, fallback: string) => string): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^\d{3}\s+/, "").replace(/^full_name:\s*/i, "").trim() || t("account:update_failed", "Không thể cập nhật thông tin.");
}

export function ClientAccount() {
  const { t } = useTranslation(["account", "common"]);
  const { user, updateProfile } = useAuth();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data: me, isLoading } = useQuery({
    queryKey: ["client-me"],
    queryFn: getClientMe,
  });

  useEffect(() => {
    setFullName(user?.full_name ?? "");
  }, [user?.full_name]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    setSaved(false);

    const trimmed = fullName.trim();
    if (trimmed.length > 255) {
      setError(t("account:name_max_length", "Họ tên không được vượt quá 255 ký tự."));
      return;
    }

    try {
      setSaving(true);
      const nextUser = await updateProfile({ full_name: trimmed || null });
      qc.setQueryData(["client-me"], me ? { ...me, full_name: nextUser.full_name } : me);
      void qc.invalidateQueries({ queryKey: ["client-me"] });
      setSaved(true);
    } catch (err) {
      setError(cleanError(err, t));
    } finally {
      setSaving(false);
    }
  }

  const hasChanges = fullName.trim() !== (user?.full_name ?? "");

  if (isLoading && !user) return <TenantLoadingState label={t("account:loading", "Đang tải tài khoản...")} />;

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-4 pb-8">
      <PageHeader title={t("account:title", "Tài khoản")} subtitle={t("account:subtitle", "Cập nhật thông tin cá nhân trong tenant portal")} />
      <ClientSectionNav items={SETTINGS_SECTION_NAV} />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <Card>
          <CardHeader className="flex items-center gap-2">
            <UserCog className="h-4 w-4 text-slate-400" />
            <CardTitle>{t("account:personal_info", "Thông tin cá nhân")}</CardTitle>
          </CardHeader>
          <CardBody>
            <form className="space-y-5" onSubmit={submit}>
              <div>
                <label className="label-xs" htmlFor="account-full-name">
                  {t("account:display_name", "Họ tên hiển thị")}
                </label>
                <input
                  id="account-full-name"
                  className="input mt-1"
                  value={fullName}
                  onChange={(event) => {
                    setFullName(event.target.value);
                    setSaved(false);
                  }}
                  maxLength={255}
                  placeholder={t("account:ph_full_name", "Nhập họ tên")}
                />
                <p className="mt-1 text-xs text-slate-500 dark:text-text-muted">
                  {t("account:display_name_hint", "Họ tên này hiển thị ở topbar, sidebar và các khu vực nhận diện tài khoản.")}
                </p>
              </div>

              <div>
                <label className="label-xs">{t("account:email_login", "Email đăng nhập")}</label>
                <div className="mt-1 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-border-subtle dark:bg-surface-elevated dark:text-text-secondary">
                  {user?.email ?? "-"}
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/20 dark:text-rose-300">
                  {error}
                </div>
              )}

              {saved && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  {t("account:updated_success", "Đã cập nhật thông tin tài khoản.")}
                </div>
              )}

              <div className="flex justify-end">
                <button type="submit" className="btn-primary" disabled={!hasChanges || saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {t("account:save_changes", "Lưu thay đổi")}
                </button>
              </div>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("account:current_tenant", "Tenant hiện tại")}</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <InfoRow label={t("account:label_tenant", "Tenant")} value={me?.tenant_name ?? "-"} />
            <InfoRow label={t("account:label_tenant_slug", "Tenant slug")} value={me?.tenant_slug ?? "-"} mono />
             <InfoRow label={t("account:label_role", "Role")} value={roleLabel(user?.role, t)} />
            <InfoRow label={t("account:label_permissions", "Quyền truy cập")} value={`${user?.permissions.length ?? 0} ${t("account:permission_unit", "quyền")}`} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="label-xs">{label}</div>
      <div className={`mt-1 text-sm text-slate-700 dark:text-text-secondary ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}
