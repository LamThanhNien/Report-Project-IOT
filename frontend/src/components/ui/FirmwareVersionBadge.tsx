import { GitBranch } from "lucide-react";
import { cn } from "../../lib/cn";

interface Props {
  version: string | null | undefined;
  channel?: "dev" | "staging" | "stable";
  className?: string;
}

const CHANNEL_TONE: Record<NonNullable<Props["channel"]>, string> = {
  dev: "bg-slate-200 text-slate-700 dark:bg-surface-muted/40 dark:text-text-secondary",
  staging: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  stable: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
};

export function FirmwareVersionBadge({ version, channel, className }: Props) {
  if (!version) return <span className="text-slate-400">Chưa có thông tin</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-mono rounded bg-slate-100 text-slate-800 dark:bg-surface-elevated dark:text-text-secondary">
        <GitBranch className="h-3 w-3 opacity-60" />
        {version}
      </span>
      {channel && (
        <span className={cn("chip", CHANNEL_TONE[channel])}>{channel}</span>
      )}
    </span>
  );
}
