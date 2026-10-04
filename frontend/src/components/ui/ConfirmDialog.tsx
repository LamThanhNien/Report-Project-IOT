import { useTranslation } from "react-i18next";
import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import { cn } from "../../lib/cn";

interface Props {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmationText?: string;
  confirmationLabel?: string;
  loading?: boolean;
  loadingLabel?: string;
  confirmDisabled?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  confirmationText,
  confirmationLabel,
  loading,
  loadingLabel,
  confirmDisabled,
  error,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation("common");
  const effectiveConfirmationLabel = confirmationLabel ?? t("dialog.confirmation_text", "Type the value below to confirm");
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationInputRef = useRef<HTMLInputElement>(null);
  const onCancelRef = useRef(onCancel);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    return () => previouslyFocused?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      (confirmationText ? confirmationInputRef.current : cancelButtonRef.current)?.focus();
    });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmationText, loading, open]);

  useEffect(() => {
    if (open) setTypedConfirmation("");
  }, [open, confirmationText]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        aria-errormessage={error ? errorId : undefined}
        className="card max-w-md w-full p-0"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-border-subtle flex items-center justify-between">
          <div className="flex items-center gap-3">
            {destructive && (
              <div className="p-1.5 rounded-md bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
                <AlertTriangle className="h-4 w-4" />
              </div>
            )}
            <h3 id={titleId} className="font-semibold text-slate-800 dark:text-text-primary">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="btn-ghost h-8 w-8 p-0"
            aria-label={t("dialog.close", "Close dialog")}
            disabled={loading}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {description && (
          <div id={descriptionId} className="px-5 py-4 text-sm text-slate-600 dark:text-text-muted">{description}</div>
        )}
        {confirmationText && (
          <div className="px-5 pb-4">
            <label className="block text-sm font-medium text-slate-700 dark:text-text-secondary">
              {effectiveConfirmationLabel}: <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-surface-elevated">{confirmationText}</code>
              <input
                ref={confirmationInputRef}
                value={typedConfirmation}
                onChange={(event) => setTypedConfirmation(event.target.value)}
                className="input mt-2"
                autoComplete="off"
                aria-label={effectiveConfirmationLabel}
              />
            </label>
          </div>
        )}
        {error && (
          <div id={errorId} role="alert" className="mx-5 mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </div>
        )}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-border-subtle flex items-center justify-end gap-2">
          <button ref={cancelButtonRef} type="button" onClick={onCancel} className="btn-secondary" disabled={loading}>
            {cancelLabel ?? t("actions.cancel", "Cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading || confirmDisabled || Boolean(confirmationText && typedConfirmation !== confirmationText)}
            className={cn(destructive ? "btn-danger" : "btn-primary")}
          >
            {loading ? loadingLabel ?? t("actions.processing", "Processing…") : confirmLabel ?? t("actions.confirm", "Confirm")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
