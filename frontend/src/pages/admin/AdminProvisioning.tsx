import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, CheckCircle2, Clock, Search, Filter, RefreshCw, KeyRound, Cpu } from "lucide-react";
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

interface ProvisioningSession {
  id: string;
  device_id: string | null;
  tenant_id: string | null;
  tenant?: TenantSummary | null;
  claim_code: string | null;
  status: string;
  expires_at: string | null;
  claimed_at: string | null;
  created_at: string;
}

function formatShortId(value: string | null | undefined): string {
  return value ? `${value.substring(0, 8)}...` : "-";
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("vi-VN") : "-";
}

function errorMessage(error: unknown): string | null {
  return error ? userSafeErrorMessage(error) : null;
}

export default function AdminProvisioning() {
  const [filterTenant, setFilterTenant] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const sessionsQuery = useQuery({
    queryKey: ["admin-provisioning", filterTenant, filterStatus],
    queryFn: () =>
      adminApi.listProvisioningSessions({
        tenant_id: filterTenant || undefined,
        status: filterStatus || undefined,
      }),
  });

  const sessions = (sessionsQuery.data?.items || []) as ProvisioningSession[];
  const summary = useMemo(() => {
    const pending = sessions.filter((session) => session.status === "pending").length;
    const claimed = sessions.filter((session) => session.status === "claimed").length;
    return { total: sessionsQuery.data?.total ?? sessions.length, pending, claimed };
  }, [sessions, sessionsQuery.data?.total]);

  const columns: Column<ProvisioningSession>[] = [
    {
      key: "claim_code",
      header: "Mã claim",
      render: (session) => (
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0">
            <KeyRound className="h-3.5 w-3.5" />
          </div>
          <span className="font-mono text-xs font-semibold text-slate-800 dark:text-text-primary">
            {session.claim_code ? `${session.claim_code.substring(0, 16)}...` : "-"}
          </span>
        </div>
      ),
    },
    {
      key: "tenant_id",
      header: "Khách hàng",
      render: (session) => <TenantCell tenant={session.tenant} compact />,
    },
    {
      key: "device_id",
      header: "Thiết bị",
      render: (session) => (
        <div className="inline-flex items-center gap-1 font-mono text-xs text-slate-600 dark:text-text-secondary">
          <Cpu className="h-3 w-3 text-slate-400" />
          <span>{formatShortId(session.device_id)}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Trạng thái",
      render: (session) => <StatusBadge tone={statusToTone(session.status)} label={statusLabel(session.status)} />,
    },
    {
      key: "expires_at",
      header: "Hết hạn",
      sortable: true,
      sortValue: (session) => session.expires_at,
      render: (session) => (
        <span className="text-xs text-slate-500 dark:text-text-muted">{formatDate(session.expires_at)}</span>
      ),
    },
    {
      key: "created_at",
      header: "Tạo lúc",
      sortable: true,
      sortValue: (session) => session.created_at,
      render: (session) => (
        <span className="text-xs text-slate-500 dark:text-text-muted">{formatDate(session.created_at)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      <PageHeader
        title="Cấp phát thiết bị"
        subtitle="Giám sát toàn bộ phiên cấp phát và claim thiết bị trên các tenant."
        actions={
          <button
            onClick={() => sessionsQuery.refetch()}
            disabled={sessionsQuery.isFetching}
            className="btn-secondary text-xs"
            title="Làm mới"
          >
            <RefreshCw className={sessionsQuery.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Làm mới
          </button>
        }
      />

      <AdminSectionNav items={ADMIN_DEVICE_SECTION_NAV} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Tổng phiên"
          value={summary.total}
          icon={<Building2 className="h-4 w-4" />}
          loading={sessionsQuery.isLoading}
        />
        <MetricCard
          label="Đang chờ"
          value={summary.pending}
          icon={<Clock className="h-4 w-4" />}
          tone="info"
          loading={sessionsQuery.isLoading}
        />
        <MetricCard
          label="Đã claim"
          value={summary.claimed}
          icon={<CheckCircle2 className="h-4 w-4" />}
          tone="success"
          loading={sessionsQuery.isLoading}
        />
      </div>

      <DataTable
        data={sessions}
        columns={columns}
        loading={sessionsQuery.isLoading}
        error={errorMessage(sessionsQuery.error)}
        onRetry={() => sessionsQuery.refetch()}
        rowKey={(session) => session.id}
        emptyTitle="Không tìm thấy phiên cấp phát"
        emptyDescription="Thử đổi bộ lọc tenant hoặc trạng thái để xem thêm dữ liệu."
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
              <option value="claimed">Đã claim</option>
              <option value="expired">Hết hạn</option>
              <option value="revoked">Đã thu hồi</option>
            </select>
            <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-text-muted">
              <span>{sessions.length} phiên</span>
            </div>
          </>
        }
      />
    </div>
  );
}
