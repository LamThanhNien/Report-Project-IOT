import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Activity, AlertTriangle, Building2, Cpu, Database, HardDrive, Package, Radio, RefreshCw, Rocket, Server, ShieldCheck, Wifi } from "lucide-react";
import { listDevices } from "../../services/deviceApi";
import { listFirmware } from "../../services/firmwareApi";
import { listOtaJobs } from "../../services/otaApi";
import { listAlerts } from "../../services/alertApi";
import { listTenants } from "../../services/tenantAdminApi";
import { getSystemHealth } from "../../services/systemApi";
import { useAuth } from "../../contexts/AuthContext";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { HealthIndicator } from "../../components/ui/HealthIndicator";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { DonutChart } from "../../components/charts/DonutChart";
import { FirmwareVersionBadge } from "../../components/ui/FirmwareVersionBadge";
import { deviceTone, otaTone, severityTone } from "../../lib/status";
import { formatRelative } from "../../lib/formatters";
import { AdminAction, AdminMetric } from "./adminPresentation";
import { AdminActivityPanel, AdminTenantOverview } from "./adminDashboardSections";

const RUNNING_OTA = ["pending", "sent", "started", "accepted", "downloading", "flashing", "applying", "rebooting", "verifying"];
const HEALTH_COMPONENTS = [{ key: "api", label: "API", icon: Server }, { key: "database", label: "Database", icon: Database }, { key: "mqtt", label: "MQTT", icon: Radio }, { key: "storage", label: "Storage", icon: HardDrive }] as const;

export function Dashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const devicesQ = useQuery({ queryKey: ["devices"], queryFn: () => listDevices(), refetchInterval: 15_000 });
  const firmwareQ = useQuery({ queryKey: ["firmware"], queryFn: () => listFirmware() });
  const tenantsQ = useQuery({ queryKey: ["admin-tenants"], queryFn: listTenants });
  const otaQ = useQuery({ queryKey: ["ota-jobs"], queryFn: () => listOtaJobs(), refetchInterval: 15_000 });
  const alertsQ = useQuery({ queryKey: ["alerts"], queryFn: () => listAlerts(), refetchInterval: 20_000 });
  const healthQ = useQuery({ queryKey: ["system-health"], queryFn: getSystemHealth, refetchInterval: 15_000 });
  const queries = [devicesQ, firmwareQ, tenantsQ, otaQ, alertsQ, healthQ];
  const fetching = queries.some((query) => query.isFetching);
  const devices = (devicesQ.data ?? []).filter((device) => device.status !== "deleted");
  const online = devices.filter((device) => device.status === "online").length;
  const offline = devices.filter((device) => device.status === "offline").length;
  const other = devices.length - online - offline;
  const jobs = otaQ.data ?? [];
  const succeeded = jobs.filter((job) => ["success", "completed"].includes(job.status)).length;
  const failed = jobs.filter((job) => ["failed", "timeout"].includes(job.status)).length;
  const completed = succeeded + failed;
  const openAlerts = (alertsQ.data ?? []).filter((alert) => alert.status !== "resolved");
  const firmwareCounts = Array.from(devices.reduce((counts, device) => { const version = device.firmware_version || t("dashboard:admin_no_firmware", "Chưa có firmware"); counts.set(version, (counts.get(version) ?? 0) + 1); return counts; }, new Map<string, number>())).sort((a, b) => b[1] - a[1]);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("dashboard:greeting_morning", "Chào buổi sáng") : hour < 18 ? t("dashboard:greeting_afternoon", "Chào buổi chiều") : t("dashboard:greeting_evening", "Chào buổi tối");
  const unavailable = (error: boolean, value: number | string) => error ? "—" : value;

  return <div className="space-y-6">
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-6 dark:border-border-subtle dark:bg-surface sm:px-8">
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-blue-500/10 to-violet-500/5 blur-3xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div><div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-300"><ShieldCheck className="h-3.5 w-3.5" />Admin Console</div><h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-text-primary sm:text-3xl">{greeting}{user?.full_name ? ", " + user.full_name : ""}</h1><p className="mt-2 text-sm text-slate-500 dark:text-text-muted">Tổng quan vận hành thiết bị, tenant và hạ tầng AIFOM.</p></div>
        <button className="btn-secondary" disabled={fetching} onClick={() => { queries.forEach((query) => void query.refetch()); }}><RefreshCw className={"h-4 w-4 " + (fetching ? "animate-spin motion-reduce:animate-none" : "")} />Làm mới</button>
      </div>
    </div>

    {queries.filter((query) => query.isError).map((query, index) => <ErrorState key={index} message={query.error instanceof Error ? query.error.message : "Không thể tải dữ liệu"} onRetry={() => query.refetch()} />)}

    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      <AdminMetric label="Tổng thiết bị" value={unavailable(devicesQ.isError, devices.length)} hint="Thiết bị đã đăng ký" icon={<Cpu className="h-5 w-5" />} loading={devicesQ.isLoading} to="/console/devices" />
      <AdminMetric label="Online" value={unavailable(devicesQ.isError, online)} hint={devicesQ.isError ? "—" : devices.length ? Math.round(online / devices.length * 100) + "% trong tổng thiết bị" : "Chưa có thiết bị"} index={1} icon={<Wifi className="h-5 w-5" />} loading={devicesQ.isLoading} to="/console/devices" />
      <AdminMetric label="Cảnh báo chưa xử lý" value={unavailable(alertsQ.isError, openAlerts.length)} hint={alertsQ.isError ? "—" : "Trong các cảnh báo đã tải · " + openAlerts.filter((alert) => alert.severity === "critical").length + " critical"} index={2} icon={<AlertTriangle className="h-5 w-5" />} loading={alertsQ.isLoading} to="/console/alerts" />
      <AdminMetric label="Firmware" value={unavailable(firmwareQ.isError, firmwareQ.data?.length ?? 0)} hint="Thư viện firmware" index={3} icon={<Package className="h-5 w-5" />} loading={firmwareQ.isLoading} to="/console/firmware" />
      <AdminMetric label="OTA đang chạy" value={unavailable(otaQ.isError, jobs.filter((job) => RUNNING_OTA.includes(job.status)).length)} hint={otaQ.isError ? "—" : completed >= 5 ? Math.round(succeeded / completed * 100) + "% · " + completed + " job đã kết thúc" : "Chưa đủ mẫu để đánh giá tỷ lệ thành công"} index={4} icon={<Rocket className="h-5 w-5" />} loading={otaQ.isLoading} to="/console/ota" />
    </div>

    <AdminActivityPanel tenants={tenantsQ.data ?? []} jobs={jobs} alerts={alertsQ.data ?? []} />

    <div className="grid gap-5 xl:grid-cols-3">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Wifi className="h-4 w-4 text-emerald-500" />Trạng thái thiết bị</CardTitle></CardHeader><CardBody>
        {devicesQ.isLoading ? <div className="h-56 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-surface-elevated" /> : devicesQ.isError ? <p className="text-sm text-slate-500">Chưa tải được dữ liệu</p> : devices.length ? <><DonutChart data={[{ name: "Online", value: online, color: "#10b981" }, { name: "Offline", value: offline, color: "#f43f5e" }, { name: "Khác", value: other, color: "#94a3b8" }]} centerValue={devices.length} centerLabel="Thiết bị" /><div className="mt-2 flex justify-between border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-border-subtle"><span>Offline</span><span className="font-semibold tabular-nums">{offline}</span></div></> : <EmptyState title="Chưa có thiết bị" />}
      </CardBody></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Package className="h-4 w-4 text-violet-500" />Phân bố firmware</CardTitle></CardHeader><CardBody className="space-y-4">
        {devicesQ.isLoading ? <div className="h-56 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-surface-elevated" /> : devicesQ.isError ? <p className="text-sm text-slate-500">Chưa tải được dữ liệu</p> : !firmwareCounts.length ? <EmptyState title="Chưa có dữ liệu firmware" /> : firmwareCounts.slice(0, 6).map(([version, count]) => <div key={version}><div className="mb-2 flex items-center justify-between gap-3 text-xs"><FirmwareVersionBadge version={version} /><span className="font-mono text-slate-500">{count} · {Math.round(count / devices.length * 100)}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-surface-elevated"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500" style={{ width: count / devices.length * 100 + "%" }} /></div></div>)}
      </CardBody></Card>
      <Card><CardHeader className="flex items-center justify-between"><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-blue-500" />Sức khỏe hệ thống</CardTitle><Link to="/console/system" className="text-xs text-brand-600 dark:text-brand-400">Chi tiết</Link></CardHeader><CardBody className="space-y-4">
        {HEALTH_COMPONENTS.map(({ key, label, icon: Icon }) => { const status = healthQ.data?.[key] ?? "unknown"; return <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-3 dark:border-border-subtle"><div className="flex items-center gap-3"><div className="rounded-lg bg-slate-100 p-2 text-slate-500 dark:bg-surface-elevated"><Icon className="h-4 w-4" /></div><span className="text-sm font-medium">{label}</span></div><HealthIndicator status={status === "healthy" ? "success" : status === "degraded" ? "warning" : status === "down" ? "danger" : "neutral"} label={healthQ.isLoading ? "…" : status} /></div>; })}
        <p className="text-xs text-slate-500 dark:text-text-muted">Kiểm tra gần nhất: {healthQ.dataUpdatedAt ? formatRelative(new Date(healthQ.dataUpdatedAt).toISOString()) : "—"}</p>
      </CardBody></Card>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <AdminAction title="Quản lý thiết bị" description="Registry và trạng thái kết nối" icon={<Cpu className="h-5 w-5" />} to="/console/devices" />
      <AdminAction title="Firmware / OTA" description="Theo dõi phiên bản và cập nhật" icon={<Rocket className="h-5 w-5" />} to="/console/firmware" index={3} />
      <AdminAction title="Tenant" description={tenantsQ.isError ? "—" : (tenantsQ.data?.filter((tenant) => tenant.is_active).length ?? 0) + " tenant đang hoạt động"} icon={<Building2 className="h-5 w-5" />} to="/console/admin/tenants" index={1} />
      <AdminAction title="Lịch sử lệnh" description="Tra cứu lệnh đã gửi tới thiết bị" icon={<Activity className="h-5 w-5" />} to="/console/admin/commands" index={4} />
    </div>

    <AdminTenantOverview tenants={tenantsQ.data ?? []} loading={tenantsQ.isLoading} error={tenantsQ.isError} />

    <div className="grid gap-5 xl:grid-cols-2">
      <Card><CardHeader className="flex items-center justify-between"><CardTitle>Thiết bị gần đây</CardTitle><Link className="text-xs text-brand-600 dark:text-brand-400" to="/console/devices">Xem tất cả</Link></CardHeader><CardBody className="space-y-2">
        {devicesQ.isLoading && <div className="h-48 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-surface-elevated" />}
        {!devicesQ.isLoading && !devicesQ.isError && !devices.length && <EmptyState title="Chưa có thiết bị" />}
        {[...devices].sort((a, b) => (b.last_seen_at ?? "").localeCompare(a.last_seen_at ?? "")).slice(0, 6).map((device) => <Link key={device.id} to={"/console/devices/" + encodeURIComponent(device.device_uid)} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 transition-colors hover:bg-slate-50 dark:border-border-subtle dark:hover:bg-surface-elevated"><div className="flex min-w-0 items-center gap-3"><div className="rounded-lg bg-blue-50 p-2 text-blue-600 dark:bg-blue-500/10"><Cpu className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold">{device.name}</p><p className="truncate text-xs text-slate-500">{device.device_uid} · {formatRelative(device.last_seen_at)}</p></div></div><StatusBadge tone={deviceTone(device.status)} label={device.status} /></Link>)}
      </CardBody></Card>
      <Card><CardHeader><CardTitle>Hoạt động gần đây</CardTitle></CardHeader><CardBody className="space-y-3">
        {(otaQ.isLoading || alertsQ.isLoading) && <div className="h-48 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-surface-elevated" />}
        {[...jobs].sort((a, b) => b.requested_at.localeCompare(a.requested_at)).slice(0, 3).map((job) => <div key={job.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 dark:border-border-subtle"><div><p className="text-sm font-medium">OTA · {job.device_uid}</p><p className="text-xs text-slate-500">{job.firmware_version} · {formatRelative(job.requested_at)}</p></div><StatusBadge tone={otaTone(job.status)} label={job.status} /></div>)}
        {[...openAlerts].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 3).map((alert) => <Link key={alert.id} to={"/console/alerts?alert=" + encodeURIComponent(alert.id)} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 dark:border-border-subtle"><div className="min-w-0"><p className="truncate text-sm font-medium">{alert.title}</p><p className="text-xs text-slate-500">{alert.device_uid ?? "—"} · {formatRelative(alert.timestamp)}</p></div><StatusBadge tone={severityTone(alert.severity)} label={alert.severity} /></Link>)}
        {!otaQ.isLoading && !alertsQ.isLoading && !otaQ.isError && !alertsQ.isError && !jobs.length && !openAlerts.length && <EmptyState title="Chưa có hoạt động" />}
      </CardBody></Card>
    </div>
  </div>;
}
