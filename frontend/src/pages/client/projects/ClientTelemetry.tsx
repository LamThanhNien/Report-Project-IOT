import { ErrorBanner } from "../../../components/ui/ErrorBanner";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePersistedState } from "../../../hooks/usePersistedState";
import { useQuery } from "@tanstack/react-query";
import { Activity, Download, Loader2, Search } from "lucide-react";
import { listClientDevices, getClientDeviceTelemetry } from "../../../services/clientApi";
import type { TelemetryAggregatedResponse } from "../../../services/clientApi";
import { PageHeader } from "../../../components/ui/PageHeader";
import { ClientSectionNav, MONITORING_SECTION_NAV } from "../../../components/layout/ClientSectionNav";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { useFeature } from "../../../contexts/FeatureContext";
import { FeatureGate } from "./FeatureGate";
import { formatRelative, formatNumber } from "../../../lib/formatters";
import type { Telemetry } from "../../../types";
import { TelemetryChart } from "../../../components/charts/TelemetryChart";
import { ErrorState } from "../../../components/ui/ErrorState";
import { useProjectScope } from "../../../hooks/useProjectScope";

export function ClientTelemetry({ scopedProjectId }: { scopedProjectId?: string } = {}) {
  const { t } = useTranslation(["monitoring", "common", "devices"]);
  const { hasFeature, featuresReady } = useFeature();
  const { projectId } = useProjectScope();
  const effectiveProjectId = scopedProjectId ?? projectId ?? undefined;
  const [selectedDevice, setSelectedDevice] = useState<string>("");
  const [selectedMetric, setSelectedMetric] = useState("");
  const [timeRange, setTimeRange] = useState<"live" | "6h" | "1d" | "1w" | "1m">("live");
  const [aggregate, setAggregate] = useState<"avg" | "min" | "max">("avg");
  const [search, setSearch] = usePersistedState("aifom_clienttelemetry_search", "", "session");

  const { data: devices, isLoading: devicesLoading } = useQuery({
    queryKey: ["client-devices", effectiveProjectId],
    queryFn: () => listClientDevices(effectiveProjectId),
  });

  const { data: telemetry, isLoading: telemetryLoading, error, refetch } = useQuery({
    queryKey: ["client-telemetry", selectedDevice],
    queryFn: () => getClientDeviceTelemetry(selectedDevice, { limit: 200 }),
    enabled: !!selectedDevice,
    refetchInterval: 10_000,
  });

  useEffect(() => {
    setSelectedDevice("");
    setSelectedMetric("");
  }, [effectiveProjectId]);

  const deviceList = devices ?? [];

  const telemetryList: Telemetry[] = useMemo(() => {
    if (!telemetry) return [];
    const isAgg = (v: unknown): v is TelemetryAggregatedResponse =>
      typeof v === "object" && v !== null && "aggregated" in v && "data" in v;
    return isAgg(telemetry) ? telemetry.data : (telemetry as Telemetry[]);
  }, [telemetry]);

  const metrics = useMemo(() => {
    const map = new Map<string, Telemetry[]>();
    for (const tRec of telemetryList) {
      const arr = map.get(tRec.metric_name) ?? [];
      arr.push(tRec);
      map.set(tRec.metric_name, arr);
    }
    return Array.from(map.entries()).map(([name, records]) => ({
      name,
      latest: records[0],
      count: records.length,
    }));
  }, [telemetryList]);

  const filteredMetrics = useMemo(() => {
    if (!search) return metrics;
    const q = search.toLowerCase();
    return metrics.filter((m) => m.name.toLowerCase().includes(q));
  }, [metrics, search]);

  useEffect(() => {
    if (!selectedMetric || !metrics.some((metric) => metric.name === selectedMetric)) {
      setSelectedMetric(metrics[0]?.name ?? "");
    }
  }, [metrics, selectedMetric]);

  const chartQ = useQuery({
    queryKey: ["client-telemetry-chart", selectedDevice, selectedMetric, timeRange, aggregate],
    queryFn: () => getClientDeviceTelemetry(selectedDevice, { metric_name: selectedMetric, time_range: timeRange, aggregate, limit: 1000 }),
    enabled: Boolean(selectedDevice && selectedMetric),
    refetchInterval: timeRange === "live" ? 5_000 : 30_000,
  });
  const chartData = useMemo<Telemetry[]>(() => {
    const value = chartQ.data;
    if (!value) return [];
    return Array.isArray(value) ? value : value.data;
  }, [chartQ.data]);
  const invalidValueCount = chartData.filter((record) => !Number.isFinite(Number(record.metric_value))).length;

  function exportCsv() {
    if (!chartData.length) return;
    const rows = ["timestamp,device_uid,metric_name,metric_value,unit", ...chartData.map((record) =>
      [record.timestamp, selectedDevice, record.metric_name, record.metric_value, record.unit ?? ""].map((value) => JSON.stringify(value)).join(","),
    )];
    const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `telemetry-${selectedDevice}-${selectedMetric}-${timeRange}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!featuresReady) return <div className="flex items-center justify-center h-64 text-sm text-slate-500">{t("common:loading", "Đang tải…")}</div>;
  if (!hasFeature("telemetry_view")) return <FeatureGate featureName="telemetry_view" />;

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-4">
      <PageHeader
        title={t("monitoring:telemetry_title", "Xem Telemetry")}
      />

      <ClientSectionNav items={MONITORING_SECTION_NAV} />

      {/* ── Streamlined Telemetry Control Toolbar ──────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between border-b border-slate-200/80 dark:border-border-subtle pb-4 pt-1">
        {/* Device Selector + Metric Selector + Time Range + Aggregate */}
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {/* Device Selector */}
          <div className="flex items-center gap-2 min-w-[220px]">
            <select
              className="input text-xs h-9 w-full"
              aria-label={t("monitoring:select_device", "Chọn thiết bị")}
              value={selectedDevice}
              onChange={(e) => setSelectedDevice(e.target.value)}
              disabled={devicesLoading}
            >
              <option value="">
                {devicesLoading
                  ? t("devices:loading_devices", "Đang tải thiết bị…")
                  : `-- ${t("monitoring:select_device", "Chọn thiết bị")} --`}
              </option>
              {deviceList.map((d) => (
                <option key={d.id} value={d.device_uid}>
                  {d.name} ({d.device_uid})
                </option>
              ))}
            </select>
            {devicesLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 shrink-0" />}
          </div>

          {selectedDevice && (
            <>
              {/* Metric Selector */}
              {metrics.length > 0 && (
                <select
                  className="input text-xs h-9 min-w-[140px]"
                  aria-label={t("devices:telemetry.aria_metric", "Metric")}
                  value={selectedMetric}
                  onChange={(event) => setSelectedMetric(event.target.value)}
                >
                  {metrics.map((metric) => (
                    <option key={metric.name} value={metric.name}>
                      {metric.name}
                    </option>
                  ))}
                </select>
              )}

              {/* Time Range Selector */}
              <select
                className="input text-xs h-9 min-w-[110px]"
                aria-label={t("devices:telemetry.aria_time_range", "Khoảng thời gian")}
                value={timeRange}
                onChange={(event) => setTimeRange(event.target.value as typeof timeRange)}
              >
                <option value="live">{t("devices:telemetry.time_range_live", "Live (5s)")}</option>
                <option value="6h">{t("devices:telemetry.time_range_6h", "6 giờ")}</option>
                <option value="1d">{t("devices:telemetry.time_range_1d", "1 ngày")}</option>
                <option value="1w">{t("devices:telemetry.time_range_1w", "1 tuần")}</option>
                <option value="1m">{t("devices:telemetry.time_range_1m", "1 tháng")}</option>
              </select>

              {/* Aggregate Selector */}
              <select
                className="input text-xs h-9 min-w-[110px]"
                aria-label={t("devices:telemetry.aria_aggregate", "Tổng hợp")}
                value={aggregate}
                disabled={timeRange === "live"}
                onChange={(event) => setAggregate(event.target.value as typeof aggregate)}
              >
                <option value="avg">{t("devices:telemetry.agg_avg", "Trung bình (Avg)")}</option>
                <option value="min">{t("devices:telemetry.agg_min", "Nhỏ nhất (Min)")}</option>
                <option value="max">{t("devices:telemetry.agg_max", "Lớn nhất (Max)")}</option>
              </select>
            </>
          )}
        </div>

        {/* Export CSV Action */}
        {selectedDevice && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="btn-secondary flex items-center gap-1.5 text-xs h-9"
              onClick={exportCsv}
              disabled={!chartData.length}
            >
              <Download className="h-3.5 w-3.5" />
              <span>{t("devices:telemetry.export_csv", "Xuất CSV")}</span>
            </button>
          </div>
        )}
      </div>

      {selectedDevice && (
        <div className="space-y-4">
          <Card className="border border-slate-200/80 dark:border-border-subtle bg-white dark:bg-surface shadow-xs">
            <CardHeader className="flex items-center justify-between py-3">
              <CardTitle className="text-sm font-semibold text-slate-900 dark:text-text-primary">
                {t("devices:telemetry.chart_title", "Biểu đồ Telemetry: {{metric}}", { metric: selectedMetric || t("devices:telemetry.unselected_metric", "Chưa chọn metric") })}
              </CardTitle>
            </CardHeader>
            <CardBody className="pt-0">
              {chartQ.isLoading && chartData.length === 0 ? (
                <div className="flex h-64 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : chartQ.isError && chartData.length === 0 ? (
                <ErrorState
                  message={t("devices:telemetry.error_load_chart", "Không thể tải biểu đồ telemetry.")}
                  onRetry={() => chartQ.refetch()}
                />
              ) : chartData.length === 0 ? (
                <div className="flex h-64 items-center justify-center text-sm text-slate-500">
                  {t("devices:telemetry.empty_range", "Không có dữ liệu trong khoảng đã chọn.")}
                </div>
              ) : (
                <>
                  {chartQ.isError && (
                    <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                      <p>{t("devices:telemetry.error_refresh_chart", "Không thể cập nhật biểu đồ. Dữ liệu gần nhất vẫn đang được hiển thị.")}</p>
                      <button className="btn-secondary h-8 text-xs" onClick={() => chartQ.refetch()}>{t("common:actions.retry", "Thử lại")}</button>
                    </div>
                  )}
                  <TelemetryChart
                    data={chartData}
                    metricName={selectedMetric}
                    unit={chartData[0]?.unit}
                    height={280}
                  />
                  {invalidValueCount > 0 && (
                    <p className="mt-2 text-xs text-amber-600">
                      {t("devices:telemetry.invalid_values_skipped", "Đã bỏ qua {{count}} giá trị không hợp lệ.", { count: invalidValueCount })}
                    </p>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-slate-400" />
              <CardTitle>{t("devices:telemetry.device_telemetry", "Telemetry: {{device}}", { device: selectedDevice })}</CardTitle>
            </div>
            <div className="relative max-w-xs w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-9"
                aria-label={t("common:actions.search_metric", "Tìm metric...")}
                placeholder={t("common:actions.search_metric", "Tìm metric...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          {error && telemetryList.length > 0 && (
            <div role="status" className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              <p>{t("common:error_refresh_stale", "Không thể cập nhật dữ liệu. Các bản ghi gần nhất vẫn đang được hiển thị.")}</p>
              <button className="btn-secondary h-8 text-xs" onClick={() => refetch()}>{t("common:actions.retry", "Thử lại")}</button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 dark:bg-surface/40">
                <tr>
                  <th className="text-left px-4 py-2">{t("common:col.metric", "Metric")}</th>
                  <th className="text-right px-4 py-2">{t("common:col.latest_value", "Giá trị mới nhất")}</th>
                  <th className="text-left px-4 py-2">{t("common:col.unit", "Đơn vị")}</th>
                  <th className="text-right px-4 py-2">{t("common:col.record_count", "Số bản ghi")}</th>
                  <th className="text-left px-4 py-2">{t("common:col.updated", "Cập nhật")}</th>
                </tr>
              </thead>
              <tbody>
                {telemetryLoading && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-sm text-slate-500">
                      {t("common:loading", "Đang tải…")}
                    </td>
                  </tr>
                )}
                {error && telemetryList.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8">
                      <p className="text-sm text-rose-600 mb-2">{t("common:error_load_data", "Không thể tải dữ liệu")}</p>
                      <button className="btn-secondary text-xs" onClick={() => refetch()}>
                        {t("common:actions.retry", "Thử lại")}
                      </button>
                    </td>
                  </tr>
                )}
                {!telemetryLoading && (!error || telemetryList.length > 0) && filteredMetrics.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-sm text-slate-500">
                      {search ? t("common:no_matching_metrics", "Không tìm thấy metric phù hợp") : t("monitoring:no_data", "Chưa có dữ liệu telemetry")}
                    </td>
                  </tr>
                )}
                {filteredMetrics.map((m) => (
                  <tr key={m.name} className="border-t border-slate-100 dark:border-border-subtle">
                    <td className="px-4 py-2 font-mono text-xs font-medium">{m.name}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {formatNumber(m.latest?.metric_value, 2)}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {m.latest?.unit ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-slate-500">{m.count}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">
                      {formatRelative(m.latest?.timestamp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        </div>
      )}

      {!selectedDevice && (
        <Card className="border border-slate-200/80 dark:border-border-subtle bg-white dark:bg-surface shadow-xs">
          <CardBody className="py-12 text-center">
            <Activity className="h-8 w-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">{t("monitoring:select_device_hint", "Chọn một thiết bị để xem dữ liệu telemetry")}</p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
