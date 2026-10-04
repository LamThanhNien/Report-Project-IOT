import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";

const FEATURE_LABEL_KEYS: Record<string, { key: string; fallback: string }> = {
  device_management: { key: "feature.device_management", fallback: "Quản lý thiết bị" },
  ota_update: { key: "feature.ota_update", fallback: "OTA / Cập nhật Firmware" },
  firmware_history: { key: "feature.firmware_history", fallback: "Lịch sử Firmware" },
  telemetry_view: { key: "feature.telemetry_view", fallback: "Xem Telemetry" },
  advanced_monitoring: { key: "feature.advanced_monitoring", fallback: "Giám sát nâng cao" },
  alert_management: { key: "feature.alert_management", fallback: "Quản lý cảnh báo" },
  api_access: { key: "feature.api_access", fallback: "API Access" },
  user_management: { key: "feature.user_management", fallback: "Quản lý người dùng" },
  audit_log: { key: "feature.audit_log", fallback: "Audit Log" },
};

interface Props {
  featureName: string;
}

export function FeatureGate({ featureName }: Props) {
  const { t } = useTranslation(["common", "nav"]);
  const featureMeta = FEATURE_LABEL_KEYS[featureName];
  const label = featureMeta ? t(featureMeta.key, featureMeta.fallback) : featureName;

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="max-w-md text-center p-8">
        <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-slate-100 dark:bg-surface-elevated flex items-center justify-center">
          <Lock className="h-6 w-6 text-slate-400" />
        </div>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-text-primary mb-2">
          {t("common:feature_gate.title", "Tính năng chưa được kích hoạt")}
        </h2>
        <p className="text-sm text-slate-500 dark:text-text-muted mb-6">
          <span className="font-medium text-slate-700 dark:text-text-secondary">{label}</span>{" "}
          {t("common:feature_gate.unavailable", "chưa được bật cho workspace này.")}
        </p>
      </div>
    </div>
  );
}
