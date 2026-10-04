import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { cn } from "../../lib/cn";

const gradients = ["from-blue-500 to-cyan-500", "from-emerald-500 to-teal-500", "from-rose-500 to-pink-500", "from-violet-500 to-purple-500", "from-amber-500 to-orange-500"];

export function AdminMetric({ label, value, hint, icon, index = 0, loading, to }: { label: string; value: ReactNode; hint?: ReactNode; icon: ReactNode; index?: number; loading?: boolean; to?: string }) {
  const content = <div className="group h-full rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-colors hover:border-slate-300 dark:border-border-subtle dark:bg-surface dark:hover:border-slate-700">
    <div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-text-muted">{label}</p><div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm", gradients[index % gradients.length])}>{icon}</div></div>
    <div className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 tabular-nums dark:text-text-primary">{loading ? <div className="h-9 w-24 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-surface-elevated" /> : value}</div>
    {hint && <p className="mt-1.5 text-xs text-slate-500 dark:text-text-muted">{hint}</p>}
  </div>;
  return to ? <Link to={to} className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{content}</Link> : content;
}

export function AdminAction({ title, description, icon, to, index = 0 }: { title: string; description: string; icon: ReactNode; to: string; index?: number }) {
  return <Link to={to} className="group flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-brand-400 dark:border-border-subtle dark:bg-surface dark:hover:border-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white", gradients[index % gradients.length])}>{icon}</div><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900 dark:text-text-primary">{title}</p><p className="mt-0.5 text-xs text-slate-500 dark:text-text-muted">{description}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-brand-500" /></Link>;
}

export function AdminReadOnlyNote({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-800/40 dark:bg-sky-950/20 dark:text-sky-300">{children}</div>;
}
