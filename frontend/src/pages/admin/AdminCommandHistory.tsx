import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, RotateCcw, Search, Send, Filter, RefreshCw, Terminal, Cpu } from "lucide-react";
import { adminApi } from "../../services/adminApi";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { MetricCard } from "../../components/ui/MetricCard";
import { PageHeader } from "../../components/ui/PageHeader";
import { AdminSectionNav, ADMIN_DEVICE_SECTION_NAV } from "../../components/layout/AdminSectionNav";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TenantCell } from "../../components/ui/TenantCell";
import { statusLabel, statusToTone } from "../../lib/statusHelper";
import { userSafeErrorMessage } from "../../lib/errorPresentation";
import type { TenantSummary } from "../../types";

interface CommandDispatch {
  id: string;
  tenant_id: string | null;
  tenant?: TenantSummary | null;
  command_type: string;
  target_type: string;
  status: string;
  retry_count: number;
  created_at: string;
}

function formatDate(value: string): string {
  return value ? new Date(value).toLocaleString("vi-VN") : "-";
}

function errorMessage(error: unknown): string | null {
  return error ? userSafeErrorMessage(error) : null;
}

interface AdminCommandHistoryProps {
  readOnly?: boolean;
  queryKey?: string[];
  queryFn?: (params?: Record<string, unknown>) => Promise<{ items: unknown[]; total: number }>;
  showSectionNav?: boolean;
}

export default function AdminCommandHistory({
  queryKey = ["admin-commands"],
  queryFn = adminApi.listCommandHistory,
  showSectionNav = true,
}: AdminCommandHistoryProps = {}) {
  const [filterTenant, setFilterTenant] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");

  const commandsQuery = useQuery({
    queryKey: [...queryKey, filterTenant, filterStatus, filterType],
    queryFn: () =>
      queryFn({
        tenant_id: filterTenant || undefined,
        status: filterStatus || undefined,
        command_type: filterType || undefined,
      }),
  });

  const dispatches = (commandsQuery.data?.items || []) as CommandDispatch[];
  const summary = useMemo(() => {
    const sent = dispatches.filter((dispatch) => dispatch.status === "sent" || dispatch.status === "completed").length;
    const retries = dispatches.reduce((sum, dispatch) => sum + (dispatch.retry_count ?? 0), 0);
    return { total: commandsQuery.data?.total ?? dispatches.length, sent, retries };
  }, [dispatches, commandsQuery.data?.total]);

  const columns: Column<CommandDispatch>[] = [
    {
      key: "command_type",
      header: "Loại lệnh",
      sortable: true,
      sortValue: (dispatch) => dispatch.command_type,
      render: (dispatch) => (
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0">
            <Terminal className="h-3.5 w-3.5" />
          </div>
          <span className="font-mono text-xs font-semibold text-slate-900 dark:text-text-primary">
            {dispatch.command_type}
          </span>
        </div>
      ),
    },
    {
      key: "target_type",
      header: "Đối tượng",
      render: (dispatch) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-surface-elevated text-slate-700 dark:text-text-secondary capitalize">
          {statusLabel(dispatch.target_type)}
        </span>
      ),
    },
    {
      key: "tenant_id",
      header: "Khách hàng",
      render: (dispatch) => <TenantCell tenant={dispatch.tenant} compact />,
    },
    {
      key: "status",
      header: "Trạng thái",
      render: (dispatch) => <StatusBadge tone={statusToTone(dispatch.status)} label={statusLabel(dispatch.status)} />,
    },
    {
      key: "retry_count",
      header: "Thử lại",
      align: "right",
      sortable: true,
      sortValue: (dispatch) => dispatch.retry_count,
      render: (dispatch) => (
        <span className="font-mono text-xs tabular-nums text-slate-600 dark:text-text-secondary font-medium">
          {dispatch.retry_count}
        </span>
      ),
    },
    {
      key: "created_at",
      header: "Thời gian",
      sortable: true,
      sortValue: (dispatch) => dispatch.created_at,
      render: (dispatch) => (
        <span className="text-xs text-slate-500 dark:text-text-muted">{formatDate(dispatch.created_at)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      <PageHeader
        title="Lịch sử lệnh"
        subtitle="Theo dõi các lệnh đã gửi tới thiết bị và nhóm thiết bị trên toàn hệ thống."
        actions={
          <button
            onClick={() => commandsQuery.refetch()}
            disabled={commandsQuery.isFetching}
            className="btn-secondary text-xs"
            title="Làm mới"
          >
            <RefreshCw className={commandsQuery.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Làm mới
          </button>
        }
      />

      {showSectionNav && <AdminSectionNav items={ADMIN_DEVICE_SECTION_NAV} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Tổng lệnh"
          value={summary.total}
          icon={<Send className="h-4 w-4" />}
          loading={commandsQuery.isLoading}
        />
        <MetricCard
          label="Đã gửi / Hoàn thành"
          value={summary.sent}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="success"
          loading={commandsQuery.isLoading}
        />
        <MetricCard
          label="Lượt thử lại"
          value={summary.retries}
          icon={<RotateCcw className="h-4 w-4" />}
          loading={commandsQuery.isLoading}
        />
      </div>

      <DataTable
        data={dispatches}
        columns={columns}
        loading={commandsQuery.isLoading}
        error={errorMessage(commandsQuery.error)}
        onRetry={() => commandsQuery.refetch()}
        rowKey={(dispatch) => dispatch.id}
        emptyTitle="Không tìm thấy lịch sử lệnh"
        emptyDescription="Thử đổi bộ lọc tenant, trạng thái hoặc loại lệnh để xem thêm dữ liệu."
        className="flex-1"
        toolbar={
          <>
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-text-muted" />
              <input
                type="text"
                value={filterTenant}
                onChange={(event) => setFilterTenant(event.target.value)}
                className="input w-full pl-9 text-xs"
                placeholder="Lọc theo tenant ID"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-text-muted font-medium">
              <Filter className="h-3.5 w-3.5" />
              Lọc:
            </div>
            <select
              className="input w-48 text-xs h-9"
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="pending">Đang chờ</option>
              <option value="sent">Đã gửi</option>
              <option value="completed">Hoàn thành</option>
              <option value="failed">Thất bại</option>
              <option value="timeout">Hết thời gian</option>
            </select>
            <select
              className="input w-52 text-xs h-9"
              value={filterType}
              onChange={(event) => setFilterType(event.target.value)}
            >
              <option value="">Tất cả loại lệnh</option>
              <option value="set_output">Set Output</option>
              <option value="toggle_output">Toggle Output</option>
              <option value="request_status">Request Status</option>
              <option value="request_telemetry">Request Telemetry</option>
              <option value="reboot">Reboot</option>
            </select>
            <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-text-muted">
              <span>{dispatches.length} lệnh</span>
            </div>
          </>
        }
      />
    </div>
  );
}
