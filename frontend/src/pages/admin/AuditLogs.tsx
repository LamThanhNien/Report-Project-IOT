import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, RefreshCw, List, Clock, Filter } from "lucide-react";
import { listAuditLogs } from "../../services/tenantAdminApi";
import { adminApi } from "../../services/adminApi";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable } from "../../components/ui/DataTable";
import { TenantCell } from "../../components/ui/TenantCell";
import { formatDateTime } from "../../lib/formatters";
import { userSafeErrorMessage } from "../../lib/errorPresentation";
import { cn } from "../../lib/cn";
import type { Column } from "../../components/ui/DataTable";
import type { TenantSummary } from "../../types";

// ── Types ────────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string;
  tenant_id: string | null;
  tenant?: TenantSummary | null;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

interface TimelineGroup {
  date: string;
  events: AuditLog[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  login: "Đăng nhập",
  logout: "Đăng xuất",
  register_tenant: "Đăng ký tenant",
  create_tenant: "Tạo tenant",
  assign_device: "Gán thiết bị",
  upload_firmware: "Tải firmware",
  create_ota_job: "Tạo OTA",
  device_created: "Tạo thiết bị",
  device_deleted: "Xóa thiết bị",
};

const ACTION_TONES: Record<string, string> = {
  login: "tone-success-chip",
  logout: "tone-neutral-chip",
  register_tenant: "tone-info-chip",
  create_tenant: "tone-info-chip",
  assign_device: "bg-purple-500/10 text-purple-600 dark:text-purple-300 border border-purple-500/20",
  upload_firmware: "tone-warning-chip",
  create_ota_job: "tone-success-chip",
  device_created: "tone-info-chip",
  device_deleted: "tone-danger-chip",
};

const SENSITIVE_KEYS = new Set(["password", "token", "secret", "apikey", "authorization", "hashed_password"]);

function maskDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail)) {
    masked[SENSITIVE_KEYS.has(k.toLowerCase()) ? k : k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "***" : v;
  }
  return masked;
}

// ── Component ────────────────────────────────────────────────────────────────

export function AuditLogs() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeView = searchParams.get("view") === "timeline" ? "timeline" : "list";

  // Shared filters
  const [actionFilter, setActionFilter] = useState("");
  const [tenantFilter, setTenantFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // List tab state
  const [page, setPage] = useState(0);
  const limit = 100;

  // ── List query ───────────────────────────────────────────────────────────
  const listQuery = useQuery({
    queryKey: ["audit-logs", actionFilter, tenantFilter, page, limit],
    queryFn: () => listAuditLogs({
      action: actionFilter || undefined,
      tenant_id: tenantFilter || undefined,
      limit,
      offset: page * limit,
    }),
    refetchInterval: 30_000,
    enabled: activeView === "list",
  });

  // ── Timeline query ──────────────────────────────────────────────────────
  const timelineQuery = useQuery({
    queryKey: ["admin-audit-timeline", tenantFilter, actionFilter, dateFrom, dateTo],
    queryFn: () => adminApi.getAuditTimeline({
      tenant_id: tenantFilter || undefined,
      action: actionFilter || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    enabled: activeView === "timeline",
  });

  const switchView = (view: "list" | "timeline") => {
    setSearchParams(view === "timeline" ? { view: "timeline" } : {}, { replace: true });
  };

  // ── Table columns ───────────────────────────────────────────────────────
  const columns: Column<AuditLog>[] = [
    {
      key: "created_at",
      header: "Thời gian",
      sortable: true,
      sortValue: (r) => r.created_at,
      render: (r) => (
        <span className="text-xs text-text-muted whitespace-nowrap">
          {formatDateTime(r.created_at)}
        </span>
      ),
    },
    {
      key: "action",
      header: "Hành động",
      sortable: true,
      sortValue: (r) => r.action,
      render: (r) => (
        <span className={cn("chip text-xs font-semibold px-2.5 py-0.5 rounded-full", ACTION_TONES[r.action] ?? "tone-neutral-chip")}>
          {ACTION_LABELS[r.action] ?? r.action}
        </span>
      ),
    },
    {
      key: "resource",
      header: "Đối tượng",
      render: (r) =>
        r.resource_type ? (
          <div>
            <span className="text-xs font-semibold text-text-primary capitalize">
              {r.resource_type}
            </span>
            {r.resource_id && (
              <div className="font-mono text-[10px] text-text-muted truncate max-w-[140px]" title={r.resource_id}>
                {r.resource_id}
              </div>
            )}
          </div>
        ) : (
          <span className="text-text-muted">—</span>
        ),
    },
    {
      key: "tenant_id",
      header: "Khách hàng",
      render: (r) => <TenantCell tenant={r.tenant} fallback="admin" compact />,
    },
    {
      key: "detail",
      header: "Chi tiết",
      render: (r) =>
        r.detail ? (
          <span className="font-mono text-[11px] text-text-secondary truncate max-w-[220px] block" title={JSON.stringify(maskDetail(r.detail))}>
            {Object.entries(maskDetail(r.detail))
              .slice(0, 3)
              .map(([k, v]) => `${k}=${String(v)}`)
              .join(", ")}
          </span>
        ) : null,
    },
  ];

  // ── Timeline data ───────────────────────────────────────────────────────
  const timelineGroups = (timelineQuery.data || []) as TimelineGroup[];
  const timelineTotal = timelineGroups.reduce((sum, g) => sum + g.events.length, 0);

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-4">
      <PageHeader
        title="Nhật ký hệ thống"
        subtitle="Lịch sử thao tác trên toàn hệ thống"
        actions={
          <button
            onClick={() => activeView === "list" ? listQuery.refetch() : timelineQuery.refetch()}
            disabled={activeView === "list" ? listQuery.isFetching : timelineQuery.isFetching}
            className="btn-secondary"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", (activeView === "list" ? listQuery.isFetching : timelineQuery.isFetching) && "animate-spin")} />
            Làm mới
          </button>
        }
      />

      {/* Segmented Pill Tab Switcher */}
      <div className="flex items-center justify-between">
        <div className="inline-flex rounded-xl bg-surface-elevated p-1 border border-border-subtle">
          <button
            onClick={() => switchView("list")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150",
              activeView === "list"
                ? "bg-surface text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            <List className="h-3.5 w-3.5" />
            Danh sách log
          </button>
          <button
            onClick={() => switchView("timeline")}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150",
              activeView === "timeline"
                ? "bg-surface text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            Dòng thời gian
          </button>
        </div>

        {activeView === "timeline" && !timelineQuery.isLoading && !timelineQuery.error && (
          <span className="text-xs font-medium text-text-muted">{timelineTotal} bản ghi</span>
        )}
      </div>

      {/* Modern Filter Toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border-subtle bg-surface p-3.5 shadow-sm">
        <div className="flex items-center gap-2 text-text-muted mr-1">
          <Filter className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-wider hidden sm:inline">Bộ lọc:</span>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Hành động</label>
          <select
            className="input h-8 text-xs min-w-[150px] bg-surface dark:bg-surface-muted border-border-subtle"
            aria-label="Hành động" value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(0); }}
          >
            <option value="">Tất cả hành động</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Tenant ID</label>
          <input
            type="text"
            aria-label="Tenant ID" value={tenantFilter}
            onChange={(e) => { setTenantFilter(e.target.value); setPage(0); }}
            className="input h-8 text-xs w-[170px] bg-surface dark:bg-surface-muted border-border-subtle"
            placeholder="UUID tenant..."
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Từ ngày</label>
          <input
            type="date"
            aria-label="Từ ngày" value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="input h-8 text-xs bg-surface dark:bg-surface-muted border-border-subtle"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Đến ngày</label>
          <input
            type="date"
            aria-label="Đến ngày" value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="input h-8 text-xs bg-surface dark:bg-surface-muted border-border-subtle"
          />
        </div>
      </div>

      {/* ── Tab: Danh sách log ──────────────────────────────────────────── */}
      {activeView === "list" && (
        <div className="flex flex-col flex-1">
          <DataTable
            data={listQuery.data as AuditLog[] | undefined}
            columns={columns}
            loading={listQuery.isLoading}
            error={listQuery.error ? userSafeErrorMessage(listQuery.error) : null}
            onRetry={listQuery.refetch}
            rowKey={(r) => r.id}
            emptyTitle="Chưa có nhật ký"
            emptyDescription="Các thao tác quan trọng (đăng nhập, tạo tenant, OTA, v.v.) sẽ hiển thị ở đây."
            hidePagination
            className="flex-1"
          />
          {/* The API exposes a page of rows without a total count. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-surface-elevated px-4 py-3 text-xs text-text-muted">
            <span>Trang {page + 1} · {listQuery.data?.length ?? 0} bản ghi đã tải</span>
            <div className="flex gap-2"><button className="btn-secondary h-8 text-xs" disabled={page === 0 || listQuery.isFetching} onClick={() => setPage((value) => Math.max(0, value - 1))}>Trang trước</button><button className="btn-secondary h-8 text-xs" disabled={listQuery.isFetching || (listQuery.data?.length ?? 0) < limit} onClick={() => setPage((value) => value + 1)}>Trang sau</button></div>
          </div>
        </div>
      )}

      {/* ── Tab: Dòng thời gian ─────────────────────────────────────────── */}
      {activeView === "timeline" && (
        <>
          {timelineQuery.error && (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-50 dark:bg-rose-950/30 p-4">
              <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
                Lỗi tải dữ liệu: {userSafeErrorMessage(timelineQuery.error)}
              </p>
            </div>
          )}

          {timelineQuery.isLoading ? (
            <div className="flex justify-center py-16">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : timelineGroups.length === 0 ? (
            <div className="rounded-2xl border border-border-subtle bg-surface p-12 text-center shadow-sm">
              <ShieldCheck className="mx-auto h-10 w-10 text-text-muted mb-2" />
              <p className="text-sm font-medium text-text-muted">Không tìm thấy nhật ký nào</p>
            </div>
          ) : (
            <div className="space-y-8">
              {timelineGroups.map((group) => (
                <div key={group.date} className="relative">
                  <div className="sticky top-0 z-10 py-2 bg-app/90 backdrop-blur-sm">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                      {group.date}
                    </h3>
                  </div>
                  <div className="space-y-3 border-l-2 border-border-subtle pl-5 ml-2 mt-2">
                    {group.events.map((log) => (
                      <div
                        key={log.id}
                        className="group relative flex items-start gap-4 rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <div className="absolute -left-[27px] top-5 h-3.5 w-3.5 rounded-full bg-blue-500 border-2 border-app shadow-sm" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className={cn("chip text-xs font-semibold px-2.5 py-0.5 rounded-full", ACTION_TONES[log.action] ?? "tone-neutral-chip")}>
                              {ACTION_LABELS[log.action] ?? log.action}
                            </span>
                            {log.resource_type && (
                              <span className="chip tone-neutral-chip text-xs font-medium capitalize">
                                {log.resource_type}
                              </span>
                            )}
                            <TenantCell tenant={log.tenant} fallback="admin" compact />
                          </div>
                          <p className="text-xs text-text-muted font-medium">
                            {new Date(log.created_at).toLocaleTimeString('vi-VN')}
                            {log.ip_address && ` · IP: ${log.ip_address}`}
                            {log.user_id && ` · User: ${log.user_id.substring(0, 8)}`}
                          </p>
                          {log.detail && Object.keys(log.detail).length > 0 && (
                            <details className="mt-3 group/details">
                              <summary className="text-xs font-medium text-text-secondary cursor-pointer hover:text-primary transition-colors">
                                Xem chi tiết
                              </summary>
                              <pre className="mt-2 text-xs font-mono text-slate-100 bg-slate-950 dark:bg-black/70 border border-border-subtle rounded-xl p-3 overflow-x-auto max-w-2xl">
                                {JSON.stringify(maskDetail(log.detail), null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
