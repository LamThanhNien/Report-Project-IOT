import React from "react";
import { Inbox } from "lucide-react";
import { cn } from "../../lib/cn";

interface Props {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: "default" | "inline";
  className?: string;
}

export function EmptyState({ icon, title, description, action, variant = "default", className }: Props) {
  if (variant === "inline") {
    return (
      <div className={cn("py-8 px-4 text-center", className)}>
        <div className="text-sm font-medium text-slate-600 dark:text-text-secondary">{title}</div>
        {description && <div className="text-xs mt-1 text-slate-500 dark:text-text-muted">{description}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-12 px-6",
        "text-slate-500 dark:text-text-muted",
        className,
      )}
    >
      <div className="p-3 rounded-full bg-slate-100 dark:bg-surface-elevated mb-3 text-slate-400 dark:text-text-muted">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <div className="text-sm font-semibold text-slate-700 dark:text-text-secondary">{title}</div>
      {description && <div className="text-xs mt-1 max-w-md">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
