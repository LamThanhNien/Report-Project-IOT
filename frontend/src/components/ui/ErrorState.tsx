import { useTranslation } from "react-i18next";
﻿import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "../../lib/cn";

interface Props {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
  correlationId?: string;
  className?: string;
}

export function ErrorState({
  title,
  message,
  onRetry,
  retrying = false,
  correlationId,
  className,
}: Props) {
  const { t } = useTranslation("common");
  return (
    <div role="alert" className={cn("card p-6 flex items-start gap-4 border-rose-200 dark:border-rose-900/40", className)}>
      <div className="p-2 rounded-md bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <div className="text-sm font-semibold text-slate-800 dark:text-text-primary">{title ?? t("errors.title", "Unable to load data")}</div>
        <div className="text-xs text-slate-500 dark:text-text-muted mt-1">
          {message ?? t("errors.request_failed", "Unable to complete the request. Please try again.")}
        </div>
        {correlationId && (
          <div className="mt-1 text-[11px] text-slate-400 dark:text-text-muted">
            {t("errors.support_id", "Support ID")}: <code>{correlationId}</code>
          </div>
        )}
        {onRetry && (
          <button onClick={onRetry} disabled={retrying} className="btn-secondary mt-3 text-xs h-8">
            <RefreshCw className={cn("h-3.5 w-3.5", retrying && "animate-spin")} />
            {retrying ? t("actions.retrying", "Retrying…") : t("actions.retry", "Retry")}
          </button>
        )}
      </div>
    </div>
  );
}
