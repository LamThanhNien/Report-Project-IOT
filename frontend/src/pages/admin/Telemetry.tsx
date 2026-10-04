import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowUpDown,
  BarChart3,
  Clock,
  Database,
  Gauge,
  Radio,
  RefreshCw,
  Search,
  Signal,
  WifiOff,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { formatDateTime, formatRelative } from "../../lib/formatters";
import { cn } from "../../lib/cn";
import { deviceTone, severityTone } from "../../lib/status";
import { useTelemetryData } from "../../hooks/useTelemetryData";
import { usePagination } from "../../hooks/usePagination";
import { PaginationBar } from "../../components/ui/PaginationBar";
import {
  AGG_OPTIONS,
  RANGE_OPTIONS,
  buildFleetChartData,
  calculateDeviceTelemetrySummary,
  formatCompact,
  formatMetricValue,
  formatPercent,
  getAvailableTelemetryMetrics,
  getHighErrorDevices,
  getMetricLabel,
  getMetricUnit,
  getSilentDevices,
  getTimeBucketSize,
  getTopSenders,
  getWeakRssiDevices,
  sortDeviceSummaries,
  type AggType,
  type DeviceTelemetrySummary,
  type MetricSelection,
} from "../../lib/telemetryUtils";

type StatusFilter = "all" | "online" | "offline" | "warning";
type SortKey = "attention" | "messages" | "msgPerMin" | "lastTelemetry" | "rssi" | "errorRate";

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "warning", label: "Cảnh báo" },
];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "attention", label: "Cần chú ý" },
  { value: "messages", label: "Messages" },
  { value: "msgPerMin", label: "Msg/phút" },
  { value: "lastTelemetry", label: "Gần nhất" },
  { value: "rssi", label: "RSSI yếu" },
  { value: "errorRate", label: "Error rate" },
];

const METRIC_GRADIENTS = [
  { from: "from-blue-500", to: "to-cyan-500", border: "hover:border-blue-500/40", glow: "shadow-blue-500/10" },
  { from: "from-emerald-500", to: "to-teal-500", border: "hover:border-emerald-500/40", glow: "shadow-emerald-500/10" },
  { from: "from-violet-500", to: "to-purple-500", border: "hover:border-violet-500/40", glow: "shadow-violet-500/10" },
  { from: "from-amber-500", to: "to-orange-500", border: "hover:border-amber-500/40", glow: "shadow-amber-500/10" },
  { from: "from-rose-500", to: "to-pink-500", border: "hover:border-rose-500/40", glow: "shadow-rose-500/10" },
];

export function Telemetry() {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]["key"]>("1h");
  const [metric, setMetric] = useState<MetricSelection>("message_rate");
  const [aggregation, setAggregation] = useState<AggType>("auto");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("attention");

  const rangeOption = RANGE_OPTIONS.find((item) => item.key === range) ?? RANGE_OPTIONS[1];
  const { telQ, devicesQ, devices, hasData, refreshError } = useTelemetryData(range, rangeOption);
  const telemetry = telQ.data ?? [];
  const isInitialLoading = (telQ.isLoading && !hasData) || devicesQ.isLoading;
  const hasBlockingError = telQ.isError && !hasData;

  const availableMetrics = useMemo(() => getAvailableTelemetryMetrics(telemetry), [telemetry]);
  const summaries = useMemo(
    () => calculateDeviceTelemetrySummary(telemetry, devices, rangeOption.minutes),
    [telemetry, devices, rangeOption.minutes],
  );
  const filteredSummaries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = summaries.filter((s) => {
      const matchSearch =
        !q || s.deviceUid.toLowerCase().includes(q) || (s.deviceName ?? "").toLowerCase().includes(q);
      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "warning" && s.healthStatus !== "good") ||
        s.status.toLowerCase() === statusFilter;
      return matchSearch && matchStatus;
    });
    return sortDeviceSummaries(filtered, sortKey);
  }, [summaries, search, statusFilter, sortKey]);

  const PAGE_SIZE = 10;
  const { page, setPage, totalPages, pagedItems: pagedSummaries } = usePagination(
    filteredSummaries,
    PAGE_SIZE,
    [search, statusFilter, sortKey] as const,
  );

  const chartData = useMemo(
    () => buildFleetChartData(telemetry, metric, aggregation, rangeOption.minutes, Date.now()),
    [telemetry, metric, aggregation, rangeOption.minutes],
  );
  const metricSample = useMemo(
    () => (metric.startsWith("metric:") ? telemetry.find((t) => t.metric_name === metric.slice(7)) : null),
    [metric, telemetry],
  );
  const chartUnit = getMetricUnit(metric, metricSample);
  const bucketLabel = formatBucketMs(getTimeBucketSize(rangeOption.minutes, telemetry.length));

  const fleetStats = useMemo(() => {
    let reportingDevices = 0;
    let totalErrors = 0;
    let weakSignalCount = 0;
    let silentCount = 0;
    const rssiValues: number[] = [];

    for (const summary of summaries) {
      if (summary.totalMessages > 0) reportingDevices += 1;
      else silentCount += 1;
      totalErrors += summary.errorCount;
      if (summary.avgRssi !== null) {
        rssiValues.push(summary.avgRssi);
        if (summary.avgRssi < -75) weakSignalCount += 1;
      }
    }

    return { reportingDevices, totalErrors, weakSignalCount, silentCount, avgRssi: avg(rssiValues) };
  }, [summaries]);
  const totalMessages = telemetry.length;
  const { reportingDevices, totalErrors, weakSignalCount, silentCount, avgRssi } = fleetStats;
  const errorRate = totalMessages > 0 ? totalErrors / totalMessages : 0;
  const messageRate = totalMessages / Math.max(rangeOption.minutes, 1);
  const isRefreshing = telQ.isFetching || devicesQ.isFetching;

  const topSenders = useMemo(() => getTopSenders(summaries), [summaries]);
  const weakRssi = useMemo(() => getWeakRssiDevices(summaries), [summaries]);
  const silentDevices = useMemo(() => getSilentDevices(summaries), [summaries]);
  const highErrorDevices = useMemo(() => getHighErrorDevices(summaries), [summaries]);

  const refresh = useCallback(() => {
    telQ.refetch();
    devicesQ.refetch();
    queryClient.invalidateQueries({ queryKey: ["telemetry"] });
  }, [devicesQ, queryClient, telQ]);

  if (hasBlockingError) {
    return (
      <div className="space-y-6">
        <StatusStrip
          devices={devices}
          isRefreshing={isRefreshing}
          refresh={refresh}
        />
        <div className="rounded-2xl border border-rose-500/20 bg-rose-50 dark:bg-rose-950/20 px-6 py-12 text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-rose-500" />
          <div className="text-base font-bold text-rose-800 dark:text-rose-200">
            Không tải được telemetry
          </div>
          <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">
            Kiểm tra kết nối mạng và thử lại.
          </div>
          <button onClick={refresh} className="btn-secondary mt-5">
            <RefreshCw className="h-3.5 w-3.5" />
            Thử lại
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      {/* ── Status Strip ──────────────────────────────────────── */}
      <StatusStrip devices={devices} isRefreshing={isRefreshing} refresh={refresh} />

      {/* ── Filters ───────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedRange value={range} onChange={setRange} />
          <div className="h-5 w-px bg-border-subtle hidden sm:block" />
          <select
            aria-label="Telemetry metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricSelection)}
            className="input h-8 w-auto min-w-44 text-xs bg-surface dark:bg-surface-muted border-border-subtle"
          >
            <option value="message_rate">Message rate</option>
            <option value="rssi">RSSI</option>
            <option value="error_rate">Error rate</option>
            <option value="device_reporting">Device reporting</option>
            <option value="all_metrics">All metrics</option>
            {availableMetrics.length > 0 && (
              <optgroup label="Metric cụ thể">
                {availableMetrics.map((name) => (
                  <option key={name} value={`metric:${name}`}>
                    {name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <select
            aria-label="Telemetry aggregation"
            value={aggregation}
            onChange={(e) => setAggregation(e.target.value as AggType)}
            className="input h-8 w-auto text-xs bg-surface dark:bg-surface-muted border-border-subtle"
          >
            {AGG_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="h-5 w-px bg-border-subtle hidden sm:block" />
          <div className="inline-flex rounded-xl bg-surface-elevated p-1 border border-border-subtle">
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o.value}
                onClick={() => setStatusFilter(o.value)}
                className={cn(
                  "h-6 rounded-lg px-2.5 text-[11px] font-semibold transition-all duration-150",
                  statusFilter === o.value
                    ? "bg-surface text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-48 flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Tìm thiết bị" placeholder="Tìm thiết bị..."
              className="input h-8 pl-9 text-xs bg-surface dark:bg-surface-muted border-border-subtle"
            />
          </div>
        </div>
        {refreshError && (
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            {refreshError}
          </div>
        )}
      </div>

      {/* ── Bento Metric Cards ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Tổng messages</p>
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", METRIC_GRADIENTS[0].from, METRIC_GRADIENTS[0].to)}>
              <Database className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold tabular-nums tracking-tight text-text-primary">
              {isInitialLoading ? "-" : formatCompact(totalMessages)}
            </div>
            <p className="mt-1 truncate text-xs text-text-muted">{rangeOption.label}</p>
          </div>
        </div>

        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Tốc độ</p>
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", METRIC_GRADIENTS[1].from, METRIC_GRADIENTS[1].to)}>
              <Zap className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400">
              {isInitialLoading ? "-" : `${formatCompact(messageRate)}/m`}
            </div>
            <p className="mt-1 truncate text-xs text-text-muted">bucket {bucketLabel}</p>
          </div>
        </div>

        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Thiết bị gửi</p>
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", METRIC_GRADIENTS[2].from, METRIC_GRADIENTS[2].to)}>
              <Radio className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold tabular-nums tracking-tight text-text-primary">
              {isInitialLoading ? "-" : `${reportingDevices} / ${devices.length}`}
            </div>
            <p className="mt-1 truncate text-xs text-text-muted">trong {rangeOption.label}</p>
          </div>
        </div>

        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">RSSI TB</p>
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", METRIC_GRADIENTS[3].from, METRIC_GRADIENTS[3].to)}>
              <Signal className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold tabular-nums tracking-tight text-amber-600 dark:text-amber-400">
              {isInitialLoading || avgRssi === null ? "-" : `${Math.round(avgRssi)} dBm`}
            </div>
            <p className="mt-1 truncate text-xs text-text-muted">{weakSignalCount} thiết bị yếu</p>
          </div>
        </div>

        <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border-subtle bg-surface p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md col-span-2 sm:col-span-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Error rate</p>
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", METRIC_GRADIENTS[4].from, METRIC_GRADIENTS[4].to)}>
              <AlertTriangle className="h-3.5 w-3.5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-extrabold tabular-nums tracking-tight text-rose-600 dark:text-rose-400">
              {isInitialLoading ? "-" : formatPercent(errorRate)}
            </div>
            <p className="mt-1 truncate text-xs text-text-muted">{totalErrors} lỗi · {silentCount} im lặng</p>
          </div>
        </div>
      </div>

      {/* ── Fleet Chart ───────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm">
        <div className="border-b border-border-subtle px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-text-primary">
                {chartTitle(metric)}
              </h3>
              <p className="mt-0.5 text-xs text-text-muted">
                {chartSubtitle(metric, aggregation, rangeOption.label, bucketLabel)}
              </p>
            </div>
            <div className="flex gap-2">
              <span className="chip tone-neutral-chip">
                {chartUnit || "unit"}
              </span>
              <span className="chip tone-info-chip">
                {chartData.length} pts
              </span>
            </div>
          </div>
        </div>
        <div className="p-4 bg-surface dark:bg-app/40">
          {isInitialLoading ? (
            <div className="flex h-[300px] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-border-subtle border-t-primary" />
                <div className="text-xs text-text-muted font-medium">Đang tải dữ liệu telemetry...</div>
              </div>
            </div>
          ) : metric === "all_metrics" ? (
            <div className="flex h-[300px] items-center justify-center">
              <div className="text-center">
                <BarChart3 className="mx-auto mb-2 h-8 w-8 text-text-muted" />
                <div className="text-xs text-text-muted font-medium">Chọn metric cụ thể để xem biểu đồ</div>
              </div>
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex h-[300px] items-center justify-center">
              <div className="text-center">
                <Activity className="mx-auto mb-2 h-8 w-8 text-text-muted" />
                <div className="text-xs text-text-muted font-medium">Không có dữ liệu trong khoảng thời gian này</div>
              </div>
            </div>
          ) : (
            <FleetChart data={chartData} metric={metric} aggregation={aggregation} unit={chartUnit} />
          )}
        </div>
      </div>

      {/* ── Insight Panels ────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InsightCard
          title="Gửi nhiều nhất"
          icon={<Activity className="h-4 w-4" />}
          tone="info"
          items={topSenders}
          emptyMsg="Chưa có dữ liệu"
        />
        <InsightCard
          title="RSSI yếu"
          icon={<Signal className="h-4 w-4" />}
          tone="warning"
          items={weakRssi}
          emptyMsg="Tín hiệu ổn định"
        />
        <InsightCard
          title="Không gửi gần đây"
          icon={<WifiOff className="h-4 w-4" />}
          tone="danger"
          items={silentDevices}
          emptyMsg="Tất cả đang hoạt động"
        />
        <InsightCard
          title="Lỗi cao"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="danger"
          items={highErrorDevices}
          emptyMsg="Không có lỗi"
        />
      </div>

      {/* ── Device Table ──────────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm flex flex-col flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-6 py-4 bg-surface-elevated/40 shrink-0">
          <div>
            <h3 className="text-base font-bold text-text-primary">
              Telemetry theo thiết bị
            </h3>
            <p className="mt-0.5 text-xs text-text-muted">
              {filteredSummaries.length} thiết bị · ưu tiên lỗi, tín hiệu yếu, lưu lượng bất thường
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-3.5 w-3.5 text-text-muted" />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="input h-8 w-auto text-xs bg-surface dark:bg-surface-muted border-border-subtle"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DeviceTable summaries={pagedSummaries} loading={isInitialLoading} />
        <PaginationBar
          page={page}
          totalPages={totalPages}
          totalItems={filteredSummaries.length}
          pageSize={PAGE_SIZE}
          onPrev={() => setPage(page - 1)}
          onNext={() => setPage(page + 1)}
          className="mt-auto border-t border-border-subtle shrink-0"
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Status Strip — compact dark/light bar at the top
   ═══════════════════════════════════════════════════════════════════════ */

function StatusStrip({
  devices,
  isRefreshing,
  refresh,
}: {
  devices: Array<{ status: string }>;
  isRefreshing: boolean;
  refresh: () => void;
}) {
  const onlineCount = devices.filter((d) => d.status === "online").length;
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border-subtle bg-surface px-5 py-3 shadow-sm">
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2.5 w-2.5">
            {isRefreshing ? (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
            ) : (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
            )}
            <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", isRefreshing ? "bg-sky-400" : "bg-emerald-500")} />
          </span>
          <span className="text-xs font-semibold text-text-primary">
            {isRefreshing ? "Đang cập nhật..." : "Trực tuyến"}
          </span>
        </div>
        <div className="h-4 w-px bg-border-subtle hidden sm:block" />
        <div className="flex items-center gap-4 text-xs">
          <span className="text-text-muted">
            Thiết bị:{" "}
            <span className="font-semibold text-text-primary font-mono">{devices.length}</span>
          </span>
          <span className="text-text-muted">
            Online:{" "}
            <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono">{onlineCount}</span>
          </span>
          <span className="text-text-muted">
            Offline:{" "}
            <span className="font-semibold text-rose-600 dark:text-rose-400 font-mono">{devices.length - onlineCount}</span>
          </span>
        </div>
      </div>
      <button
        onClick={refresh}
        disabled={isRefreshing}
        className="btn-secondary h-8 text-xs px-3"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
        Làm mới
      </button>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Segmented Range Selector
   ═══════════════════════════════════════════════════════════════════════ */

function SegmentedRange({
  value,
  onChange,
}: {
  value: (typeof RANGE_OPTIONS)[number]["key"];
  onChange: (v: (typeof RANGE_OPTIONS)[number]["key"]) => void;
}) {
  return (
    <div className="inline-flex rounded-xl bg-surface-elevated p-1 border border-border-subtle">
      {RANGE_OPTIONS.map((item) => (
        <button
          key={item.key}
          onClick={() => onChange(item.key)}
          className={cn(
            "h-7 rounded-lg px-3 text-xs font-semibold transition-all duration-150",
            value === item.key
              ? "bg-surface text-text-primary shadow-sm"
              : "text-text-muted hover:text-text-primary",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Fleet Chart — monitoring panel
   ═══════════════════════════════════════════════════════════════════════ */

function FleetChart({
  data,
  metric,
  aggregation,
  unit,
}: {
  data: Array<{ ts: number; value: number; count: number; unit: string }>;
  metric: MetricSelection;
  aggregation: AggType;
  unit: string;
}) {
  const minTs = data[0]?.ts ?? Date.now();
  const maxTs = data[data.length - 1]?.ts ?? minTs;
  const rangeMs = maxTs - minTs;
  return (
    <div className="h-[300px] min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 16, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="fleetFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0284c7" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#0284c7" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.15)" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => formatTimeTick(Number(v), rangeMs)}
            tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
            axisLine={false}
            tickLine={false}
            minTickGap={36}
            tickCount={6}
          />
          <YAxis
            tickFormatter={(v) => formatAxisValue(Number(v), metric, unit)}
            tick={{ fontSize: 10, fill: "var(--color-text-muted)" }}
            axisLine={false}
            tickLine={false}
            width={56}
          />
          {metric === "rssi" && <ReferenceLine y={-75} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.6} />}
          <Tooltip
            contentStyle={{
              background: "rgb(15 23 42)",
              border: "1px solid rgba(148,163,184,0.2)",
              borderRadius: 12,
              color: "white",
              fontSize: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
            }}
            labelFormatter={(v) => formatDateTime(new Date(Number(v)))}
            formatter={(value, _name, item) => {
              const n = typeof value === "number" ? value : Number(value);
              const payload = item.payload as { count?: number } | undefined;
              return [
                `${formatMetricValue(metric === "error_rate" ? n : n, metric === "error_rate" ? "error_rate" : unit)} · ${payload?.count ?? 0} samples · ${aggregation.toUpperCase()}`,
                getMetricLabel(metric),
              ];
            }}
          />
          <Area
            type="monotone"
            dataKey="value"
            name={getMetricLabel(metric)}
            stroke="#0284c7"
            strokeWidth={2.5}
            fill="url(#fleetFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Device Table — health-bar visualization
   ═══════════════════════════════════════════════════════════════════════ */

function DeviceTable({ summaries, loading }: { summaries: DeviceTelemetrySummary[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse border-b border-border-subtle bg-surface-elevated/40" />
        ))}
      </div>
    );
  }

  if (summaries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Radio className="mb-3 h-8 w-8 text-text-muted" />
        <div className="text-sm font-semibold text-text-primary">
          Không có thiết bị khớp bộ lọc
        </div>
        <div className="mt-1 text-xs text-text-muted">Thử thay đổi bộ lọc hoặc từ khóa tìm kiếm.</div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto flex flex-col flex-1">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle bg-surface-elevated/60 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            <th className="px-5 py-3 text-left">Thiết bị</th>
            <th className="px-4 py-3 text-left">Trạng thái</th>
            <th className="px-4 py-3 text-center">Sức khỏe</th>
            <th className="px-4 py-3 text-right">Messages</th>
            <th className="px-4 py-3 text-right">Msg/phút</th>
            <th className="px-4 py-3 text-left">Telemetry cuối</th>
            <th className="px-4 py-3 text-left">Metric</th>
            <th className="px-4 py-3 text-right">RSSI</th>
            <th className="px-4 py-3 text-right">Lỗi</th>
            <th className="px-5 py-3 text-right">Chi tiết</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {summaries.map((s) => (
            <tr
              key={s.deviceUid}
              className="transition-colors hover:bg-surface-elevated/50"
            >
              {/* Device */}
              <td className="px-5 py-3">
                <Link
                  to={`/console/devices/${s.deviceUid}`}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  {s.deviceName ?? s.deviceUid}
                </Link>
                <div className="mt-0.5 font-mono text-[10px] text-text-muted">{s.deviceUid}</div>
              </td>

              {/* Status */}
              <td className="px-4 py-3">
                <StatusBadge tone={deviceTone(s.status)} label={s.status} />
              </td>

              <td className="px-4 py-3"><StatusBadge tone={s.healthStatus === "good" ? "success" : s.healthStatus === "warning" ? "warning" : "danger"} label={s.healthStatus} /></td>

              {/* Messages */}
              <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums text-text-primary">
                {formatCompact(s.totalMessages)}
              </td>

              {/* Msg/min */}
              <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums text-text-primary">
                {formatCompact(s.msgPerMin)}
              </td>

              {/* Last telemetry */}
              <td className="px-4 py-3">
                <div className="text-xs font-medium text-text-primary">{formatRelative(s.lastTelemetryTime)}</div>
                <div className="text-[10px] text-text-muted">{formatDateTime(s.lastTelemetryTime)}</div>
              </td>

              {/* Latest metric */}
              <td className="px-4 py-3">
                {s.latestMetricName ? (
                  <>
                    <div className="font-mono text-[11px] font-semibold text-text-primary">{s.latestMetricName}</div>
                    <div className="text-[10px] text-text-muted">
                      {formatMetricValue(s.latestMetricValue, s.latestMetricUnit ?? "")}
                    </div>
                  </>
                ) : (
                  <span className="text-xs text-text-muted">-</span>
                )}
              </td>

              {/* RSSI */}
              <td className="px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums">
                {s.avgRssi === null ? (
                  <span className="text-text-muted">-</span>
                ) : (
                  <span className={cn(s.avgRssi < -80 ? "text-rose-500" : s.avgRssi < -70 ? "text-amber-500" : "text-text-primary")}>
                    {Math.round(s.avgRssi)}
                  </span>
                )}
              </td>

              {/* Errors */}
              <td className="px-4 py-3 text-right">
                <div className="font-mono text-xs font-semibold tabular-nums">
                  {s.errorCount > 0 ? (
                    <span className="text-rose-500">{s.errorCount}</span>
                  ) : (
                    <span className="text-text-muted">0</span>
                  )}
                </div>
                <div className="text-[10px] text-text-muted">{formatPercent(s.errorRate)}</div>
              </td>

              {/* Action */}
              <td className="px-5 py-3 text-right">
                <Link
                  to={`/console/devices/${s.deviceUid}`}
                  className="btn-secondary h-7 px-2.5 text-[11px]"
                >
                  Chi tiết
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Insight Card — alert panels
   ═══════════════════════════════════════════════════════════════════════ */

function InsightCard({
  title,
  icon,
  tone,
  items,
  emptyMsg,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "info" | "warning" | "danger";
  items: Array<{ uid: string; name: string | null; label: string }>;
  emptyMsg: string;
}) {
  const toneClasses = {
    info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
    warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
    danger: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  }[tone];

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface shadow-sm overflow-hidden flex flex-col justify-between">
      <div className="flex items-center gap-2.5 border-b border-border-subtle px-4 py-3 bg-surface-elevated/40">
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-xl border", toneClasses)}>
          {icon}
        </div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-text-primary">{title}</h4>
        {items.length > 0 && (
          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-surface-muted px-1.5 text-[10px] font-bold text-text-primary border border-border-subtle">
            {items.length}
          </span>
        )}
      </div>
      <div className="divide-y divide-border-subtle flex-1">
        {items.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-text-muted font-medium">{emptyMsg}</div>
        ) : (
          items.map((item) => (
            <div key={item.uid} className="flex items-center justify-between gap-2 px-4 py-2.5 transition-colors hover:bg-surface-elevated/40">
              <div className="min-w-0">
                <Link
                  to={`/console/devices/${item.uid}`}
                  className="block truncate text-xs font-semibold text-primary hover:underline"
                >
                  {item.name ?? item.uid}
                </Link>
                {item.name && (
                  <div className="truncate font-mono text-[10px] text-text-muted">{item.uid}</div>
                )}
              </div>
              <span className="flex-shrink-0 font-mono text-xs font-semibold text-text-secondary">
                {item.label}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════ */

function chartTitle(metric: MetricSelection): string {
  if (metric === "message_rate") return "Lưu lượng message theo thời gian";
  if (metric === "rssi") return "RSSI trung bình theo thời gian";
  if (metric === "error_rate") return "Error rate theo thời gian";
  if (metric === "device_reporting") return "Thiết bị đang gửi theo thời gian";
  if (metric === "all_metrics") return "Telemetry metrics";
  return `${metric.slice(7)} theo thời gian`;
}

function chartSubtitle(metric: MetricSelection, agg: AggType, rangeLabel: string, bucket: string): string {
  if (metric === "all_metrics") return "Chọn metric cụ thể để xem biểu đồ chi tiết.";
  return `${getMetricLabel(metric)} · bucket ${bucket} · ${rangeLabel} · ${agg.toUpperCase()}`;
}

function formatAxisValue(value: number, metric: MetricSelection, unit: string): string {
  if (metric === "error_rate") return `${Math.round(value * 100)}%`;
  if (metric === "rssi") return `${Math.round(value)}`;
  if (unit === "devices") return `${Math.round(value)}`;
  return formatCompact(value);
}

function formatTimeTick(value: number, rangeMs: number): string {
  const d = new Date(value);
  if (rangeMs <= 10 * 60 * 1000) return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  if (rangeMs <= 24 * 60 * 60 * 1000) return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

function formatBucketMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 60 / 60_000)}h`;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}
