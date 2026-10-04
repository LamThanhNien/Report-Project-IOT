import { useTranslation } from "react-i18next";
import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { useDialogFocus } from "../../hooks/useDialogFocus";

interface Props {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  headerContent?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  /** Require an explicit action rendered by the caller before the modal can close. */
  explicitClose?: boolean;
}

const SIZES: Record<NonNullable<Props["size"]>, string> = {
  sm: "max-w-md",
  md: "max-w-xl",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({ open, onClose, title, children, footer, headerContent, size = "md", explicitClose = false }: Props) {
  const { t } = useTranslation("common");
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogFocus(open, dialogRef);
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !explicitClose) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [explicitClose, open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={cn("card w-full p-0 flex flex-col max-h-[90dvh]", SIZES[size])}>
        <div className={cn(headerContent ? "pt-4" : "border-b border-slate-200 py-4 dark:border-border-subtle", "px-5")}>
          <div className="flex items-center justify-between">
            <h3 id={titleId} className="font-semibold text-slate-800 dark:text-text-primary">{title}</h3>
            {!explicitClose && (
              <button type="button" onClick={onClose} className="btn-ghost h-8 w-8 p-0" aria-label={t("dialog.close", "Close dialog")}>
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {headerContent && (
          <div className="border-b border-slate-200 px-5 dark:border-border-subtle">
            {headerContent}
          </div>
        )}
        <div className="p-5 overflow-y-auto flex-1">
          {children}
        </div>
        {footer && (
          <div className="px-5 py-3 border-t border-slate-200 dark:border-border-subtle flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
