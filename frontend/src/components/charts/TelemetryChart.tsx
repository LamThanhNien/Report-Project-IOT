import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Telemetry } from "../../types";

interface Props {
  data: Telemetry[];
  height?: number;
  color?: string;
  metricName?: string;
  unit?: string | null;
  valueFormatter?: (value: number) => string;
  yTickFormatter?: (value: number) => string;
}

function formatTimeTick(value: number, rangeMs: number): string {
  const date = new Date(value);
  const options: Intl.DateTimeFormatOptions =
    rangeMs <= 10 * 60 * 1000
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
      : { hour: "2-digit", minute: "2-digit", hour12: false };
  return date.toLocaleTimeString("en-US", options);
}

function defaultNumberLabel(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (abs >= 1_000) return `${Number((value / 1_000).toFixed(1))}k`;
  if (abs >= 100) return String(Math.round(value));
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(abs >= 10 ? 1 : 2)));
}

export function TelemetryChart({
  data,
  height = 220,
  color = "#3366ff",
  metricName,
  unit,
  valueFormatter = defaultNumberLabel,
  yTickFormatter = valueFormatter,
}: Props) {
  const formatted = [...data]
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .map((d) => ({
      ts: new Date(d.timestamp).getTime(),
      value: d.metric_value,
      label: d.metric_name,
    }))
    .filter((d) => Number.isFinite(d.ts) && Number.isFinite(d.value));

  const firstTs = formatted[0]?.ts ?? Date.now();
  const lastTs = formatted[formatted.length - 1]?.ts ?? firstTs;
  const rangeMs = Math.max(0, lastTs - firstTs);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={formatted} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="telGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" vertical={false} />
        <XAxis
          dataKey="ts"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(t) => formatTimeTick(Number(t), rangeMs)}
          tick={{ fontSize: 11, fill: "rgb(100 116 139)" }}
          axisLine={false}
          tickLine={false}
          minTickGap={32}
          tickCount={5}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={(value) => yTickFormatter(Number(value))}
          tick={{ fontSize: 11, fill: "rgb(100 116 139)" }}
          axisLine={false}
          tickLine={false}
          width={54}
          tickCount={5}
          allowDecimals
        />
        <Tooltip
          contentStyle={{
            background: "rgb(15 23 42)",
            border: "none",
            borderRadius: 8,
            fontSize: 12,
            color: "white",
          }}
          labelFormatter={(t) => new Date(Number(t)).toLocaleString("en-US")}
          formatter={(v) => {
            const numeric = typeof v === "number" ? v : Number(v);
            const label = Number.isFinite(numeric) ? valueFormatter(numeric) : String(v);
            return [unit ? `${label} ${unit}` : label, metricName ?? "Value"];
          }}
        />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill="url(#telGrad)" isAnimationActive={false} connectNulls={true} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
