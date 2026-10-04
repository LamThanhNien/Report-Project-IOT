import { ErrorState } from "../../components/ui/ErrorState";
import { FieldError } from "../../components/ui/FieldError";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  ToggleLeft,
  ToggleRight,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Users,
  Search,
  Filter,
  RefreshCw,
  Sparkles,
  Shield,
  Layers,
} from "lucide-react";
import { listTenants, createTenant, setTenantStatus, listServicePlans } from "../../services/tenantAdminApi";
import { PageHeader } from "../../components/ui/PageHeader";
import { DataTable } from "../../components/ui/DataTable";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { Modal } from "../../components/ui/Modal";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";

import { MetricCard } from "../../components/ui/MetricCard";
import { formatRelative, formatDateTime } from "../../lib/formatters";
import { userSafeErrorMessage } from "../../lib/errorPresentation";
import type { Column } from "../../components/ui/DataTable";
import type { Tenant } from "../../types";

interface TenantsProps {
  readOnly?: boolean;
  queryKey?: string[];
  queryFn?: () => Promise<Tenant[]>;
}

type TenantForm = {
  name: string;
  slug: string;
  plan_id: string;
  owner_email: string;
  owner_password: string;
  owner_full_name: string;
};

type TenantFormField = "name" | "slug" | "owner_email" | "owner_password";
type TenantFormErrors = Partial<Record<TenantFormField, string>>;

const EMPTY_FORM: TenantForm = {
  name: "",
  slug: "",
  plan_id: "",
  owner_email: "",
  owner_password: "",
  owner_full_name: "",
};

function validateTenantForm(form: TenantForm): TenantFormErrors {
  const errors: TenantFormErrors = {};
  if (!form.name.trim()) errors.name = "Tên tenant là bắt buộc.";
  if (!form.slug.trim()) errors.slug = "Slug là bắt buộc.";

  const email = form.owner_email.trim();
  const password = form.owner_password;
  if (email && !password) errors.owner_password = "Nhập mật khẩu khi tạo tài khoản chủ sở hữu.";
  if (password && !email) errors.owner_email = "Nhập email khi tạo tài khoản chủ sở hữu.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.owner_email = "Email không đúng định dạng.";
  }
  if (password) {
    if (password.length < 8) errors.owner_password = "Mật khẩu phải có ít nhất 8 ký tự.";
    else if (password.length > 128) errors.owner_password = "Mật khẩu không được vượt quá 128 ký tự.";
    else if (!/[A-Z]/.test(password)) errors.owner_password = "Mật khẩu phải có ít nhất một chữ hoa.";
    else if (!/[a-z]/.test(password)) errors.owner_password = "Mật khẩu phải có ít nhất một chữ thường.";
    else if (!/\d/.test(password)) errors.owner_password = "Mật khẩu phải có ít nhất một chữ số.";
  }
  return errors;
}

export function Tenants({
  readOnly = false,
  queryKey = ["admin-tenants"],
  queryFn = listTenants,
}: TenantsProps = {}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<TenantForm>(EMPTY_FORM);
  const [touched, setTouched] = useState<Partial<Record<TenantFormField, boolean>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [toggleTarget, setToggleTarget] = useState<{ tenant: Tenant; nextStatus: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");

  const validationErrors = validateTenantForm(form);

  const { data: tenants, isLoading, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn,
  });

  const { data: plans, error: plansError, refetch: refetchPlans } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: listServicePlans,
    enabled: !readOnly,
  });

  const createMut = useMutation({
    mutationFn: createTenant,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      setModalOpen(false);
      setForm(EMPTY_FORM);
      setTouched({});
      setFormError(null);
    },
    onError: (e: Error) => {
      setFormError(userSafeErrorMessage(e));
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      setTenantStatus(id, is_active),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey });
      setToggleTarget(null);
    },
  });

  const tenantList = tenants ?? [];

  // Summary Metrics
  const summary = useMemo(() => {
    const total = tenantList.length;
    const active = tenantList.filter((t) => t.is_active).length;
    const disabled = total - active;
    const totalDevices = tenantList.reduce((acc, t) => acc + (t.device_count || 0), 0);
    const totalUsers = tenantList.reduce((acc, t) => acc + (t.user_count || 0), 0);
    return { total, active, disabled, totalDevices, totalUsers };
  }, [tenantList]);

  // Unique plans from tenants list
  const availablePlans = useMemo(() => {
    const set = new Set<string>();
    tenantList.forEach((t) => {
      if (t.plan_name) set.add(t.plan_name);
    });
    return Array.from(set).sort();
  }, [tenantList]);

  // Filtered tenants
  const filteredTenants = useMemo(() => {
    return tenantList.filter((t) => {
      if (statusFilter === "active" && !t.is_active) return false;
      if (statusFilter === "disabled" && t.is_active) return false;
      if (planFilter !== "all" && (t.plan_name ?? "—") !== planFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const match =
          t.name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q) ||
          (t.plan_name && t.plan_name.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [tenantList, statusFilter, planFilter, search]);

  const columns: Column<Tenant>[] = [
    {
      key: "name",
      header: "Tenant",
      sortable: true,
      render: (t) => (
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 font-bold text-xs uppercase shrink-0">
            {t.name.slice(0, 2)}
          </div>
          <div>
            <div className="font-semibold text-slate-900 dark:text-text-primary hover:text-brand-600 transition-colors">
              {t.name}
            </div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-text-muted">{t.slug}</div>
          </div>
        </div>
      ),
      sortValue: (t) => t.name,
    },
    {
      key: "plan_name",
      header: "Giới hạn workspace",
      render: (t) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 border border-brand-200 dark:border-brand-800/40">
          {t.plan_name ?? "— Chưa gán —"}
        </span>
      ),
    },
    {
      key: "device_count",
      header: "Thiết bị",
      align: "center",
      render: (t) => (
        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-surface-elevated text-xs font-mono font-medium text-slate-700 dark:text-text-secondary">
          <Cpu className="h-3 w-3 text-slate-400" />
          <span>{t.device_count}</span>
        </div>
      ),
      sortValue: (t) => t.device_count,
      sortable: true,
    },
    {
      key: "user_count",
      header: "Người dùng",
      align: "center",
      render: (t) => (
        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-surface-elevated text-xs font-mono font-medium text-slate-700 dark:text-text-secondary">
          <Users className="h-3 w-3 text-slate-400" />
          <span>{t.user_count}</span>
        </div>
      ),
      sortValue: (t) => t.user_count,
      sortable: true,
    },
    {
      key: "is_active",
      header: "Trạng thái",
      render: (t) => (
        <StatusBadge tone={t.is_active ? "success" : "danger"} label={t.is_active ? "Active" : "Disabled"} />
      ),
    },
    {
      key: "created_at",
      header: "Tạo lúc",
      render: (t) => (
        <span title={formatDateTime(t.created_at)} className="text-xs text-slate-500 dark:text-text-muted">
          {formatRelative(t.created_at)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (t) => readOnly ? null : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setToggleTarget({ tenant: t, nextStatus: !t.is_active });
          }}
          disabled={toggleMut.isPending}
          className="btn-ghost h-8 w-8 p-0 rounded-lg text-xs hover:bg-surface-elevated"
          title={t.is_active ? "Disable" : "Enable"}
          aria-label={`${t.is_active ? "Vô hiệu hoá" : "Kích hoạt"} tenant ${t.name}`}
        >
          {t.is_active ? (
            <ToggleRight className="h-5 w-5 text-emerald-500 transition-transform hover:scale-110" />
          ) : (
            <ToggleLeft className="h-5 w-5 text-slate-400 hover:text-slate-600 transition-transform hover:scale-110" />
          )}
        </button>
      ),
    },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-5">
      <PageHeader
        title="Quản lý Tenant"
        subtitle="Danh sách khách hàng đang sử dụng hệ thống AIFOM"
        actions={
          <div className="flex items-center gap-2">
            {!readOnly && (
              <button onClick={() => setModalOpen(true)} className="btn-primary">
                <Plus className="h-4 w-4" /> Tạo Tenant
              </button>
            )}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="btn-secondary"
              title="Làm mới"
            >
              <RefreshCw className={isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            </button>
          </div>
        }
      />

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Tổng số Tenant"
          value={error ? "—" : summary.total}
          icon={<Building2 className="h-4 w-4" />}
          loading={isLoading}
        />
        <MetricCard
          label="Đang hoạt động"
          value={error ? "—" : summary.active}
          tone="success"
          icon={<CheckCircle2 className="h-4 w-4" />}
          loading={isLoading}
        />
        <MetricCard
          label="Vô hiệu hoá"
          value={error ? "—" : summary.disabled}
          tone={summary.disabled > 0 ? "danger" : "neutral"}
          icon={<AlertTriangle className="h-4 w-4" />}
          loading={isLoading}
        />
        <MetricCard
          label="Tổng thiết bị kết nối"
          value={error ? "—" : summary.totalDevices}
          icon={<Cpu className="h-4 w-4" />}
          loading={isLoading}
        />
      </div>

      <DataTable
        data={filteredTenants}
        columns={columns}
        loading={isLoading}
        error={error ? userSafeErrorMessage(error) : null}
        onRetry={refetch}
        rowKey={(t) => t.id}
        onRowClick={readOnly ? undefined : (t) => navigate(`/console/admin/tenants/${t.id}`)}
        emptyTitle="Chưa có tenant phù hợp"
        emptyDescription="Tạo tenant đầu tiên hoặc thay đổi bộ lọc tìm kiếm"
        className="flex-1"
        toolbar={
          <>
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Tìm kiếm tenant" placeholder="Tìm kiếm theo tên, slug, giới hạn…"
                className="input pl-9 w-full"
              />
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-text-muted font-medium">
              <Filter className="h-3.5 w-3.5" />
              Bộ lọc:
            </div>
            <select
              className="input h-9 w-auto text-xs"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="active">Đang hoạt động (Active)</option>
              <option value="disabled">Vô hiệu hoá (Disabled)</option>
            </select>
            {availablePlans.length > 0 && (
              <select
                className="input h-9 w-auto text-xs"
                value={planFilter}
                onChange={(e) => setPlanFilter(e.target.value)}
              >
                <option value="all">Tất cả gói</option>
                {availablePlans.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            )}
            <div className="ml-auto text-xs text-slate-500 dark:text-text-muted hidden sm:block">
              Hiển thị <span className="font-semibold text-slate-800 dark:text-text-primary">{filteredTenants.length}</span> / {summary.total} tenant
            </div>
          </>
        }
      />

      {!readOnly && (
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Tạo Tenant mới"
          size="md"
          footer={
            <>
              <button
                onClick={() => setModalOpen(false)}
                className="btn-secondary"
                disabled={createMut.isPending}
              >
                Hủy
              </button>
              <button
                onClick={() => {
                  setTouched({ name: true, slug: true, owner_email: true, owner_password: true });
                  if (Object.keys(validationErrors).length > 0) return;
                  createMut.mutate({
                    name: form.name.trim(),
                    slug: form.slug.trim(),
                    plan_id: form.plan_id || null,
                    owner_email: form.owner_email.trim() || undefined,
                    owner_password: form.owner_password || undefined,
                    owner_full_name: form.owner_full_name.trim() || undefined,
                  });
                }}
                disabled={createMut.isPending || !form.name.trim() || !form.slug.trim() || !form.plan_id}
                className="btn-primary"
              >
                {createMut.isPending ? "Đang tạo…" : "Tạo"}
              </button>
            </>
          }
        >
          {formError && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}
          {plansError && <ErrorState message={userSafeErrorMessage(plansError)} onRetry={() => refetchPlans()} />}
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-surface-elevated border border-border-subtle space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-text-primary pb-1 border-b border-border-subtle">
                <Building2 className="h-3.5 w-3.5 text-brand-500" />
                Thông tin Tenant
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-text-secondary mb-1 block">
                  Tên Tenant *
                </label>
                <input
                  className="input w-full"
                  aria-label="Tên Tenant"
                  placeholder="VD: Viện Nghiên cứu Nông nghiệp"
                  aria-invalid={Boolean(touched.name && validationErrors.name)}
                  aria-describedby={touched.name && validationErrors.name ? "tenant-name-error" : undefined}
                  value={form.name}
                  onBlur={() => setTouched((current) => ({ ...current, name: true }))}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((f) => ({
                      ...f,
                      name,
                      slug: f.slug || name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""),
                    }));
                  }}
                />
                <FieldError id="tenant-name-error" message={touched.name ? validationErrors.name : null} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-text-secondary mb-1 block">
                  Slug *
                </label>
                <input
                  className="input font-mono w-full"
                  aria-label="Slug"
                  placeholder="vien-nghien-cuu-nn"
                  aria-invalid={Boolean(touched.slug && validationErrors.slug)}
                  aria-describedby={touched.slug && validationErrors.slug ? "tenant-slug-error" : undefined}
                  value={form.slug}
                  onBlur={() => setTouched((current) => ({ ...current, slug: true }))}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                />
                <FieldError id="tenant-slug-error" message={touched.slug ? validationErrors.slug : null} />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700 dark:text-text-secondary mb-1 block">
                  Giới hạn workspace
                </label>
                <select
                  aria-label="Giới hạn workspace"
                  className="input w-full"
                  value={form.plan_id}
                  onChange={(e) => setForm((f) => ({ ...f, plan_id: e.target.value }))}
                >
                  <option value="" disabled>Chọn cấu hình giới hạn</option>
                  {(plans ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface-elevated border border-border-subtle space-y-3">
              <div className="flex items-center justify-between pb-1 border-b border-border-subtle">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-text-primary">
                  <Shield className="h-3.5 w-3.5 text-brand-500" />
                  Tài khoản chủ sở hữu
                </div>
                <span className="text-[11px] text-slate-400 italic">(tuỳ chọn)</span>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-text-secondary mb-1 block">
                    Email đăng nhập
                  </label>
                  <input
                    type="email"
                    className="input w-full"
                    placeholder="owner@company.com"
                    aria-invalid={Boolean(touched.owner_email && validationErrors.owner_email)}
                    aria-describedby={
                      touched.owner_email && validationErrors.owner_email ? "tenant-owner-email-error" : undefined
                    }
                    value={form.owner_email}
                    onBlur={() => setTouched((current) => ({ ...current, owner_email: true }))}
                    onChange={(e) => setForm((f) => ({ ...f, owner_email: e.target.value }))}
                  />
                  <FieldError
                    id="tenant-owner-email-error"
                    message={touched.owner_email ? validationErrors.owner_email : null}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-text-secondary mb-1 block">
                    Mật khẩu tạm thời
                  </label>
                  <input
                    type="password"
                    className="input w-full"
                    placeholder="8–128 ký tự, có chữ hoa, chữ thường và chữ số"
                    aria-invalid={Boolean(touched.owner_password && validationErrors.owner_password)}
                    aria-describedby={
                      touched.owner_password && validationErrors.owner_password ? "tenant-owner-password-error" : undefined
                    }
                    value={form.owner_password}
                    onBlur={() => setTouched((current) => ({ ...current, owner_password: true }))}
                    onChange={(e) => setForm((f) => ({ ...f, owner_password: e.target.value }))}
                  />
                  <FieldError
                    id="tenant-owner-password-error"
                    message={touched.owner_password ? validationErrors.owner_password : null}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700 dark:text-text-secondary mb-1 block">
                    Họ tên
                  </label>
                  <input
                    type="text"
                    className="input w-full"
                    placeholder="Nguyễn Văn A"
                    value={form.owner_full_name}
                    onChange={(e) => setForm((f) => ({ ...f, owner_full_name: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={toggleTarget !== null}
        title={toggleTarget?.nextStatus ? "Kích hoạt tenant?" : "Vô hiệu hoá tenant?"}
        description={
          toggleTarget ? (
            <div>{toggleTarget.nextStatus
              ? `Tenant “${toggleTarget.tenant.name}” sẽ có thể tiếp tục sử dụng hệ thống.`
              : `Tenant “${toggleTarget.tenant.name}” sẽ bị chặn truy cập cho đến khi được kích hoạt lại.`}{toggleMut.isError && <p role="alert" className="mt-3 text-xs text-rose-500">{userSafeErrorMessage(toggleMut.error)}</p>}</div>
          ) : undefined
        }
        confirmLabel={toggleTarget?.nextStatus ? "Kích hoạt" : "Vô hiệu hoá"}
        destructive={!toggleTarget?.nextStatus}
        loading={toggleMut.isPending}
        onCancel={() => {
          setToggleTarget(null);
        }}
        onConfirm={() => {
          if (!toggleTarget) return;
          toggleMut.mutate({ id: toggleTarget.tenant.id, is_active: toggleTarget.nextStatus });
        }}
      />
    </div>
  );
}
