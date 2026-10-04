import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search, Cpu, Filter, Plus, Wifi, WifiOff, Wrench } from "lucide-react";
import { listDevices, createDevice, type AdminDeviceCreateData } from "../../services/deviceApi";
import { MetricCard } from "../../components/ui/MetricCard";
import { PageHeader } from "../../components/ui/PageHeader";
import { AdminSectionNav, ADMIN_DEVICE_SECTION_NAV } from "../../components/layout/AdminSectionNav";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { FirmwareVersionBadge } from "../../components/ui/FirmwareVersionBadge";
import { Modal } from "../../components/ui/Modal";
import { TenantCell } from "../../components/ui/TenantCell";
import { deviceTone } from "../../lib/status";
import { formatRelative, formatDateTime } from "../../lib/formatters";
import type { Device } from "../../types";

interface DevicesProps {
  readOnly?: boolean;
  queryKey?: string[];
  queryFn?: () => Promise<Device[]>;
  showSectionNav?: boolean;
}

export function Devices({
  readOnly = false,
  queryKey = ["devices"],
  queryFn,
  showSectionNav = true,
}: DevicesProps = {}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [versionFilter, setVersionFilter] = useState<string>("all");
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<AdminDeviceCreateData>({
    device_uid: "",
    name: "",
    hardware_model: null,
  });
  const [formError, setFormError] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [...queryKey, tenantFilter],
    queryFn: () => queryFn ? queryFn() : listDevices(tenantFilter === "all" ? undefined : tenantFilter),
    refetchInterval: 15_000,
  });

  const createMutation = useMutation({
    mutationFn: createDevice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      setShowCreate(false);
      setForm({ device_uid: "", name: "", hardware_model: null });
      setFormError(null);
    },
    onError: (err: Error & { status?: number; body?: { detail?: string } }) => {
      setFormError(err.body?.detail ?? err.message ?? "Không thể tạo thiết bị");
    },
  });

  const devices = data ?? [];
  const tenants = Array.from(
    new Map(
      devices
        .map((device) => device.tenant)
        .filter((tenant): tenant is NonNullable<Device["tenant"]> => !!tenant)
        .map((tenant) => [tenant.id, tenant]),
    ).values(),
  );

  const versions = useMemo(() => {
    const s = new Set<string>();
    devices.forEach((d) => d.firmware_version && s.add(d.firmware_version));
    return Array.from(s).sort();
  }, [devices]);

  const filtered = useMemo(() => {
    return devices.filter((d) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (versionFilter !== "all" && d.firmware_version !== versionFilter) return false;
      if (readOnly && tenantFilter !== "all" && d.tenant?.id !== tenantFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${d.device_uid} ${d.name} ${d.firmware_version ?? ""} ${d.tenant?.name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [devices, statusFilter, versionFilter, tenantFilter, search, readOnly]);

  const columns: Column<Device>[] = [
    {
      key: "device_uid",
      header: "Thiết bị",
      sortable: true,
      sortValue: (d) => d.name,
      render: (d) =>
        readOnly ? (
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-slate-100 dark:bg-surface-elevated border border-border-subtle flex items-center justify-center text-slate-600 dark:text-text-secondary shrink-0">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold text-slate-900 dark:text-text-primary">{d.name}</div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-text-muted">{d.device_uid}</div>
            </div>
          </div>
        ) : (
          <Link to={`/console/devices/${d.device_uid}`} className="flex items-center gap-3 group">
            <div className="h-9 w-9 rounded-xl bg-brand-500/10 border border-brand-500/20 group-hover:border-brand-500/40 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0 transition-colors">
              <Cpu className="h-4 w-4" />
            </div>
            <div>
              <div className="font-semibold text-slate-900 dark:text-text-primary group-hover:text-brand-600 transition-colors">
                {d.name}
              </div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-text-muted">{d.device_uid}</div>
            </div>
          </Link>
        ),
    },
    {
      key: "tenant",
      header: "Khách hàng",
      sortable: true,
      sortValue: (d) => d.tenant?.name ?? "",
      render: (d) => <TenantCell tenant={d.tenant} />,
    },
    {
      key: "status",
      header: "Trạng thái",
      sortable: true,
      sortValue: (d) => d.status,
      render: (d) => <StatusBadge tone={deviceTone(d.status)} label={d.status} />,
    },
    {
      key: "firmware",
      header: "Firmware",
      sortable: true,
      sortValue: (d) => d.firmware_version,
      render: (d) => <FirmwareVersionBadge version={d.firmware_version} />,
    },
    {
      key: "last_seen",
      header: "Last seen",
      sortable: true,
      sortValue: (d) => (d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0),
      render: (d) => (
        <span title={formatDateTime(d.last_seen_at)} className="text-xs text-slate-600 dark:text-text-muted">
          {formatRelative(d.last_seen_at)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (d) => readOnly ? null : (
        <Link
          to={`/console/devices/${d.device_uid}`}
          className="text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          Chi tiết →
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-5">
      <PageHeader
        title="Thiết bị"
        subtitle={`${devices.length} thiết bị · ${devices.filter((d) => d.status === "online").length} online`}
        actions={
          <div className="flex items-center gap-2">
            {!readOnly && (
              <button
                onClick={() => setShowCreate(true)}
                className="btn-primary"
              >
                <Plus className="h-3.5 w-3.5" /> Thêm thiết bị
              </button>
            )}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="btn-secondary"
            >
              <RefreshCw className={isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Làm mới
            </button>
          </div>
        }
      />

      {showSectionNav && <AdminSectionNav items={ADMIN_DEVICE_SECTION_NAV} />}

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Tổng thiết bị"
          value={error ? "—" : devices.length}
          icon={<Cpu className="h-4 w-4" />}
          loading={isLoading}
        />
        <MetricCard
          label="Đang trực tuyến"
          value={error ? "—" : devices.filter((d) => d.status === "online").length}
          tone="success"
          icon={<Wifi className="h-4 w-4" />}
          loading={isLoading}
        />
        <MetricCard
          label="Ngoại tuyến"
          value={error ? "—" : devices.filter((d) => d.status === "offline").length}
          tone={devices.filter((d) => d.status === "offline").length > 0 ? "danger" : "neutral"}
          icon={<WifiOff className="h-4 w-4" />}
          loading={isLoading}
        />
        <MetricCard
          label="Đang bảo trì"
          value={error ? "—" : devices.filter((d) => d.status === "maintenance").length}
          tone={devices.filter((d) => d.status === "maintenance").length > 0 ? "warning" : "neutral"}
          icon={<Wrench className="h-4 w-4" />}
          loading={isLoading}
        />
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        rowKey={(d) => d.id}
        emptyTitle="Không có thiết bị phù hợp"
        emptyDescription={readOnly ? "Thay đổi bộ lọc để xem thiết bị." : "Thay đổi bộ lọc hoặc đăng ký thiết bị mới."}
        className="flex-1"
        toolbar={
          <>
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo tên, UID, firmware…"
                className="input pl-9"
              />
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-500">
              <Filter className="h-3.5 w-3.5" />
              Lọc:
            </div>
            <select
              className="input h-9 w-auto"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="maintenance">Maintenance</option>
              <option value="deleted">Đã xóa</option>
            </select>
            <select
              className="input h-9 w-auto"
              value={versionFilter}
              onChange={(e) => setVersionFilter(e.target.value)}
            >
              <option value="all">Tất cả firmware</option>
              {versions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              className="input h-9 w-auto"
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
            >
              <option value="all">Tất cả khách hàng</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <div className="ml-auto inline-flex items-center gap-2 text-xs text-slate-500">
              <Cpu className="h-3.5 w-3.5" />
              {filtered.length} kết quả
            </div>
          </>
        }
      />

      <Modal
        open={showCreate}
        onClose={() => { setShowCreate(false); setFormError(null); }}
        title="Thêm thiết bị mới"
        footer={
          <>
            <button
              onClick={() => { setShowCreate(false); setFormError(null); }}
              className="btn-secondary"
            >
              Hủy
            </button>
            <button
              onClick={() => {
                if (!form.device_uid.trim() || !form.name.trim()) return;
                createMutation.mutate({
                  device_uid: form.device_uid.trim(),
                  name: form.name.trim(),
                  hardware_model: form.hardware_model?.trim() || null,
                });
              }}
              disabled={!form.device_uid.trim() || !form.name.trim() || createMutation.isPending}
              className="btn-primary"
            >
              {createMutation.isPending ? "Đang tạo..." : "Tạo thiết bị"}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-3 py-2">
              {formError}
            </div>
          )}
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-border-subtle dark:bg-surface-elevated dark:text-text-muted">
            Thiết bị được tạo ở cấp nền tảng và chưa thuộc khách hàng. Việc gán thiết bị cho tenant phải do tenant thực hiện qua luồng provisioning.
          </p>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-text-secondary mb-1">
              Device UID <span className="text-red-500">*</span>
            </label>
            <input
              className="input w-full"
              value={form.device_uid}
              onChange={(e) => setForm((f) => ({ ...f, device_uid: e.target.value }))}
              placeholder="VD: esp32-001A"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-text-secondary mb-1">
              Tên thiết bị <span className="text-red-500">*</span>
            </label>
            <input
              className="input w-full"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="VD: Cảm biến nhiệt độ phòng server"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-text-secondary mb-1">
              Model phần cứng
            </label>
            <input
              className="input w-full"
              value={form.hardware_model ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, hardware_model: e.target.value || null }))}
              placeholder="VD: ESP32-S3"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
