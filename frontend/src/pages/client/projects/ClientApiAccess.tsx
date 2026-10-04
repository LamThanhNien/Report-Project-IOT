import { Code, Key, BookOpen, ExternalLink, Lock } from "lucide-react";
import { PageHeader } from "../../../components/ui/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { TenantLoadingState } from "../../../components/ui/TenantUi";
import { useFeature } from "../../../contexts/FeatureContext";
import { FeatureGate } from "./FeatureGate";
import { useQuery } from "@tanstack/react-query";
import { apiBaseUrl } from "../../../services/apiClient";
import { getClientMe } from "../../../services/clientApi";
import { useTranslation } from "react-i18next";

export function ClientApiAccess() {
  const { t } = useTranslation(["account", "common"]);
  const { hasFeature, featuresReady } = useFeature();

  const { data: me } = useQuery({
    queryKey: ["client-me"],
    queryFn: getClientMe,
  });

  if (!featuresReady) return <TenantLoadingState label={t("account:loading", "Đang tải tài khoản...")} />;
  if (!hasFeature("api_access")) return <FeatureGate featureName="api_access" />;

  return (
    <>
      <PageHeader
        title={t("account:api_access.title", "Truy cập API")}
        subtitle={t("account:api_access.subtitle", "Thông tin truy cập API cho tích hợp và tự động hóa")}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-slate-400" />
              <CardTitle>{t("account:api_access.credentials", "Thông tin xác thực")}</CardTitle>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
                 <span className="label-xs">{t("account:api_access.tenant_id", "Tenant ID")}</span>
              <p className="mt-1 font-mono text-sm text-slate-700 dark:text-text-secondary bg-slate-50 dark:bg-surface-elevated px-3 py-2 rounded-md">
                {me?.tenant_id ?? "—"}
              </p>
            </div>
            <div>
                 <span className="label-xs">{t("account:api_access.tenant_slug", "Tenant Slug")}</span>
              <p className="mt-1 font-mono text-sm text-slate-700 dark:text-text-secondary bg-slate-50 dark:bg-surface-elevated px-3 py-2 rounded-md">
                {me?.tenant_slug ?? "—"}
              </p>
            </div>
            <div>
                 <span className="label-xs">{t("account:api_access.base_url", "Base URL")}</span>
              <p className="mt-1 font-mono text-sm text-slate-700 dark:text-text-secondary bg-slate-50 dark:bg-surface-elevated px-3 py-2 rounded-md">
                {window.location.origin}/api/v1/client
              </p>
            </div>
            <div className="card p-3 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                <Lock className="inline h-3 w-3 mr-1" />
                 {t("account:api_access.key_notice", "Quản lý API key chưa được hỗ trợ. Sử dụng JWT token từ quá trình đăng nhập để xác thực API.")}
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-slate-400" />
              <CardTitle>{t("account:api_access.documentation", "Tài liệu API")}</CardTitle>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-text-muted">
              {t("account:api_access.rest_notice", "API tuân theo chuẩn REST với request và response JSON. Tất cả endpoint yêu cầu xác thực Bearer token.")}
            </p>
            <div className="space-y-2">
               <h4 className="text-xs font-medium uppercase tracking-wider text-slate-500">{t("account:api_access.main_endpoints", "Các endpoint chính")}</h4>
              <div className="space-y-1">
                {[
                    { method: "GET", path: "/devices", desc: t("account:api_access.endpoints.devices", "Danh sách thiết bị") },
                    { method: "GET", path: "/devices/{uid}/telemetry", desc: t("account:api_access.endpoints.telemetry", "Telemetry thiết bị") },
                    { method: "GET", path: "/firmware", desc: t("account:api_access.endpoints.firmware", "Danh sách firmware") },
                    { method: "GET", path: "/ota-jobs", desc: t("account:api_access.endpoints.ota", "Danh sách OTA job") },
                    { method: "GET", path: "/alerts", desc: t("account:api_access.endpoints.alerts", "Cảnh báo bất thường") },
                    { method: "GET", path: "/projects", desc: t("account:api_access.endpoints.projects", "Danh sách dự án") },
                    { method: "POST", path: "/devices/{id}/commands", desc: t("account:api_access.endpoints.commands", "Gửi lệnh thiết bị") },
                ].map((ep) => (
                  <div key={ep.path} className="flex items-center gap-3 text-sm">
                    <span className="chip bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300 w-12 justify-center">
                      {ep.method}
                    </span>
                    <code className="text-xs text-slate-600 dark:text-text-muted">{ep.path}</code>
                    <span className="text-xs text-slate-500 ml-auto">{ep.desc}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="pt-2">
              <a
                href={`${apiBaseUrl}/docs`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary text-xs"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                 {t("account:api_access.swagger", "Xem Swagger Docs")}
              </a>
            </div>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Code className="h-4 w-4 text-slate-400" />
               <CardTitle>{t("account:api_access.example", "Ví dụ sử dụng")}</CardTitle>
            </div>
          </CardHeader>
          <CardBody>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface-muted p-4">
              <pre className="font-mono text-xs leading-6 text-text-primary">
{`# Lấy danh sách thiết bị
curl -H "Authorization: Bearer <JWT_TOKEN>" \\
  ${apiBaseUrl}/api/v1/client/devices

# Gửi lệnh bật đèn
curl -X POST \\
  -H "Authorization: Bearer <JWT_TOKEN>" \\
  -H "Content-Type: application/json" \\
  -d '{"command": "set_gpio", "params": {"pin": 2, "state": true}}' \\
  ${apiBaseUrl}/api/v1/client/devices/<DEVICE_ID>/commands

# Lấy telemetry mới nhất
curl -H "Authorization: Bearer <JWT_TOKEN>" \\
  ${apiBaseUrl}/api/v1/client/devices/<DEVICE_UID>/latest-telemetry`}
              </pre>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
