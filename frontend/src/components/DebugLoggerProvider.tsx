/**
 * Development-only global event listener.
 * Must be placed inside <BrowserRouter> so useLocation() works.
 *
 * Captures:
 *   - Route changes (via useLocation)
 *   - Button / link clicks (capture phase on document)
 *   - Form submits (native submit event)
 *   - Select, checkbox, radio changes (normal mode)
 *   - All input changes (verbose mode only)
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { debugLogger, isSensitiveField, maskSensitiveData } from "../lib/debugLogger";

// Input types that are always logged (they represent discrete choices)
const DISCRETE_TYPES = new Set(["select-one", "select-multiple", "checkbox", "radio"]);

export function DebugLoggerProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const prevPath = useRef<string>("");

  // ── Route changes ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!debugLogger.isEnabled()) return;
    const cur = location.pathname;
    if (cur !== prevPath.current) {
      debugLogger.route(cur, prevPath.current || undefined);
      prevPath.current = cur;
    }
  }, [location.pathname]);

  // ── Global DOM event listeners ─────────────────────────────────────────────
  useEffect(() => {
    if (!debugLogger.isEnabled()) return;

    // ── Clicks ────────────────────────────────────────────────────────────────
    const onClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Walk up to find the nearest interactive element
      const el = target.closest(
        'button, [role="button"], a, [type="submit"], [type="button"], [type="reset"]',
      ) as HTMLElement | null;
      if (!el) return;

      const rawText = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      const text = rawText.slice(0, 70);
      const action =
        el.getAttribute("data-action") ??
        el.getAttribute("data-testid") ??
        el.getAttribute("aria-label") ??
        undefined;
      const path = window.location.pathname;

      if (text || action) {
        debugLogger.click(text, { path, action: action ?? undefined });
      }
    };

    // ── Form submits ──────────────────────────────────────────────────────────
    const onSubmitCapture = (e: Event) => {
      const form = e.target as HTMLFormElement;
      const path = window.location.pathname;

      // Derive a form name from its attributes or the current route
      const formId =
        form.id ||
        form.getAttribute("name") ||
        form.getAttribute("data-form") ||
        path.split("/").filter(Boolean).slice(-1)[0] ||
        "form";

      // Extract form values safely
      const raw: Record<string, unknown> = {};
      try {
        new FormData(form).forEach((val, key) => {
          raw[key] = isSensitiveField(key)
            ? "***MASKED***"
            : String(val).slice(0, 120);
        });
      } catch {
        // FormData may fail on some form types — silently ignore
      }

      const safe = maskSensitiveData(raw);
      debugLogger.formSubmit(formId, { ...safe, _path: path });
    };

    // ── Input / select / checkbox changes ─────────────────────────────────────
    const onChangeCapture = (e: Event) => {
      const target = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (!target) return;

      const type =
        (target as HTMLInputElement).type?.toLowerCase() ?? "text";
      const field =
        target.name ||
        target.id ||
        target.getAttribute("data-field") ||
        target.getAttribute("aria-label") ||
        "unknown";

      const isDiscrete = DISCRETE_TYPES.has(type);
      if (!isDiscrete && !debugLogger.isVerbose()) return; // skip rapid typing in normal mode

      let value: string;
      if (type === "checkbox") {
        value = String((target as HTMLInputElement).checked);
      } else {
        value = (target.value ?? "").slice(0, 120);
      }

      debugLogger.inputChange(field, type, value);
    };

    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("submit", onSubmitCapture, true);
    document.addEventListener("change", onChangeCapture, true);

    return () => {
      document.removeEventListener("click", onClickCapture, true);
      document.removeEventListener("submit", onSubmitCapture, true);
      document.removeEventListener("change", onChangeCapture, true);
    };
  }, []);

  return <>{children}</>;
}
