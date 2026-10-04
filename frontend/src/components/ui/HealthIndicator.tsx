import { cn } from "../../lib/cn";
import { TONE_CLASSES, type StatusTone } from "../../lib/status";

interface Props {
  status: StatusTone;
  label: string;
  hint?: string;
  className?: string;
}

export function HealthIndicator({ status, label, hint, className }: Props) {
  const t = TONE_CLASSES[status];
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="relative inline-flex h-2.5 w-2.5">
        <span className={cn("absolute inset-0 rounded-full opacity-60 animate-pulse-dot", t.dot)} />
        <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", t.dot)} />
      </span>
      <div>
        <div className={cn("text-sm font-medium", t.text)}>{label}</div>
        {hint && <div className="text-[11px] text-slate-500 dark:text-text-muted">{hint}</div>}
      </div>
    </div>
  );
}
