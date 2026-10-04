import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useProjectScope } from "../../../hooks/useProjectScope";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Pencil,
  Gauge,
  History,
  KeyRound,
  Loader2,
  PanelsTopLeft,
  PlugZap,
  RefreshCw,
  Rocket,
  Satellite,
  Settings2,
  ShieldAlert,
  Signal,
  Thermometer,
  WifiOff,
  XCircle,
} from "lucide-react";
import { getClientDeviceDetail, sendClientDeviceCommand, updateClientDevice, updateClientDeviceOfflineTimeout, regenerateDeviceToken } from "../../../services/clientApi";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { PageHeader } from "../../../components/ui/PageHeader";
import { TelemetryChart } from "../../../components/charts/TelemetryChart";
import { Timeline, type TimelineItem } from "../../../components/ui/Timeline";
import { Tabs } from "../../../components/ui/Tabs";
import { FirmwareVersionBadge } from "../../../components/ui/FirmwareVersionBadge";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Modal } from "../../../components/ui/Modal";
import { DeviceEditModal } from "../../../components/devices/DeviceEditModal";
import { useFeature } from "../../../contexts/FeatureContext";
import { useAuth } from "../../../contexts/AuthContext";
import { FeatureGate } from "./FeatureGate";
import { canManageDevices, canManageOta, canSendCommands } from "../../../lib/permissions";
import { deviceTone, otaTone, severityTone } from "../../../lib/status";
import { formatDateTime, formatRelative } from "../../../lib/formatters";
import { useDeviceStatusStream } from "../../../hooks/useDeviceStatusStream";
import type {
  Telemetry,
  TenantDeviceDetail,
  Device,
} from "../../../types";

type TabKey = "overview" | "ota" | "alerts" | "activity";
type SystemCommandKey = "request_status" | "request_telemetry" | "reboot";
type CommandUiState = { status: "idle" | "pending" | "success" | "error"; text?: string };

const SENSOR_ORDER = ["temperature", "humidity", "light", "pressure", "motion"];
const SYSTEM_ORDER = ["rssi", "free_heap", "uptime_ms", "firmware_version", "ip", "ip_address", "mac", "mac_address"];
const METRIC_PREFERENCE = ["temperature", "humidity", "rssi", "free_heap"];

function humanizeKey(key: string): string {
  return key
    .replace(/^sensor_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function metricUnit(metric: string, explicit?: string | null): string | null {
  const key = metric.toLowerCase();
  if (explicit) {
    if (explicit.toLowerCase() === "c") return "°C";
    return explicit;
  }
  if (key.includes("temperature")) return "°C";
  if (key.includes("humidity") || key.includes("moisture")) return "%";
  if (key === "rssi") return "dBm";
  if (key === "free_heap") return "KB";
  if (key === "uptime_ms") return null;
  return null;
}

function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${Number((value / 1_000).toFixed(1))}k`;
  if (abs >= 100) return String(Math.round(value));
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(abs >= 10 ? 1 : 2)));
}

function formatBytesValue(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(Math.abs(value)) / Math.log(1024)), units.length - 1);
  return `${Number((value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1))} ${units[index]}`;
}

function formatDurationMs(value: number): string {
  if (!Number.isFinite(value)) return "-";
  let seconds = Math.max(0, Math.floor(value / 1000));
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  return `${seconds}s`;
}

function formatMetricValue(key: string, value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "boolean") return value ? "ON" : "OFF";
  if (typeof value === "string") return value;
  if (typeof value !== "number" || Number.isNaN(value)) return valueLabel(value);
  const normalized = key.toLowerCase();
  if (normalized === "rssi") return `${Math.round(value)} dBm`;
  if (normalized === "free_heap") return formatBytesValue(value);
  if (normalized === "uptime_ms") return formatDurationMs(value);
  const unit = metricUnit(normalized);
  const label = normalized === "temperature" || normalized === "humidity" ? Number(value.toFixed(1)).toString() : formatCompactNumber(value);
  return unit ? `${label} ${unit}` : label;
}

function sortEntries(entries: Array<[string, unknown]>, order: string[]): Array<[string, unknown]> {
  return [...entries].sort(([a], [b]) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    return a.localeCompare(b);
  });
}

function numericFromPayload(record: Telemetry, key: string): number | null {
  if (record.metric_name === key && Number.isFinite(record.metric_value)) return record.metric_value;
  const raw = record.raw_payload?.[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

function commandErrorMessage(error: unknown, t?: (key: string, fallback: string) => string): string {
  if (error instanceof Error) return error.message;
  return t ? t("devices:detail.command_failed", "Command failed.") : "Command failed.";
}

function syncTone(status: string | null | undefined): "success" | "warning" | "danger" | "neutral" {
  if (status === "synced") return "success";
  if (status === "pending") return "warning";
  if (status === "failed") return "danger";
  return "neutral";
}

function useThrottledValue<T>(value: T, delayMs: number): T {
  const [throttled, setThrottled] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => setThrottled(value), delayMs);
    return () => window.clearTimeout(handle);
  }, [delayMs, value]);

  return throttled;
}

function valueLabel(value: unknown): string {
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "string") return value;
  if (value == null) return "-";
  return JSON.stringify(value);
}

function buildMetricOptions(detail: TenantDeviceDetail): Array<{ key: string; unit: string | null }> {
  const units = new Map<string, string | null>();
  
  // Pre-populate with default common metrics
  const defaults = ["temperature", "humidity", "rssi", "free_heap", "uptime_ms"];
  for (const key of defaults) {
    units.set(key, metricUnit(key));
  }

  for (const record of detail.recent_telemetry) {
    if (Number.isFinite(record.metric_value)) units.set(record.metric_name, metricUnit(record.metric_name, record.unit));
    if (record.raw_payload) {
      for (const [key, value] of Object.entries(record.raw_payload)) {
        if (typeof value === "number" && Number.isFinite(value)) units.set(key, metricUnit(key));
      }
    }
  }
  for (const [key, value] of Object.entries({
    ...detail.live_status.sensor_values,
    ...detail.live_status.system_values,
    ...detail.live_status.latest_payload,
  })) {
    if (typeof value === "number" && Number.isFinite(value)) units.set(key, metricUnit(key));
  }
  return Array.from(units.entries())
    .map(([key, unit]) => ({ key, unit }))
    .sort((a, b) => {
      const ai = METRIC_PREFERENCE.indexOf(a.key);
      const bi = METRIC_PREFERENCE.indexOf(b.key);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.key.localeCompare(b.key);
    });
}

function pickDefaultMetric(options: Array<{ key: string }>): string {
  if (options.length === 0) return "";
  return METRIC_PREFERENCE.find((key) => options.some((item) => item.key === key)) ?? options[0].key;
}

function buildMetricTelemetry(records: Telemetry[], metric: string): Telemetry[] {
  if (!metric) return [];
  const bySample = new Map<string, Telemetry>();
  for (const record of records) {
    const value = numericFromPayload(record, metric);
    if (value == null) continue;
    bySample.set(`${record.timestamp}:${metric}:${value}`, {
      ...record,
      metric_name: metric,
      metric_value: value,
      unit: metricUnit(metric, record.metric_name === metric ? record.unit : null),
    });
  }
  return Array.from(bySample.values()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

function buildMetricStats(records: Telemetry[]): { current: number | null; min: number | null; max: number | null; avg: number | null } {
  const values = records.map((item) => item.metric_value).filter((value) => Number.isFinite(value));
  if (values.length === 0) return { current: null, min: null, max: null, avg: null };
  return {
    current: values[values.length - 1],
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

type OutputRow = {
  key: string;
  gpio_pin: number | null;
  channel: string | null;
  capability_type: string | null;
  desired_value: unknown;
  reported_value: unknown;
  sync_status: string | null;
  updated_at: string | null;
  source: "canonical" | "telemetry";
};

function buildOutputRows(detail: TenantDeviceDetail): OutputRow[] {
  const canonical = detail.device_channel_states ?? detail.channel_states ?? [];
  if (canonical.length > 0) {
    return canonical.map((state, index) => ({
      key: state.id ?? state.channel ?? state.telemetry_state_key ?? `channel-${index}`,
      gpio_pin: state.gpio_pin ?? null,
      channel: state.channel ?? state.capability_key ?? state.telemetry_state_key ?? null,
      capability_type: state.capability_type ?? null,
      desired_value: state.desired_value,
      reported_value: state.reported_value,
      sync_status: state.sync_status ?? "unknown",
      updated_at: state.last_reported_at ?? state.updated_at ?? null,
      source: "canonical",
    }));
  }

  return Object.entries(detail.live_status.output_states).map(([key, reported]) => {
    return {
      key,
      gpio_pin: gpioFromKey(key),
      channel: key,
      capability_type: null,
      desired_value: undefined,
      reported_value: reported,
      sync_status: "unknown",
      updated_at: detail.live_status.last_telemetry_at,
      source: "telemetry",
    };
  });
}

function gpioFromKey(key: string): number | null {
  const match = key.match(/gpio[_-]?(\d+)/i);
  return match ? Number(match[1]) : null;
}

export function ClientDeviceDetail() {
  const { t } = useTranslation(["devices", "common"]);
  const { resolveLink } = useProjectScope();
  const { deviceUid } = useParams<{ deviceUid: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { hasFeature, featuresReady } = useFeature();
  const { user } = useAuth();
  const [tab, setTab] = useState<TabKey>("overview");

  // Real-time device status updates via SSE (supplements 15s polling).
  const streamState = useDeviceStatusStream();
  const [offlineTimeoutValue, setOfflineTimeoutValue] = useState<string>("");
  const [offlineTimeoutMessage, setOfflineTimeoutMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<string>("");
  const [systemCommandStates, setSystemCommandStates] = useState<Partial<Record<SystemCommandKey, CommandUiState>>>({});
  const [confirmRebootOpen, setConfirmRebootOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [confirmGenerateTokenOpen, setConfirmGenerateTokenOpen] = useState(false);

  const generateTokenMut = useMutation({
    mutationFn: async () => {
      if (!deviceUid) throw new Error("Device UID is missing");
      const res = await regenerateDeviceToken(deviceUid);
      return res.auth_token;
    },
    onSuccess: (token) => {
      setNewToken(token);
      setConfirmGenerateTokenOpen(false);
    },
    onError: (error) => {
      alert(error instanceof Error ? error.message : t("devices:detail.failed_to_generate_token", "Failed to generate token"));
    }
  });

  const detailQ = useQuery({
    queryKey: ["client-device-detail", deviceUid],
    queryFn: () => getClientDeviceDetail(deviceUid!),
    enabled: !!deviceUid,
    refetchInterval: 15_000,
  });
  const throttledDetailData = useThrottledValue(detailQ.data, 750);

  const offlineTimeoutMut = useMutation({
    mutationFn: (seconds: number) => {
      if (!deviceUid) {
        throw new Error("Device UID is missing");
      }
      return updateClientDeviceOfflineTimeout(deviceUid, seconds);
    },
    onSuccess: (response) => {
      setOfflineTimeoutValue(String(response.offline_timeout_seconds));
      setOfflineTimeoutMessage({ type: "success", text: t("devices:detail.offline_timeout_updated", "Offline timeout updated.") });
      qc.invalidateQueries({ queryKey: ["client-device-detail", deviceUid] });
    },
    onError: (error: Error) => {
      setOfflineTimeoutMessage({ type: "error", text: error.message });
    },
  });

  const updateDeviceMut = useMutation({
    mutationFn: (data: { name: string; hardware_model: string | null; mac_address: string | null; description: string | null }) => {
      if (!deviceUid) {
        throw new Error("Device UID is missing");
      }
      return updateClientDevice(deviceUid, data);
    },
    onSuccess: () => {
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["client-device-detail", deviceUid] });
      qc.invalidateQueries({ queryKey: ["client-devices"] });
    },
  });

  // Hydrate from server only when the persisted value changes (load / after Save / external update).
  // Do not re-sync on blur — that was wiping unsaved drafts back to the default (e.g. 60).
  useEffect(() => {
    const timeoutSeconds = detailQ.data?.device?.offline_timeout_seconds;
    if (typeof timeoutSeconds === "number") {
      setOfflineTimeoutValue(String(timeoutSeconds));
    }
  }, [detailQ.data?.device?.offline_timeout_seconds]);

  useEffect(() => {
    if (!detailQ.data) return;
    const options = buildMetricOptions(detailQ.data);
    if (options.length === 0) {
      setSelectedMetric("");
      return;
    }
    setSelectedMetric((current) => current && options.some((item) => item.key === current) ? current : pickDefaultMetric(options));
  }, [detailQ.data]);

  if (!featuresReady) {
    return <div className="flex items-center justify-center h-64 text-sm text-slate-500">{t("common:loading", "Loading...")}</div>;
  }
  if (!hasFeature("device_management")) return <FeatureGate featureName="device_management" />;

  if (detailQ.isLoading) {
    return <div className="flex items-center justify-center h-64 text-slate-500 text-sm">{t("devices:detail.loading_device", "Loading device...")}</div>;
  }

  if (detailQ.isError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="text-sm text-red-600">{t("devices:detail.failed_to_load", "Failed to load device details")}</div>
        <button onClick={() => detailQ.refetch()} className="btn-secondary">{t("common:actions.retry", "Retry")}</button>
      </div>
    );
  }

  const detailData = throttledDetailData ?? detailQ.data;
  if (!detailData) {
    return <div className="flex items-center justify-center h-64 text-slate-500 text-sm">{t("devices:detail.device_not_found", "Device not found")}</div>;
  }
  const detail: TenantDeviceDetail = detailData;

  const sensorEntries = sortEntries(Object.entries(detail.live_status.sensor_values), SENSOR_ORDER);
  const systemEntries = sortEntries(Object.entries(detail.live_status.system_values), SYSTEM_ORDER);
  const metricOptions = buildMetricOptions(detail);
  const defaultMetric = pickDefaultMetric(metricOptions);
  const activeMetric = selectedMetric && metricOptions.some((item) => item.key === selectedMetric) ? selectedMetric : defaultMetric;
  const activeMetricMeta = metricOptions.find((item) => item.key === activeMetric);
  const chartTelemetry = buildMetricTelemetry(detail.recent_telemetry, activeMetric);
  const visibleChartTelemetry = chartTelemetry.slice(-80);
  const metricStats = buildMetricStats(visibleChartTelemetry);
  const channelRows = buildOutputRows(detail);
  const realtimeLabel =
    streamState.status === "connected"
      ? t("devices:detail.stream_connected", "Connected")
      : streamState.status === "reconnecting"
        ? t("devices:detail.stream_reconnecting", "Reconnecting")
        : t("devices:detail.stream_disconnected", "Disconnected");
  const realtimeTone = streamState.status === "connected" ? "success" : streamState.status === "reconnecting" ? "warning" : "neutral";
  const projectCount = detail.project_bindings.length;
  const canManageDevice = canManageDevices(user) && detail.device.status !== "deleted";
  const canCreateOta = hasFeature("ota_update") && canManageOta(user) && detail.device.status !== "deleted";
  const canSendDeviceCommands = canSendCommands(user) && detail.can_send_commands && detail.device.status !== "deleted";
  const canAlerts = hasFeature("alert_management");

  async function sendSystemCommand(command: SystemCommandKey, params: Record<string, unknown> = {}) {
    if (!canSendDeviceCommands) return;
    if (command === "reboot" && !detail.can_reboot) return;
    setSystemCommandStates((current) => ({
      ...current,
      [command]: { status: "pending", text: t("devices:detail.sending", "Sending...") },
    }));
    try {
      await sendClientDeviceCommand(detail.device.id, { command, params });
      setSystemCommandStates((current) => ({
        ...current,
        [command]: { status: "success", text: t("devices:detail.accepted", "Accepted") },
      }));
      qc.invalidateQueries({ queryKey: ["client-device-detail", deviceUid] });
      window.setTimeout(() => {
        setSystemCommandStates((current) => ({
          ...current,
          [command]: { status: "idle" },
        }));
      }, 2500);
    } catch (error) {
      setSystemCommandStates((current) => ({
        ...current,
        [command]: { status: "error", text: commandErrorMessage(error, t) },
      }));
    }
  }

  function saveOfflineTimeout() {
    const next = Number.parseInt(offlineTimeoutValue, 10);
    if (!Number.isFinite(next)) {
      setOfflineTimeoutMessage({ type: "error", text: t("devices:detail.offline_timeout_must_be_number", "Offline timeout must be a number.") });
      return;
    }
    if (next < 10 || next > 600) {
      setOfflineTimeoutMessage({ type: "error", text: t("devices:detail.offline_timeout_range_error", "Offline timeout must be between 10 and 600 seconds.") });
      return;
    }
    setOfflineTimeoutMessage(null);
    offlineTimeoutMut.mutate(next);
  }

  const activityItems: TimelineItem[] = detail.activity.map((item) => ({
    id: `${item.kind}-${item.timestamp}-${item.title}`,
    title: item.title,
    description:
      item.kind === "ota"
        ? `${item.detail.firmware_version ?? "Firmware"}${item.detail.progress != null ? ` · ${item.detail.progress}%` : ""}`
        : item.kind === "telemetry"
          ? `${item.detail.metric_value ?? "-"}${item.detail.unit ? ` ${item.detail.unit}` : ""}`
          : item.kind === "alert"
            ? `${item.detail.metric_name ?? item.title}`
            : item.kind === "command"
              ? String(item.detail.command ?? item.status ?? "")
              : item.status ?? "",
    timestamp: formatRelative(item.timestamp),
    tone:
      item.kind === "alert"
        ? severityTone(item.severity === "critical" ? "critical" : "warning")
        : item.kind === "ota"
          ? severityTone(item.status === "failed" ? "warning" : "info")
          : severityTone("info"),
  }));

  return (
    <>
      <div className="mb-4">
        <Link
          to={resolveLink("/devices")}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 dark:hover:bg-surface dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-3 w-3" /> {t("devices:detail.back_to_devices", "Back to devices")}
        </Link>
      </div>

      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <span>{detail.device.name}</span>
            <StatusBadge tone={deviceTone(detail.device.status)} label={detail.device.status} />
          </div>
        }
        subtitle={
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-mono">{detail.device.device_uid}</span>
            {detail.device.hardware_model && <span>• {detail.device.hardware_model}</span>}
            <span>• {projectCount > 0 ? `${projectCount} ${projectCount > 1 ? t("devices:detail.projects_plural", "projects") : t("devices:detail.project_singular", "project")}` : t("devices:detail.no_project_bindings_yet", "No project bindings yet")}</span>
          </div>
        }
        actions={
          <>
            <button onClick={() => detailQ.refetch()} className="btn-secondary">
              <RefreshCw className="h-3.5 w-3.5" /> {t("common:actions.refresh", "Refresh")}
            </button>
            {canManageDevice && (
              <button onClick={() => setEditOpen(true)} className="btn-secondary">
                <Pencil className="h-3.5 w-3.5" /> {t("common:actions.edit", "Edit")}
              </button>
            )}
            {canCreateOta && (
              <button
                onClick={() => navigate(resolveLink("/ota"), { state: { deviceUid: detail.device.device_uid } })}
                className="btn-primary"
              >
                <Rocket className="h-3.5 w-3.5" /> {t("devices:detail.create_ota", "Create OTA")}
              </button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4 mb-6">
        <StatCard label={t("devices:detail.firmware", "Firmware")} value={<FirmwareVersionBadge version={detail.device.firmware_version} />} />
        <StatCard label={t("devices:detail.last_seen", "Hoạt động lần cuối")} value={detail.device.last_seen_at ? formatRelative(detail.device.last_seen_at) : t("devices:detail.never_online", "Chưa từng online")} hint={detail.device.last_seen_at ? formatDateTime(detail.device.last_seen_at) : t("devices:detail.no_info", "Chưa có thông tin")} />
        <StatCard label={t("devices:detail.last_telemetry", "Telemetry lần cuối")} value={detail.live_status.last_telemetry_at ? formatRelative(detail.live_status.last_telemetry_at) : t("devices:detail.no_data", "Chưa có dữ liệu")} hint={detail.live_status.last_telemetry_at ? formatDateTime(detail.live_status.last_telemetry_at) : t("devices:detail.no_info", "Chưa có thông tin")} />
        <StatCard label={t("devices:detail.connection", "Kết nối")} value={detail.live_status.connection_status ?? detail.device.status} />
        <StatCard label={t("devices:detail.projects", "Dự án")} value={projectCount ? String(projectCount) : t("common:actions.none", "Không có")} />
        <StatCard label={t("devices:detail.alerts", "Cảnh báo")} value={String(detail.alerts.length)} />
      </div>

      <Tabs
        tabs={[
          { key: "overview", label: <span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> {t("devices:detail.overview", "Overview")}</span> },
          { key: "ota", label: <span className="inline-flex items-center gap-1.5"><Rocket className="h-3.5 w-3.5" /> {t("devices:detail.ota", "OTA")}</span> },
          { key: "alerts", label: <span className="inline-flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5" /> {t("devices:detail.alerts_tab", "Alerts")}</span> },
          { key: "activity", label: <span className="inline-flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> {t("devices:detail.activity", "Activity")}</span> },
        ]}
        active={tab}
        onChange={(key) => setTab(key as TabKey)}
        className="mb-5 rounded-xl border border-slate-200 bg-white px-3 pt-1 shadow-sm dark:border-border-subtle dark:bg-surface"
      />

      {tab === "overview" && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("devices:detail.device_info", "Device information")}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <Row label={t("devices:detail.name", "Name")} value={detail.device.name} />
              <Row label={t("devices:detail.device_uid", "Device UID")} value={<span className="font-mono text-xs">{detail.device.device_uid}</span>} />
              <Row label={t("devices:detail.hardware_model", "Hardware model")} value={detail.device.hardware_model ?? t("common:not_updated", "Chưa cập nhật")} />
              <Row label={t("devices:detail.description", "Description")} value={detail.device.description ?? t("common:not_updated", "Chưa cập nhật")} />
              <Row label={t("devices:detail.status", "Status")} value={<StatusBadge tone={deviceTone(detail.device.status)} label={detail.device.status} />} />
              <Row label={t("devices:detail.last_seen_label", "Last seen")} value={detail.device.last_seen_at ? formatRelative(detail.device.last_seen_at) : t("devices:detail.never_online", "Chưa từng online")} hint={detail.device.last_seen_at ? formatDateTime(detail.device.last_seen_at) : t("devices:detail.no_info", "Chưa có thông tin")} />
              <div className="rounded-xl border border-slate-200 dark:border-border-subtle p-3 space-y-2">
                <div className="text-xs font-medium text-slate-600 dark:text-text-secondary">{t("devices:detail.offline_timeout", "Offline timeout")}</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={10}
                    max={600}
                    step={1}
                    className="input h-8 w-28"
                    value={offlineTimeoutValue}
                    onChange={(event) => setOfflineTimeoutValue(event.target.value)}
                    disabled={!canManageDevice || offlineTimeoutMut.isPending}
                  />
                  <span className="text-xs text-slate-500">{t("devices:detail.seconds", "seconds")}</span>
                  {canManageDevice && (
                    <button className="btn-secondary h-8 text-xs" onClick={saveOfflineTimeout} disabled={offlineTimeoutMut.isPending}>
                      {t("common:actions.save", "Save")}
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  {t("devices:detail.offline_timeout_hint", "If the device does not send heartbeat or telemetry within this time, it will be marked offline.")}
                </div>
                {offlineTimeoutMessage && (
                  <div className={`text-xs ${offlineTimeoutMessage.type === "success" ? "text-emerald-600" : "text-rose-600"}`}>
                    {offlineTimeoutMessage.text}
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-border-subtle p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-slate-600 dark:text-text-secondary">{t("devices:detail.auth_token", "Authentication Token")}</div>
                  {canManageDevice && (
                    <button className="btn-secondary h-8 text-xs" onClick={() => setConfirmGenerateTokenOpen(true)}>
                      <KeyRound className="h-3.5 w-3.5" />
                      {t("devices:detail.generate_new_token", "Generate New Token")}
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">
                  {t("devices:detail.auth_token_hint", "If you lost your device authentication token, you can generate a new one. The old token will be invalidated immediately.")}
                </div>
              </div>
              <Row
                label={t("devices:detail.projects_label", "Projects")}
                value={
                  projectCount > 0
                    ? detail.project_bindings.map((item) => item.project_name).join(", ")
                    : t("devices:detail.not_bound_to_project_yet", "Not bound to a project yet")
                }
              />
            </CardBody>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{t("devices:detail.live_status", "Live status")}</CardTitle>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={deviceTone(detail.device.status)} label={detail.device.status} />
                  <StatusBadge tone={realtimeTone} label={`Realtime: ${realtimeLabel}`} />
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-border-subtle dark:bg-app/40 dark:text-text-secondary">
                <div className="inline-flex items-center gap-1.5 font-medium">
                  {streamState.status === "connected" ? <Signal className="h-3.5 w-3.5 text-emerald-500" /> : <WifiOff className="h-3.5 w-3.5 text-slate-400" />}
                  {t("devices:detail.source", "Source:")} {streamState.source}
                </div>
                <div className="mt-1 text-slate-500">
                  {t("devices:detail.last_event", "Last event:")} {streamState.lastEventAt ? formatRelative(streamState.lastEventAt) : t("devices:detail.no_stream_event_yet", "No stream event yet")}
                </div>
                <div className="mt-1 text-slate-500">
                  {t("devices:detail.device_link", "Device link:")} {detail.live_status.mqtt_status ?? detail.live_status.connection_status ?? detail.device.status}
                </div>
              </div>
            </CardHeader>
            <CardBody className="space-y-4">
              {metricOptions.length > 0 && activeMetric ? (
                <div className="rounded-2xl border border-slate-200 dark:border-border-subtle p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-slate-500">{t("devices:detail.realtime_metric", "Realtime metric")}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <select
                          className="input h-9 min-w-48 sm:w-auto"
                          value={activeMetric}
                          onChange={(event) => setSelectedMetric(event.target.value)}
                        >
                          {metricOptions.map((metric) => (
                            <option key={metric.key} value={metric.key}>
                              {humanizeKey(metric.key)}
                            </option>
                          ))}
                        </select>
                        {activeMetricMeta?.unit && <span className="chip bg-slate-100 text-slate-600 dark:bg-surface-elevated dark:text-text-secondary">{activeMetricMeta.unit}</span>}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <MetricStat label={t("devices:detail.stat_current", "Current")} value={metricStats.current == null ? "-" : formatMetricValue(activeMetric, metricStats.current)} />
                      <MetricStat label={t("devices:detail.stat_min", "Min")} value={metricStats.min == null ? "-" : formatMetricValue(activeMetric, metricStats.min)} />
                      <MetricStat label={t("devices:detail.stat_max", "Max")} value={metricStats.max == null ? "-" : formatMetricValue(activeMetric, metricStats.max)} />
                      <MetricStat label={t("devices:detail.stat_avg", "Avg")} value={metricStats.avg == null ? "-" : formatMetricValue(activeMetric, metricStats.avg)} />
                    </div>
                  </div>
                  <div className="mt-4 min-w-0">
                    {visibleChartTelemetry.length > 0 ? (
                      <TelemetryChart
                        data={visibleChartTelemetry}
                        height={240}
                        metricName={humanizeKey(activeMetric)}
                        unit={null}
                        valueFormatter={(value) => formatMetricValue(activeMetric, value)}
                        yTickFormatter={(value) => activeMetric === "rssi" ? `${Math.round(value)}` : activeMetric === "free_heap" ? formatCompactNumber(value) : formatCompactNumber(value)}
                      />
                    ) : (
                      <EmptyState
                        icon={<Gauge className="h-5 w-5" />}
                        title={t("devices:detail.no_samples_title", "No samples for this metric")}
                        description={t("devices:detail.no_samples_desc", "Waiting for telemetry points that include this numeric field.")}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<Gauge className="h-5 w-5" />}
                  title={t("devices:detail.no_telemetry_title", "No telemetry samples yet")}
                  description={t("devices:detail.no_telemetry_desc", "Waiting for numeric telemetry from this device.")}
                  hint={t("devices:detail.no_telemetry_hint", "Use Request telemetry to ask the device to publish its latest values.")}
                />
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <KeyValueList
                  title={t("devices:detail.sensor_values", "Sensor values")}
                  icon={<Thermometer className="h-4 w-4 text-slate-400" />}
                  items={sensorEntries}
                  emptyTitle={t("devices:detail.no_sensor_data_title", "No sensor data received")}
                  emptyBody={t("devices:detail.no_sensor_data_body", "Waiting for telemetry from this device...")}
                  emptyHint={t("devices:detail.no_sensor_data_hint", "Use Request telemetry to ask the device to publish its latest values.")}
                />
                <OutputStatesCard rows={channelRows} />
                <KeyValueList
                  title={t("devices:detail.system_values", "System values")}
                  icon={<Cpu className="h-4 w-4 text-slate-400" />}
                  items={systemEntries}
                  emptyTitle={t("devices:detail.no_system_values_title", "No system values reported")}
                  emptyBody={t("devices:detail.no_system_values_body", "Status payloads have not included RSSI, heap, uptime, firmware, IP, or MAC values yet.")}
                />
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-border-subtle p-3">
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{t("devices:detail.device_commands", "Device commands")}</div>
                {canSendDeviceCommands && (
                  <div className="flex flex-wrap gap-2">
                    <CommandButton
                      label={t("devices:detail.cmd_request_status", "Request status")}
                      state={systemCommandStates.request_status}
                      onClick={() => sendSystemCommand("request_status")}
                    />
                    <CommandButton
                      label={t("devices:detail.cmd_request_telemetry", "Request telemetry")}
                      state={systemCommandStates.request_telemetry}
                      onClick={() => sendSystemCommand("request_telemetry")}
                    />
                    {detail.can_reboot && (
                      <CommandButton
                        label={t("devices:detail.cmd_reboot_device", "Reboot device")}
                        state={systemCommandStates.reboot}
                        onClick={() => setConfirmRebootOpen(true)}
                        destructive
                      />
                    )}
                  </div>
                )}
                {!canSendDeviceCommands && <div className="text-xs text-slate-500">{t("devices:detail.no_permission_commands", "Bạn không có quyền gửi lệnh thiết bị.")}</div>}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("devices:detail.available_firmware", "Available firmware")}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {detail.available_firmware.length === 0 && (
                <div className="text-sm text-slate-500">{t("devices:detail.no_matching_firmware", "No tenant-accessible firmware matched this device yet.")}</div>
              )}
              {detail.available_firmware.slice(0, 6).map((firmware) => (
                <div key={firmware.id} className="rounded-xl border border-slate-200 dark:border-border-subtle px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <FirmwareVersionBadge version={firmware.version} />
                    <span className="text-xs text-slate-500">{firmware.target_device_type}</span>
                  </div>
                  {firmware.release_notes && <p className="mt-2 text-xs text-slate-500">{firmware.release_notes}</p>}
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      )}

      {tab === "ota" && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle>{t("devices:detail.firmware_ota_title", "Firmware and OTA")}</CardTitle>
            {canCreateOta && (
              <button
                onClick={() => navigate(resolveLink("/ota"), { state: { deviceUid: detail.device.device_uid } })}
                className="btn-primary text-sm"
              >
                <Rocket className="h-3.5 w-3.5" /> {t("devices:detail.new_ota_campaign", "New OTA campaign")}
              </button>
            )}
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-border-subtle px-4 py-3">
              <div className="text-xs text-slate-500 mb-1">{t("devices:detail.current_firmware", "Current firmware")}</div>
              <FirmwareVersionBadge version={detail.device.firmware_version} />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="text-left px-2 py-2 font-medium">{t("devices:detail.col_firmware", "Firmware")}</th>
                    <th className="text-left px-2 py-2 font-medium">{t("devices:detail.col_status", "Status")}</th>
                    <th className="text-left px-2 py-2 font-medium">{t("devices:detail.col_requested", "Requested")}</th>
                    <th className="text-left px-2 py-2 font-medium">{t("devices:detail.col_progress", "Progress")}</th>
                    <th className="text-left px-2 py-2 font-medium">{t("devices:detail.col_last_update", "Last update")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.ota_jobs.map((job) => {
                    const isTerminal = ["success", "completed", "failed", "cancelled", "rolled_back"].includes(job.status.toLowerCase());
                    const timedOut = !isTerminal && (Date.now() - new Date(job.requested_at).getTime() > 180_000);
                    const displayStatus = timedOut ? "timeout" : job.status;
                    const displayProgress = timedOut ? t("devices:detail.timeout_status", "Hết hạn") : (job.progress != null ? `${job.progress}%` : "-");
                    return (
                      <tr key={job.id} className="border-t border-slate-100 dark:border-border-subtle">
                        <td className="px-2 py-2"><FirmwareVersionBadge version={job.firmware_version} /></td>
                        <td className="px-2 py-2"><StatusBadge tone={otaTone(displayStatus)} label={displayStatus} /></td>
                        <td className="px-2 py-2 text-xs text-slate-500">{formatDateTime(job.requested_at)}</td>
                        <td className={`px-2 py-2 ${timedOut ? "text-rose-500 font-semibold" : ""}`}>{displayProgress}</td>
                        <td className="px-2 py-2 text-xs text-slate-500">{formatDateTime(job.updated_at)}</td>
                      </tr>
                    );
                  })}
                  {detail.ota_jobs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                        {t("devices:detail.no_ota_jobs", "No OTA jobs have been created for this device yet.")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {tab === "alerts" && (
        <div className="grid grid-cols-1 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("devices:detail.recent_alerts", "Recent alerts")}</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              {!canAlerts ? (
                <FeatureGate featureName="alert_management" />
              ) : detail.alerts.length === 0 ? (
                <div className="text-sm text-slate-500">{t("devices:detail.no_alerts_device", "No alerts for this device.")}</div>
              ) : (
                detail.alerts.map((alert) => (
                  <div key={alert.id} className="rounded-2xl border border-slate-200 dark:border-border-subtle px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{alert.title ?? alert.metric_name}</div>
                        <div className="text-xs text-slate-500">
                          {alert.message ?? `${valueLabel(alert.metric_value)}`}
                        </div>
                      </div>
                      <StatusBadge tone={severityTone(alert.severity)} label={alert.severity} />
                    </div>
                    <div className="mt-2 text-xs text-slate-500">{formatDateTime(alert.timestamp)}</div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>

        </div>
      )}

      {tab === "activity" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("devices:detail.recent_activity_timeline", "Recent activity timeline")}</CardTitle>
          </CardHeader>
          <CardBody>
            {activityItems.length === 0 ? (
              <div className="text-sm text-slate-500">{t("devices:detail.no_recent_activity", "No recent activity captured for this device.")}</div>
            ) : (
              <Timeline items={activityItems} />
            )}
          </CardBody>
        </Card>
      )}

      <div id="device-modals">
        <ConfirmDialog
          open={confirmRebootOpen}
          title={t("devices:detail.reboot_modal_title", "Reboot device?")}
          description={
            <div className="space-y-2">
              <p>
                {t("devices:detail.reboot_modal_desc1", "This will send a reboot command to")} <span className="font-mono">{detail.device.device_uid}</span>.
              </p>
              <p className="text-xs text-slate-500">{t("devices:detail.reboot_modal_desc2", "The device may disconnect briefly while ESP32 restarts.")}</p>
            </div>
          }
          confirmLabel={t("devices:detail.reboot_confirm_label", "Reboot device")}
          destructive
          loading={systemCommandStates.reboot?.status === "pending"}
          onCancel={() => setConfirmRebootOpen(false)}
          onConfirm={() => {
            setConfirmRebootOpen(false);
            sendSystemCommand("reboot");
          }}
        />
        <DeviceEditModal
          open={editOpen}
          device={detail.device}
          loading={updateDeviceMut.isPending}
          error={updateDeviceMut.isError ? updateDeviceMut.error.message : null}
          onClose={() => {
            if (!updateDeviceMut.isPending) setEditOpen(false);
          }}
          onSubmit={(data) => updateDeviceMut.mutate(data)}
        />

        {confirmGenerateTokenOpen && (
          <ConfirmDialog
            open={true}
            title={t("devices:detail.token_modal_title", "Generate New Token?")}
            description={
              <div className="space-y-2 text-sm text-slate-600">
                <p>
                  {t("devices:detail.token_modal_desc1", "Generating a new token will")} <strong>{t("devices:detail.token_modal_desc2", "immediately invalidate")}</strong> {t("devices:detail.token_modal_desc3", "the current token for this device.")}
                </p>
                <p>{t("devices:detail.token_modal_desc4", "The device will need the new token to authenticate with the platform.")}</p>
                <p className="font-semibold text-rose-600">{t("devices:detail.token_modal_desc5", "This action cannot be undone.")}</p>
              </div>
            }
            confirmLabel={t("devices:detail.token_confirm_label", "Generate New Token")}
            destructive
            loading={generateTokenMut.isPending}
            onCancel={() => setConfirmGenerateTokenOpen(false)}
            onConfirm={() => generateTokenMut.mutate()}
          />
        )}

        {newToken !== null && (
          <Modal
            open={true}
            onClose={() => setNewToken(null)}
            title={t("devices:detail.new_token_title", "New Authentication Token")}
            footer={
              <button className="btn-primary w-full" onClick={() => setNewToken(null)}>
                {t("devices:detail.copied_token_btn", "I have copied the token")}
              </button>
            }
          >
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                <div className="font-semibold mb-1">{t("devices:detail.important_copy_token", "Important: Copy this token now.")}</div>
                {t("devices:detail.token_security_note", "For security reasons, this token is only shown once. We do not store it in our database.")}
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("devices:detail.auth_token_label", "Authentication Token")}</label>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    className="input font-mono flex-1"
                    value={newToken || ""}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    className="btn-secondary whitespace-nowrap"
                    onClick={() => {
                      if (newToken) {
                        navigator.clipboard.writeText(newToken);
                      }
                    }}
                  >
                    {t("common:actions.copy", "Copy")}
                  </button>
                </div>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string | null;
}) {
  return (
    <Card>
      <CardBody>
        <div className="text-xs text-slate-500 mb-1">{label}</div>
        <div className="text-sm font-medium">{value}</div>
        {hint && <div className="text-[11px] text-slate-500 mt-1">{hint}</div>}
      </CardBody>
    </Card>
  );
}

function Row({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string | null;
}) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-slate-500 text-xs">{label}</span>
      <div className="text-right">
        <div>{value}</div>
        {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
      </div>
    </div>
  );
}

function MetricStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 text-right dark:bg-app/50">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-medium text-slate-800 dark:text-text-primary">{value}</div>
    </div>
  );
}

function KeyValueList({
  title,
  icon,
  items,
  emptyTitle,
  emptyBody,
  emptyHint,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<[string, unknown]>;
  emptyTitle: string;
  emptyBody: string;
  emptyHint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-border-subtle p-4 min-w-0">
      <div className="flex items-center gap-2 text-sm font-medium mb-3">
        {icon}
        {title}
      </div>
      {items.length === 0 ? (
        <EmptyState icon={icon} title={emptyTitle} description={emptyBody} hint={emptyHint} compact />
      ) : (
        <div className="space-y-2">
          {items.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate text-slate-500" title={key}>{humanizeKey(key)}</span>
              <span className="font-mono text-right text-slate-800 dark:text-text-primary">{formatMetricValue(key, value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OutputStatesCard({ rows }: { rows: OutputRow[] }) {
  const { t } = useTranslation(["devices", "common"]);
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-border-subtle p-4 min-w-0">
      <div className="flex items-center gap-2 text-sm font-medium mb-3">
        <PlugZap className="h-4 w-4 text-slate-400" />
        {t("devices:detail.output_states", "Output states")}
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<Settings2 className="h-4 w-4" />}
          title={t("devices:detail.no_output_state_title", "No GPIO/output state reported")}
          description={t("devices:detail.no_output_state_desc", "No canonical channel state or telemetry-reported output state is available yet.")}
          hint={t("devices:detail.no_output_state_hint", "Send Request status to refresh output states.")}
          compact
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.key} className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-3 dark:border-border-subtle dark:bg-app/40">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-900 dark:text-text-primary">
                    {row.gpio_pin != null ? `GPIO ${row.gpio_pin}` : humanizeKey(row.channel ?? row.key)}
                    {row.capability_type ? <span className="text-slate-500"> · {humanizeKey(row.capability_type)}</span> : null}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-500">{row.channel ?? row.key}</div>
                </div>
                <StatusBadge tone={syncTone(row.sync_status)} label={row.sync_status ?? "unknown"} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <OutputField label={t("devices:detail.desired", "Desired")} value={row.desired_value === undefined ? t("devices:detail.unknown", "Unknown") : valueLabel(row.desired_value)} />
                <OutputField label={t("devices:detail.reported", "Reported")} value={valueLabel(row.reported_value)} strong />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <span>{row.source === "canonical" ? t("devices:detail.backend_channel_state", "Backend channel state") : t("devices:detail.telemetry_reported", "Telemetry reported")}</span>
                <span>{t("devices:detail.updated", "Updated:")} {formatRelative(row.updated_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OutputField({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-white px-2 py-1.5 dark:bg-surface">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono ${strong ? "font-semibold text-slate-900 dark:text-text-primary" : "text-slate-700 dark:text-text-secondary"}`}>{value}</div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  hint,
  compact,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  hint?: string;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center dark:border-border-subtle dark:bg-app/40 ${compact ? "px-3 py-4" : "px-4 py-8"}`}>
      <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm dark:bg-surface">
        {icon}
      </div>
      <div className="text-sm font-medium text-slate-700 dark:text-text-secondary">{title}</div>
      {description && <div className="mt-1 text-xs text-slate-500">{description}</div>}
      {hint && <div className="mt-2 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
}

function CommandButton({
  label,
  state,
  onClick,
  destructive,
}: {
  label: string;
  state?: CommandUiState;
  onClick: () => void;
  destructive?: boolean;
}) {
  const pending = state?.status === "pending";
  const success = state?.status === "success";
  const error = state?.status === "error";
  return (
    <div className="flex flex-col gap-1">
      <button className={destructive ? "btn-secondary text-sm text-rose-700 dark:text-rose-300" : "btn-secondary text-sm"} onClick={onClick} disabled={pending}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : success ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : error ? <XCircle className="h-3.5 w-3.5 text-rose-500" /> : <Satellite className="h-3.5 w-3.5" />}
        {label}
      </button>
      {state?.text && state.status !== "idle" && (
        <span className={`text-[11px] ${error ? "text-rose-600" : success ? "text-emerald-600" : "text-slate-500"}`}>
          {state.text}
        </span>
      )}
    </div>
  );
}
