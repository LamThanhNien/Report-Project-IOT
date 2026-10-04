import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Copy, Check, Cpu, FolderOpen, Users, SlidersHorizontal, ShieldCheck } from "lucide-react";
import { getTenant, listTenantUsers, listTenantDevices, listTenantProjects, listServicePlans, updateTenant } from "../../services/tenantAdminApi";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { Tabs } from "../../components/ui/Tabs";
import { formatDateTime, formatRelative } from "../../lib/formatters";
import { deviceTone } from "../../lib/status";
import { AdminMetric, AdminReadOnlyNote } from "./adminPresentation";

export function TenantDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [tab, setTab] = useState("info");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const tenantQ = useQuery({ queryKey: ["admin-tenant", id], queryFn: () => getTenant(id), enabled: !!id });
  const usersQ = useQuery({ queryKey: ["admin-tenant-users", id], queryFn: () => listTenantUsers(id), enabled: !!id });
  const devicesQ = useQuery({ queryKey: ["admin-tenant-devices", id], queryFn: () => listTenantDevices(id), enabled: !!id });
  const projectsQ = useQuery({ queryKey: ["admin-tenant-projects", id], queryFn: () => listTenantProjects(id), enabled: !!id });
  const plansQ = useQuery({ queryKey: ["admin-plans"], queryFn: listServicePlans });
  const updatePlanMut = useMutation({
    mutationFn: (plan_id: string | null) => updateTenant(id, { plan_id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-tenant", id] }); qc.invalidateQueries({ queryKey: ["admin-tenants"] }); },
  });
  const tenant = tenantQ.data;
  const plan = plansQ.data?.find((item) => item.id === tenant?.plan_id);
  const devices = (devicesQ.data ?? []).filter((device) => device.status !== "deleted");

  if (tenantQ.isLoading) return <div className="space-y-4"><PageHeader title="Tenant" /><div className="h-64 animate-pulse rounded-2xl bg-slate-100 dark:bg-surface-elevated" /></div>;
  if (tenantQ.isError) return <ErrorState message={tenantQ.error.message} onRetry={() => tenantQ.refetch()} />;
  if (!tenant) return <EmptyState title="Tenant not found" />;

  return <div className="space-y-5">
    <Link to="/console/admin/tenants" className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-brand-600"><ArrowLeft className="h-3.5 w-3.5" />Back to tenants</Link>
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-border-subtle dark:bg-surface">
      <PageHeader title={<span className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600"><Building2 className="h-6 w-6" /></span>{tenant.name}</span>} subtitle={"Slug: " + tenant.slug} actions={<div className="flex flex-wrap items-center gap-2"><StatusBadge tone={tenant.is_active ? "success" : "danger"} label={tenant.is_active ? "Active" : "Disabled"} /><button className="btn-secondary text-xs" onClick={async () => { try { await navigator.clipboard.writeText(tenant.id); setCopied(true); setCopyError(null); } catch { setCopyError("Không thể sao chép ID. Bạn có thể chọn ID trong thông tin tenant."); } }}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Đã sao chép ID" : "Copy ID"}</button></div>} />
      {copyError && <p role="alert" className="text-xs text-rose-500">{copyError}</p>}
    </div>
    <div className="grid gap-4 sm:grid-cols-3"><AdminMetric label="Thiết bị" value={tenant.device_count} hint={devicesQ.isError ? "—" : devices.filter((device) => device.status === "online").length + " online"} icon={<Cpu className="h-5 w-5" />} /><AdminMetric label="Người dùng" value={tenant.user_count} hint="Thành viên workspace" index={1} icon={<Users className="h-5 w-5" />} /><AdminMetric label="Projects" value={projectsQ.isError ? "—" : projectsQ.data?.length ?? 0} loading={projectsQ.isLoading} hint="Không gian làm việc của tenant" index={3} icon={<FolderOpen className="h-5 w-5" />} /></div>
    <Tabs tabs={[{ key: "info", label: <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />Thông tin tổng quan</span> }, { key: "users", label: <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Users ({usersQ.data?.length ?? 0})</span> }, { key: "devices", label: <span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" />Devices ({devices.length})</span> }, { key: "projects", label: <span className="inline-flex items-center gap-1.5"><FolderOpen className="h-3.5 w-3.5" />Projects ({projectsQ.data?.length ?? 0})</span> }]} active={tab} onChange={setTab} />

    {tab === "info" && <div className="grid gap-5 lg:grid-cols-3">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-brand-500" />Chi tiết Tenant</CardTitle></CardHeader><CardBody className="space-y-3.5 text-sm"><Row label="Tenant ID" value={<span className="break-all font-mono text-xs select-all">{tenant.id}</span>} /><Row label="Tên Tenant" value={tenant.name} /><Row label="Slug" value={<code className="rounded bg-slate-100 px-2 py-0.5 dark:bg-surface-elevated">{tenant.slug}</code>} /><Row label="Trạng thái" value={<StatusBadge tone={tenant.is_active ? "success" : "danger"} label={tenant.is_active ? "Active" : "Disabled"} />} /><Row label="Ngày khởi tạo" value={<span title={formatDateTime(tenant.created_at)}>{formatRelative(tenant.created_at)}</span>} /></CardBody></Card>
      <Card className="lg:col-span-2"><CardHeader className="flex items-center justify-between"><CardTitle className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-brand-500" />Hạn ngạch tài nguyên</CardTitle><StatusBadge tone="info" label={tenant.plan_name ?? "Chưa gán cấu hình"} /></CardHeader><CardBody className="space-y-5">
        <label className="block text-xs font-medium text-slate-500">Giới hạn workspace<select aria-label="Giới hạn workspace" className="input mt-2 max-w-md" value={tenant.plan_id ?? ""} disabled={updatePlanMut.isPending || plansQ.isLoading || plansQ.isError} onChange={(event) => updatePlanMut.mutate(event.target.value || null)}><option value="" disabled>Chưa gán cấu hình giới hạn</option>{(plansQ.data ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.max_devices} thiết bị</option>)}</select></label>
        {plansQ.isError && <ErrorState message={plansQ.error.message} onRetry={() => plansQ.refetch()} />}
        {updatePlanMut.isError && <p role="alert" className="text-xs text-rose-500">{updatePlanMut.error.message}</p>}
        {plan && <div className="grid gap-4 sm:grid-cols-2"><Quota label="Thiết bị" used={tenant.device_count} limit={plan.max_devices} /><Quota label="Người dùng" used={tenant.user_count} limit={plan.max_users} /><div className="sm:col-span-2 rounded-xl bg-slate-50 p-4 text-xs text-slate-600 dark:bg-surface-elevated dark:text-text-muted">Lưu telemetry: <span className="font-semibold">{plan.telemetry_retention_days} ngày</span></div></div>}
        <AdminReadOnlyNote><span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Thiết bị, thành viên và projects thuộc tenant được hiển thị ở chế độ chỉ đọc.</span></AdminReadOnlyNote>
      </CardBody></Card>
    </div>}

    {tab === "users" && <div className="space-y-4"><AdminReadOnlyNote>Danh sách thành viên chỉ đọc. Tenant quản lý tài khoản và quyền truy cập trong workspace.</AdminReadOnlyNote><Card><CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-brand-500" />Danh sách thành viên Tenant</CardTitle></CardHeader>{usersQ.isError ? <CardBody><ErrorState message={usersQ.error.message} onRetry={() => usersQ.refetch()} /></CardBody> : usersQ.isLoading ? <CardBody><div className="h-32 animate-pulse rounded-xl bg-slate-100 dark:bg-surface-elevated" /></CardBody> : <div className="divide-y divide-slate-100 dark:divide-border-subtle">{!usersQ.data?.length && <CardBody><EmptyState title="No users yet" /></CardBody>}{(usersQ.data ?? []).map((member) => <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-slate-50 dark:hover:bg-surface-elevated/40"><div className="flex min-w-0 items-center gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold dark:bg-surface-elevated">{member.email.slice(0, 2).toUpperCase()}</span><div className="min-w-0"><p className="break-all text-sm font-semibold">{member.email}</p><p className="text-xs text-slate-500">{member.full_name ?? "—"}</p></div></div><StatusBadge tone="info" label={member.role.replace("tenant_", "")} /></div>)}</div>}</Card></div>}

    {tab === "devices" && <div className="space-y-4"><AdminReadOnlyNote>Thiết bị thuộc tenant được hiển thị chỉ đọc; việc gán và vận hành thiết bị do tenant thực hiện.</AdminReadOnlyNote><Card><CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="h-4 w-4 text-emerald-500" />Thiết bị đã gán ({devices.length})</CardTitle></CardHeader>{devicesQ.isError ? <CardBody><ErrorState message={devicesQ.error.message} onRetry={() => devicesQ.refetch()} /></CardBody> : devicesQ.isLoading ? <CardBody><div className="h-32 animate-pulse rounded-xl bg-slate-100 dark:bg-surface-elevated" /></CardBody> : <div className="divide-y divide-slate-100 dark:divide-border-subtle">{!devices.length && <CardBody><EmptyState title="No devices assigned" /></CardBody>}{devices.map((device) => <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div className="flex min-w-0 items-center gap-3"><div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600"><Cpu className="h-4 w-4" /></div><div><p className="text-sm font-semibold">{device.name}</p><p className="break-all font-mono text-xs text-slate-500">{device.device_uid}</p></div></div><StatusBadge tone={deviceTone(device.status)} label={device.status} /></div>)}</div>}</Card></div>}

    {tab === "projects" && <Card><CardHeader><CardTitle className="flex items-center gap-2"><FolderOpen className="h-4 w-4 text-violet-500" />Tenant projects</CardTitle></CardHeader>{projectsQ.isError ? <CardBody><ErrorState message={projectsQ.error.message} onRetry={() => projectsQ.refetch()} /></CardBody> : projectsQ.isLoading ? <CardBody><div className="h-32 animate-pulse rounded-xl bg-slate-100 dark:bg-surface-elevated" /></CardBody> : <div className="divide-y divide-slate-100 dark:divide-border-subtle">{!projectsQ.data?.length && <CardBody><EmptyState title="No projects yet" /></CardBody>}{(projectsQ.data ?? []).map((project) => <div key={project.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-violet-500/10 p-3 text-violet-500"><FolderOpen className="h-5 w-5" /></div><div><p className="text-sm font-semibold">{project.name}</p><p className="mt-1 text-xs text-slate-500">{project.description ?? "—"}</p><p className="mt-1 text-xs text-slate-500">Cập nhật {formatRelative(project.updated_at)}</p></div></div><Link className="btn-secondary text-xs" to={"/console/admin/tenants/" + id + "/projects/" + project.id}>Open read-only</Link></div>)}</div>}</Card>}
  </div>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between gap-4"><span className="shrink-0 text-xs text-slate-500">{label}</span><span className="min-w-0 text-right">{value}</span></div>;
}

function Quota({ label, used, limit }: { label: string; used: number; limit: number }) {
  const percent = limit > 0 ? Math.min(100, used / limit * 100) : 0;
  return <div className="rounded-xl border border-slate-200 p-4 dark:border-border-subtle"><div className="mb-2 flex justify-between gap-2 text-xs"><span className="font-medium">{label}</span><span className="font-mono text-slate-500">{used} / {limit}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-surface-elevated"><div className={percent >= 90 ? "h-full rounded-full bg-amber-500" : "h-full rounded-full bg-brand-500"} style={{ width: percent + "%" }} /></div></div>;
}
