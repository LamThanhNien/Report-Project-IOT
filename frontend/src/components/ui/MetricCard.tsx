import React from "react";
import { cn } from "../../lib/cn";
import { TONE_CLASSES, type StatusTone } from "../../lib/status";
import { Skeleton } from "./Skeleton";

interface Props {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: StatusTone;
  trend?: { value: string; positive?: boolean };
  loading?: boolean;
  compact?: boolean;
  className?: string;
}

export function MetricCard({ label, value, hint, icon, tone = "neutral", trend, loading, compact, className }: Props) {
  const t = TONE_CLASSES[tone];
  return (
    <div
      className={cn(
        "card flex flex-col gap-2 hover:-translate-y-0.5 hover:shadow-md",
        compact ? "p-4 min-h-[88px]" : "p-5 min-h-[112px]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="section-label">{label}</div>
        {icon && (
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl", t.bg, t.text)}>
            {icon}
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <div
          className={cn(
            "font-semibold text-slate-900 dark:text-text-primary tabular-nums",
            compact ? "text-xl" : "text-2xl",
          )}
        >
          {loading ? <Skeleton className={compact ? "h-6 w-14" : "h-7 w-16"} /> : value}
        </div>
        {trend && (
          <span
            className={cn(
              "text-xs font-medium",
              trend.positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
            )}
          >
            {trend.value}
          </span>
        )}
      </div>
      {hint && (
        <div className="text-xs text-slate-500 dark:text-text-muted">{hint}</div>
      )}
    </div>
  );
}
