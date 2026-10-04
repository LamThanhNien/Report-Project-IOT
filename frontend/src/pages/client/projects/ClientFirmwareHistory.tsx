import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePersistedState } from "../../../hooks/usePersistedState";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { History, Search, Package, Rocket, Upload } from "lucide-react";
import { listClientFirmware } from "../../../services/clientApi";
import { PageHeader } from "../../../components/ui/PageHeader";
import { PaginationBar } from "../../../components/ui/PaginationBar";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { useAuth } from "../../../contexts/AuthContext";
import { useFeature } from "../../../contexts/FeatureContext";
import { FeatureGate } from "./FeatureGate";
import { ReadOnlyNotice } from "../../../components/permissions/PermissionGate";
import { canManageFirmware, canManageOta } from "../../../lib/permissions";
import { formatDateTime, formatBytes, shortHash } from "../../../lib/formatters";

const PAGE_SIZE = 20;

export function ClientFirmwareHistory() {
  const { t } = useTranslation(["devices", "common"]);
  const { hasFeature, featuresReady } = useFeature();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [search, setSearch] = usePersistedState("aifom_clientfirmwarehistory_search", "", "session");
  const [page, setPage] = useState(0);
  const canUploadFirmware = canManageFirmware(user);
  const canCreateOta = hasFeature("ota_update") && canManageOta(user);

  const { data: firmware = [], isLoading, error, refetch } = useQuery({
    queryKey: ["client-firmware-history"],
    queryFn: () => listClientFirmware(),
  });

  const filtered = useMemo(() => {
    if (!search) return firmware;
    const q = search.toLowerCase();
    return firmware.filter((f) =>
      `${f.version} ${f.target_device_type} ${f.release_notes ?? ""}`.toLowerCase().includes(q),
    );
  }, [firmware, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const effectivePage = Math.max(0, Math.min(page, totalPages - 1));
  const paged = useMemo(() => filtered.slice(effectivePage * PAGE_SIZE, (effectivePage + 1) * PAGE_SIZE), [filtered, effectivePage]);
  const columnCount = canCreateOta ? 8 : 7;

  const handleSearch = (v: string) => { setSearch(v); setPage(0); };

  if (!featuresReady) return <div className="flex items-center justify-center h-64 text-sm text-slate-500">{t("common:loading", "Đang tải…")}</div>;
  if (!hasFeature("firmware_history")) return <FeatureGate featureName="firmware_history" />;

  return (
    <div className="flex flex-col flex-1 min-h-full">
      <PageHeader
        title={t("devices:firmware.title", "Lịch sử Firmware")}
        subtitle={t("devices:firmware.subtitle", "Lịch sử các phiên bản firmware đã tải lên cho tenant của bạn")}
        actions={
          canUploadFirmware || canCreateOta ? (
            <div className="flex items-center gap-2">
              {canUploadFirmware && (
              <button
                className="btn-secondary"
                onClick={() => navigate("/client/ota", { state: { tab: "firmware", upload: true } })}
              >
                <Upload className="h-3.5 w-3.5" /> {t("devices:firmware.upload_firmware", "Upload firmware")}
              </button>
              )}
              {canCreateOta && (
              <button
                className="btn-primary"
                onClick={() => navigate("/client/ota", { state: { create: true } })}
              >
                <Rocket className="h-3.5 w-3.5" /> {t("devices:firmware.create_ota", "Create OTA")}
              </button>
              )}
            </div>
          ) : undefined
        }
      />

      {(!canUploadFirmware || !canCreateOta) && <ReadOnlyNotice />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardBody className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center">
              <Package className="h-5 w-5 text-sky-600" />
            </div>
            <div>
              <div className="text-xs text-slate-500">{t("devices:firmware.total_versions", "Tổng phiên bản")}</div>
              <div className="text-2xl font-semibold">{firmware.length}</div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-brand-50 dark:bg-brand-500/10 flex items-center justify-center">
              <History className="h-5 w-5 text-brand-600 dark:text-brand-300" />
            </div>
            <div>
              <div className="text-xs text-slate-500">{t("devices:firmware.device_types", "Loại thiết bị")}</div>
              <div className="text-2xl font-semibold">
                {new Set(firmware.map((f) => f.target_device_type)).size}
              </div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
              <Package className="h-5 w-5 text-violet-600" />
            </div>
            <div>
              <div className="text-xs text-slate-500">{t("devices:firmware.active_versions", "Đang hoạt động")}</div>
              <div className="text-2xl font-semibold">
                {firmware.filter((f) => f.is_active).length}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="flex flex-col flex-1">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-400" />
            <CardTitle>{t("devices:firmware.version_history", "Lịch sử phiên bản")}</CardTitle>
          </div>
          <div className="relative max-w-xs w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9"
              placeholder={t("devices:firmware.search_placeholder", "Tìm kiếm firmware...")}
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <div className="overflow-x-auto flex-1">
          <table className="min-w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-surface/40">
              <tr>
                <th className="text-left px-4 py-2">{t("devices:firmware.col_version", "Phiên bản")}</th>
                <th className="text-left px-4 py-2">{t("devices:firmware.col_device", "Thiết bị")}</th>
                <th className="text-left px-4 py-2">{t("devices:firmware.col_type", "Loại")}</th>
                <th className="text-right px-4 py-2">{t("devices:firmware.col_size", "Kích thước")}</th>
                <th className="text-left px-4 py-2">{t("devices:firmware.col_checksum", "Checksum")}</th>
                {canCreateOta && <th className="text-right px-4 py-2">{t("devices:firmware.col_actions", "Actions")}</th>}
                <th className="text-left px-4 py-2">{t("devices:firmware.col_status", "Trạng thái")}</th>
                <th className="text-left px-4 py-2">{t("devices:firmware.col_created", "Ngày tạo")}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={columnCount} className="text-center py-8 text-sm text-slate-500">
                    {t("common:loading", "Đang tải…")}
                  </td>
                </tr>
              )}
              {error && (
                <tr>
                  <td colSpan={columnCount} className="text-center py-8">
                    <p className="text-sm text-rose-600 mb-2">{t("common:error_load_data", "Không thể tải dữ liệu")}</p>
                    <button className="btn-secondary text-xs" onClick={() => refetch()}>
                      {t("common:actions.retry", "Thử lại")}
                    </button>
                  </td>
                </tr>
              )}
              {!isLoading && !error && filtered.length === 0 && (
                <tr>
                  <td colSpan={columnCount} className="text-center py-8 text-sm text-slate-500">
                    {search ? t("devices:firmware.no_fw_match", "Không tìm thấy firmware phù hợp") : t("devices:firmware.no_fw_yet", "Chưa có firmware nào")}
                  </td>
                </tr>
              )}
              {paged.map((fw) => (
                <tr key={fw.id} className="border-t border-slate-100 dark:border-border-subtle">
                  <td className="px-4 py-2 font-mono text-xs font-medium">{fw.version}</td>
                  <td className="px-4 py-2 text-xs">{fw.target_device_type}</td>
                  <td className="px-4 py-2">
                    <StatusBadge
                      tone={fw.source_type === "binary" ? "info" : "neutral"}
                      label={fw.source_type}
                    />
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-slate-500">
                    {formatBytes(fw.file_size)}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">
                    {shortHash(fw.checksum_sha256)}
                  </td>
                  {canCreateOta && (
                    <td className="px-4 py-2 text-right">
                      <button
                        className="btn-primary h-8 px-2 text-xs"
                        onClick={() => navigate("/client/ota", { state: { firmwareId: fw.id, create: true } })}
                        disabled={!fw.object_key}
                        title={fw.object_key ? t("devices:firmware.create_ota_tooltip", "Create OTA from this firmware") : t("devices:firmware.binary_required_tooltip", "Firmware requires a binary file for OTA")}
                      >
                        <Rocket className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                  <td className="px-4 py-2">
                    <StatusBadge
                      tone={fw.is_active ? "success" : "neutral"}
                      label={fw.is_active ? t("devices:firmware.active", "Hoạt động") : t("devices:firmware.inactive", "Không hoạt động")}
                    />
                  </td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {formatDateTime(fw.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalItems={filtered.length}
          pageSize={PAGE_SIZE}
          onPrev={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
          className="mt-auto rounded-none rounded-b-xl border-x-0 border-b-0 shrink-0"
        />
      </Card>
    </div>
  );
}
