import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Bell, RefreshCw, Search, AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { acknowledgeAlert, listAlerts, resolveAlert } from "../../services/alertApi";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { AdminMetric } from "./adminPresentation";
import { Modal } from "../../components/ui/Modal";
import { TenantCell } from "../../components/ui/TenantCell";
import { severityTone } from "../../lib/status";
import { formatDateTime, formatRelative } from "../../lib/formatters";
import type { Alert } from "../../types";
import { Link, useSearchParams } from "react-router-dom";
import { useAdminAlertReadState } from "../../hooks/useAdminAlertReadState";

interface AlertsProps {
  readOnly?: boolean;
  queryKey?: string[];
  queryFn?: () => Promise<Alert[]>;
}

export function Alerts({
  readOnly = true,
  queryKey = ["alerts"],
  queryFn = () => listAlerts(),
}: AlertsProps = {}) {
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Alert | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { markRead } = useAdminAlertReadState();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn,
    refetchInterval: 20_000,
    placeholderData: (previous) => previous,
  });

  const lifecycleMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "acknowledge" | "resolve" }) =>
      action === "acknowledge" ? acknowledgeAlert(id) : resolveAlert(id),
    onSuccess: (updated) => {
      setSelected(updated);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const alerts = data ?? [];

  useEffect(() => {
    const alertId = searchParams.get("alert");
    if (!alertId || alerts.length === 0) return;
    const match = alerts.find((alert) => alert.id === alertId);
    if (!match) return;
    setSelected(match);
    markRead(match.id);
  }, [alerts, markRead, searchParams]);

  function openAlert(alert: Alert): void {
    markRead(alert.id);
    setSelected(alert);
    setSearchParams({ alert: alert.id });
  }

  function closeAlert(): void {
    setSelected(null);
    setSearchParams({});
  }

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (severity !== "all" && a.severity !== severity) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (sourceFilter !== "all" && a.source !== sourceFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${a.title} ${a.message} ${a.device_uid ?? ""} ${a.tenant?.name ?? ""} ${a.tenant?.slug ?? ""}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [alerts, search, severity, statusFilter, sourceFilter]);

  const critical = alerts.filter((a) => a.severity === "critical").length;
  const warning = alerts.filter((a) => a.severity === "warning").length;
  const info = alerts.filter((a) => a.severity === "info").length;

  const columns: Column<Alert>[] = [
    {
      key: "severity",
      header: "Mức độ",
      sortable: true,
      sortValue: (a) => a.severity,
      render: (a) => <StatusBadge tone={severityTone(a.severity)} label={a.severity} />,
    },
    {
      key: "status",
      header: "Trạng thái",
      sortable: true,
      sortValue: (a) => a.status,
      render: (a) => (
        <StatusBadge
          tone={a.status === "resolved" ? "success" : a.status === "acknowledged" ? "info" : "warning"}
          label={a.status}
        />
      ),
    },
    {
      key: "title",
      header: "Tiêu đề",
      render: (a) => (
        <div>
          <div className="text-sm font-medium text-slate-800 dark:text-text-primary">{a.title}</div>
          <div className="text-xs text-slate-500 line-clamp-1">{a.message}</div>
        </div>
      ),
    },
    {
      key: "source",
      header: "Nguồn",
      sortable: true,
      sortValue: (a) => a.source,
      render: (a) => (
        <span className="chip bg-slate-100 text-slate-700 dark:bg-surface-elevated dark:text-text-secondary">
          {a.source}
        </span>
      ),
    },
    {
      key: "device",
      header: "Thiết bị",
      render: (a) =>
        a.device_uid && !readOnly ? (
          <Link to={`/console/devices/${a.device_uid}`} className="font-mono text-xs hover:text-brand-600">
            {a.device_uid}
          </Link>
        ) : a.device_uid ? (
          <span className="font-mono text-xs">{a.device_uid}</span>
        ) : (
          "—"
        ),
    },
    {
      key: "tenant",
      header: "Khách hàng",
      sortable: true,
      sortValue: (a) => a.tenant?.name ?? "",
      render: (a) => <TenantCell tenant={a.tenant} compact />,
    },
    {
      key: "time",
      header: "Thời gian",
      sortable: true,
      sortValue: (a) => new Date(a.timestamp).getTime(),
      render: (a) => (
        <span title={formatDateTime(a.timestamp)} className="text-xs text-slate-500">
          {formatRelative(a.timestamp)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      <PageHeader
        title="Cảnh báo"
        subtitle="Sự kiện và cảnh báo từ fleet IoT"
        actions={
          <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary">
            <RefreshCw className={isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Làm mới
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <AdminMetric label="Tổng" value={error ? "—" : alerts.length} hint="Tổng cảnh báo phát hiện" icon={<Bell className="h-5 w-5" />} loading={isLoading} />
        <AdminMetric label="Critical" value={error ? "—" : critical} hint="Mức độ nghiêm trọng" index={2} icon={<AlertOctagon className="h-5 w-5" />} loading={isLoading} />
        <AdminMetric label="Warning" value={error ? "—" : warning} hint="Cảnh báo tiềm ẩn" index={4} icon={<AlertTriangle className="h-5 w-5" />} loading={isLoading} />
        <AdminMetric label="Info" value={error ? "—" : info} hint="Thông tin hệ thống" index={3} icon={<Info className="h-5 w-5" />} loading={isLoading} />
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        rowKey={(a) => a.id}
        onRowClick={openAlert}
        emptyTitle="Fleet đang ổn định"
        emptyDescription="Chưa có cảnh báo nào trong khoảng thời gian gần đây."
        toolbar={
          <>
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo nội dung, device…"
                className="input pl-9"
              />
            </div>
            <select
              className="input h-9 w-auto"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="all">Tất cả mức</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="info">Info</option>
            </select>
            <select className="input h-9 w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">Tất cả trạng thái</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
            </select>
            <select className="input h-9 w-auto" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
              <option value="all">Tất cả nguồn</option>
              <option value="device">Thiết bị</option>
              <option value="automation_rule">Automation</option>
              <option value="ota">OTA</option>
            </select>
          </>
        }
      />

      <Modal
        open={!!selected}
        onClose={closeAlert}
        title={
          <div className="flex items-center gap-3">
            {selected && <StatusBadge tone={severityTone(selected.severity)} label={selected.severity} />}
            <span>{selected?.title}</span>
          </div>
        }
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Nội dung</div>
              <p className="text-slate-700 dark:text-text-secondary">{selected.message}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Khách hàng</div>
                <TenantCell tenant={selected.tenant} />
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Thời gian</div>
                <div>{formatDateTime(selected.timestamp)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Nguồn</div>
                <div>{selected.source}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Trạng thái</div>
                <div>{selected.status}</div>
              </div>
              {selected.device_uid && !readOnly && (
                <div className="col-span-2">
                  <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Thiết bị</div>
                  <Link
                    to={`/console/devices/${selected.device_uid}`}
                    className="font-mono text-xs text-brand-600 hover:underline"
                  >
                    {selected.device_uid}
                  </Link>
                </div>
              )}
            </div>
            {!readOnly && selected.status !== "resolved" && (
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-border-subtle">
                {selected.status === "open" && (
                  <button
                    className="btn-secondary"
                    disabled={lifecycleMutation.isPending}
                    onClick={() => lifecycleMutation.mutate({ id: selected.id, action: "acknowledge" })}
                  >
                    Xác nhận
                  </button>
                )}
                <button
                  className="btn-primary"
                  disabled={lifecycleMutation.isPending}
                  onClick={() => lifecycleMutation.mutate({ id: selected.id, action: "resolve" })}
                >
                  Giải quyết
                </button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
