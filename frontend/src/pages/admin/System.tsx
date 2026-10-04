import { useQuery } from "@tanstack/react-query";
import { ExternalLink, RefreshCw, Server, Database, Radio, HardDrive, Activity, BarChart3, Zap, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { getSystemHealth } from "../../services/systemApi";
import { PageHeader } from "../../components/ui/PageHeader";
import { HealthIndicator } from "../../components/ui/HealthIndicator";
import { apiBaseUrl } from "../../services/apiClient";
import type { StatusTone } from "../../lib/status";
import { cn } from "../../lib/cn";

type ComponentKey = "api" | "database" | "mqtt" | "storage";
const COMPONENTS: { key: ComponentKey; label: string; description: string; icon: typeof Server; gradient: { from: string; to: string } }[] = [
  { key: "api", label: "FastAPI Backend", description: "REST + OpenAPI · port 8000", icon: Server, gradient: { from: "from-blue-500", to: "to-cyan-500" } },
  { key: "database", label: "PostgreSQL + TimescaleDB", description: "Hypertable telemetry", icon: Database, gradient: { from: "from-emerald-500", to: "to-teal-500" } },
  { key: "mqtt", label: "Mosquitto MQTT Broker", description: "Telemetry + OTA bus", icon: Radio, gradient: { from: "from-amber-500", to: "to-orange-500" } },
  { key: "storage", label: "MinIO Object Storage", description: "Firmware binary store", icon: HardDrive, gradient: { from: "from-violet-500", to: "to-purple-500" } },
];

const STATUS_TONE: Record<string, StatusTone> = {
  healthy: "success",
  degraded: "warning",
  down: "danger",
  unknown: "neutral",
};

export function System() {
  const { data, isLoading, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ["system-health"],
    queryFn: getSystemHealth,
    refetchInterval: 15_000,
  });

  // Extract enhanced details if available (from new health endpoint)
  const details = (data as unknown as { _details?: Record<string, { latency_ms?: number; detail?: string; status?: string }> })?._details;

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      <PageHeader
        title="Tình trạng hệ thống"
        subtitle="Kiểm tra hạ tầng backend, observability stack và endpoint nội bộ"
        actions={
          <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary">
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} /> Làm mới
          </button>
        }
      />

      {/* Overall status banner */}
      {details?.overall && typeof details.overall === "string" && (
        <div className={cn(
          "p-4 rounded-2xl border text-sm flex items-center gap-3 shadow-sm",
          details.overall === "healthy"
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
            : details.overall === "degraded"
              ? "bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-300"
              : "bg-rose-500/10 border-rose-500/20 text-rose-700 dark:text-rose-300"
        )}>
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface shadow-xs">
            {details.overall === "healthy" ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            ) : details.overall === "degraded" ? (
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            ) : (
              <XCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            )}
          </div>
          <div>
            <div className="font-bold text-sm">
              {details.overall === "healthy" && "Tất cả dịch vụ hoạt động bình thường"}
              {details.overall === "degraded" && "Một số dịch vụ đang gặp vấn đề"}
              {details.overall === "down" && "Hệ thống gặp sự cố nghiêm trọng"}
            </div>
            <div className="text-xs opacity-80 mt-0.5">
              Kết quả kiểm tra kết nối API, Database, MQTT và Storage.
            </div>
          </div>
          {details.timestamp && typeof details.timestamp === "string" && (
            <span className="ml-auto text-xs font-mono opacity-70 hidden sm:inline-block">
              {new Date(details.timestamp).toLocaleTimeString("vi-VN")}
            </span>
          )}
        </div>
      )}

      {/* 4 Component Health Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {COMPONENTS.map((c) => {
          const status = data?.[c.key] ?? "unknown";
          const tone = STATUS_TONE[status];
          const Icon = c.icon;
          const componentDetail = details?.[c.key];
          return (
            <div key={c.key} className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3.5">
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm shrink-0", c.gradient.from, c.gradient.to)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-bold text-text-primary">{c.label}</div>
                    <div className="text-xs text-text-muted mt-0.5">{c.description}</div>
                    {/* Show detail from real health check */}
                    {componentDetail?.detail && typeof componentDetail.detail === "string" && (
                      <div className="text-xs text-text-secondary mt-2 font-mono bg-surface-elevated px-2.5 py-1 rounded-lg border border-border-subtle inline-block">
                        {componentDetail.detail}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <HealthIndicator
                    status={tone}
                    label={isLoading ? "…" : status}
                  />
                  {/* Show latency */}
                  {componentDetail?.latency_ms != null && typeof componentDetail.latency_ms === "number" && (
                    <span className="text-[11px] text-text-muted font-mono font-semibold">
                      {componentDetail.latency_ms}ms
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Endpoints & Observability Card */}
      <div className="rounded-2xl border border-border-subtle bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border-subtle px-6 py-4 bg-surface-elevated/40">
          <h3 className="text-base font-bold text-text-primary">Endpoints &amp; Observability</h3>
          <p className="mt-0.5 text-xs text-text-muted">Đường dẫn giám sát hiệu năng, log và tài liệu kỹ thuật</p>
        </div>
        <div className="p-6 space-y-1 text-sm">
          <LinkRow label="API base URL" url={apiBaseUrl} />
          <LinkRow label="Health" url={`${apiBaseUrl}/health`} />
          <LinkRow label="Readiness" url={`${apiBaseUrl}/ready`} />
          <LinkRow label="System Health" url={`${apiBaseUrl}/api/v1/debug/system-health`} />
          <LinkRow label="Prometheus metrics" url={`${apiBaseUrl}/metrics`} icon={<BarChart3 className="h-3.5 w-3.5" />} />
          <LinkRow label="OpenAPI Swagger" url={`${apiBaseUrl}/docs`} external />
          {dataUpdatedAt && (
            <div className="text-[11px] text-text-muted pt-3 border-t border-border-subtle">
              Lần cập nhật: {new Date(dataUpdatedAt).toLocaleString("vi-VN")}
            </div>
          )}
        </div>
      </div>

      {/* Environment Card */}
      <div className="rounded-2xl border border-border-subtle bg-surface shadow-sm overflow-hidden">
        <div className="border-b border-border-subtle px-6 py-4 bg-surface-elevated/40">
          <h3 className="text-base font-bold text-text-primary">Môi trường</h3>
          <p className="mt-0.5 text-xs text-text-muted">Thông tin build và runtime của hệ thống</p>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <KV label="Environment" value={(import.meta.env.VITE_ENV ?? "local").toString()} />
            <KV label="Mode" value={import.meta.env.MODE} />
            <KV label="Build" value={import.meta.env.DEV ? "development" : "production"} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkRow({
  label,
  url,
  external,
  icon,
}: {
  label: string;
  url: string;
  external?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2.5 border-b border-border-subtle last:border-0">
      <div className="flex items-center gap-2 text-text-secondary text-xs font-medium">
        {icon}
        {label}
      </div>
      <a
        href={url}
        target={external ? "_blank" : undefined}
        rel="noreferrer"
        className="break-all font-mono text-xs text-primary hover:underline inline-flex items-center gap-1.5 font-semibold"
      >
        {url}
        {external && <ExternalLink className="h-3 w-3 text-text-muted" />}
      </a>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-elevated p-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</div>
      <div className="font-mono text-sm font-bold text-text-primary mt-1">{value}</div>
    </div>
  );
}
