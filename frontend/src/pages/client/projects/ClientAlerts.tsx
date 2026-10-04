import { ActionDropdown } from "../../../components/ui/ActionDropdown";
import { useAuth } from "../../../contexts/AuthContext";
import { canManageMonitoring } from "../../../lib/permissions";
import { usePagination } from "../../../hooks/usePagination";
import { PaginationBar } from "../../../components/ui/PaginationBar";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCheck,
  Copy,
  Cpu,
  Eye,
  Info,
  LayoutGrid,
  List,
  Mail,
  MoreVertical,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { listClientAlerts, deleteClientAlert } from "../../../services/clientApi";
import { PageHeader } from "../../../components/ui/PageHeader";
import { ClientSectionNav, MONITORING_SECTION_NAV } from "../../../components/layout/ClientSectionNav";
import { FullSpinner } from "../../../components/ui/Spinner";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { Modal } from "../../../components/ui/Modal";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useFeature } from "../../../contexts/FeatureContext";
import { FeatureGate } from "./FeatureGate";
import { formatDateTime, formatRelative } from "../../../lib/formatters";
import { cn } from "../../../lib/cn";
import { useClientAlertReadState } from "../../../hooks/useClientAlertReadState";
import { useProjectScope } from "../../../hooks/useProjectScope";
import { usePersistedState } from "../../../hooks/usePersistedState";
import type { AnomalyAlert } from "../../../types";

type SeverityFilter = "all" | "info" | "warning" | "critical";
type ReadFilter = "all" | "unread" | "read";

const severityIcon = {
  critical: <ShieldAlert className="h-5 w-5 text-white" />,
  warning: <AlertTriangle className="h-5 w-5 text-white" />,
  info: <Info className="h-5 w-5 text-white" />,
};

interface AlertActionsMenuProps {
  alert: AnomalyAlert;
  isRead: boolean;
  onOpen: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}

function AlertActionsMenu({ alert, isRead, onOpen, onToggleRead, onDelete }: AlertActionsMenuProps) {
  const { t } = useTranslation(["alerts", "common"]);
  const { user } = useAuth();
  const canManage = canManageMonitoring(user);
  const { resolveLink } = useProjectScope();
  return (
    <ActionDropdown
      triggerSize="sm"
      triggerAriaLabel={t("alerts:actions_for", "Thao tác cho {{title}}", { title: alert.title ?? alert.metric_name })}
      menuWidth="w-48"
      items={[
        { id: "view", icon: <Eye className="h-3.5 w-3.5" />, label: t("common:actions.view_details", "Xem chi tiết"), onClick: onOpen },
        { id: "read", icon: isRead ? <Mail className="h-3.5 w-3.5" /> : <CheckCheck className="h-3.5 w-3.5" />, label: isRead ? t("alerts:mark_unread", "Đánh dấu chưa đọc") : t("alerts:mark_read", "Đánh dấu đã đọc"), onClick: onToggleRead },
        alert.device_uid ? { id: "device", to: resolveLink(`/devices/${alert.device_uid}`), icon: <Cpu className="h-3.5 w-3.5" />, label: t("alerts:view_device", "Xem thiết bị") } : null,
        { id: "copy", icon: <Copy className="h-3.5 w-3.5" />, label: t("common:actions.copy_id", "Sao chép mã ID"), onClick: () => navigator.clipboard.writeText(alert.id) },
        canManage ? { variant: "separator" } : null,
        canManage ? { id: "delete", danger: true, icon: <Trash2 className="h-3.5 w-3.5" />, label: t("common:actions.delete", "Xóa cảnh báo"), onClick: onDelete } : null,
      ]}
    />
  );
}
interface AlertFilterProps {
  search: string;
  onSearchChange: (val: string) => void;
  severityFilter: SeverityFilter;
  onSeverityFilterChange: (val: SeverityFilter) => void;
  readFilter: ReadFilter;
  onReadFilterChange: (val: ReadFilter) => void;
  viewMode: "grid" | "list";
  onViewModeChange: (val: "grid" | "list") => void;
  stats: { total: number; unread: number; info: number; warning: number; critical: number };
}

function AlertSearchAndFilters({
  search,
  onSearchChange,
  severityFilter,
  onSeverityFilterChange,
  readFilter,
  onReadFilterChange,
  viewMode,
  onViewModeChange,
  stats,
}: AlertFilterProps) {
  const { t } = useTranslation(["alerts", "common"]);
  const FILTER_OPTIONS: { key: string; label: string; active: boolean; onClick: () => void }[] = [
    { key: "all", label: `${t("common:all", "Tất cả")} (${stats.total})`, active: severityFilter === "all" && readFilter === "all", onClick: () => { onSeverityFilterChange("all"); onReadFilterChange("all"); } },
    { key: "unread", label: `${t("alerts:unread", "Chưa đọc")} (${stats.unread})`, active: readFilter === "unread", onClick: () => { onReadFilterChange("unread"); } },
    { key: "critical", label: `${t("alerts:severity_critical", "Nghiêm trọng")} (${stats.critical})`, active: severityFilter === "critical", onClick: () => { onSeverityFilterChange("critical"); } },
    { key: "warning", label: `${t("alerts:severity_warning", "Cảnh báo")} (${stats.warning})`, active: severityFilter === "warning", onClick: () => { onSeverityFilterChange("warning"); } },
    { key: "info", label: `${t("alerts:severity_info", "Thông tin")} (${stats.info})`, active: severityFilter === "info", onClick: () => { onSeverityFilterChange("info"); } },
  ];

  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 dark:border-border-subtle pb-4 pt-1">
      <div className="relative max-w-sm flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9 pr-8"
          placeholder={t("alerts:search_placeholder", "Tìm cảnh báo...")}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {search && (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            onClick={() => onSearchChange("")}
            aria-label={t("common:actions.clear_search", "Xóa tìm kiếm")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="scrollbar-hide flex items-center gap-1 overflow-x-auto">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={cn(
                "chip whitespace-nowrap transition-colors",
                f.active
                  ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300 font-medium"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-surface-elevated dark:text-text-muted dark:hover:bg-surface-muted",
              )}
              onClick={f.onClick}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-border p-0.5 bg-surface-elevated">
          <button
            type="button"
            aria-label={t("common:view.list", "Dạng danh sách")}
            onClick={() => onViewModeChange("list")}
            className={cn(
              "flex h-7 w-8 items-center justify-center transition-all duration-200 rounded-md",
              viewMode === "list"
                ? "bg-surface text-text-primary shadow-sm font-semibold"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={t("common:view.grid", "Dạng lưới")}
            onClick={() => onViewModeChange("grid")}
            className={cn(
              "flex h-7 w-8 items-center justify-center transition-all duration-200 rounded-md",
              viewMode === "grid"
                ? "bg-surface text-text-primary shadow-sm font-semibold"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClientAlerts({ scopedProjectId }: { scopedProjectId?: string } = {}) {
  const { user } = useAuth();
  const canManage = canManageMonitoring(user);
  const { t } = useTranslation(["alerts", "common", "devices"]);
  const { resolveLink } = useProjectScope();
  const { hasFeature, featuresReady } = useFeature();
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = usePersistedState<"grid" | "list">("aifom_client_alerts_view_mode", "list", "local");
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<AnomalyAlert | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const { isRead, markRead, toggleRead, markManyRead } = useClientAlertReadState();
  const queryClient = useQueryClient();

  const deleteMut = useMutation({
    mutationFn: deleteClientAlert,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-alerts", scopedProjectId] });
      if (selected && selected.id === deleteId) {
        closeAlert();
      }
      setDeleteId(null);
    },
    onError: (err: any) => {
      console.error("Lỗi khi xóa cảnh báo:", err);
      alert(t("alerts:cannot_delete", "Không thể xóa cảnh báo: ") + (err?.message || t("common:unknown_error", "Lỗi không xác định")));
      setDeleteId(null);
    },
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["client-alerts", scopedProjectId],
    queryFn: () => listClientAlerts(100, scopedProjectId),
    refetchInterval: 30_000,
  });

  const allAlerts = data ?? [];
  const unreadCount = allAlerts.filter((a) => !isRead(a.id)).length;
  const countBySeverity = (s: "info" | "warning" | "critical") =>
    allAlerts.filter((a) => a.severity === s).length;

  const selectedDetails = useMemo(() => {
    if (!selected?.details) return [];
    return Object.entries(selected.details).filter(([, value]) => value !== null && value !== undefined);
  }, [selected]);

  useEffect(() => {
    const alertId = searchParams.get("alert");
    if (!alertId || allAlerts.length === 0) return;
    const match = allAlerts.find((a) => a.id === alertId);
    if (!match) return;
    setSelected(match);
    markRead(match.id);
  }, [allAlerts, markRead, searchParams]);

  const filteredAlerts = useMemo(() => {
    return allAlerts.filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (readFilter === "unread" && isRead(a.id)) return false;
      if (readFilter === "read" && !isRead(a.id)) return false;
      if (search.trim()) {
        const query = search.toLowerCase();
        const titleMatch = (a.title ?? a.metric_name ?? "").toLowerCase().includes(query);
        const msgMatch = (a.message ?? "").toLowerCase().includes(query);
        const uidMatch = (a.device_uid ?? "").toLowerCase().includes(query);
        const metricMatch = (a.metric_name ?? "").toLowerCase().includes(query);
        if (!titleMatch && !msgMatch && !uidMatch && !metricMatch) return false;
      }
      return true;
    });
  }, [allAlerts, severityFilter, readFilter, search, isRead]);

  const PAGE_SIZE = 12;
  const { page, setPage, totalPages, pagedItems: pagedAlerts } = usePagination(filteredAlerts, PAGE_SIZE, [search, severityFilter, readFilter]);

  if (!featuresReady) return <FullSpinner label={t("common:loading", "Đang tải...")} />;
  if (!hasFeature("alert_management")) return <FeatureGate featureName="alert_management" />;

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <div className="text-sm text-red-600">{t("alerts:error_load", "Không thể tải cảnh báo")}</div>
        <button onClick={() => refetch()} className="btn-secondary">
          {t("common:actions.retry", "Thử lại")}
        </button>
      </div>
    );
  }

  function openAlert(alert: AnomalyAlert): void {
    markRead(alert.id);
    setSelected(alert);
    setSearchParams({ alert: alert.id });
  }

  function closeAlert(): void {
    setSelected(null);
    setSearchParams({});
  }

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-4">
      <PageHeader
        title={t("alerts:title", "Cảnh báo")}
        subtitle={t("alerts:subtitle", "Theo dõi các sự kiện bất thường trên thiết bị của bạn")}
        actions={
          unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => markManyRead(allAlerts.map((a) => a.id))}
              className="btn-secondary"
            >
              <CheckCheck className="h-3.5 w-3.5" /> {t("alerts:mark_all_read", "Đánh dấu tất cả đã đọc")}
            </button>
          ) : null
        }
      />

      <ClientSectionNav items={MONITORING_SECTION_NAV} />

      {/* Filter Chips & View Mode Controls */}
      <AlertSearchAndFilters
        search={search}
        onSearchChange={setSearch}
        severityFilter={severityFilter}
        onSeverityFilterChange={setSeverityFilter}
        readFilter={readFilter}
        onReadFilterChange={setReadFilter}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        stats={{
          total: allAlerts.length,
          unread: unreadCount,
          info: countBySeverity("info"),
          warning: countBySeverity("warning"),
          critical: countBySeverity("critical"),
        }}
      />

      {isLoading ? (
        <Card className="overflow-hidden" aria-label={t("alerts:loading_alerts", "Đang tải cảnh báo...")}>
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className="flex items-center gap-4 border-b border-slate-100 p-4 dark:border-border-subtle"><div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-slate-100 dark:bg-surface-elevated" /><div className="flex-1 space-y-2"><div className="h-4 w-1/3 animate-pulse rounded bg-slate-100 dark:bg-surface-elevated" /><div className="h-3 w-2/3 animate-pulse rounded bg-slate-100 dark:bg-surface-elevated" /></div></div>)}
        </Card>
      ) : filteredAlerts.length === 0 ? (
        <Card>
          <CardBody>
            <div className="py-12 text-center text-sm text-slate-500">
              {search || severityFilter !== "all" || readFilter !== "all"
                ? t("alerts:no_filtered_alerts", "Không tìm thấy cảnh báo nào phù hợp với bộ lọc")
                : t("alerts:no_alerts", "Không có cảnh báo nào")}
            </div>
          </CardBody>
        </Card>
      ) : viewMode === "list" ? (
        /* List View Mode (Growing Layout matching ClientDevices) */
        <Card className="p-0 overflow-hidden flex flex-col flex-1">
          <div className="overflow-x-auto">
            <div className="flex flex-col md:min-w-[1250px]">
              <div className="hidden md:flex items-center gap-4 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-text-secondary bg-slate-100/75 dark:bg-surface-elevated/70 border-b border-slate-200 dark:border-border-subtle shrink-0">
                <div className="w-10 text-center">{t("common:col.icon", "Icon")}</div>
                <div className="flex-1">{t("alerts:col_title_content", "Tiêu đề cảnh báo / Nội dung")}</div>
                <div className="w-36">{t("devices:col_device", "Thiết bị")}</div>
                <div className="w-32">{t("common:status.label", "Mức độ")}</div>
                <div className="w-28">{t("alerts:col_source", "Nguồn")}</div>
                <div className="w-32">{t("common:col.updated", "Thời gian")}</div>
                <div className="w-28 text-right">{t("common:col.actions", "Thao tác")}</div>
              </div>
              {pagedAlerts.map((alert) => (
                <AlertListRow
                  key={alert.id}
                  alert={alert}
                  isReadAlert={isRead(alert.id)}
                  onOpen={() => openAlert(alert)}
                  onToggleRead={() => toggleRead(alert.id)}
                  onDelete={() => setDeleteId(alert.id)}
                />
              ))}
            </div>
          </div>
        </Card>
      ) : (
        /* Grid View Mode matching ClientDevices */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pagedAlerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              isReadAlert={isRead(alert.id)}
              onOpen={() => openAlert(alert)}
              onToggleRead={() => toggleRead(alert.id)}
              onDelete={() => setDeleteId(alert.id)}
            />
          ))}
        </div>
      )}
      {filteredAlerts.length > 0 && <PaginationBar page={page} totalPages={totalPages} totalItems={filteredAlerts.length} pageSize={PAGE_SIZE} onPrev={() => setPage(page - 1)} onNext={() => setPage(page + 1)} className="mt-auto shrink-0" />}

      {/* Alert Detail Modal */}
      <Modal
        open={!!selected}
        onClose={closeAlert}
        title={
          <div className="flex items-center gap-3">
            {selected && (
              <StatusBadge
                tone={selected.severity === "critical" ? "danger" : selected.severity === "warning" ? "warning" : "info"}
                label={selected.severity}
              />
            )}
            <span>{selected?.title ?? selected?.metric_name ?? t("alerts:detail_title", "Chi tiết cảnh báo")}</span>
          </div>
        }
        size="lg"
        footer={
          <>
            {canManage && <button
              type="button"
              className="btn-danger flex items-center gap-1 mr-auto text-xs"
              onClick={() => {
                if (selected) {
                  setDeleteId(selected.id);
                }
              }}
              disabled={deleteMut.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("common:actions.delete", "Xóa cảnh báo")}
            </button>}
            <button type="button" className="btn-secondary" onClick={closeAlert}>
              {t("common:actions.close", "Đóng")}
            </button>
          </>
        }
      >
        {selected && (
          <div className="space-y-5 text-sm">
            <div>
              <div className="mb-1 text-xs uppercase tracking-wider text-slate-500">{t("common:col.content", "Nội dung")}</div>
              <p className="text-slate-700 dark:text-text-secondary">
                {selected.message ?? `${selected.metric_name}: ${selected.metric_value ?? "-"}`}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <DetailItem label={t("devices:col_device", "Thiết bị")}>
                <Link
                  to={resolveLink(`/devices/${selected.device_uid}`)}
                  className="font-mono text-xs text-brand-600 hover:underline dark:text-brand-400 font-medium"
                >
                  {selected.device_uid}
                </Link>
              </DetailItem>
              <DetailItem label={t("common:col.updated", "Thời gian")}>{formatDateTime(selected.timestamp)}</DetailItem>
              <DetailItem label={t("alerts:col_source", "Nguồn")}>{selected.source ?? "device"}</DetailItem>
              {selected.status && <DetailItem label={t("common:status.label", "Trạng thái")}>{selected.status}</DetailItem>}
              <DetailItem label={t("common:col.metric", "Metric")}>{selected.metric_name}</DetailItem>
              <DetailItem label={t("common:col.value", "Giá trị")}>
                <span className="font-mono">{selected.metric_value?.toFixed(3) ?? "-"}</span>
              </DetailItem>
            </div>

            {selectedDetails.length > 0 && (
              <div>
                <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">{t("alerts:extra_info", "Thông tin bổ sung")}</div>
                <div className="divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-border-subtle dark:border-border-subtle">
                  {selectedDetails.map(([key, value]) => (
                    <div key={key} className="grid grid-cols-[140px_1fr] gap-3 px-3 py-2">
                      <span className="text-xs uppercase tracking-wide text-slate-500">{key}</span>
                      <span className="break-words font-mono text-xs text-slate-700 dark:text-text-secondary">
                        {typeof value === "object" ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Confirmation Dialog for Alert Deletion */}
      <ConfirmDialog
        open={canManage && !!deleteId}
        title={t("common:actions.delete", "Xóa cảnh báo")}
        description={t("alerts:delete_confirm_desc", "Bạn có chắc chắn muốn xóa cảnh báo này không? Thao tác này không thể hoàn tác.")}
        confirmLabel={t("common:actions.delete", "Xóa cảnh báo")}
        cancelLabel={t("common:actions.cancel", "Hủy")}
        destructive
        loading={deleteMut.isPending}
        onConfirm={() => {
          if (canManage && deleteId) deleteMut.mutate(deleteId);
        }}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

// ─── Alert List Row Component (Matching DeviceListRow) ─────────────────────────

function AlertListRow({
  alert,
  isReadAlert,
  onOpen,
  onToggleRead,
  onDelete,
}: {
  alert: AnomalyAlert;
  isReadAlert: boolean;
  onOpen: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation(["alerts", "common", "devices"]);
  const { resolveLink } = useProjectScope();
  const severityLogo = {
    critical: "bg-rose-500",
    warning: "bg-amber-500",
    info: "bg-sky-500",
  }[alert.severity] ?? "bg-slate-500";

  return (
    <div
      className={cn(
        "group relative flex flex-col md:flex-row md:items-center gap-3 md:gap-4 border-b border-slate-100 dark:border-border-subtle px-4 py-3 hover:bg-slate-50/60 dark:hover:bg-surface-elevated/50 transition-colors",
        isReadAlert && "opacity-75 bg-slate-50/40 dark:bg-surface/40",
      )}
    >
      {/* Logo Icon */}
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm mx-auto md:mx-0",
          severityLogo,
        )}
      >
        {severityIcon[alert.severity] ?? severityIcon.info}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {!isReadAlert && <span className="h-2 w-2 rounded-full bg-brand-500 shrink-0" title={t("alerts:unread", "Chưa đọc")} />}
          <span
            onClick={onOpen}
            className="block truncate text-sm font-semibold text-text-primary hover:text-brand-600 dark:hover:text-brand-400 cursor-pointer"
          >
            {alert.title ?? alert.metric_name}
          </span>
        </div>
        <div className="mt-0.5">
          <span className="truncate text-[11px] font-mono text-slate-400">
            {alert.message || `Metric: ${alert.metric_name} (${alert.metric_value?.toFixed(3) ?? "-"})`}
          </span>
        </div>
      </div>

      <div className="w-full md:w-36 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:col_device", "Thiết bị")}:</span>
        <Link
          to={resolveLink(`/devices/${alert.device_uid}`)}
          className="font-mono text-xs text-brand-600 hover:underline dark:text-brand-400 font-medium"
        >
          {alert.device_uid}
        </Link>
      </div>

      <div className="w-full md:w-32 md:shrink-0 flex items-center gap-1.5 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("common:status.label", "Mức độ")}:</span>
        <StatusBadge
          tone={alert.severity === "critical" ? "danger" : alert.severity === "warning" ? "warning" : "info"}
          label={alert.severity}
        />
      </div>

      <div className="w-full md:w-28 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("alerts:col_source", "Nguồn")}:</span>
        <span className="font-medium text-slate-700 dark:text-text-primary">{alert.source || "device"}</span>
      </div>

      <div className="w-full md:w-32 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("common:col.updated", "Thời gian")}:</span>
        <span className="font-medium text-slate-600 dark:text-text-muted">{formatRelative(alert.timestamp)}</span>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center justify-end gap-1 w-full md:w-28 border-t md:border-t-0 pt-2 md:pt-0">
        <button
          type="button"
          className="btn-primary flex items-center gap-1 px-2.5 py-1.5 text-xs"
          onClick={onOpen}
        >
          {t("common:actions.view_details", "Chi tiết")}
          <ArrowRight className="h-3 w-3" />
        </button>
        <AlertActionsMenu
          alert={alert}
          isRead={isReadAlert}
          onOpen={onOpen}
          onToggleRead={onToggleRead}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

// ─── Alert Grid Card Component (Matching DeviceCard) ───────────────────────────

function AlertCard({
  alert,
  isReadAlert,
  onOpen,
  onToggleRead,
  onDelete,
}: {
  alert: AnomalyAlert;
  isReadAlert: boolean;
  onOpen: () => void;
  onToggleRead: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation(["alerts", "common", "devices"]);
  const { resolveLink } = useProjectScope();
  const severityLogo = {
    critical: "bg-rose-500",
    warning: "bg-amber-500",
    info: "bg-sky-500",
  }[alert.severity] ?? "bg-slate-500";

  return (
    <Card className={cn("group flex h-full flex-col hover:border-brand-300 transition-colors", isReadAlert && "opacity-75 bg-slate-50/40 dark:bg-surface/40")}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        {/* Logo Icon */}
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm",
            severityLogo,
          )}
        >
          {severityIcon[alert.severity] ?? severityIcon.info}
        </div>

        {/* Title + Status Dot */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {!isReadAlert && <span className="h-2 w-2 rounded-full bg-brand-500 shrink-0" title={t("alerts:unread", "Chưa đọc")} />}
            <CardTitle className="truncate text-base">{alert.title ?? alert.metric_name}</CardTitle>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            <StatusBadge
              tone={alert.severity === "critical" ? "danger" : alert.severity === "warning" ? "warning" : "info"}
              label={alert.severity}
            />
          </div>
        </div>

        <AlertActionsMenu
          alert={alert}
          isRead={isReadAlert}
          onOpen={onOpen}
          onToggleRead={onToggleRead}
          onDelete={onDelete}
        />
      </CardHeader>
      <CardBody className="flex flex-1 flex-col">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 py-2.5 mb-3 border-y border-slate-100 dark:border-border-subtle text-xs text-slate-600 dark:text-text-secondary">
          <div className="min-w-0">
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("devices:col_device", "Thiết bị")}</span>
            <Link
              to={resolveLink(`/devices/${alert.device_uid}`)}
              className="font-mono text-xs text-brand-600 hover:underline dark:text-brand-400 font-medium truncate block"
            >
              {alert.device_uid}
            </Link>
          </div>
          <div className="min-w-0">
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("alerts:col_source", "Nguồn")}</span>
            <span className="font-medium text-slate-700 dark:text-text-primary">{alert.source || "device"}</span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("common:col.metric", "Metric")}</span>
            <span className="font-medium text-slate-700 dark:text-text-primary">{alert.metric_name}</span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("common:col.updated", "Thời gian")}</span>
            <span className="font-medium text-slate-600 dark:text-text-muted">{formatRelative(alert.timestamp)}</span>
          </div>
        </div>

        <p className="text-xs text-slate-600 dark:text-text-secondary line-clamp-2 mb-4">
          {alert.message || `Metric value: ${alert.metric_value?.toFixed(3) ?? "-"}`}
        </p>

        <button
          type="button"
          className="btn-primary mt-auto w-full flex items-center justify-center gap-1 text-xs py-2"
          onClick={onOpen}
        >
          {t("common:actions.view_details", "Xem chi tiết")} →
        </button>
      </CardBody>
    </Card>
  );
}

function DetailItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-slate-800 dark:text-text-primary">{children}</div>
    </div>
  );
}
