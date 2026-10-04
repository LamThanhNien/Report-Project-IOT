import { useMemo, useState } from "react";
import { usePersistedState } from "../../../hooks/usePersistedState";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ScrollText, Search, Filter, ChevronLeft, ChevronRight, List, Clock } from "lucide-react";
import { auditEnhancedApi, AuditLog } from "../../../services/auditEnhancedApi";
import { PageHeader } from "../../../components/ui/PageHeader";
import { ClientSectionNav, SETTINGS_SECTION_NAV } from "../../../components/layout/ClientSectionNav";
import { Card, CardBody } from "../../../components/ui/Card";
import { MetricCard } from "../../../components/ui/MetricCard";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { Tabs } from "../../../components/ui/Tabs";
import { TenantLoadingState } from "../../../components/ui/TenantUi";
import { useFeature } from "../../../contexts/FeatureContext";
import { FeatureGate } from "./FeatureGate";
import { formatDateTime, formatRelative } from "../../../lib/formatters";

// ── Constants ────────────────────────────────────────────────────────────────

const ACTION_TONES: Record<string, "info" | "success" | "warning" | "danger" | "neutral"> = {
  login: "info",
  logout: "neutral",
  assign_device: "success",
  unassign_device: "warning",
  upload_firmware: "info",
  create_ota_job: "info",
  create_project: "success",
  delete_project: "danger",
  send_command: "info",
  device_created: "success",
  device_deleted: "danger",
};

function getActionMeta(action: string, t: (key: string, fallback: string) => string): { label: string; tone: "info" | "success" | "warning" | "danger" | "neutral" } {
  const labels: Record<string, string> = {
    login: t("audit:action_labels.login", "Đăng nhập"),
    logout: t("audit:action_labels.logout", "Đăng xuất"),
    assign_device: t("audit:action_labels.assign_device", "Gán thiết bị"),
    unassign_device: t("audit:action_labels.unassign_device", "Bỏ gán thiết bị"),
    upload_firmware: t("audit:action_labels.upload_firmware", "Tải firmware"),
    create_ota_job: t("audit:action_labels.create_ota_job", "Tạo OTA job"),
    create_project: t("audit:action_labels.create_project", "Tạo project"),
    delete_project: t("audit:action_labels.delete_project", "Xóa project"),
    send_command: t("audit:action_labels.send_command", "Gửi lệnh"),
    device_created: t("audit:action_labels.device_created", "Tạo thiết bị"),
    device_deleted: t("audit:action_labels.device_deleted", "Xóa thiết bị"),
  };
  return { label: labels[action] ?? action, tone: ACTION_TONES[action] ?? "neutral" };
}

const SENSITIVE_KEYS = new Set(["password", "token", "secret", "apikey", "authorization", "hashed_password"]);

function maskSensitiveDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      masked[k] = "***";
    } else {
      masked[k] = v;
    }
  }
  return masked;
}

const PAGE_SIZE = 25;

// ── Component ────────────────────────────────────────────────────────────────

export function ClientAuditLogs() {
  const { t, i18n } = useTranslation(["audit", "common"]);
  const dateLocale = i18n.language === "en" ? "en-US" : "vi-VN";
  const { hasFeature, featuresReady } = useFeature();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("view") === "timeline" ? "timeline" : "list";

  // Shared filters
  const [search, setSearch] = usePersistedState("aifom_clientauditlogs_search", "", "session");
  const [actionFilter, setActionFilter] = usePersistedState("aifom_clientauditlogs_actionfilter", "", "session");
  const [resourceFilter, setResourceFilter] = usePersistedState("aifom_clientauditlogs_resourcefilter", "", "session");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);

  // ── Data query (shared for both tabs) ──────────────────────────────────────
  const { data: rawData, isLoading, error, refetch } = useQuery({
    queryKey: ["client-audit-logs", actionFilter, resourceFilter, dateFrom, dateTo],
    queryFn: () => auditEnhancedApi.list({
      action: actionFilter || undefined,
      resource_type: resourceFilter || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      limit: 200,
    }),
    refetchInterval: 30_000,
  });

  // Backend may return flat array or { items, total }
  const logs: AuditLog[] = Array.isArray(rawData)
    ? rawData
    : ((rawData as { items?: AuditLog[] })?.items ?? []);

  const uniqueActions = useMemo(() => {
    const set = new Set(logs.map((l) => l.action));
    return Array.from(set).sort();
  }, [logs]);

  // Client-side text search (applied on top of server-side filters)
  const filtered = useMemo(() => {
    if (!search) return logs;
    const q = search.toLowerCase();
    return logs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        (l.resource_type ?? "").toLowerCase().includes(q) ||
        (l.resource_id ?? "").toLowerCase().includes(q) ||
        JSON.stringify(l.detail ?? {}).toLowerCase().includes(q),
    );
  }, [logs, search]);

  // ── Pagination (list tab) ─────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  // ── Timeline grouping ─────────────────────────────────────────────────────
  const groupedLogs = useMemo(() => {
    const groups: Record<string, AuditLog[]> = {};
    filtered.forEach((log) => {
      const date = new Date(log.created_at).toLocaleDateString(dateLocale);
      if (!groups[date]) groups[date] = [];
      groups[date].push(log);
    });
    return groups;
  }, [filtered, dateLocale]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  const switchTab = (tab: "list" | "timeline") => {
    setSearchParams(tab === "timeline" ? { view: "timeline" } : {}, { replace: true });
    setPage(0);
  };

  const resetFilters = () => {
    setSearch("");
    setActionFilter("");
    setResourceFilter("");
    setDateFrom("");
    setDateTo("");
    setPage(0);
  };

  const handleFilterChange = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(0);
  };

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!featuresReady) {
    return <TenantLoadingState label={t("common:loading", "Đang tải...")} />;
  }
  if (!hasFeature("audit_log")) {
    return <FeatureGate featureName="audit_log" />;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <PageHeader
        title={t("audit:title", "Nhật ký hoạt động")}
        subtitle={t("audit:description", "Lịch sử hoạt động trong workspace của bạn")}
      />

      <ClientSectionNav items={SETTINGS_SECTION_NAV} />

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <MetricCard label={t("audit:total_events", "Tổng sự kiện")} value={logs.length} icon={<ScrollText className="h-4 w-4" />} loading={isLoading} />
        <MetricCard label={t("audit:action_types", "Loại hành động")} value={uniqueActions.length} icon={<Filter className="h-4 w-4" />} tone="info" loading={isLoading} />
        <MetricCard label={t("audit:showing", "Đang hiển thị")} value={filtered.length} icon={<ScrollText className="h-4 w-4" />} tone="success" loading={isLoading} />
      </div>

      <Tabs
        className="mb-4"
        active={activeTab}
        onChange={(key) => switchTab(key as "list" | "timeline")}
        tabs={[
          { key: "list", label: <span className="inline-flex items-center gap-1.5"><List className="h-3.5 w-3.5" />{t("audit:tab_list", "Danh sách log")}</span> },
          { key: "timeline", label: <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{t("audit:tab_timeline", "Dòng thời gian")}</span> },
        ]}
      />

      {/* Shared filters */}
      <Card className="mb-4">
        <CardBody className="py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="label-xs mb-1">{t("audit:action", "Hành động")}</label>
              <select
                className="input h-8 text-xs max-w-[160px]"
                value={actionFilter}
                onChange={(e) => handleFilterChange(setActionFilter)(e.target.value)}
              >
                <option value="">{t("common:all", "Tất cả")}</option>
                {uniqueActions.map((a) => (
                  <option key={a} value={a}>{getActionMeta(a, t).label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label-xs mb-1">{t("audit:resource", "Loại tài nguyên")}</label>
              <input
                type="text"
                value={resourceFilter}
                onChange={(e) => handleFilterChange(setResourceFilter)(e.target.value)}
                className="input h-8 text-xs w-[140px]"
                placeholder={t("audit:resource_placeholder", "VD: device")}
              />
            </div>
            <div>
              <label className="label-xs mb-1">{t("audit:date_from", "Từ ngày")}</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => handleFilterChange(setDateFrom)(e.target.value)}
                className="input h-8 text-xs"
              />
            </div>
            <div>
              <label className="label-xs mb-1">{t("audit:date_to", "Đến ngày")}</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => handleFilterChange(setDateTo)(e.target.value)}
                className="input h-8 text-xs"
              />
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9 h-8 text-xs w-[180px]"
                placeholder={t("common:actions.search_placeholder", "Tìm kiếm...")}
                value={search}
                onChange={(e) => handleFilterChange(setSearch)(e.target.value)}
              />
            </div>
            {(search || actionFilter || resourceFilter || dateFrom || dateTo) && (
              <button
                onClick={resetFilters}
                className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
              >
                {t("common:actions.clear_filter", "Xóa bộ lọc")}
              </button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── Tab: Log list ──────────────────────────────────────────── */}
      {activeTab === "list" && (
        <Card className="p-0 overflow-hidden flex flex-col flex-1">
          <div className="overflow-x-auto flex-1">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-surface/40">
                <tr>
                  <th className="text-left px-4 py-2">{t("audit:action", "Hành động")}</th>
                  <th className="text-left px-4 py-2">{t("audit:resource", "Loại tài nguyên")}</th>
                  <th className="text-left px-4 py-2">{t("audit:resource_id", "ID tài nguyên")}</th>
                  <th className="text-left px-4 py-2">{t("audit:details", "Chi tiết")}</th>
                  <th className="text-left px-4 py-2">{t("audit:timestamp", "Thời gian")}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-sm text-slate-500">
                      {t("common:loading", "Đang tải…")}
                    </td>
                  </tr>
                )}
                {error && (
                  <tr>
                    <td colSpan={5} className="text-center py-8">
                      <p className="text-sm text-rose-600 mb-2">{t("common:error_load_data", "Không thể tải dữ liệu")}</p>
                      <button className="btn-secondary text-xs" onClick={() => refetch()}>
                        {t("common:actions.retry", "Thử lại")}
                      </button>
                    </td>
                  </tr>
                )}
                {!isLoading && !error && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-sm text-slate-500">
                      {search || actionFilter || resourceFilter || dateFrom || dateTo
                        ? t("audit:no_matching_logs", "Không tìm thấy log phù hợp")
                        : t("audit:no_logs", "Chưa có nhật ký nào")}
                    </td>
                  </tr>
                )}
                {paged.map((log) => {
                  const meta = getActionMeta(log.action, t);
                  return (
                    <tr key={log.id} className="border-t border-slate-100 dark:border-border-subtle">
                      <td className="px-4 py-2">
                        <StatusBadge
                          tone={meta.tone}
                          label={meta.label}
                        />
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-600 dark:text-text-muted">
                        {log.resource_type ?? "—"}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-slate-500">
                        {log.resource_id ? `${log.resource_id.slice(0, 8)}…` : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500 max-w-xs truncate">
                        {log.detail ? JSON.stringify(log.detail) : "—"}
                      </td>
                      <td className="px-4 py-2 text-xs text-slate-500" title={formatDateTime(log.created_at)}>
                        {formatRelative(log.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > PAGE_SIZE && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-border-subtle">
              <span className="text-xs bg-slate-100 dark:bg-surface-muted text-slate-600 dark:text-text-secondary px-2 py-0.5 rounded">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} / {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  className="btn-ghost p-1 disabled:opacity-40"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-slate-500 px-2">{page + 1} / {totalPages}</span>
                <button
                  className="btn-ghost p-1 disabled:opacity-40"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── Tab: Timeline ─────────────────────────────────────────── */}
      {activeTab === "timeline" && (
        <>
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
              <p className="text-red-800 dark:text-red-300 text-sm">
                {t("common:error_load_data", "Lỗi tải dữ liệu")}: {(error as Error).message}
              </p>
              <button className="btn-secondary text-xs mt-2" onClick={() => refetch()}>
                {t("common:actions.retry", "Thử lại")}
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 dark:bg-surface-elevated/50 rounded-lg">
              <p className="text-slate-500 dark:text-text-muted">
                {search || actionFilter || resourceFilter || dateFrom || dateTo
                  ? t("audit:no_matching_logs", "Không tìm thấy nhật ký nào phù hợp")
                  : t("audit:no_logs", "Chưa có nhật ký nào")}
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(groupedLogs).map(([date, events]) => (
                <div key={date}>
                  <h3 className="text-sm font-semibold text-slate-500 dark:text-text-muted mb-3 sticky top-0 bg-white dark:bg-surface py-2 z-10">
                    {date}
                  </h3>
                  <div className="space-y-2 border-l-2 border-slate-200 dark:border-border-subtle pl-4 ml-1">
                    {events.map((log) => {
                      const meta = getActionMeta(log.action, t);
                      return (
                        <div
                          key={log.id}
                          className="relative flex items-start gap-4 p-3 bg-white dark:bg-surface-elevated border border-slate-200 dark:border-border-subtle rounded-lg hover:shadow-sm transition-shadow"
                        >
                          <div className="absolute -left-[23px] top-4 w-3 h-3 rounded-full bg-blue-500 border-2 border-white dark:border-border-subtle"></div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <StatusBadge
                                tone={meta.tone}
                                label={meta.label}
                              />
                              {log.resource_type && (
                                <span className="text-xs bg-slate-100 dark:bg-surface-muted text-slate-600 dark:text-text-secondary px-2 py-0.5 rounded">
                                  {log.resource_type}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-400 dark:text-text-muted">
                              {new Date(log.created_at).toLocaleTimeString(dateLocale)}
                              {log.ip_address && ` · IP: ${log.ip_address}`}
                            </p>
                            {log.detail && Object.keys(log.detail).length > 0 && (
                              <details className="mt-2">
                                <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300">
                                  {t("audit:details", "Chi tiết")}
                                </summary>
                                <pre className="mt-1 text-xs text-slate-500 dark:text-text-muted bg-slate-50 dark:bg-surface rounded p-2 overflow-x-auto max-w-lg">
                                  {JSON.stringify(maskSensitiveDetail(log.detail), null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

