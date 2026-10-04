import type React from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { CardHeader, CardTitle } from "../../../components/ui/Card";
import { cn } from "../../../lib/cn";

export function getGreeting(t: (key: string, fallback: string) => string): string {
  const h = new Date().getHours();
  if (h < 12) return t("dashboard:greeting_morning", "Chào buổi sáng");
  if (h < 18) return t("dashboard:greeting_afternoon", "Chào buổi chiều");
  return t("dashboard:greeting_evening", "Chào buổi tối");
}

// ── Gradient palette ────────────────────────────────────────────────────────
const METRIC_GRADIENTS = [
  { from: "from-blue-500",    to: "to-cyan-500",   border: "hover:border-blue-500/40",   glow: "shadow-blue-500/10" },
  { from: "from-emerald-500", to: "to-teal-500",   border: "hover:border-emerald-500/40", glow: "shadow-emerald-500/10" },
  { from: "from-rose-500",    to: "to-pink-500",   border: "hover:border-rose-500/40",    glow: "shadow-rose-500/10" },
  { from: "from-violet-500",  to: "to-purple-500", border: "hover:border-violet-500/40",  glow: "shadow-violet-500/10" },
  { from: "from-amber-500",   to: "to-orange-500", border: "hover:border-amber-500/40",   glow: "shadow-amber-500/10" },
];

interface BentoMetricCardProps {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  gradientIdx: number;
  loading?: boolean;
  isOnlineDot?: boolean;
  onClick?: () => void;
  dataTestId?: string;
}

export function BentoMetricCard({
  label,
  value,
  hint,
  icon,
  gradientIdx,
  loading,
  isOnlineDot,
  onClick,
  dataTestId,
}: BentoMetricCardProps) {
  const g = METRIC_GRADIENTS[gradientIdx % METRIC_GRADIENTS.length];
  return (
    <div
      data-testid={dataTestId}
      onClick={onClick}
      className={cn(
        "group relative overflow-hidden rounded-2xl border p-5 transition-all duration-150",
        "border-slate-200/80 bg-white shadow-sm hover:border-slate-400 hover:bg-slate-50/40 dark:border-border-subtle dark:bg-surface dark:hover:border-slate-700 dark:hover:bg-surface-elevated/40",
        onClick && "cursor-pointer",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {isOnlineDot && (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
          )}
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-text-muted">
            {label}
          </p>
        </div>
        <div className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm",
          g.from, g.to,
        )}>
          {icon}
        </div>
      </div>

      <div className="mt-4">
        {loading ? (
          <div className="h-9 w-24 animate-pulse rounded-lg bg-slate-100 dark:bg-surface-elevated" />
        ) : (
          <p className="text-3xl font-extrabold tabular-nums tracking-tight text-slate-900 dark:text-text-primary">
            {value}
          </p>
        )}
        {hint && (
          <p className="mt-1 text-xs font-medium text-slate-500 dark:text-text-muted">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}

// ── SectionHeader ───────────────────────────────────────────────────────────
export function SectionHeader({
  icon,
  title,
  to,
  onClick,
  linkLabel,
}: {
  icon: React.ReactNode;
  title: string;
  to?: string;
  onClick?: () => void;
  linkLabel?: string;
}) {
  const { t } = useTranslation(["dashboard", "common"]);
  const displayLinkLabel = linkLabel ?? t("dashboard:view_all", "Xem tất cả");
  return (
    <CardHeader className="flex items-center justify-between border-b border-slate-100 pb-3.5 dark:border-border-subtle">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 shadow-inner dark:bg-surface-elevated">
          {icon}
        </div>
        <CardTitle className="text-base font-semibold text-slate-900 dark:text-text-primary">{title}</CardTitle>
      </div>
      {to ? (
        <Link
          to={to}
          className="group flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
        >
          {displayLinkLabel}
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>
      ) : onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="group flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
        >
          {displayLinkLabel}
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
        </button>
      ) : null}
    </CardHeader>
  );
}

// ── OtaStatChip ─────────────────────────────────────────────────────────────
export function OtaStatChip({
  label, value, valueClass, hint,
}: {
  label: string; value: string; valueClass?: string; hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-slate-300/80 bg-slate-50/80 p-4 shadow-sm transition-all duration-150 hover:border-slate-400 hover:bg-slate-100/80 dark:border-border-subtle dark:bg-surface-elevated/60 dark:hover:border-slate-600 dark:hover:bg-surface-elevated">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-text-muted">
        {label}
      </p>
      <p className={cn("text-2xl font-bold tabular-nums text-slate-900 dark:text-text-primary", valueClass)}>
        {value}
      </p>
      {hint && <p className="text-[11px] text-slate-400 dark:text-text-muted">{hint}</p>}
    </div>
  );
}

// ── ActionTile ──────────────────────────────────────────────────────────────
export function ActionTile({
  icon,
  label,
  gradient,
  to,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  gradient: string;
  to?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className={cn(
        "flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm",
        gradient,
      )}>
        {icon}
      </div>
      <span className="text-center text-xs font-semibold text-slate-700 transition-colors duration-150 group-hover:text-brand-600 dark:text-text-secondary dark:group-hover:text-text-primary">
        {label}
      </span>
    </>
  );

  const cls = cn(
    "group flex flex-col items-center gap-3 rounded-2xl border border-slate-300/80 bg-slate-50/80 p-4 shadow-sm",
    "transition-all duration-150 hover:border-slate-400 hover:bg-slate-100/80",
    "dark:border-border-subtle dark:bg-surface-elevated/60 dark:hover:border-slate-600 dark:hover:bg-surface-elevated",
  );

  if (to) {
    return <Link to={to} className={cls}>{inner}</Link>;
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}

