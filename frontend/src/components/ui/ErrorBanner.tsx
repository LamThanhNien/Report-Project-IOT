import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { cn } from "../../lib/cn";

interface ErrorBannerProps {
  title?: string;
  message: string;
  tone?: "error" | "warning" | "info";
  correlationId?: string;
  action?: ReactNode;
  onDismiss?: () => void;
  live?: "assertive" | "polite" | "off";
  className?: string;
}

export function ErrorBanner({
  title,
  message,
  tone = "error",
  correlationId,
  action,
  onDismiss,
  live = tone === "error" ? "assertive" : "polite",
  className,
}: ErrorBannerProps) {
  const { t } = useTranslation("common");
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div
      role={live === "assertive" ? "alert" : "status"}
      aria-live={live}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-sm",
        tone === "error" && "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/50 dark:bg-rose-500/10 dark:text-rose-300",
        tone === "warning" && "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-500/10 dark:text-amber-300",
        tone === "info" && "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-500/10 dark:text-sky-300",
        className,
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        <div className={cn("text-xs", title && "mt-1")}>{message}</div>
        {correlationId && (
          <div className="mt-1.5 text-[11px] opacity-75">
            {t("errors.support_id", "Support ID")}: <code>{correlationId}</code>
          </div>
        )}
        {action && <div className="mt-2">{action}</div>}
      </div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label={t("actions.dismiss", "Dismiss notification")} className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
