import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Layers3, Search, Users, Filter, RefreshCw, Cpu } from "lucide-react";
import { adminApi } from "../../services/adminApi";
import { listTenants } from "../../services/tenantAdminApi";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { MetricCard } from "../../components/ui/MetricCard";
import { PageHeader } from "../../components/ui/PageHeader";
import { AdminSectionNav, ADMIN_DEVICE_SECTION_NAV } from "../../components/layout/AdminSectionNav";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TenantCell } from "../../components/ui/TenantCell";
import { statusLabel, statusToTone } from "../../lib/statusHelper";
import { userSafeErrorMessage } from "../../lib/errorPresentation";
import type { TenantSummary } from "../../types";

interface DeviceGroup {
  id: string;
  tenant_id: string;
  tenant?: TenantSummary | null;
  name: string;
  group_type: string;
  status: string;
  device_count: number;
  description?: string | null;
  created_at: string;
  updated_at: string;
}

function formatDate(value: string): string {
  return value ? new Date(value).toLocaleDateString("vi-VN") : "-";
}

function errorMessage(error: unknown): string | null {
  return error ? userSafeErrorMessage(error) : null;
}

export default function AdminDeviceGroups() {
  const [filterTenant, setFilterTenant] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");

  const tenantsQuery = useQuery({
    queryKey: ["admin-tenants"],
    queryFn: listTenants,
  });

  const groupsQuery = useQuery({
    queryKey: ["admin-device-groups", filterTenant, filterStatus],
    queryFn: () =>
      adminApi.listDeviceGroups({
        tenant_id: filterTenant || undefined,
        status: filterStatus || undefined,
      }),
  });

  const groups = (groupsQuery.data?.items || []) as DeviceGroup[];
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((group) =>
      [group.name, group.description, group.tenant?.name, group.tenant?.slug, group.tenant_id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [groups, search]);
  const summary = useMemo(() => {
    const tenants = new Set(groups.map((group) => group.tenant_id).filter(Boolean));
    const devices = groups.reduce((sum, group) => sum + (group.device_count ?? 0), 0);
    return { groups: groupsQuery.data?.total ?? groups.length, tenants: tenants.size, devices };
  }, [groups, groupsQuery.data?.total]);

  const columns: Column<DeviceGroup>[] = [
    {
      key: "name",
      header: "Tên nhóm",
      sortable: true,
      sortValue: (group) => group.name,
      render: (group) => (
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 font-bold shrink-0">
            <Layers3 className="h-4 w-4" />
          </div>
          <div>
            <div className="font-semibold text-slate-900 dark:text-text-primary">{group.name}</div>
            {group.description && (
              <div className="line-clamp-1 text-xs text-slate-500 dark:text-text-muted mt-0.5">
                {group.description}
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: "tenant_id",
      header: "Khách hàng",
      render: (group) => <TenantCell tenant={group.tenant} compact />,
    },
    {
      key: "group_type",
      header: "Loại",
      render: (group) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-surface-elevated text-slate-700 dark:text-text-secondary capitalize">
          {statusLabel(group.group_type)}
        </span>
      ),
    },
    {
      key: "device_count",
      header: "Thiết bị",
      align: "right",
      sortable: true,
      sortValue: (group) => group.device_count,
      render: (group) => (
        <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-surface-elevated text-xs font-mono font-semibold text-slate-800 dark:text-text-primary">
          <Cpu className="h-3 w-3 text-slate-400" />
          <span>{group.device_count}</span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Trạng thái",
      render: (group) => <StatusBadge tone={statusToTone(group.status)} label={statusLabel(group.status)} />,
    },
    {
      key: "updated_at",
      header: "Cập nhật",
      sortable: true,
      sortValue: (group) => group.updated_at,
      render: (group) => (
        <span className="text-xs text-slate-500 dark:text-text-muted">{formatDate(group.updated_at || group.created_at)}</span>
      ),
    },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      <PageHeader
        title="Nhóm thiết bị"
        subtitle="Theo dõi toàn bộ nhóm thiết bị trên các tenant trong hệ thống."
        actions={
          <button
            onClick={() => groupsQuery.refetch()}
            disabled={groupsQuery.isFetching}
            className="btn-secondary text-xs"
            title="Làm mới"
          >
            <RefreshCw className={groupsQuery.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Làm mới
          </button>
        }
      />

      <AdminSectionNav items={ADMIN_DEVICE_SECTION_NAV} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Tổng nhóm"
          value={summary.groups}
          icon={<Layers3 className="h-4 w-4" />}
          loading={groupsQuery.isLoading}
        />
        <MetricCard
          label="Tenant có nhóm"
          value={summary.tenants}
          icon={<Building2 className="h-4 w-4" />}
          loading={groupsQuery.isLoading}
        />
        <MetricCard
          label="Thiết bị đã nhóm"
          value={summary.devices}
          icon={<Users className="h-4 w-4" />}
          loading={groupsQuery.isLoading}
        />
      </div>

      <DataTable
        data={filteredGroups}
        columns={columns}
        loading={groupsQuery.isLoading}
        error={errorMessage(groupsQuery.error)}
        onRetry={() => groupsQuery.refetch()}
        rowKey={(group) => group.id}
        emptyTitle="Không tìm thấy nhóm thiết bị"
        emptyDescription="Thử đổi bộ lọc tenant hoặc trạng thái để xem thêm dữ liệu."
        className="flex-1"
        toolbar={
          <>
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="input w-full pl-9 text-xs"
                placeholder="Tìm nhóm, mô tả hoặc tenant"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-text-muted font-medium">
              <Filter className="h-3.5 w-3.5" />
              Lọc:
            </div>
            <select
              className="input w-56 text-xs h-9"
              value={filterTenant}
              onChange={(event) => setFilterTenant(event.target.value)}
            >
              <option value="">Tất cả tenant</option>
              {(tenantsQuery.data ?? []).map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
            <select
              className="input w-48 text-xs h-9"
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động</option>
              <option value="archived">Đã lưu trữ</option>
            </select>
            <div className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-text-muted">
              <span>{filteredGroups.length} nhóm</span>
            </div>
          </>
        }
      />
    </div>
  );
}
