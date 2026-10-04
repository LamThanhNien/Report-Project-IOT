import { Bar, BarChart as RBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Datum {
  name: string;
  value: number;
}

interface Props {
  data: Datum[];
  height?: number;
  color?: string;
  yLabel?: string;
}

export function BarChart({ data, height = 220, color = "#3366ff" }: Props) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RBarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(148 163 184 / 0.2)" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: "rgb(100 116 139)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 11, fill: "rgb(100 116 139)" }} axisLine={false} tickLine={false} width={40} />
        <Tooltip
          contentStyle={{
            background: "rgb(15 23 42)",
            border: "none",
            borderRadius: 8,
            fontSize: 12,
            color: "white",
          }}
        />
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
      </RBarChart>
    </ResponsiveContainer>
  );
}
