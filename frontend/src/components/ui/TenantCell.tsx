import type { TenantSummary } from "../../types";

export function TenantCell({
  tenant,
  fallback = "Chưa gán khách hàng",
  compact = false,
}: {
  tenant?: TenantSummary | null;
  fallback?: string;
  compact?: boolean;
}) {
  if (!tenant) return <span className="text-xs text-slate-400 italic">{fallback}</span>;

  const secondary = tenant.slug ?? tenant.email;
  return (
    <div className={compact ? "max-w-[140px]" : "max-w-[180px]"} title={secondary ? `${tenant.name} · ${secondary}` : tenant.name}>
      <div className="truncate text-sm font-medium text-slate-800 dark:text-text-primary">{tenant.name}</div>
      {secondary && <div className="truncate text-[11px] text-slate-500 dark:text-text-muted">{secondary}</div>}
    </div>
  );
}
