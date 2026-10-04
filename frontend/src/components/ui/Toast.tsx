import type { ReactNode } from "react";
import { useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "../../lib/cn";

const TOAST_SAFE_TOP = "var(--app-toast-safe-top, 4.75rem)";
const APP_TOPBAR_SELECTOR = "[data-app-topbar]";

function syncToastHeaderHeight(): void {
  const headers = Array.from(document.querySelectorAll<HTMLElement>(APP_TOPBAR_SELECTOR));
  const heights = headers
    .map((header) => header.getBoundingClientRect().height)
    .filter((height) => height > 0);
  const root = document.documentElement;
  if (heights.length === 0) {
    root.style.removeProperty("--app-toast-safe-header-height");
    return;
  }
  root.style.setProperty("--app-toast-safe-header-height", `${Math.max(...heights)}px`);
}

function useToastSafeArea(): void {
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(syncToastHeaderHeight);
    const mutationObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => {
      syncToastHeaderHeight();
      const headers = Array.from(document.querySelectorAll<HTMLElement>(APP_TOPBAR_SELECTOR));
      headers.forEach((header) => resizeObserver?.observe(header));
    });

    syncToastHeaderHeight();
    const headers = Array.from(document.querySelectorAll<HTMLElement>(APP_TOPBAR_SELECTOR));
    headers.forEach((header) => resizeObserver?.observe(header));
    mutationObserver?.observe(document.body, { childList: true, subtree: true });

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      document.documentElement.style.removeProperty("--app-toast-safe-header-height");
    };
  }, []);
}

export type ToastTone = "success" | "error" | "warning" | "info";

export interface ToastProps {
  open: boolean;
  message: string;
  tone?: ToastTone;
  duration?: number;
  onClose: () => void;
  /** Render inside a shared viewport instead of creating a portal per item. */
  portal?: boolean;
  dismissLabel?: string;
}

const TONE_STYLES: Record<ToastTone, string> = {
  success: "border-emerald-200 text-emerald-800 dark:border-emerald-500/30 dark:text-emerald-200",
  error: "border-rose-200 text-rose-800 dark:border-rose-500/30 dark:text-rose-200",
  warning: "border-amber-200 text-amber-800 dark:border-amber-500/30 dark:text-amber-200",
  info: "border-slate-200 text-slate-800 dark:border-border-subtle dark:text-text-primary",
};

const ICONS = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

export function Toast({
  open,
  message,
  tone = "info",
  duration = 4000,
  onClose,
  portal = true,
  dismissLabel = "Đóng thông báo",
}: ToastProps) {
  useEffect(() => {
    if (!open || duration <= 0) return;
    const timer = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(timer);
  }, [duration, message, onClose, open]);

  if (!open) return null;

  const Icon = ICONS[tone];
  const content = (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border bg-white px-4 py-3 shadow-lg dark:bg-surface",
        TONE_STYLES[tone],
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 break-words text-sm font-medium">{message}</span>
      <button type="button" onClick={onClose} className="btn-ghost -mr-2 -mt-1 h-8 w-8 shrink-0 p-0" aria-label={dismissLabel}>
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );

  if (!portal) return content;
  return createPortal(
    <div
      className="pointer-events-none fixed inset-x-4 z-[70] flex justify-end"
      data-toast-placement="below-topbar"
      style={{ top: TOAST_SAFE_TOP }}
    >
      {content}
    </div>,
    document.body,
  );
}

export function ToastViewport({ children, ariaLabel = "Notifications" }: { children: ReactNode; ariaLabel?: string }) {
  useToastSafeArea();
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      data-testid="toast-viewport"
      data-toast-placement="below-topbar"
      aria-label={ariaLabel}
      className="pointer-events-none fixed inset-x-4 z-[70] flex flex-col items-end gap-3"
      style={{ top: TOAST_SAFE_TOP }}
    >
      {children}
    </div>,
    document.body,
  );
}
