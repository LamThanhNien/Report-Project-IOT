import React from "react";
import { cn } from "../../lib/cn";

interface Props {
  tabs: { key: string; label: React.ReactNode; badge?: React.ReactNode }[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

export function Tabs({ tabs, active, onChange, className }: Props) {
  return (
    <div className={cn("scrollbar-hide flex items-center gap-4 overflow-x-auto border-b border-slate-200 dark:border-border-subtle", className)}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cn(
            "py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px flex items-center gap-2",
            active === t.key
              ? "border-primary text-primary"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:text-text-muted dark:hover:text-text-secondary",
          )}
        >
          {t.label}
          {t.badge}
        </button>
      ))}
    </div>
  );
}
