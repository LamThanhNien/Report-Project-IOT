import type { Device, Telemetry } from "../types";

export type FleetMetricKey = "message_rate" | "rssi" | "error_rate" | "device_reporting";
export type MetricSelection = FleetMetricKey | `metric:${string}` | "all_metrics";
export type AggType = "auto" | "avg" | "sum" | "min" | "max" | "p95";

export interface RangeOption {
  key: "5m" | "1h" | "24h" | "7d";
  label: string;
  minutes: number;
}

export interface ChartDataPoint {
  ts: number;
  value: number;
  count: number;
  unit: string;
}

export interface DeviceTelemetrySummary {
  deviceUid: string;
  deviceName: string | null;
  status: string;
  totalMessages: number;
  msgPerMin: number;
  lastTelemetryTime: string | null;
  latestMetricName: string | null;
  latestMetricValue: number | null;
  latestMetricUnit: string | null;
  avgRssi: number | null;
  errorCount: number;
  errorRate: number;
  healthStatus: "good" | "warning" | "critical";
}

export interface InsightDevice {
  uid: string;
  name: string | null;
  value: number;
  label: string;
}

export const RANGE_OPTIONS: RangeOption[] = [
  { key: "5m", label: "5 phút", minutes: 5 },
  { key: "1h", label: "1 giờ", minutes: 60 },
  { key: "24h", label: "24 giờ", minutes: 60 * 24 },
  { key: "7d", label: "7 ngày", minutes: 60 * 24 * 7 },
];

export const AGG_OPTIONS: { value: AggType; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "avg", label: "Avg" },
  { value: "sum", label: "Sum" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
  { value: "p95", label: "P95" },
];

export function getTimeBucketSize(rangeMinutes: number, dataPointCount = 0): number {
  if (rangeMinutes <= 5) return dataPointCount > 900 ? 5_000 : 10_000;
  if (rangeMinutes <= 60) return 60_000;
  if (rangeMinutes <= 60 * 24) return 15 * 60_000;
  return 2 * 60 * 60_000;
}

export function getMetricUnit(selection: MetricSelection, sample?: Telemetry | null): string {
  if (selection === "message_rate") return "msg/min";
  if (selection === "rssi") return "dBm";
  if (selection === "error_rate") return "%";
  if (selection === "device_reporting") return "devices";
  if (selection.startsWith("metric:")) return normalizeUnit(sample?.unit, selection.slice(7));
  return "";
}

export function getMetricLabel(selection: MetricSelection): string {
  if (selection === "message_rate") return "Message rate";
  if (selection === "rssi") return "RSSI";
  if (selection === "error_rate") return "Error rate";
  if (selection === "device_reporting") return "Device reporting";
  if (selection === "all_metrics") return "All metrics";
  return selection.slice(7);
}

export function resolveAgg(selection: MetricSelection, agg: AggType): AggType {
  if (agg !== "auto") return agg;
  if (selection === "message_rate" || selection === "device_reporting") return "sum";
  if (selection === "error_rate") return "avg";
  return "avg";
}

export function getAvailableTelemetryMetrics(telemetry: Telemetry[]): string[] {
  const metrics = new Set<string>();
  for (const item of telemetry) {
    if (Number.isFinite(item.metric_value)) metrics.add(item.metric_name);
  }
  return Array.from(metrics).sort((a, b) => a.localeCompare(b));
}

export function buildFleetChartData(
  telemetry: Telemetry[],
  selection: MetricSelection,
  agg: AggType,
  rangeMinutes: number,
  now = Date.now(),
  maxPoints = 250,
): ChartDataPoint[] {
  if (selection === "all_metrics" || telemetry.length === 0) return [];

  const fromMs = now - rangeMinutes * 60_000;
  const bucketMs = getTimeBucketSize(rangeMinutes, telemetry.length);
  const buckets = new Map<number, Telemetry[]>();

  for (const item of telemetry) {
    const ts = new Date(item.timestamp).getTime();
    if (!Number.isFinite(ts) || ts < fromMs || ts > now) continue;
    const bucketTs = Math.floor((ts - fromMs) / bucketMs) * bucketMs + fromMs;
    const records = buckets.get(bucketTs) ?? [];
    records.push(item);
    buckets.set(bucketTs, records);
  }

  const resolvedAgg = resolveAgg(selection, agg);
  const points = Array.from(buckets.entries())
    .sort(([left], [right]) => left - right)
    .map(([ts, records]) => buildBucketPoint(ts, records, selection, resolvedAgg, bucketMs))
    .filter((point): point is ChartDataPoint => point !== null);

  return downsampleSeries(points, maxPoints);
}

export function calculateDeviceTelemetrySummary(
  telemetry: Telemetry[],
  devices: Device[],
  rangeMinutes: number,
): DeviceTelemetrySummary[] {
  const devicesByUid = new Map(devices.map((device) => [device.device_uid, device]));
  const telemetryByDevice = new Map<string, Telemetry[]>();

  for (const item of telemetry) {
    const records = telemetryByDevice.get(item.device_uid) ?? [];
    records.push(item);
    telemetryByDevice.set(item.device_uid, records);
  }

  const allDeviceUids = new Set<string>([
    ...devices.map((device) => device.device_uid),
    ...telemetryByDevice.keys(),
  ]);

  return Array.from(allDeviceUids).map((deviceUid) => {
    const records = telemetryByDevice.get(deviceUid) ?? [];
    const device = devicesByUid.get(deviceUid);
    const sorted = [...records].sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
    const rssiValues = records.filter((item) => isRssiMetric(item.metric_name)).map((item) => item.metric_value);
    const errorCount = records.filter((item) => isErrorMetric(item.metric_name)).length;
    const avgRssi = rssiValues.length > 0 ? average(rssiValues) : device?.rssi ?? null;
    const totalMessages = records.length;
    const errorRate = totalMessages > 0 ? errorCount / totalMessages : 0;
    const latest = sorted[0] ?? null;

    return {
      deviceUid,
      deviceName: device?.name ?? null,
      status: device?.status ?? (totalMessages > 0 ? "unknown" : "offline"),
      totalMessages,
      msgPerMin: totalMessages / Math.max(rangeMinutes, 1),
      lastTelemetryTime: latest?.timestamp ?? device?.last_seen_at ?? null,
      latestMetricName: latest?.metric_name ?? null,
      latestMetricValue: latest?.metric_value ?? null,
      latestMetricUnit: latest?.unit ?? null,
      avgRssi,
      errorCount,
      errorRate,
      healthStatus: getHealthStatus(totalMessages, avgRssi, errorRate, latest?.timestamp ?? null, rangeMinutes),
    };
  });
}

export function sortDeviceSummaries(
  summaries: DeviceTelemetrySummary[],
  sortKey: "attention" | "messages" | "msgPerMin" | "lastTelemetry" | "rssi" | "errorRate",
): DeviceTelemetrySummary[] {
  const sorted = [...summaries];
  if (sortKey === "messages") return sorted.sort((left, right) => right.totalMessages - left.totalMessages);
  if (sortKey === "msgPerMin") return sorted.sort((left, right) => right.msgPerMin - left.msgPerMin);
  if (sortKey === "lastTelemetry") return sorted.sort((left, right) => timeValue(right.lastTelemetryTime) - timeValue(left.lastTelemetryTime));
  if (sortKey === "rssi") return sorted.sort((left, right) => (left.avgRssi ?? 0) - (right.avgRssi ?? 0));
  if (sortKey === "errorRate") return sorted.sort((left, right) => right.errorRate - left.errorRate);
  return sorted.sort(compareAttention);
}

export function getTopSenders(summaries: DeviceTelemetrySummary[], limit = 5): InsightDevice[] {
  return summaries
    .filter((summary) => summary.totalMessages > 0)
    .sort((left, right) => right.totalMessages - left.totalMessages)
    .slice(0, limit)
    .map((summary) => ({
      uid: summary.deviceUid,
      name: summary.deviceName,
      value: summary.totalMessages,
      label: `${formatCompact(summary.totalMessages)} samples`,
    }));
}

export function getWeakRssiDevices(summaries: DeviceTelemetrySummary[], threshold = -75): InsightDevice[] {
  return summaries
    .filter((summary) => summary.avgRssi !== null && summary.avgRssi < threshold)
    .sort((left, right) => (left.avgRssi ?? 0) - (right.avgRssi ?? 0))
    .slice(0, 5)
    .map((summary) => ({
      uid: summary.deviceUid,
      name: summary.deviceName,
      value: summary.avgRssi ?? 0,
      label: `${Math.round(summary.avgRssi ?? 0)} dBm`,
    }));
}

export function getSilentDevices(summaries: DeviceTelemetrySummary[], limit = 5): InsightDevice[] {
  return summaries
    .filter((summary) => summary.totalMessages === 0)
    .slice(0, limit)
    .map((summary) => ({
      uid: summary.deviceUid,
      name: summary.deviceName,
      value: 0,
      label: "No telemetry",
    }));
}

export function getHighErrorDevices(summaries: DeviceTelemetrySummary[], limit = 5): InsightDevice[] {
  return summaries
    .filter((summary) => summary.errorCount > 0)
    .sort((left, right) => right.errorRate - left.errorRate)
    .slice(0, limit)
    .map((summary) => ({
      uid: summary.deviceUid,
      name: summary.deviceName,
      value: summary.errorRate,
      label: `${summary.errorCount} errors (${formatPercent(summary.errorRate)})`,
    }));
}

export function formatMetricValue(value: number | null | undefined, selectionOrUnit: MetricSelection | string): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  if (selectionOrUnit === "error_rate") return formatPercent(value);
  if (selectionOrUnit === "rssi" || selectionOrUnit === "dBm") return `${Math.round(value)} dBm`;
  if (selectionOrUnit === "message_rate" || selectionOrUnit === "msg/min") return `${formatCompact(value)} msg/min`;
  if (selectionOrUnit === "device_reporting" || selectionOrUnit === "devices") return `${Math.round(value)} devices`;
  if (selectionOrUnit === "%") return `${formatCompact(value)}%`;
  if (selectionOrUnit) return `${formatCompact(value)} ${selectionOrUnit}`;
  return formatCompact(value);
}

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  if (Number.isInteger(value)) return value.toLocaleString("vi-VN");
  return String(Number(value.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2)));
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function buildBucketPoint(
  ts: number,
  records: Telemetry[],
  selection: MetricSelection,
  agg: AggType,
  bucketMs: number,
): ChartDataPoint | null {
  if (selection === "message_rate") {
    return {
      ts,
      value: records.length / Math.max(bucketMs / 60_000, 1 / 60),
      count: records.length,
      unit: "msg/min",
    };
  }

  if (selection === "device_reporting") {
    return {
      ts,
      value: new Set(records.map((item) => item.device_uid)).size,
      count: records.length,
      unit: "devices",
    };
  }

  if (selection === "error_rate") {
    const value = records.length === 0 ? 0 : records.filter((item) => isErrorMetric(item.metric_name)).length / records.length;
    return { ts, value, count: records.length, unit: "%" };
  }

  const metricName = selection === "rssi" ? null : selection.slice(7);
  const matching = records.filter((item) => selection === "rssi" ? isRssiMetric(item.metric_name) : item.metric_name === metricName);
  if (matching.length === 0) return null;

  const values = matching.map((item) => item.metric_value).filter(Number.isFinite);
  if (values.length === 0) return null;
  const sample = matching[0];
  return {
    ts,
    value: aggregate(values, agg),
    count: values.length,
    unit: getMetricUnit(selection, sample),
  };
}

function aggregate(values: number[], agg: AggType): number {
  if (values.length === 0) return 0;
  if (agg === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (agg === "min") return Math.min(...values);
  if (agg === "max") return Math.max(...values);
  if (agg === "p95") {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * 0.95))];
  }
  return average(values);
}

function downsampleSeries(points: ChartDataPoint[], maxPoints: number): ChartDataPoint[] {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  return points.filter((_, index) => index % step === 0).slice(0, maxPoints);
}

function getHealthStatus(
  totalMessages: number,
  avgRssi: number | null,
  errorRate: number,
  lastTelemetryTime: string | null,
  rangeMinutes: number,
): DeviceTelemetrySummary["healthStatus"] {
  const isSilent = totalMessages === 0 || !lastTelemetryTime;
  const weakSignal = avgRssi !== null && avgRssi < -75;
  const highErrorRate = errorRate >= 0.05;
  const stale = lastTelemetryTime ? Date.now() - new Date(lastTelemetryTime).getTime() > rangeMinutes * 60_000 : false;
  if (highErrorRate || isSilent || stale) return "critical";
  if (weakSignal || errorRate > 0) return "warning";
  return "good";
}

function compareAttention(left: DeviceTelemetrySummary, right: DeviceTelemetrySummary): number {
  const leftScore = attentionScore(left);
  const rightScore = attentionScore(right);
  if (leftScore !== rightScore) return rightScore - leftScore;
  return right.totalMessages - left.totalMessages;
}

function attentionScore(summary: DeviceTelemetrySummary): number {
  let score = 0;
  if (summary.errorRate >= 0.05) score += 100;
  else if (summary.errorRate > 0) score += 60;
  if (summary.avgRssi !== null && summary.avgRssi < -75) score += 40;
  if (summary.totalMessages === 0) score += 80;
  if (summary.healthStatus === "critical") score += 30;
  return score;
}

function isRssiMetric(metricName: string): boolean {
  return /rssi/i.test(metricName);
}

function isErrorMetric(metricName: string): boolean {
  return /error|fail|exception/i.test(metricName);
}

function normalizeUnit(unit: string | null | undefined, metricName: string): string {
  if (unit) {
    if (unit.toLowerCase() === "c") return "°C";
    return unit;
  }
  if (/temperature|temp/i.test(metricName)) return "°C";
  if (/humidity|moisture/i.test(metricName)) return "%";
  if (/rssi/i.test(metricName)) return "dBm";
  return "";
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function timeValue(value: string | null): number {
  return value ? new Date(value).getTime() : 0;
}
