import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Cpu, Wifi, WifiOff, Rocket, FolderOpen, Plus, AlertTriangle, ShieldAlert, BarChart3, Clock, Zap, Terminal, RefreshCw, Radio } from "lucide-react";
import { listClientDevices, listClientAlerts, listClientOtaJobs, listClientProjects } from "../../../services/clientApi";
import { Card, CardBody } from "../../../components/ui/Card";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { ErrorState } from "../../../components/ui/ErrorState";
import { useAuth } from "../../../contexts/AuthContext";
import { hasPermission, canViewDevices, canViewOta } from "../../../lib/permissions";
import { deviceTone, severityTone } from "../../../lib/status";
import { formatRelative, formatNumber } from "../../../lib/formatters";
import { useDeviceStatusStream } from "../../../hooks/useDeviceStatusStream";

import { EmptyState } from "../../../components/ui/EmptyState";
import { DonutChart } from "../../../components/charts/DonutChart";
import { cn } from "../../../lib/cn";
import { getGreeting, BentoMetricCard, SectionHeader, OtaStatChip, ActionTile } from "./dashboardPresentation";
import { getInitials, getLogoGradient } from "./projectUtils";

const panelClass = "overflow-hidden border border-slate-200/80 bg-white shadow-sm dark:border-border-subtle dark:bg-surface";
function RowSkeleton({ count = 4 }: { count?: number }) {
  return <CardBody className="space-y-3" aria-busy="true">{Array.from({ length: count }, (_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-surface-elevated" />)}</CardBody>;
}

export function ClientDashboard({ scopedProjectId }: { scopedProjectId?: string } = {}) {
  const { t } = useTranslation(["dashboard", "devices", "alerts", "nav", "common", "projects"]);
  const { user } = useAuth();
  const stream = useDeviceStatusStream();
  const base = scopedProjectId ? "/client/workspace/" + scopedProjectId : "/client";
  const devicesQ = useQuery({
    queryKey: ["client-devices", scopedProjectId],
    queryFn: () => listClientDevices(scopedProjectId),
    enabled: canViewDevices(user),
    refetchInterval: 15_000,
  });
  const otaQ = useQuery({
    queryKey: ["client-ota-jobs", scopedProjectId],
    queryFn: () => listClientOtaJobs(scopedProjectId),
    enabled: canViewOta(user),
    refetchInterval: 15_000,
  });
  const alertsQ = useQuery({
    queryKey: ["client-alerts", scopedProjectId],
    queryFn: () => listClientAlerts(10, scopedProjectId),
    enabled: hasPermission(user, "monitoring.view"),
    refetchInterval: 30_000,
  });
  const devices = (devicesQ.data ?? []).filter((device) => device.status !== "deleted");
  const online = devices.filter((device) => device.status === "online").length;
  const offline = devices.filter((device) => device.status === "offline").length;
  const runningOta = (otaQ.data ?? []).filter((job) => !["success", "completed", "failed", "cancelled", "rolled_back"].includes(job.status.toLowerCase())).length;
  const projectsQ = useQuery({ queryKey: ["client-projects"], queryFn: listClientProjects, enabled: !scopedProjectId && hasPermission(user, "projects.view"), staleTime: 30_000 });
  const jobs = otaQ.data ?? [];
  const completed = jobs.filter((job) => ["success", "completed"].includes(job.status.toLowerCase())).length;
  const failed = jobs.filter((job) => job.status.toLowerCase() === "failed").length;
  const statusDist = [{ name: "Online", value: online, color: "#10b981" }, { name: "Offline", value: offline, color: "#f43f5e" }, { name: t("dashboard:other_status", "Trạng thái khác"), value: devices.length - online - offline, color: "#94a3b8" }].filter((item) => item.value > 0);
  const unavailable = t("dashboard:unavailable", "Không có dữ liệu");
  const deviceValue = (value: number) => devicesQ.isError ? "—" : formatNumber(value);
  const deviceHint = devicesQ.isError ? unavailable : undefined;
  return <div className="space-y-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-text-primary">{getGreeting(t)}, {user?.full_name?.trim().split(/\s+/).pop() || t("dashboard:you", "bạn")} 👋</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-text-muted">{t("dashboard:subtitle")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-3.5 py-2 text-xs font-medium text-slate-600 shadow-sm dark:border-border-subtle dark:bg-surface dark:text-text-secondary">
          <span className={cn("h-2 w-2 rounded-full", stream.status === "connected" ? "bg-emerald-500" : "bg-amber-500")} />
          <Radio className="h-3.5 w-3.5" />{stream.status === "connected" ? t("dashboard:live", "Kết nối trực tiếp") : t("dashboard:polling", "Cập nhật mỗi 15 giây")}
        </span>
        <button type="button" className="btn-secondary h-9 px-3" aria-label={t("dashboard:refresh", "Làm mới tổng quan")} onClick={() => { devicesQ.refetch(); if (canViewOta(user)) otaQ.refetch(); if (hasPermission(user, "monitoring.view")) alertsQ.refetch(); if (!scopedProjectId && hasPermission(user, "projects.view")) projectsQ.refetch(); }}><RefreshCw className={cn("h-4 w-4", devicesQ.isFetching && "motion-safe:animate-spin")} /></button>
        {hasPermission(user, "devices.manage") && <Link className="btn-primary h-9 px-3.5 text-xs shadow-sm" to={base + "/devices/onboard"}><Plus className="h-3.5 w-3.5" />{t("dashboard:action_add_device")}</Link>}
      </div>
    </div>
    {devicesQ.isError && <ErrorState message={devicesQ.error.message} onRetry={() => devicesQ.refetch()} />}
    <div className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", canViewOta(user) ? "xl:grid-cols-4" : "lg:grid-cols-3")}>
      {canViewDevices(user) && <>
        <BentoMetricCard label={t("dashboard:total_devices", "Tổng thiết bị")} value={deviceValue(devices.length)} hint={deviceHint ?? t("dashboard:allocated", "đã phân bổ")} icon={<Cpu className="h-5 w-5" />} gradientIdx={0} loading={devicesQ.isLoading} dataTestId="kpi-total-devices" />
        <BentoMetricCard label="Online" value={deviceValue(online)} hint={deviceHint ?? t("dashboard:online_pct", "{{pct}}% đang hoạt động", { pct: devices.length ? Math.round(online / devices.length * 100) : 0 })} icon={<Wifi className="h-5 w-5" />} gradientIdx={1} loading={devicesQ.isLoading} isOnlineDot={online > 0} dataTestId="kpi-online-devices" />
        <BentoMetricCard label="Offline" value={deviceValue(offline)} hint={deviceHint ?? t("dashboard:disconnected", "mất kết nối")} icon={<WifiOff className="h-5 w-5" />} gradientIdx={2} loading={devicesQ.isLoading} dataTestId="kpi-offline-devices" />
      </>}
      {canViewOta(user) && <BentoMetricCard label={t("dashboard:running_ota")} value={otaQ.isError ? "—" : formatNumber(runningOta)} hint={otaQ.isError ? unavailable : t("dashboard:jobs", "tác vụ")} icon={<Rocket className="h-5 w-5" />} gradientIdx={3} loading={otaQ.isLoading} dataTestId="kpi-running-ota" />}
    </div>
    {canViewOta(user) && <Card className={panelClass}>
      <SectionHeader icon={<Rocket className="h-4 w-4 text-violet-500" />} title={t("dashboard:ota_firmware", "OTA / Firmware")} to={base + "/ota"} linkLabel={t("dashboard:manage_ota", "Quản lý OTA")} />
      <CardBody>{otaQ.isError ? <ErrorState message={otaQ.error.message} onRetry={() => otaQ.refetch()} /> : <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {otaQ.isLoading ? Array.from({ length: 4 }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100 dark:bg-surface-elevated" />) : <>
          <OtaStatChip label={t("dashboard:ota_total", "Tổng tác vụ")} value={formatNumber(jobs.length)} />
          <OtaStatChip label={t("dashboard:running_ota")} value={formatNumber(runningOta)} valueClass="text-sky-600 dark:text-sky-400" />
          <OtaStatChip label={t("dashboard:ota_completed", "Hoàn thành")} value={formatNumber(completed)} valueClass="text-emerald-600 dark:text-emerald-400" />
          <OtaStatChip label={t("dashboard:ota_failed", "OTA thất bại")} value={formatNumber(failed)} valueClass="text-rose-600 dark:text-rose-400" />
        </>}
      </div>}</CardBody>
    </Card>}
    {canViewDevices(user) && <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className={panelClass}>
        <SectionHeader icon={<BarChart3 className="h-4 w-4 text-blue-500" />} title={t("dashboard:device_status", "Trạng thái thiết bị")} />
        <CardBody>{devicesQ.isLoading ? <div className="h-64 animate-pulse rounded-xl bg-slate-100 dark:bg-surface-elevated" /> : devicesQ.isError ? <EmptyState title={unavailable} /> : devices.length === 0 ? <EmptyState icon={<BarChart3 className="h-5 w-5" />} title={t("dashboard:no_devices_title")} description={t("dashboard:add_devices_desc", "Thêm thiết bị để xem phân bổ trạng thái")} /> : <DonutChart data={statusDist} centerLabel={t("dashboard:devices_unit", "thiết bị")} centerValue={formatNumber(devices.length)} height={250} />}</CardBody>
      </Card>
      <Card className={cn(panelClass, "lg:col-span-2")}>
        <SectionHeader icon={<Cpu className="h-4 w-4 text-blue-500" />} title={t("dashboard:recent_devices", "Thiết bị gần đây")} to={base + "/devices"} />
        {devicesQ.isLoading ? <RowSkeleton count={5} /> : devicesQ.isError ? <CardBody><EmptyState title={unavailable} /></CardBody> : devices.length === 0 ? <EmptyState icon={<Cpu className="h-5 w-5" />} title={t("dashboard:no_devices_title")} /> : <div className="divide-y divide-slate-100 dark:divide-border-subtle">
          {devices.slice(0, 6).map((device) => <Link key={device.id} to={base + "/devices/" + encodeURIComponent(device.device_uid)} className="group flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-slate-50/80 dark:hover:bg-surface-elevated/50">
            <div className="flex min-w-0 flex-1 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400"><Cpu className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-800 group-hover:text-brand-600 dark:text-text-primary dark:group-hover:text-brand-400">{device.name}</p><p className="mt-0.5 truncate font-mono text-[11px] text-slate-400 dark:text-text-muted">{device.device_uid}{device.firmware_version && ` · FW: ${device.firmware_version}`}</p></div></div>
            <div className="flex shrink-0 items-center gap-3"><span className="hidden text-[11px] text-slate-400 sm:block dark:text-text-muted">{formatRelative(device.last_seen_at)}</span><StatusBadge tone={deviceTone(device.status)} label={device.status} /></div>
          </Link>)}
        </div>}
      </Card>
    </div>}
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {hasPermission(user, "monitoring.view") && <Card className={panelClass}>
        <SectionHeader icon={<AlertTriangle className="h-4 w-4 text-amber-500" />} title={t("dashboard:recent_alerts")} to={base + "/alerts"} />
        {alertsQ.isLoading ? <RowSkeleton /> : alertsQ.isError ? <CardBody><ErrorState message={alertsQ.error.message} onRetry={() => alertsQ.refetch()} /></CardBody> : !alertsQ.data?.length ? <EmptyState icon={<AlertTriangle className="h-5 w-5" />} title={t("dashboard:no_alerts_title")} /> : <div className="divide-y divide-slate-100 dark:divide-border-subtle">{alertsQ.data.slice(0, 5).map((alert) => <Link key={alert.id} to={base + "/alerts"} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/80 dark:hover:bg-surface-elevated/50">
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", alert.severity === "critical" ? "bg-rose-50 text-rose-500 dark:bg-rose-950/40" : "bg-amber-50 text-amber-500 dark:bg-amber-950/40")}>{alert.severity === "critical" ? <ShieldAlert className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}</div>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800 dark:text-text-primary">{alert.title || alert.device_uid}</p><p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-text-muted">{alert.message}</p></div><StatusBadge tone={severityTone(alert.severity)} label={alert.severity} />
        </Link>)}</div>}
      </Card>}
      {!scopedProjectId && hasPermission(user, "projects.view") && <Card className={panelClass}>
        <SectionHeader icon={<FolderOpen className="h-4 w-4 text-brand-500" />} title={t("nav:sidebar.projects", "Dự án")} to="/client/projects" />
        {projectsQ.isLoading ? <RowSkeleton /> : projectsQ.isError ? <CardBody><ErrorState message={projectsQ.error.message} onRetry={() => projectsQ.refetch()} /></CardBody> : !projectsQ.data?.length ? <EmptyState icon={<FolderOpen className="h-5 w-5" />} title={t("projects:no_projects")} /> : <div className="divide-y divide-slate-100 dark:divide-border-subtle">{projectsQ.data.slice(0, 5).map((project) => <Link key={project.id} to={`/client/workspace/${project.id}/home`} className="group flex items-center gap-3 px-5 py-3 hover:bg-slate-50/80 dark:hover:bg-surface-elevated/50">
          <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-xs font-bold text-white", getLogoGradient(project.id))}>{getInitials(project.name)}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-800 group-hover:text-brand-600 dark:text-text-primary">{project.name}</p><p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-text-muted">{project.description || t("projects:no_description", "Không có mô tả")}</p></div><Clock className="hidden h-3 w-3 text-slate-400 sm:block" /><span className="hidden text-[11px] text-slate-400 sm:block">{formatRelative(project.updated_at)}</span>
        </Link>)}</div>}
      </Card>}
    </div>
    <Card className={panelClass}>
      <SectionHeader icon={<Zap className="h-4 w-4 text-amber-500" />} title={t("dashboard:quick_actions_title", "Thao tác nhanh")} />
      <CardBody><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {canViewDevices(user) && <ActionTile to={base + "/devices"} icon={<Cpu className="h-5 w-5" />} label={t("devices:title")} gradient="from-blue-500 to-cyan-500" />}
        {hasPermission(user, "projects.view") && !scopedProjectId && <ActionTile to="/client/projects" icon={<FolderOpen className="h-5 w-5" />} label={t("nav:sidebar.projects", "Dự án")} gradient="from-violet-500 to-purple-500" />}
        {canViewOta(user) && <ActionTile to={base + "/ota"} icon={<Rocket className="h-5 w-5" />} label="Firmware / OTA" gradient="from-emerald-500 to-teal-500" />}
        {hasPermission(user, "commands.view") && <ActionTile to={base + "/commands"} icon={<Terminal className="h-5 w-5" />} label={t("nav:sidebar.commands", "Lệnh thiết bị")} gradient="from-rose-500 to-pink-500" />}
        {hasPermission(user, "automation.view") && <ActionTile to={base + "/automation"} icon={<Zap className="h-5 w-5" />} label="Automation" gradient="from-amber-500 to-orange-500" />}
      </div></CardBody>
    </Card>
  </div>;
}
