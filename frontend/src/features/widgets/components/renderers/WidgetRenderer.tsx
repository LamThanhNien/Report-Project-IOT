import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { LegendPayload } from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  MoreVertical,
  Settings2,
  Trash2,
  WifiOff,
  Zap,
} from "lucide-react";
import { createPortal } from "react-dom";
import { cn } from "../../../../lib/cn";
import { usePersistedState } from "../../../../hooks/usePersistedState";
import { getClientDeviceTelemetry } from "../../../../services/clientApi";
import type { TelemetryAggregatedResponse } from "../../../../services/clientApi";
import { listDatastreams } from "../../../../services/datastreamApi";
import type { Telemetry } from "../../../../types";
import type { WidgetRenderProps, WidgetCommandRequest, WidgetRuntimeState } from "../../types";
import type { ProjectWidget } from "../../../../types";
import type { Device } from "../../../../types";
import { useDragPerformanceMode } from "../../dragPerformanceContext";
import { useConfirm } from "../../../../contexts/ConfirmContext";
import { normalizeBoolean, normalizeCommandParams, normalizeNumber, parseOptionValue, stateFieldForBinding } from "../../utils/widgetBindings";

type RechartsModule = typeof import("recharts");
let rechartsPromise: Promise<RechartsModule> | null = null;

function loadRecharts(): Promise<RechartsModule> {
  rechartsPromise ??= import("recharts");
  return rechartsPromise;
}

function useRecharts(enabled: boolean): RechartsModule | null {
  const [module, setModule] = useState<RechartsModule | null>(null);
  useEffect(() => {
    if (!enabled || module) return;
    let active = true;
    void loadRecharts().then((loaded) => {
      if (active) setModule(loaded);
    });
    return () => { active = false; };
  }, [enabled, module]);
  return module;
}

function formatValue(value: unknown, config: Record<string, unknown>): string {
  if (value == null || value === "") return "--";
  const prefix = String(config.prefix ?? "");
  const suffix = String(config.suffix ?? "");
  const unit = String(config.unit ?? "");
  const decimals = typeof config.decimalPlaces === "number" ? config.decimalPlaces : 2;
  const numeric = normalizeNumber(value);
  if (numeric !== null) {
    return `${prefix}${numeric.toFixed(decimals)}${suffix}${unit ? ` ${unit}` : ""}`;
  }
  return `${prefix}${String(value)}${suffix}`;
}

// ─── Status badge ──────────────────────────────────────────────────────────────

type StatusLevel = WidgetRenderProps["visualState"]["status"];

function statusDot(status: StatusLevel): string {
  if (status === "offline") return "bg-amber-400";
  if (status === "stale") return "bg-slate-400";
  if (status === "error") return "bg-rose-500";
  if (status === "online") return "bg-emerald-400";
  return "bg-slate-400";
}

function statusLabel(status: StatusLevel, message?: string | null): string {
  if (message) return message;
  if (status === "offline") return "Offline";
  if (status === "stale") return "No data";
  if (status === "error") return "Error";
  return "Live";
}

function WidgetStatusDot({ status, message }: WidgetRenderProps["visualState"]) {
  const isOnline = status === "online";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(
        "h-1.5 w-1.5 rounded-full shrink-0",
        statusDot(status),
        isOnline && "animate-pulse-dot",
      )} />
      <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-slate-400 dark:text-text-muted">
        {statusLabel(status, message)}
      </span>
    </span>
  );
}

// ─── Telemetry helpers ─────────────────────────────────────────────────────────

type TimeRange = "live" | "6h" | "1d" | "1w" | "1m";
type Aggregate = "avg" | "min" | "max";

// The backend's raw live query is consolidated into five-second buckets.
const LIVE_BUCKET_DURATION_MS = 5_000;

/** Blynk-style label shown next to each Time Range button */
const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  live: "Live",
  "6h": "6h",
  "1d": "1d",
  "1w": "1w",
  "1m": "1m",
};

export function resolveTimeRange(value: unknown): TimeRange {
  switch (String(value ?? "").trim().toLowerCase()) {
    case "live":
    case "15m":
    case "15min":
      return "live";
    case "6h":
    case "1h":
      return "6h";
    case "1d":
    case "24h":
      return "1d";
    case "1w":
    case "7d":
      return "1w";
    case "1m":
    case "30d":
      return "1m";
    default:
      return "live";
  }
}

const TIME_RANGE_DURATIONS_MS: Record<Exclude<TimeRange, "live">, number> = {
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1m": 30 * 24 * 60 * 60 * 1000,
};

export function timeRangeDurationMs(timeRange: TimeRange): number | null {
  return timeRange === "live" ? null : TIME_RANGE_DURATIONS_MS[timeRange];
}

function isAggregatedResponse(v: unknown): v is TelemetryAggregatedResponse {
  return typeof v === "object" && v !== null && "aggregated" in v && "data" in v;
}

function telemetryPointLimit(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1000, Math.max(10, Math.floor(numeric))) : 60;
}

function useTelemetrySeries(
  widget: WidgetRenderProps["widget"],
  timeRange: TimeRange,
  aggregate: Aggregate,
  paused = false,
) {
  const binding = widget.binding ?? {};
  const deviceUid = String(binding.device_uid ?? "");
  let metricName = String(binding.telemetry_field ?? binding.feedback_key ?? binding.state_key ?? "");
  
  // Fallback for older widgets that were configured without telemetry_field/feedback_key/state_key
  if (!metricName && binding.binding_type === "virtual" && binding.channel) {
    const chan = String(binding.channel);
    metricName = chan.startsWith("ch_") ? chan : `ch_${chan}`;
  }

  const isLive = timeRange === "live";
  const defaultInterval = isLive ? 5_000 : 15_000;
  const userInterval = typeof widget.config.refreshIntervalSeconds === "number"
    ? Math.max(3_000, Number(widget.config.refreshIntervalSeconds) * 1000)
    : defaultInterval;
  const limit = telemetryPointLimit(widget.config.maxDataPoints);
  const liveWindow = isLive ? (() => {
    const to = new Date();
    const from = new Date(to.getTime() - limit * LIVE_BUCKET_DURATION_MS);
    return { from_time: from.toISOString(), to_time: to.toISOString() };
  })() : {};

  return useQuery({
    queryKey: ["widget-telemetry", widget.id, deviceUid, metricName, timeRange, aggregate],
    queryFn: () => getClientDeviceTelemetry(deviceUid, {
      metric_name: metricName,
      time_range: timeRange,
      aggregate,
      limit,
      ...liveWindow,
    }),
    enabled: !!deviceUid && !!metricName && !paused,
    refetchInterval: userInterval,
    placeholderData: (prev) => prev,
  });
}

function useMultiTelemetrySeries(
  widget: WidgetRenderProps["widget"],
  timeRange: TimeRange,
  aggregate: Aggregate,
  paused = false,
) {
  const binding = widget.binding ?? {};
  const deviceUid = String(binding.device_uid ?? "");
  const channels = Array.isArray(binding.channels) ? binding.channels : [];
  
  const isLive = timeRange === "live";
  const defaultInterval = isLive ? 5_000 : 15_000;
  const userInterval = typeof widget.config.refreshIntervalSeconds === "number"
    ? Math.max(3_000, Number(widget.config.refreshIntervalSeconds) * 1000)
    : defaultInterval;
  const limit = telemetryPointLimit(widget.config.maxDataPoints);
  // Compute this once per render so every channel in this request cycle uses
  // exactly the same time window.
  const liveWindow = isLive ? (() => {
    const to = new Date();
    const from = new Date(to.getTime() - limit * LIVE_BUCKET_DURATION_MS);
    return { from_time: from.toISOString(), to_time: to.toISOString() };
  })() : {};

  const queries = useQueries({
    queries: channels.map(chan => ({
      queryKey: ["widget-telemetry-multi", widget.id, deviceUid, chan, timeRange, aggregate],
      queryFn: () => getClientDeviceTelemetry(deviceUid, {
        metric_name: chan,
        time_range: timeRange,
        aggregate,
        limit,
        ...liveWindow,
      }),
      enabled: !!deviceUid && !!chan && !paused,
      refetchInterval: userInterval,
      placeholderData: (prev: unknown) => prev,
    }))
  });
  
  const isLoading = queries.some(q => q.isLoading);
  const isError = queries.some(q => q.isError);
  
  return {
    isLoading,
    isError,
    queries,
  };
}


/**
 * Format a UTC timestamp for display on the X-axis.
 * The granularity matches the bucket size of the active time range:
 *   - live (no range)  → HH:MM:SS  (seconds visible in real-time stream)
 *   - 6h  (1-min bucket) → HH:MM
 *   - 1d  (5-min bucket) → HH:MM
 *   - 1w  (1-hr bucket)  → ddd HH:MM  e.g. "Mon 14:00"
 *   - 1m  (1-day bucket) → MMM DD      e.g. "Jul 20"
 */
function formatTsLabel(ts: number, timeRange: TimeRange | null): string {
  const d = new Date(ts);
  if (timeRange === "1m") {
    // Day-level granularity — show month + day
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  if (timeRange === "1w") {
    // Hour-level granularity — show abbreviated weekday + HH:MM (no seconds)
    const dayAbbr = d.toLocaleDateString([], { weekday: "short" });
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    return `${dayAbbr} ${timeStr}`;
  }
  if (timeRange === "6h" || timeRange === "1d") {
    // Minute-level granularity — HH:MM (no seconds)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  // Live stream — show full HH:MM:SS
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/**
 * Estimated pixel width for a label produced by formatTsLabel for the given time range.
 * Used by xAxisTicks to compute how many ticks fit without overlapping.
 */
function labelPxEstimate(timeRange: TimeRange | null): number {
  if (timeRange === "1m") return 44;   // "Jul 20" ≈ 44px
  if (timeRange === "1w") return 82;   // "Mon 14:00" ≈ 82px
  if (timeRange === "6h" || timeRange === "1d") return 42; // "14:25" ≈ 42px
  return 72; // "10:24:18 PM" ≈ 72px (live stream with AM/PM)
}

function axisTickIndices(count: number, containerWidth: number, timeRange: TimeRange, compact: boolean): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];

  const gap = compact ? 8 : 10;
  const maxTicks = Math.max(2, Math.min(10, Math.floor(containerWidth / (labelPxEstimate(timeRange) + gap))));
  const tickCount = Math.min(count, maxTicks);
  if (tickCount >= count) return Array.from({ length: count }, (_, index) => index);
  if (tickCount === 2) return [0, count - 1];

  const indices: number[] = [];
  for (let index = 0; index < tickCount; index += 1) {
    const next = Math.round((index * (count - 1)) / (tickCount - 1));
    if (indices[indices.length - 1] !== next) indices.push(next);
  }
  return indices;
}

export function timeRangeAxisTicks(
  timeRange: TimeRange,
  containerWidth: number,
  compact: boolean,
  endTs = Date.now(),
): number[] {
  const duration = timeRangeDurationMs(timeRange);
  if (duration === null) return [];

  const gap = compact ? 8 : 10;
  const maxTicks = Math.max(2, Math.min(10, Math.floor(containerWidth / (labelPxEstimate(timeRange) + gap))));
  const tickCount = Math.max(2, maxTicks);
  const startTs = endTs - duration;

  return Array.from({ length: tickCount }, (_, index) => (
    startTs + (duration * index) / (tickCount - 1)
  ));
}

/**
 * Bucket-merge tolerance in milliseconds for mapMultiTelemetry.
 * Two points from different channels are merged into the same bucket if they
 * are within this window of each other.
 */
function multiTolerance(timeRange: TimeRange | null): number {
  if (timeRange === "1m") return 12 * 60 * 60 * 1000; // ±12 h within a 1-day bucket
  if (timeRange === "1w") return 30 * 60 * 1000;        // ±30 min within a 1-hour bucket
  if (timeRange === "1d") return 2.5 * 60 * 1000;       // ±2.5 min within a 5-min bucket
  if (timeRange === "6h") return 30 * 1000;              // ±30 s within a 1-min bucket
  return 500;                                             // ±500 ms for live stream
}

function mapTelemetry(data: Telemetry[], timeRange: TimeRange | null = null) {
  return [...data]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((item) => {
      const ts = new Date(item.timestamp).getTime();
      const d = new Date(ts);
      return {
        ts,
        label: formatTsLabel(ts, timeRange),
        // Full datetime string for tooltip display — always shows date + time regardless of range
        fullLabel: d.toLocaleDateString([], { month: "short", day: "numeric" })
          + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        value: item.metric_value,
        name: item.metric_name,
      };
    });
}

interface TelemetryBucket {
  ts: number;
  label: string;
  fullLabel: string;
  [key: string]: unknown;
}

export function mapMultiTelemetry(queriesData: Telemetry[][], channels: string[], timeRange: TimeRange | null = null) {
  const allPoints: { ts: number; name: string; value: number }[] = [];
  queriesData.forEach((data, channelIndex) => {
    // The API request itself identifies the channel. Prefer that stable key
    // over a backend metric label, which may be normalized for display.
    const channel = channels[channelIndex];
    data.forEach((item) => {
      const ts = new Date(item.timestamp).getTime();
      if (!isNaN(ts) && item.metric_value !== null && item.metric_value !== undefined) {
        allPoints.push({
          ts,
          name: channel || item.metric_name,
          value: item.metric_value,
        });
      }
    });
  });

  allPoints.sort((a, b) => a.ts - b.ts);

  const tolerance = multiTolerance(timeRange);
  const buckets: TelemetryBucket[] = [];

  allPoints.forEach((point) => {
    let matchedBucket: TelemetryBucket | null = null;
    if (buckets.length > 0) {
      const lastBucket = buckets[buckets.length - 1];
      if (Math.abs(point.ts - lastBucket.ts) <= tolerance) {
        matchedBucket = lastBucket;
      }
    }

    if (matchedBucket) {
      matchedBucket[point.name] = point.value;
    } else {
      const newBucket: TelemetryBucket = {
        ts: point.ts,
        label: formatTsLabel(point.ts, timeRange),
        fullLabel: (() => {
          const d = new Date(point.ts);
          return d.toLocaleDateString([], { month: "short", day: "numeric" })
            + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        })(),
        [point.name]: point.value,
      };
      buckets.push(newBucket);
    }
  });

  return buckets;
}

// ─── Gauge bar ─────────────────────────────────────────────────────────────────

function GaugeBar({ value, min, max, color }: { value: number; min: number; max: number; color: string }) {
  const safeMax = max > min ? max : min + 1;
  const percent = Math.min(100, Math.max(0, ((value - min) / (safeMax - min)) * 100));
  return (
    <div className="mt-3 space-y-1">
      <div className="h-2.5 rounded-full bg-slate-100 dark:bg-surface-elevated overflow-hidden">
        <div
          className="h-2.5 rounded-full transition-all duration-500"
          style={{ width: `${percent}%`, backgroundColor: color }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-slate-400 dark:text-text-muted">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ─── Control Widget Renderer ───────────────────────────────────────────────────

type ControlOption = { label: string; value: string | number | boolean };

function parseControlOptions(config: Record<string, unknown>): ControlOption[] {
  if (Array.isArray(config.options)) {
    return config.options
      .map((item) => {
        if (typeof item === "string") return { label: item, value: parseOptionValue(item) };
        if (typeof item === "object" && item !== null) {
          const option = item as Record<string, unknown>;
          const value = option.value !== undefined ? option.value : option.label;
          if (value === undefined || value === null) return null;
          return { label: String(option.label ?? value).trim(), value: parseOptionValue(String(value)) };
        }
        return null;
      })
      .filter((item): item is ControlOption => item !== null);
  }

  const raw = typeof config.optionsCsv === "string" ? config.optionsCsv : "";
  return raw.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).map((entry) => {
    const separator = entry.indexOf("=") !== -1 ? entry.indexOf("=") : entry.indexOf(":");
    if (separator <= 0) return { label: entry, value: parseOptionValue(entry) };
    const label = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    return { label: label || value, value: parseOptionValue(value || label) };
  });
}

function ToggleSwitchControl({
  widget,
  device,
  rawValue,
  runtimeState,
  visualState,
  readOnly,
  disabled,
  color,
  onCommand,
  deviceId,
  command,
  binding,
  valueType,
}: {
  widget: ProjectWidget;
  device?: Device;
  rawValue: unknown;
  runtimeState?: WidgetRuntimeState;
  visualState: { status: string };
  readOnly: boolean;
  disabled: boolean;
  color: string;
  onCommand: (request: WidgetCommandRequest) => void;
  deviceId: string;
  command: string;
  binding: Record<string, unknown>;
  valueType: string;
}) {
  const { t } = useTranslation(["projects"]);
  const confirm = useConfirm();
  const [overrideValue, setOverrideValue] = useState<boolean | null>(null);
  const overrideRef = useRef<boolean | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyOverride = (val: boolean | null) => {
    overrideRef.current = val;
    setOverrideValue(val);
  };

  const telemetryValue = normalizeBoolean(rawValue);

  // Lọc dữ liệu Telemetry / SSE ngầm bằng overrideRef để tránh Stale Closure
  useEffect(() => {
    if (overrideRef.current !== null) {
      if (telemetryValue === overrideRef.current) {
        // Telemetry thực sự từ ESP32 đã tới và trùng khớp -> Giải phóng khóa
        if (lockTimerRef.current) {
          clearTimeout(lockTimerRef.current);
          lockTimerRef.current = null;
        }
        applyOverride(null);
      }
      // Dữ liệu cũ rác từ DB/Server trả về trễ -> BỎ QUA HOÀN TOÀN
    }
  }, [telemetryValue]);

  // Cleanup bộ nhớ khi Component unmount
  useEffect(() => {
    return () => {
      if (lockTimerRef.current) {
        clearTimeout(lockTimerRef.current);
        lockTimerRef.current = null;
      }
    };
  }, []);

  // Ưu tiên hiển thị overrideValue nếu khác null
  const displayValue = overrideValue !== null
    ? overrideValue
    : (runtimeState?.optimisticValue !== undefined ? normalizeBoolean(runtimeState.optimisticValue) : telemetryValue);
  const isOn = displayValue;

  const showStateLabels = widget.config.showStateLabels === true;
  const onLabel = String(widget.config.onLabel ?? "ON");
  const offLabel = String(widget.config.offLabel ?? "OFF");
  const labelPosition = widget.config.labelPosition === "left" ? "left" : "right";

  useEffect(() => {
    if (runtimeState?.error) {
      applyOverride(null);
    }
  }, [runtimeState?.error]);

  const sendToggle = () => {
    const targetValue = !isOn;

    // A. Cập nhật UI sáng/tắt NGAY LẬP TỨC (0ms latency, không block click)
    applyOverride(targetValue);

    // B. Đặt lại Timer Rollback an toàn (5000ms)
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    lockTimerRef.current = setTimeout(() => {
      applyOverride(null); // Nhả khóa nếu quá 5s thiết bị không phản hồi
    }, 5000);

    // C. Bắn API / MQTT Command ngầm
    try {
      onCommand({
        deviceId,
        command,
        params: normalizeCommandParams(binding, targetValue, valueType),
        widgetId: widget.id,
        expectedValue: targetValue,
        previousValue: rawValue,
      });
    } catch {
      applyOverride(null);
    }
  };

  const handleToggle = () => {
    if (disabled) return;

    const shouldConfirm = widget.config.confirmBeforeSend === true || String(widget.config.confirmBeforeSend) === "true";
    if (shouldConfirm) {
      void confirm({
        title: t("projects:editor.confirm_command_title", "Confirm command"),
        description: t("projects:editor.confirm_command", "Send command from \"{{title}}\"?", { title: widget.title }),
        confirmLabel: t("projects:editor.confirm_command_action", "Send command"),
        cancelLabel: t("common:actions.cancel", "Cancel"),
      }).then((accepted) => {
        if (accepted) sendToggle();
      });
      return;
    }
    sendToggle();
  };

  const stateLabel = (
    <span className={cn(
      "min-w-[2rem] text-xs font-bold uppercase tracking-[0.12em] transition-colors duration-150",
      isOn ? "text-emerald-500" : "text-slate-400 dark:text-text-muted",
    )}>
      {isOn ? onLabel : offLabel}
    </span>
  );

  const disabledReason = !deviceId
    ? t("projects:editor.no_device_assigned", "Chưa gắn kết nối thiết bị")
    : visualState.status === "offline"
      ? t("projects:editor.device_offline", "Thiết bị hiện đang Offline")
      : undefined;

  return (
    <div className="dashboard-widget-control dashboard-widget-control--toggle flex items-center gap-3">
      {showStateLabels && labelPosition === "left" && stateLabel}
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        className={cn(
          "dashboard-widget-switch relative inline-flex h-8 w-16 items-center rounded-full transition-all duration-200 ease-out focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-brand-400 active:scale-95 cursor-pointer",
          isOn ? "shadow-md" : "bg-slate-200 dark:bg-surface-muted shadow-inner",
          disabled && "cursor-not-allowed opacity-50",
        )}
        style={isOn ? { backgroundColor: color, boxShadow: `0 0 14px ${color}55` } : undefined}
        disabled={disabled || Boolean(runtimeState?.pending)}
        role="switch"
        aria-checked={isOn}
        aria-label={`${widget.title}: ${isOn ? "ON" : "OFF"}`}
        title={disabledReason}
        onClick={handleToggle}
      >
        <span className={cn(
          "dashboard-widget-switch-thumb inline-block h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-200 ease-out",
          isOn ? "translate-x-[34px]" : "translate-x-[3px]",
        )} />
      </button>
      {showStateLabels && labelPosition === "right" && stateLabel}
      {!disabled && (
        <span className={cn(
          "ml-1 text-[10px] font-semibold uppercase tracking-wider transition-colors duration-150",
          isOn ? "text-emerald-500" : "text-slate-400",
        )}>
          {isOn ? "Active" : "Idle"}
        </span>
      )}
    </div>
  );
}

export function ControlWidgetRenderer({ widget, definition, device, latestState, runtimeState, visualState, readOnly, onCommand }: WidgetRenderProps) {
  const { t } = useTranslation(["projects"]);
  const confirm = useConfirm();
  const binding = widget.binding ?? {};
  const command = String(binding.command ?? "");
  const deviceId = typeof binding.device_id === "string" ? binding.device_id : "";
  const field = stateFieldForBinding(binding);
  const rawValue = latestState[field];
  const currentValue = runtimeState?.optimisticValue !== undefined ? runtimeState.optimisticValue : rawValue;
  const allowOffline = widget.config.allowOfflineControl === true;
  const disabled = readOnly === true
    || !deviceId
    || !command
    || (visualState.status === "offline" && !allowOffline);
  const isToggle = ["switch", "toggle_switch"].includes(widget.widget_type);
  const min = normalizeNumber(widget.config.min) ?? 0;
  const max = normalizeNumber(widget.config.max) ?? 100;
  const step = normalizeNumber(widget.config.step) ?? 1;
  const color = String(widget.config.color ?? "#22c55e");
  const parsedOptions = parseControlOptions(widget.config);
  const options = parsedOptions.length > 0 ? parsedOptions : [{ label: "OFF", value: "OFF" }, { label: "ON", value: "ON" }];
  const valueType = String(definition.configSchema.valueType ?? "");

  const sendValueNow = (nextValue: unknown) => {
    if (disabled || runtimeState?.pending) return;
    onCommand({
      deviceId,
      command,
      params: normalizeCommandParams(binding, nextValue, valueType),
      widgetId: widget.id,
      expectedValue: nextValue,
      previousValue: rawValue,
    });
    if (widget.widget_type === "momentary_button") {
      const pulse = normalizeNumber(widget.config.pulseDurationMs) ?? 500;
      window.setTimeout(() => {
        onCommand({
          deviceId,
          command,
          params: normalizeCommandParams(binding, false, valueType),
          widgetId: widget.id,
          expectedValue: false,
          previousValue: nextValue,
        });
      }, pulse);
    }
  };

  const sendValue = (nextValue: unknown) => {
    if (disabled || runtimeState?.pending) return;
    const shouldConfirm = widget.config.confirmBeforeSend === true || String(widget.config.confirmBeforeSend) === "true";
    if (shouldConfirm) {
      void confirm({
        title: t("projects:editor.confirm_command_title", "Confirm command"),
        description: t("projects:editor.confirm_command", "Send command from \"{{title}}\"?", { title: widget.title }),
        confirmLabel: t("projects:editor.confirm_command_action", "Send command"),
        cancelLabel: t("common:actions.cancel", "Cancel"),
      }).then((accepted) => {
        if (accepted) sendValueNow(nextValue);
      });
      return;
    }
    sendValueNow(nextValue);
  };

  if (isToggle) {
    return (
      <ToggleSwitchControl
        key={widget.id}
        widget={widget}
        device={device}
        rawValue={rawValue}
        runtimeState={runtimeState}
        visualState={visualState}
        readOnly={readOnly ?? false}
        disabled={disabled}
        color={color}
        onCommand={onCommand}
        deviceId={deviceId}
        command={command}
        binding={binding}
        valueType={valueType}
      />
    );
  }

  if (["button", "push_button", "momentary_button", "schedule_button_timer"].includes(widget.widget_type)) {
    const isPending = Boolean(runtimeState?.pending);
    return (
      <div className="flex flex-col gap-2">
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className={cn(
            "relative overflow-hidden rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all duration-150 ease-out active:scale-95 cursor-pointer",
            "focus-visible:ring-2 focus-visible:ring-offset-2",
            disabled
              ? "cursor-not-allowed opacity-50 bg-slate-400"
              : "",
          )}
          style={!disabled ? { backgroundColor: color, boxShadow: `0 4px 16px ${color}44` } : undefined}
          disabled={disabled}
          onClick={() => sendValue(true)}
        >
          {isPending
            ? <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />{t("projects:editor.sending", "Sending…")}</span>
            : widget.widget_type === "momentary_button" ? "Pulse" : "Send command"}
        </button>
        {widget.widget_type === "schedule_button_timer" && (
          <p className="text-[11px] text-slate-500">Timer: {widget.config.scheduleLabel ? String(widget.config.scheduleLabel) : "Manual trigger"}</p>
        )}
      </div>
    );
  }

  if (["slider_control", "knob_dial_control", "numeric_input", "stepper_control"].includes(widget.widget_type)) {
    const numericValue = normalizeNumber(currentValue) ?? min;
    return (
      <div className="space-y-3">
        {widget.widget_type !== "numeric_input" && (
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={numericValue}
            disabled={disabled || runtimeState?.pending}
            className={cn("w-full accent-brand-500 cursor-pointer", runtimeState?.pending && "opacity-70")}
            onChange={(event) => sendValue(Number(event.target.value))}
          />
        )}
        <div className="flex items-center gap-2">
          {widget.widget_type === "stepper_control" && (
            <button
              className="h-9 w-9 rounded-xl border border-slate-200 bg-white text-lg font-bold text-slate-700 hover:bg-slate-50 dark:border-border-subtle dark:bg-surface dark:text-text-primary transition-colors"
              disabled={disabled || runtimeState?.pending}
              onClick={() => sendValue(numericValue - step)}
            >−</button>
          )}
          <input
            type="number"
            className={cn("input text-center font-semibold", runtimeState?.pending && "opacity-70")}
            min={min}
            max={max}
            step={step}
            value={numericValue}
            disabled={disabled || runtimeState?.pending}
            onChange={(event) => sendValue(Number(event.target.value))}
          />
          {widget.widget_type === "stepper_control" && (
            <button
              className="h-9 w-9 rounded-xl border border-slate-200 bg-white text-lg font-bold text-slate-700 hover:bg-slate-50 dark:border-border-subtle dark:bg-surface dark:text-text-primary transition-colors"
              disabled={disabled || runtimeState?.pending}
              onClick={() => sendValue(numericValue + step)}
            >+</button>
          )}
          {runtimeState?.pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 shrink-0" />}
        </div>
      </div>
    );
  }

  if (widget.widget_type === "dropdown_command_selector") {
    const activeOption = options.find(opt => {
      if (opt.value === currentValue) return true;
      if (String(opt.value) === String(currentValue)) return true;
      return false;
    }) ?? options[0];
    const selected = activeOption ? String(activeOption.value) : "";
    return (
      <div className="flex items-center gap-2">
        <select
          className={cn("input", runtimeState?.pending && "opacity-70")}
          disabled={disabled || runtimeState?.pending}
          value={selected}
          onChange={(event) => {
            const nextOpt = options.find(opt => String(opt.value) === event.target.value);
            if (nextOpt) sendValue(nextOpt.value);
          }}
        >
          {options.map((option) => (
            <option key={option.label} value={String(option.value)}>{option.label}</option>
          ))}
        </select>
        {runtimeState?.pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 shrink-0" />}
      </div>
    );
  }

  if (widget.widget_type === "segmented_control") {
    const activeOption = options.find(opt => {
      if (opt.value === currentValue) return true;
      if (String(opt.value) === String(currentValue)) return true;
      return false;
    }) ?? options[0];
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const isSelected = activeOption && option.value === activeOption.value;
          return (
            <button
              key={option.label}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
                isSelected
                  ? "text-white shadow-sm"
                  : "border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-border-subtle dark:text-text-secondary dark:hover:bg-surface-elevated",
                runtimeState?.pending && "opacity-70",
              )}
              style={isSelected ? { backgroundColor: color } : undefined}
              disabled={disabled || runtimeState?.pending}
              onClick={() => sendValue(option.value)}
            >
              {option.label}
            </button>
          );
        })}
        {runtimeState?.pending && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 shrink-0 self-center" />}
      </div>
    );
  }

  if (widget.widget_type === "color_picker") {
    return (
      <div className="space-y-2">
        <input
          type="color"
          className="h-12 w-full rounded-xl border border-slate-200 bg-transparent p-1 cursor-pointer dark:border-border-subtle"
          disabled={disabled}
          value={typeof currentValue === "string" ? currentValue : "#22c55e"}
          onChange={(event) => sendValue(event.target.value)}
        />
        <p className="text-[11px] text-slate-500">{t("projects:editor.color_picker_hint", "Gửi màu đã chọn qua lệnh đã cấu hình.")}</p>
      </div>
    );
  }

  if (widget.widget_type === "direction_pad_joystick") {
    return (
      <div className="grid grid-cols-3 gap-1.5">
        <span />
        <button className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all dark:border-border-subtle dark:bg-surface dark:text-text-primary" disabled={disabled} onClick={() => sendValue("up")}>▲</button>
        <span />
        <button className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all dark:border-border-subtle dark:bg-surface dark:text-text-primary" disabled={disabled} onClick={() => sendValue("left")}>◀</button>
        <button className="h-10 rounded-xl border-2 border-brand-300 bg-brand-50 text-xs font-bold text-brand-700 hover:bg-brand-100 active:scale-95 transition-all dark:bg-brand-950/30 dark:border-brand-700 dark:text-brand-300" disabled={disabled} onClick={() => sendValue("center")}>●</button>
        <button className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all dark:border-border-subtle dark:bg-surface dark:text-text-primary" disabled={disabled} onClick={() => sendValue("right")}>▶</button>
        <span />
        <button className="h-10 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all dark:border-border-subtle dark:bg-surface dark:text-text-primary" disabled={disabled} onClick={() => sendValue("down")}>▼</button>
        <span />
      </div>
    );
  }

  return (
    <div className="text-sm text-slate-500">This control widget is ready for future command schemas.</div>
  );
}

// ─── Display Widget Renderer ───────────────────────────────────────────────────

export function DisplayWidgetRenderer({ widget, latestState, visualState }: WidgetRenderProps) {
  const field = stateFieldForBinding(widget.binding ?? {});
  const rawValue = latestState[field];
  const numericValue = normalizeNumber(rawValue) ?? 0;
  const color = String(widget.config.color ?? "#22c55e");
  const min = normalizeNumber(widget.config.min) ?? 0;
  const max = normalizeNumber(widget.config.max) ?? 100;
  const isOn = normalizeBoolean(rawValue);

  if (["led", "led_indicator", "icon_status", "device_online_status"].includes(widget.widget_type)) {
    return (
      <div className="flex items-center gap-3">
        <span
          className={cn("relative h-8 w-8 rounded-full transition-all duration-300", !isOn && "bg-slate-200 dark:bg-surface-muted")}
          style={isOn ? { backgroundColor: color, boxShadow: `0 0 18px ${color}88, 0 0 6px ${color}` } : undefined}
        >
          {isOn && <span className="absolute inset-0 rounded-full animate-ping opacity-20" style={{ backgroundColor: color }} />}
        </span>
        <div>
          <p className={cn("text-sm font-bold", isOn ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400")}>{isOn ? "Active" : "Inactive"}</p>
          <p className="text-[11px] text-slate-400">{isOn ? "Signal detected" : "No signal"}</p>
        </div>
      </div>
    );
  }

  if (["gauge", "gauge_widget", "circular_gauge", "linear_gauge", "progress_bar", "thermometer", "humidity_card", "battery_indicator", "signal_strength_wifi_rssi"].includes(widget.widget_type)) {
    return (
      <div>
        <div className="text-4xl font-bold tracking-tight text-slate-900 dark:text-text-primary" style={{ color }}>
          {formatValue(rawValue, widget.config)}
        </div>
        <GaugeBar value={numericValue} min={min} max={max} color={color} />
      </div>
    );
  }

  if (widget.widget_type === "multi_value_card") {
    const fields = Array.isArray(widget.config.fields)
      ? widget.config.fields.filter((item): item is string => typeof item === "string")
      : typeof widget.config.fieldsCsv === "string" && widget.config.fieldsCsv.trim()
        ? widget.config.fieldsCsv.split(",").map((item) => item.trim()).filter(Boolean)
        : [field];
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {fields.map((name) => (
          <div key={name} className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-surface-elevated">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400 dark:text-text-muted">{name}</p>
            <p className="mt-1.5 text-xl font-bold text-slate-900 dark:text-text-primary">{formatValue(latestState[name], widget.config)}</p>
          </div>
        ))}
      </div>
    );
  }

  if (widget.widget_type === "last_seen_card") {
    return (
      <div className="flex items-end gap-2">
        <Clock3 className="mb-0.5 h-5 w-5 shrink-0 text-slate-400" />
        <p className="text-xl font-semibold text-slate-900 dark:text-text-primary">
          {latestState.ts ? new Date(String(latestState.ts)).toLocaleString() : "--"}
        </p>
      </div>
    );
  }

  // Default display value
  return (
    <div className="space-y-2">
      <div className="text-4xl font-bold tracking-tight text-slate-900 dark:text-text-primary">
        {formatValue(rawValue, widget.config)}
      </div>
      {visualState.status !== "online" && (
        <WidgetStatusDot {...visualState} />
      )}
    </div>
  );
}

// ─── Chart Widget Renderer ─────────────────────────────────────────────────────

const CHART_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e"];

export type ChartType = "line" | "area" | "bar";

export function resolveChartType(widgetType: string, config: Record<string, unknown>): ChartType {
  const configured = String(config.chartType ?? config.chart_type ?? "").trim().toLowerCase();
  if (configured === "line" || configured === "area" || configured === "bar") return configured;
  if (configured === "column" || configured === "columns") return "bar";
  if (widgetType === "bar_chart") return "bar";
  if (widgetType === "line_chart") return "line";
  if (widgetType === "area_chart") return "area";
  if (widgetType === "realtime_mini_chart") return "bar";
  return "line";
}

function ChartWidgetRendererContent({ widget }: WidgetRenderProps) {
  const { t } = useTranslation(["projects"]);
  const isMulti = widget.widget_type === "multi_telemetry_chart";
  const isDragPerformanceMode = useDragPerformanceMode();
  
  const { projectId } = useParams<{ projectId: string }>();
  const datastreamsQ = useQuery({
    queryKey: ["client-datastreams", projectId],
    queryFn: () => listDatastreams({ project_id: projectId! }),
    enabled: !!projectId && !isDragPerformanceMode,
  });

  const getChannelDisplayName = useCallback((chanKey: string) => {
    const dss = datastreamsQ.data?.items ?? [];
    
    // 1. Try to find by direct matching with datastream_id/datastream_ids
    const singleDsId = widget.binding?.datastream_id;
    if (singleDsId) {
      const ds = dss.find(d => d.id === singleDsId);
      if (ds) {
        const pinKey = `ch_v${ds.pin}`;
        const pinKeyShort = `v${ds.pin}`;
        if (chanKey === pinKey || chanKey === pinKeyShort || chanKey === "value" || chanKey === ds.name) {
          return ds.name;
        }
      }
    }
    
    const multiDsIds = widget.binding?.datastream_ids;
    if (Array.isArray(multiDsIds)) {
      for (const dsId of multiDsIds) {
        const ds = dss.find(d => d.id === dsId);
        if (ds) {
          const pinKey = `ch_v${ds.pin}`;
          const pinKeyShort = `v${ds.pin}`;
          if (chanKey === pinKey || chanKey === pinKeyShort || chanKey === ds.name) {
            return ds.name;
          }
        }
      }
    }

    // 2. Fallback: Search all datastreams in the project for a pin match
    const match = chanKey.match(/^(?:ch_)?v(\d+)$/i);
    if (match) {
      const pinNum = parseInt(match[1], 10);
      const ds = dss.find(d => d.pin === pinNum);
      if (ds) {
        return ds.name;
      }
    }

    const dsByNameOrId = dss.find(d => d.name === chanKey || d.id === chanKey);
    if (dsByNameOrId) {
      return dsByNameOrId.name;
    }

    return chanKey;
  }, [datastreamsQ.data, widget.binding]);

  const timeRangeStorageKey = `aifom_widget_time_range_${widget.id}`;
  const [timeRange, setTimeRange] = usePersistedState<TimeRange>(
    timeRangeStorageKey,
    resolveTimeRange(widget.config.timeRange),
    "local",
  );

  const configuredAggregate = String(widget.config.aggregation ?? "").trim().toLowerCase();
  const aggregate: Aggregate = configuredAggregate === "min" || configuredAggregate === "max"
    ? configuredAggregate
    : "avg";

  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const target = document.getElementById(`widget-meta-portal-${widget.id}`);
    if (target) {
      setPortalTarget(target);
    }
  }, [widget.id]);


  const [hiddenChannels, setHiddenChannels] = useState<Record<string, boolean>>({});
  const handleLegendClick = (props: LegendPayload) => {
    const { dataKey } = props;
    if (typeof dataKey === "string") {
      setHiddenChannels((prev) => ({
        ...prev,
        [dataKey]: !prev[dataKey],
      }));
    }
  };

  const telemetryQ = useTelemetrySeries(widget, timeRange, aggregate, isDragPerformanceMode);
  const multiTelemetryQ = useMultiTelemetrySeries(widget, timeRange, aggregate, isDragPerformanceMode);


  // Resolve raw Telemetry[] from either aggregated envelope or plain array
  const telemetryRecords: Telemetry[] = useMemo(() => {
    const d = telemetryQ.data;
    if (!d) return [];
    return isAggregatedResponse(d) ? d.data : d;
  }, [telemetryQ.data]);

  const isDataAggregated: boolean = useMemo(() => {
    const d = telemetryQ.data;
    return isAggregatedResponse(d) && d.aggregated;
  }, [telemetryQ.data]);

  const aggregationGrouping: string | null = useMemo(() => {
    const d = telemetryQ.data;
    return isAggregatedResponse(d) ? d.grouping : null;
  }, [telemetryQ.data]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerHeight, setContainerHeight] = useState(160);
  const [containerWidth, setContainerWidth] = useState(300);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setContainerHeight(entries[0].contentRect.height);
        setContainerWidth(entries[0].contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tickCount = useMemo(() => {
    return Math.max(3, Math.min(10, Math.floor(containerHeight / 30)));
  }, [containerHeight]);

  const yDomain = useMemo(() => {
    const dss = datastreamsQ.data?.items ?? [];
    
    let configMin = normalizeNumber(widget.config.min);
    let configMax = normalizeNumber(widget.config.max);
    
    if (configMin === null || configMax === null) {
      const singleDsId = widget.binding?.datastream_id;
      if (singleDsId) {
        const ds = dss.find(d => d.id === singleDsId);
        if (ds) {
          if (configMin === null && typeof ds.min_value === "number") configMin = ds.min_value;
          if (configMax === null && typeof ds.max_value === "number") configMax = ds.max_value;
        }
      } else {
        const multiDsIds = widget.binding?.datastream_ids;
        if (Array.isArray(multiDsIds)) {
          let minVal: number | null = null;
          let maxVal: number | null = null;
          for (const dsId of multiDsIds) {
            const ds = dss.find(d => d.id === dsId);
            if (ds) {
              if (typeof ds.min_value === "number") {
                minVal = minVal === null ? ds.min_value : Math.min(minVal, ds.min_value);
              }
              if (typeof ds.max_value === "number") {
                maxVal = maxVal === null ? ds.max_value : Math.max(maxVal, ds.max_value);
              }
            }
          }
          if (configMin === null && minVal !== null) configMin = minVal;
          if (configMax === null && maxVal !== null) configMax = maxVal;
        }
      }
    }

    const useDefaultMiniRange = widget.widget_type === "realtime_mini_chart" && configMin === null && configMax === null;
    return [
      configMin !== null ? configMin : (useDefaultMiniRange ? 0 : 'auto'),
      configMax !== null ? configMax : (useDefaultMiniRange ? 100 : 'auto')
    ] as [any, any];
  }, [datastreamsQ.data, widget.config, widget.binding]);
  
  const channels = useMemo(() => {
    if (isMulti) {
      return Array.isArray(widget.binding?.channels) ? widget.binding.channels : [];
    }
    const binding = widget.binding ?? {};
    let metricName = String(binding.telemetry_field ?? binding.feedback_key ?? binding.state_key ?? "");
    if (!metricName && binding.binding_type === "virtual" && binding.channel) {
      const chan = String(binding.channel);
      metricName = chan.startsWith("ch_") ? chan : `ch_${chan}`;
    }
    return metricName ? [metricName] : [];
  }, [isMulti, widget.binding, widget.id]);

  const series = useMemo(() => {
    if (isMulti) {
      const queriesData = multiTelemetryQ.queries.map(q => {
        const d = q.data;
        return isAggregatedResponse(d) ? d.data : (Array.isArray(d) ? d : []);
      });
      return mapMultiTelemetry(queriesData, channels, timeRange);
    }
    return mapTelemetry(telemetryRecords, timeRange);
  }, [isMulti, telemetryRecords, multiTelemetryQ.queries, channels, widget.id, timeRange]);

  const timeRangeWindow = useMemo(() => {
    const duration = timeRangeDurationMs(timeRange);
    if (duration === null) return null;

    const endTs = Date.now();
    return { startTs: endTs - duration, endTs };
  }, [timeRange]);

  const axisTicks = useMemo(() => {
    const compact = widget.widget_type === "sparkline" || widget.widget_type === "realtime_mini_chart";
    if (timeRange !== "live") {
      const timestamps = timeRangeAxisTicks(timeRange, containerWidth, compact, timeRangeWindow?.endTs);
      return {
        labels: timestamps.map((timestamp) => formatTsLabel(timestamp, timeRange)),
        timestamps,
      };
    }

    const indices = axisTickIndices(series.length, containerWidth, timeRange, compact);
    return {
      labels: indices.map((index) => series[index]?.label).filter(Boolean),
      timestamps: indices
        .map((index) => series[index]?.ts)
      .filter((value): value is number => typeof value === "number"),
    };
  }, [containerWidth, series, timeRange, timeRangeWindow, widget.widget_type]);

  const xDomain = useMemo((): [number, number] | ["dataMin", "dataMax"] => {
    if (timeRangeWindow === null) return ["dataMin", "dataMax"];
    return [timeRangeWindow.startTs, timeRangeWindow.endTs];
  }, [timeRangeWindow]);


  const isLoading = isMulti ? multiTelemetryQ.isLoading : telemetryQ.isLoading;
  const isError = isMulti ? multiTelemetryQ.isError : telemetryQ.isError;
  const color = String(widget.config.color ?? "#2563eb");
  const colorsList = useMemo(() => {
    return widget.config.color
      ? [String(widget.config.color), ...CHART_COLORS.filter((c) => c !== widget.config.color)]
      : CHART_COLORS;
  }, [widget.config.color]);

  const isPreview = widget.id === "widget-preview";

  /* ── Time Range Selector Bar ─────────────────────────────────────────────── */
  const timeRangeBar = !isPreview && (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 4,
        padding: "4px 6px 2px",
        flexShrink: 0,
      }}
    >
      {/* Left: range buttons */}
      <div style={{ display: "flex", gap: 2 }}>
        {(["live", "6h", "1d", "1w", "1m"] as TimeRange[]).map((r) => (
          <button
            key={r}
            id={`chart-time-range-${widget.id}-${r}`}
            onClick={() => setTimeRange(r)}
            style={{
              fontSize: 10,
              fontWeight: 600,
              lineHeight: 1,
              padding: "3px 7px",
              borderRadius: 6,
              border: "none",
              cursor: "pointer",
              background: timeRange === r ? color : "transparent",
              color: timeRange === r ? "#fff" : "rgb(100 116 139)",
              transition: "background 0.15s, color 0.15s",
              letterSpacing: "0.03em",
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            {r === "live" && timeRange === "live" && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
              </span>
            )}
            {TIME_RANGE_LABELS[r]}
          </button>
        ))}
      </div>


      {/* Right: aggregation badge (only when backend confirms aggregated) */}
      {isDataAggregated && aggregationGrouping && (
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            padding: "2px 6px",
            borderRadius: 99,
            background: `${color}22`,
            color,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {aggregate.toUpperCase()} / {aggregationGrouping}
        </span>
      )}
    </div>
  );

  const renderTimeRangeBar = () => {
    if (isPreview || !portalTarget) return null;
    return createPortal(timeRangeBar, portalTarget);
  };

  const recharts = useRecharts(series.length > 0 && !isLoading && !isError);

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0 }}>
        {renderTimeRangeBar()}
        <div className="flex h-full items-center justify-center" style={{ flex: 1 }}>
          <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
        </div>
      </div>
    );
  }
  if (isError) {
    return (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0 }}>
        {renderTimeRangeBar()}
        <div className="text-sm text-rose-500" style={{ flex: 1 }}>Chart data could not be loaded.</div>
      </div>
    );
  }
  if (series.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0 }}>
        {renderTimeRangeBar()}
        <div className="flex h-full flex-col items-center justify-center gap-2 py-4 text-center" style={{ flex: 1 }}>
          <Zap className="h-7 w-7 text-slate-200 dark:text-surface-elevated" />
          <p className="text-xs text-slate-400">{t("projects:editor.no_data_in_range", "Chưa có dữ liệu trong khoảng thời gian này.")}</p>
        </div>
      </div>
    );
  }

  if (!recharts) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
      </div>
    );
  }

  const {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
  } = recharts;

  const chartType = resolveChartType(widget.widget_type, widget.config);
  const isBar = chartType === "bar";
  const isLine = chartType === "line";
  const isCompact = widget.widget_type === "sparkline" || widget.widget_type === "realtime_mini_chart";
  const hideCompactXAxis = widget.widget_type === "sparkline";
  const hideCompactYAxis = widget.widget_type === "sparkline";
  const height = isCompact ? 80 : 160;

  const curveType = ["monotone", "linear", "step"].includes(String(widget.config.curveType))
    ? String(widget.config.curveType)
    : "monotone";
  const showGrid = widget.config.showGrid !== false;
  const showXAxis = widget.config.showXAxis !== false && !hideCompactXAxis;
  const showYAxis = widget.config.showYAxis !== false && !hideCompactYAxis;
  const showLegend = isMulti && widget.config.showLegend !== false;
  const connectNulls = widget.config.connectNulls !== false;
  const configuredDecimals = normalizeNumber(widget.config.decimalPlaces);
  const chartDecimals = configuredDecimals === null
    ? 2
    : Math.max(0, Math.min(6, Math.round(configuredDecimals)));
  const chartUnit = String(widget.config.unit ?? "").trim();
  type ChartValue = number | string | ReadonlyArray<number | string>;
  const formatChartValue = (val: unknown): ChartValue => {
    if (typeof val === "number") return Number(val.toFixed(chartDecimals));
    if (typeof val === "string") return val;
    if (Array.isArray(val) && val.every((item) => typeof item === "number" || typeof item === "string")) {
      return val;
    }
    return String(val ?? "");
  };
  const formatAxisTick = (val: unknown) => String(formatChartValue(val));
  const formatTooltipValue = (val: ChartValue | undefined): React.ReactNode => {
    const formatted = formatChartValue(val);
    if (chartUnit && typeof formatted === "number") return `${formatted} ${chartUnit}`;
    return Array.isArray(formatted) ? formatted.join(", ") : formatted;
  };

  const chartWrapper = (children: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: isPreview ? `${height}px` : "100%", minHeight: 0 }}>
      {renderTimeRangeBar()}
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </div>
  );


  if (isBar) {
    return chartWrapper(
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 4, right: 24, left: -16, bottom: 0 }}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.15)" vertical={false} />}
          {timeRange === "live" ? (
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "rgb(100 116 139)" }}
              axisLine={false}
              tickLine={false}
              height={15}
              hide={!showXAxis}
              interval={0}
              ticks={axisTicks.labels as unknown as readonly (string | number)[]}
            />
          ) : (
            <XAxis
              dataKey="ts"
              type="number"
              domain={xDomain}
              tickFormatter={(val) => formatTsLabel(Number(val), timeRange)}
              tick={{ fontSize: 10, fill: "rgb(100 116 139)" }}
              axisLine={false}
              tickLine={false}
              height={15}
              ticks={axisTicks.timestamps as unknown as readonly (string | number)[]}
              minTickGap={25}
              hide={!showXAxis}
            />
          )}
          <YAxis hide={!showYAxis} tickFormatter={formatAxisTick} tick={{ fontSize: 10, fill: "rgb(100 116 139)" }} axisLine={false} tickLine={false} width={38} tickCount={tickCount} domain={yDomain} />
          <Tooltip
            formatter={formatTooltipValue}
            labelFormatter={(_label, payload) => (
              timeRange === "live" ? _label : (payload?.[0]?.payload?.fullLabel ?? formatTsLabel(Number(_label), timeRange))
            )}
            isAnimationActive={true}
            animationDuration={150}
            animationEasing="ease-out"
            contentStyle={{ background: "rgb(255 255 255)", border: "1px solid rgb(226 232 240)", borderRadius: "10px", fontSize: 11, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
            labelStyle={{ color: "rgb(71 85 105)", fontWeight: 500 }}
            cursor={{ fill: `${color}15` }}
          />

          {isMulti ? (
            <>
              {showLegend && <Legend
                onClick={handleLegendClick}
                wrapperStyle={{ fontSize: 10, paddingTop: 10, cursor: "pointer" }}
              />}
              {channels.map((chan, idx) => {
                const strokeColor = String(widget.config[`color_${chan}`] ?? CHART_COLORS[idx % CHART_COLORS.length]);
                return (
                  <Bar
                    key={chan}
                    dataKey={chan}
                    fill={strokeColor}
                    radius={[4, 4, 0, 0]}
                    name={getChannelDisplayName(chan)}
                    hide={!!hiddenChannels[chan]}
                  />
                );
              })}
            </>
          ) : (
            <Bar dataKey="value" fill={color} radius={[6, 6, 0, 0]} name={getChannelDisplayName("value")} />
          )}

        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (widget.widget_type === "donut_pie_chart") {
    const latest = series.slice(-6).map((item, index) => ({
      name: item.label,
      value: Math.max(0, Number(item.value) || 0),
      fill: [color, "#0ea5e9", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6"][index % 6],
    }));
    return chartWrapper(
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            formatter={formatChartValue}
            contentStyle={{ background: "rgb(255 255 255)", border: "1px solid rgb(226 232 240)", borderRadius: "10px", fontSize: 11 }}
            labelStyle={{ color: "rgb(71 85 105)" }}
          />
          <Pie data={latest} dataKey="value" nameKey="name" innerRadius={44} outerRadius={66} paddingAngle={3} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  const areaFill = isLine ? 0 : 0.18;

  return chartWrapper(
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 4, right: 24, left: -16, bottom: 0 }}>
        <defs>
          {isMulti ? (
            channels.map((chan, idx) => {
              const strokeColor = String(widget.config[`color_${chan}`] ?? CHART_COLORS[idx % CHART_COLORS.length]);
              const gradientId = `wg-${widget.id}-${chan}-${strokeColor.replace("#", "")}`;
              return (
                <linearGradient key={chan} id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={strokeColor} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
                </linearGradient>
              );
            })
          ) : (
            <linearGradient id={`wg-${widget.id}-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          )}
        </defs>
        {showGrid && height > 100 && <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.15)" vertical={false} />}
        {timeRange === "live" ? (
          <XAxis
            dataKey="label"
            hide={!showXAxis}
            tick={{ fontSize: 10, fill: "rgb(100 116 139)" }}
            axisLine={false}
            tickLine={false}
            height={15}
            interval={0}
            ticks={axisTicks.labels as unknown as readonly (string | number)[]}
          />
        ) : (
          <XAxis
            dataKey="ts"
            type="number"
            domain={xDomain}
            tickFormatter={(val) => formatTsLabel(Number(val), timeRange)}
            hide={!showXAxis}
            tick={{ fontSize: 10, fill: "rgb(100 116 139)" }}
            axisLine={false}
            tickLine={false}
            height={15}
            ticks={axisTicks.timestamps as unknown as readonly (string | number)[]}
            minTickGap={25}
          />
        )}
        <YAxis hide={!showYAxis} tickFormatter={formatAxisTick} tick={{ fontSize: 10, fill: "rgb(100 116 139)" }} axisLine={false} tickLine={false} width={38} tickCount={tickCount} domain={yDomain} />
        <Tooltip
          formatter={formatTooltipValue}
          labelFormatter={(_label, payload) => (
            timeRange === "live" ? _label : (payload?.[0]?.payload?.fullLabel ?? formatTsLabel(Number(_label), timeRange))
          )}
          isAnimationActive={true}
          animationDuration={150}
          animationEasing="ease-out"
          contentStyle={{ background: "rgb(255 255 255)", border: "1px solid rgb(226 232 240)", borderRadius: "10px", fontSize: 11, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}
          labelStyle={{ color: "rgb(71 85 105)", fontWeight: 500 }}
        />


        {isMulti ? (
          channels.map((chan, idx) => {
            const strokeColor = String(widget.config[`color_${chan}`] ?? CHART_COLORS[idx % CHART_COLORS.length]);
            const gradientId = `wg-${widget.id}-${chan}-${strokeColor.replace("#", "")}`;
            return (
              <Area
                key={chan}
                type={curveType as "monotone" | "linear" | "step"}
                dataKey={chan}
                stroke={strokeColor}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                fillOpacity={areaFill}
                dot={false}
                name={getChannelDisplayName(chan)}
                connectNulls={connectNulls}
                hide={!!hiddenChannels[chan]}
              />
            );
          })
        ) : (
          <Area type={curveType as "monotone" | "linear" | "step"} dataKey="value" stroke={color} strokeWidth={2} fill={`url(#wg-${widget.id}-${color.replace("#", "")})`} fillOpacity={areaFill} dot={false} name={getChannelDisplayName("value")} connectNulls={connectNulls} />
        )}
        {showLegend && (
          <Legend
            onClick={handleLegendClick}
            wrapperStyle={{ fontSize: 10, paddingTop: 10, cursor: "pointer" }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>

  );
}

export function ChartWidgetRenderer(props: WidgetRenderProps) {
  return <ChartWidgetRendererContent {...props} />;
}

// ─── Status Widget Renderer ────────────────────────────────────────────────────

export function StatusWidgetRenderer({ widget, latestState, visualState }: WidgetRenderProps) {
  const field = stateFieldForBinding(widget.binding ?? {});
  const rawValue = latestState[field];
  const isOn = normalizeBoolean(rawValue);
  const warningThreshold = normalizeNumber(widget.config.warningThreshold);
  const dangerThreshold = normalizeNumber(widget.config.dangerThreshold);
  const numericValue = normalizeNumber(rawValue);

  if (widget.widget_type === "threshold_alert_card") {
    if (numericValue === null) {
      const c = {
        text: "text-slate-500 dark:text-text-muted",
        bg: "bg-slate-50 dark:bg-slate-950/30",
        label: "NO DATA"
      };
      return (
        <div className={cn("rounded-xl px-3 py-2.5", c.bg)}>
          <p className={cn("text-[10px] font-black uppercase tracking-[0.18em]", c.text)}>{c.label}</p>
          <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-text-primary">--</p>
        </div>
      );
    }

    const condition = widget.config.thresholdCondition ?? "above";
    let level: "normal" | "warning" | "danger" = "normal";

    if (condition === "below") {
      level = dangerThreshold !== null && numericValue <= dangerThreshold
        ? "danger"
        : warningThreshold !== null && numericValue <= warningThreshold
          ? "warning"
          : "normal";
    } else {
      level = dangerThreshold !== null && numericValue >= dangerThreshold
        ? "danger"
        : warningThreshold !== null && numericValue >= warningThreshold
          ? "warning"
          : "normal";
    }

    const colorMap = {
      danger: { text: "text-rose-600 dark:text-rose-400", bg: "bg-rose-50 dark:bg-rose-950/30", label: "DANGER" },
      warning: { text: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-amber-950/30", label: "WARNING" },
      normal: { text: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", label: "NORMAL" },
    };
    const c = colorMap[level];
    return (
      <div className={cn("rounded-xl px-3 py-2.5", c.bg)}>
        <p className={cn("text-[10px] font-black uppercase tracking-[0.18em]", c.text)}>{c.label}</p>
        <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-text-primary">{formatValue(rawValue, widget.config)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <WidgetStatusDot {...visualState} />
      <div className="text-2xl font-bold text-slate-900 dark:text-text-primary">
        {numericValue !== null ? formatValue(rawValue, widget.config) : isOn ? "Active" : rawValue == null ? "--" : String(rawValue)}
      </div>
    </div>
  );
}

// ─── Utility Widget Renderer ───────────────────────────────────────────────────

export function UtilityWidgetRenderer({ widget, projectName, device }: WidgetRenderProps) {
  if (widget.widget_type === "divider") {
    return <div className="mt-4 border-t border-dashed border-slate-200 dark:border-border-subtle" />;
  }
  if (widget.widget_type === "image_card") {
    const src = typeof widget.config.imageUrl === "string" ? widget.config.imageUrl : "";
    return src
      ? <img src={src} alt={widget.title} className="max-h-40 w-full rounded-xl object-cover" />
      : <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-400 dark:border-border-subtle">Add an image URL in settings.</div>;
  }
  if (widget.widget_type === "project_info_card") {
    return (
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Project</p>
        <p className="text-2xl font-bold text-slate-900 dark:text-text-primary">{projectName ?? "--"}</p>
      </div>
    );
  }
  if (widget.widget_type === "device_info_card") {
    return (
      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">Device</p>
        <p className="text-xl font-bold text-slate-900 dark:text-text-primary">{device?.name ?? widget.binding.device_uid ?? "--"}</p>
        <p className="text-[11px] font-mono text-slate-400">{device?.device_uid ?? "--"}</p>
      </div>
    );
  }
  // markdown / text / note
  return (
    <div className="space-y-2">
      <div className="text-base font-semibold text-slate-900 dark:text-text-primary">{widget.title}</div>
      <div className="text-sm leading-relaxed text-slate-600 dark:text-text-muted whitespace-pre-wrap">
        {String(widget.config.markdown ?? widget.config.text ?? widget.config.note ?? widget.title)}
      </div>
    </div>
  );
}

// ─── Widget Chrome (card shell) ────────────────────────────────────────────────

export function WidgetChrome({
  widget,
  definition,
  device,
  visualState,
  children,
  onEdit,
  onDelete,
  readOnly,
  isEditing = false,
  actionsEnabled = !readOnly,
}: {
  widget: WidgetRenderProps["widget"];
  definition: WidgetRenderProps["definition"];
  device?: WidgetRenderProps["device"];
  visualState: WidgetRenderProps["visualState"];
  children: ReactNode;
  onEdit: () => void;
  onDelete: () => void;
  readOnly: boolean;
  isEditing?: boolean;
  actionsEnabled?: boolean;
}) {
  const { t } = useTranslation(["projects", "common"]);
  const Icon = definition.icon;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const deviceLabel = device?.device_uid ?? widget.binding.device_uid ?? definition.category;
  const hideTitle = widget.config.hideTitle === true;
  const isOnline = visualState.status === "online";

  const widgetTypeId = (widget as ProjectWidget & { definition_id?: string }).definition_id || widget.widget_type || definition.id;
  const isDefaultTitle = !widget.title || widget.title === definition.label || widget.title === definition.id;
  const translatedTitle = isDefaultTitle
    ? t(`projects:widget_registry.${widgetTypeId}.label`, widget.title || definition.label)
    : widget.title;

  useEffect(() => {
    if (!menuOpen) return;

    function updateMenuPosition() {
      const trigger = menuButtonRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const vp = 8;
      const width = Math.min(200, Math.max(160, window.innerWidth - vp * 2));
      const estimatedHeight = actionsEnabled ? 140 : 100;
      const left = Math.min(
        Math.max(vp, rect.right - width),
        Math.max(vp, window.innerWidth - width - vp),
      );
      const preferBelowTop = rect.bottom + 6;
      const top =
        preferBelowTop + estimatedHeight <= window.innerHeight - vp
          ? preferBelowTop
          : Math.max(vp, rect.top - estimatedHeight - 6);
      setMenuStyle({ left, top, width, position: "fixed" });
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && menuButtonRef.current?.contains(target)) return;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    }

    updateMenuPosition();
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [actionsEnabled, menuOpen]);

  return (
    <>
      {/* ── Header ───────────────────────────────────────────── */}
      <div className="dashboard-widget-header flex min-w-0 flex-col justify-between gap-0 bg-gradient-to-b from-slate-100/90 via-slate-50/60 to-transparent px-4 py-3 dark:from-surface-elevated/30">
        {/* Title row */}
        <div className="dashboard-widget-title-row flex min-w-0 items-center gap-2">
          {/* Icon badge */}
          <span className="dashboard-widget-title flex min-w-0 flex-1 items-center gap-2">
            <span className="dashboard-widget-title flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-950/40">
              <Icon className="h-3.5 w-3.5 text-brand-600 dark:text-brand-400" />
            </span>
            {!hideTitle && (
              <span className="min-w-0 truncate text-[13px] font-semibold text-slate-800 dark:text-text-primary">
                {translatedTitle}
              </span>
            )}
          </span>

          {/* Online dot */}
          <span className={cn(
            "h-2 w-2 shrink-0 rounded-full transition-colors",
            statusDot(visualState.status),
            isOnline && "animate-pulse-dot",
          )} />
          {/* Inline actions (only visible when container is large) */}
          {actionsEnabled && (
            <div className="dashboard-widget-inline-actions items-center gap-1">
              <button
                type="button"
                className="btn-ghost h-7 px-2 text-[11px]"
                onClick={onEdit}
                aria-label="Edit"
              >
                Edit
              </button>
              {isEditing && (
                <button
                  type="button"
                  className="btn-ghost h-7 px-2 text-[11px] text-rose-500"
                  onClick={onDelete}
                  aria-label={`Delete ${translatedTitle}`}
                >
                  Delete
                </button>
              )}
            </div>
          )}

          {/* Context menu button (only visible when container is small) */}
          {actionsEnabled && (
            <button
              type="button"
              ref={menuButtonRef}
              className="dashboard-widget-details-button dashboard-grid-action"
              aria-label={`Options for ${translatedTitle}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Meta row */}
        <div className="dashboard-widget-meta mt-1 flex min-w-0 items-center justify-between gap-2 overflow-hidden">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <p className="min-w-0 truncate font-mono text-[10px] text-slate-400 dark:text-text-muted">
              {deviceLabel}
            </p>
            {typeof widget.binding.gpio_pin === "number" && (
              <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500 dark:bg-surface-muted dark:text-text-secondary">
                GPIO {widget.binding.gpio_pin}
              </span>
            )}
          </div>
          {/* Portal target for chart time range selector */}
          <div id={`widget-meta-portal-${widget.id}`} className="shrink-0 flex items-center gap-2" />
        </div>

      </div>

      {/* ── Body ─────────────────────────────────────────────── */}
      <div className="dashboard-widget-body relative min-h-0 flex-1 overflow-hidden p-4 pt-3">
        <div className={cn("h-full", isEditing && "pointer-events-none select-none opacity-50")}>
          {children}
        </div>
        {isEditing && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-white/35 backdrop-blur-[1px] dark:bg-slate-950/35"
            aria-hidden="true"
          >
            <span className="rounded-full border border-brand-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-brand-700 shadow-sm dark:border-brand-800 dark:bg-slate-900/95 dark:text-brand-300">
              {t("projects:editor.editing_layout", "Đang chỉnh bố cục")}
            </span>
          </div>
        )}
      </div>

      {/* ── Context menu portal ───────────────────────────────── */}
      {menuOpen && menuStyle && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          className="dashboard-widget-details-menu dashboard-grid-action z-50"
        >
          {/* Widget info */}
          <div className="mb-2 min-w-0 border-b border-slate-100 pb-2 dark:border-border-subtle">
            <p className="truncate text-xs font-semibold text-slate-900 dark:text-text-primary">{translatedTitle}</p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400 dark:text-text-muted">{deviceLabel}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {typeof widget.binding.gpio_pin === "number" && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500 dark:bg-surface-muted">GPIO {widget.binding.gpio_pin}</span>
              )}
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                visualState.status === "online" ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
                  : visualState.status === "offline" ? "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
                    : "bg-slate-100 text-slate-500 dark:bg-surface-muted",
              )}>
                <span className={cn("h-1.5 w-1.5 rounded-full", statusDot(visualState.status))} />
                {statusLabel(visualState.status)}
              </span>
            </div>
          </div>

          {/* Actions */}
          {actionsEnabled && (
            <div className="flex flex-col gap-1">
              <button
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-text-secondary dark:hover:bg-surface-elevated transition-colors"
                onClick={() => { setMenuOpen(false); onEdit(); }}
                aria-label="Edit widget"
              >
                <Settings2 className="h-3.5 w-3.5 text-slate-400" />
                Edit
              </button>
              {isEditing && (
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/20 transition-colors"
                  onClick={() => { setMenuOpen(false); onDelete(); }}
                  aria-label={`Delete ${widget.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
