import React from "react";
import { TONE_CLASSES, type StatusTone } from "../../lib/status";
import { cn } from "../../lib/cn";

export interface TimelineItem {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  timestamp: React.ReactNode;
  tone?: StatusTone;
  icon?: React.ReactNode;
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return null;
  return (
    <ol className="relative">
      <span className="absolute left-3.5 top-1 bottom-1 w-px bg-slate-200 dark:bg-surface-elevated" aria-hidden />
      {items.map((it) => {
        const t = TONE_CLASSES[it.tone ?? "neutral"];
        return (
          <li key={it.id} className="relative pl-10 pb-5 last:pb-0">
            <span
              className={cn(
                "absolute left-1 top-1 h-5 w-5 rounded-full flex items-center justify-center ring-4 ring-white dark:ring-surface",
                t.bg,
                t.text,
              )}
            >
              {it.icon ?? <span className={cn("h-2 w-2 rounded-full", t.dot)} />}
            </span>
            <div className="flex items-start justify-between gap-3">
              <div className="text-sm text-slate-800 dark:text-text-secondary font-medium">{it.title}</div>
              <div className="text-xs text-slate-500 dark:text-text-muted whitespace-nowrap">
                {it.timestamp}
              </div>
            </div>
            {it.description && (
              <div className="text-xs text-slate-500 dark:text-text-muted mt-1">{it.description}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
