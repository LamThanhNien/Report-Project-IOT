import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Activity, Building2, SlidersHorizontal, Users } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listTelemetry } from "../../services/telemetryApi";
import { listOtaJobs } from "../../services/otaApi";
import { listAlerts } from "../../services/alertApi";
import { listServicePlans } from "../../services/tenantAdminApi";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorState } from "../../components/ui/ErrorState";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { DonutChart } from "../../components/charts/DonutChart";
import type { Alert, OtaJob, Tenant } from "../../types";

const RANGES = [{ key: "1h", seconds: 3600 }, { key: "24h", seconds: 86400 }, { key: "7d", seconds: 604800 }, { key: "30d", seconds: 2592000 }];

export function AdminActivityPanel({ tenants, jobs, alerts }: { tenants: Tenant[]; jobs: OtaJob[]; alerts: Alert[] }) {
  const [tenantId, setTenantId] = useState("");
  const [rangeKey, setRangeKey] = useState("24h");
  const range = RANGES.find((item) => item.key === rangeKey) ?? RANGES[1];
  const fromTime = useMemo(() => new Date(Date.now() - range.seconds * 1000).toISOString(), [range.seconds]);
  const telemetryQ = useQuery({ queryKey: ["admin-dashboard-telemetry", tenantId, rangeKey], queryFn: () => listTelemetry({ tenant_id: tenantId, from_time: fromTime, limit: 500 }), enabled: !!tenantId, refetchInterval: 15_000 });
  const otaQ = useQuery({ queryKey: ["admin-dashboard-ota", tenantId], queryFn: () => listOtaJobs(undefined, 100, tenantId), enabled: !!tenantId, refetchInterval: 15_000 });
  const alertsQ = useQuery({ queryKey: ["admin-dashboard-alerts", tenantId], queryFn: () => listAlerts({ tenant_id: tenantId }), enabled: !!tenantId, refetchInterval: 20_000 });
  const scopedJobs = tenantId ? otaQ.data ?? [] : jobs;
  const scopedAlerts = tenantId ? alertsQ.data ?? [] : alerts;
  const telemetry = tenantId ? telemetryQ.data ?? [] : [];
  const loading = !!tenantId && (telemetryQ.isLoading || otaQ.isLoading || alertsQ.isLoading);
  const errorQuery = [telemetryQ, otaQ, alertsQ].find((query) => query.isError);
  const activity = useMemo(() => {
    const end = Date.now();
    const start = new Date(fromTime).getTime();
    const width = (end - start) / 12;
    const buckets = Array.from({ length: 12 }, (_, index) => ({ timestamp: start + index * width, label: new Date(start + index * width).toLocaleString("vi-VN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }), telemetry: 0, ota: 0, alerts: 0 }));
    const add = (timestamp: string | null, key: "telemetry" | "ota" | "alerts") => { const time = timestamp ? new Date(timestamp).getTime() : NaN; if (!Number.isFinite(time) || time < start || time > end) return; const index = Math.min(11, Math.floor((time - start) / width)); buckets[index][key]++; };
    telemetry.forEach((sample) => add(sample.timestamp, "telemetry"));
    scopedJobs.forEach((job) => add(job.updated_at || job.requested_at, "ota"));
    scopedAlerts.forEach((alert) => add(alert.timestamp, "alerts"));
    return buckets;
  }, [fromTime, telemetryQ.data, otaQ.data, alertsQ.data, jobs, alerts, tenantId]);
  const samples = activity.reduce((total, bucket) => total + bucket.telemetry + bucket.ota + bucket.alerts, 0);

  return <Card><CardHeader className="flex flex-wrap items-center justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><Activity className="h-4 w-4 text-blue-500" />Hoạt động nền tảng</CardTitle><p className="mt-1 text-xs text-slate-500 dark:text-text-muted">Phân bố các bản ghi API đã tải theo thời gian; tối đa 500 mẫu telemetry cho tenant được chọn.</p></div><div className="flex flex-wrap items-center gap-3"><label className="text-xs font-medium text-slate-500">Tenant<select aria-label="Tenant hoạt động" className="input mt-1 min-w-44" value={tenantId} onChange={(event) => setTenantId(event.target.value)}><option value="">Tất cả tenant</option>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label><div className="flex gap-1">{RANGES.map((item) => <button key={item.key} className={item.key === rangeKey ? "btn-primary h-9 text-xs" : "btn-secondary h-9 text-xs"} aria-pressed={item.key === rangeKey} onClick={() => setRangeKey(item.key)}>{item.key}</button>)}</div></div></CardHeader><CardBody>
    {!tenantId && <p className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-700 dark:border-sky-800/40 dark:bg-sky-950/20 dark:text-sky-300">Chọn tenant để tải các mẫu telemetry. OTA và cảnh báo được hiển thị trong dữ liệu toàn hệ thống.</p>}
    {errorQuery ? <ErrorState message={errorQuery.error instanceof Error ? errorQuery.error.message : "Không thể tải hoạt động"} onRetry={() => errorQuery.refetch()} /> : loading ? <div className="h-64 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-surface-elevated" /> : samples ? <div role="img" aria-label={"Biểu đồ hoạt động: " + samples + " bản ghi trong " + rangeKey}><ResponsiveContainer width="100%" height={260}><AreaChart data={activity}><defs><linearGradient id="adminActivityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.3} /><stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.15} /><XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={40} /><YAxis allowDecimals={false} tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} /><Area type="monotone" dataKey="telemetry" name="Telemetry" stroke="#0ea5e9" fill="url(#adminActivityFill)" strokeWidth={2} isAnimationActive={false} /><Area type="monotone" dataKey="ota" name="OTA" stroke="#8b5cf6" fill="transparent" strokeWidth={2} isAnimationActive={false} /><Area type="monotone" dataKey="alerts" name="Alerts" stroke="#f43f5e" fill="transparent" strokeWidth={2} isAnimationActive={false} /></AreaChart></ResponsiveContainer><p className="mt-3 text-xs text-slate-500">Telemetry: {activity.reduce((total, bucket) => total + bucket.telemetry, 0)} · OTA: {activity.reduce((total, bucket) => total + bucket.ota, 0)} · Alerts: {activity.reduce((total, bucket) => total + bucket.alerts, 0)}</p></div> : <EmptyState title="Chưa có hoạt động trong khoảng thời gian này" />}
  </CardBody></Card>;
}

export function AdminTenantOverview({ tenants, loading, error }: { tenants: Tenant[]; loading: boolean; error: boolean }) {
  const plansQ = useQuery({ queryKey: ["admin-plans"], queryFn: listServicePlans });
  const active = tenants.filter((tenant) => tenant.is_active).length;
  const topTenants = [...tenants].sort((a, b) => b.device_count - a.device_count).slice(0, 5);
  const nearQuota = tenants.map((tenant) => ({ tenant, limit: plansQ.data?.find((plan) => plan.id === tenant.plan_id)?.max_devices })).filter((item) => item.limit != null && item.limit > 0 && item.tenant.device_count / item.limit >= 0.8);
  return <div className="grid gap-5 xl:grid-cols-3"><Card><CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="h-4 w-4 text-emerald-500" />Tenant theo trạng thái</CardTitle></CardHeader><CardBody>{loading ? <div className="h-56 animate-pulse rounded-xl bg-slate-100 dark:bg-surface-elevated" /> : error ? <p className="text-sm text-slate-500">Chưa tải được dữ liệu tenant</p> : tenants.length ? <DonutChart data={[{ name: "Active", value: active, color: "#10b981" }, { name: "Disabled", value: tenants.length - active, color: "#64748b" }]} centerValue={tenants.length} centerLabel="Tenant" /> : <EmptyState title="Chưa có tenant" />}</CardBody></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-blue-500" />Top Tenant theo thiết bị</CardTitle></CardHeader><CardBody className="space-y-4">{topTenants.map((tenant) => <Link key={tenant.id} to={"/console/admin/tenants/" + tenant.id} className="block rounded-xl border border-slate-100 p-3 transition-colors hover:bg-slate-50 dark:border-border-subtle dark:hover:bg-surface-elevated"><div className="mb-2 flex items-center justify-between gap-3 text-sm"><span className="truncate font-medium">{tenant.name}</span><span className="font-mono">{tenant.device_count}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-surface-elevated"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-cyan-500" style={{ width: (topTenants[0].device_count ? tenant.device_count / topTenants[0].device_count * 100 : 0) + "%" }} /></div></Link>)}{!loading && !error && !topTenants.length && <EmptyState title="Chưa có dữ liệu tenant" />}</CardBody></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-amber-500" />Tenant gần vượt quota</CardTitle></CardHeader><CardBody className="space-y-3">{plansQ.isError ? <ErrorState message={plansQ.error.message} onRetry={() => plansQ.refetch()} /> : plansQ.isLoading || loading ? <div className="h-48 animate-pulse rounded-xl bg-slate-100 dark:bg-surface-elevated" /> : error ? <p className="text-sm text-slate-500">Chưa tải được dữ liệu tenant</p> : !nearQuota.length ? <EmptyState title="Không có tenant gần vượt quota" description="Theo dữ liệu hạn ngạch thiết bị đã tải." /> : nearQuota.map(({ tenant, limit }) => <Link key={tenant.id} to={"/console/admin/tenants/" + tenant.id} className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800/40 dark:bg-amber-950/10"><div><p className="text-sm font-semibold">{tenant.name}</p><p className="mt-1 text-xs text-slate-500">{tenant.device_count} / {limit} thiết bị</p></div><StatusBadge tone="warning" label={Math.round(tenant.device_count / limit! * 100) + "%"} /></Link>)}</CardBody></Card>
  </div>;
}
