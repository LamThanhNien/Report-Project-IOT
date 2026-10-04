import { useEffect, type RefObject } from "react";

/** Contain keyboard focus and restore the trigger when a dialog closes. */
export function useDialogFocus(open: boolean, ref: RefObject<HTMLElement>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = requestAnimationFrame(() => {
      const first = ref.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]');
      (first ?? ref.current)?.focus();
    });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !ref.current) return;
      const nodes = [...ref.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]')];
      if (!nodes.length) { event.preventDefault(); ref.current.focus(); return; }
      const first = nodes[0]; const last = nodes[nodes.length - 1];
      if (!ref.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", trap);
    return () => { cancelAnimationFrame(timer); document.removeEventListener("keydown", trap); if (previous?.isConnected) previous.focus(); };
  }, [open, ref]);
}
