import { Lock, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";

export function TenantDisabled() {
  const { t } = useTranslation(["common"]);

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <div className="max-w-md text-center p-8">
        <div className="mx-auto mb-6 h-16 w-16 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center">
          <Lock className="h-8 w-8 text-rose-500" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-text-primary mb-3">
          {t("common:tenant_disabled.title", "Tài khoản đã bị vô hiệu hóa")}
        </h1>
        <p className="text-sm text-slate-500 dark:text-text-muted mb-6">
          {t("common:tenant_disabled.desc_line1", "Tenant của bạn đã bị vô hiệu hóa bởi quản trị viên.")}{" "}
          {t("common:tenant_disabled.desc_line2", "Vui lòng liên hệ quản trị viên để được hỗ trợ.")}
        </p>
        <div className="card p-4 text-left text-sm text-slate-600 dark:text-text-muted mb-6">
          <p className="font-medium text-slate-800 dark:text-text-secondary mb-2">
            {t("common:tenant_disabled.options_header", "Bạn có thể:")}
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>{t("common:tenant_disabled.option_1", "Liên hệ quản trị viên hệ thống")}</li>
            <li>
              {t("common:tenant_disabled.option_2_prefix", "Gửi email đến")}{" "}
              <a href="mailto:support@aifom.local" className="text-brand-600 hover:underline">
                support@aifom.local
              </a>
            </li>
            <li>{t("common:tenant_disabled.option_3", "Đăng nhập bằng tài khoản khác (nếu có)")}</li>
          </ul>
        </div>
        <a
          href="mailto:support@aifom.local"
          className="btn-primary inline-flex items-center gap-2"
        >
          <Mail className="h-4 w-4" />
          {t("common:tenant_disabled.contact_support", "Liên hệ hỗ trợ")}
        </a>
      </div>
    </div>
  );
}
