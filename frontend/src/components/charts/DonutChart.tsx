import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts";

interface Slice {
  name: string;
  value: number;
  color: string;
}

interface Props {
  data: Slice[];
  height?: number;
  centerLabel?: string;
  centerValue?: string | number;
}

export function DonutChart({ data, height = 220, centerLabel, centerValue }: Props) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="60%"
            outerRadius="85%"
            paddingAngle={2}
            stroke="none"
          >
            {data.map((s, i) => (
              <Cell key={i} fill={s.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "rgb(15 23 42)",
              border: "none",
              borderRadius: 8,
              fontSize: 12,
              color: "white",
            }}
            formatter={(v, n) => {
              const num = typeof v === "number" ? v : Number(v);
              return [`${num} (${total ? ((num / total) * 100).toFixed(0) : 0}%)`, String(n)];
            }}
          />
          <Legend
            verticalAlign="bottom"
            iconType="circle"
            wrapperStyle={{ fontSize: 11, color: "rgb(100 116 139)" }}
          />
        </PieChart>
      </ResponsiveContainer>
      {centerValue !== undefined && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none"
          style={{ top: -20 }}
        >
          <div className="text-2xl font-semibold text-slate-900 dark:text-text-primary tabular-nums">
            {centerValue}
          </div>
          {centerLabel && (
            <div className="text-[11px] uppercase tracking-wider text-slate-500 dark:text-text-muted mt-0.5">
              {centerLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
