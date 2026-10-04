/**
 * Development debug logger.
 * Sends structured log entries to the FastAPI /api/v1/debug/log endpoint so they
 * appear in the backend terminal alongside server logs.
 *
 * Controlled by:
 *   VITE_DEBUG_LOGS=true          enable/disable
 *   VITE_DEBUG_LOG_LEVEL=verbose  "normal" (default) | "verbose"
 */

const _BASE = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");
const _ENABLED = import.meta.env.VITE_DEBUG_LOGS === "true" && import.meta.env.MODE !== "production";
const _VERBOSE = import.meta.env.VITE_DEBUG_LOG_LEVEL === "verbose";
const _DEBUG_PATH = "/api/v1/debug/log";

const SENSITIVE = new Set([
  "password", "confirmpassword", "pass", "pwd", "token", "accesstoken", "refreshtoken",
  "authorization", "cookie", "secret", "apikey", "privatekey",
]);

export function isSensitiveField(key: string): boolean {
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE.has(compact)
    || compact.includes("password")
    || compact.endsWith("token")
    || compact.endsWith("secret")
    || compact.endsWith("apikey")
    || compact.endsWith("privatekey");
}

function looksLikeCredential(value: unknown): boolean {
  return typeof value === "string"
    && (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
      || /^Bearer\s+\S+$/i.test(value));
}

export function maskSensitiveData(data: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 5) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (isSensitiveField(k) || looksLikeCredential(v)) {
      out[k] = "***MASKED***";
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === "object"
          ? maskSensitiveData(item as Record<string, unknown>, depth + 1)
          : looksLikeCredential(item) ? "***MASKED***" : item,
      );
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = maskSensitiveData(v as Record<string, unknown>, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Fire-and-forget POST to the backend debug endpoint. Never throws. */
function _send(category: string, message: string, data?: Record<string, unknown>): void {
  if (!_ENABLED) return;
  // Never log calls to the debug endpoint itself
  if (message.includes(_DEBUG_PATH)) return;

  const body = JSON.stringify({
    category,
    message,
    data: data ? maskSensitiveData(data) : {},
  });

  // Use raw fetch (not apiClient) to avoid circular import / infinite loop
  fetch(`${_BASE}${_DEBUG_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true, // survives page navigation
  }).catch(() => {}); // silent failure — debug infra must never break the app
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export const debugLogger = {
  isEnabled: () => _ENABLED,
  isVerbose: () => _VERBOSE,

  // ── Navigation ──────────────────────────────────────────────────────────────

  route(path: string, from?: string) {
    if (!_ENABLED) return;
    const msg = from ? `from="${from}" to="${path}"` : `path="${path}"`;
    console.debug(`[CLIENT ROUTE] ${msg}`);
    _send("[CLIENT ROUTE]", msg);
  },

  // ── UI interactions ─────────────────────────────────────────────────────────

  click(text: string, opts?: { path?: string; modal?: string; action?: string }) {
    if (!_ENABLED) return;
    const parts = [`text="${text.slice(0, 60)}"`];
    if (opts?.path) parts.push(`path="${opts.path}"`);
    if (opts?.modal) parts.push(`modal="${opts.modal}"`);
    if (opts?.action) parts.push(`action="${opts.action}"`);
    const msg = parts.join(" ");
    console.debug(`[CLIENT CLICK] ${msg}`);
    _send("[CLIENT CLICK]", msg);
  },

  inputChange(field: string, type: string, value?: string) {
    if (!_ENABLED) return;
    const safe = isSensitiveField(field) || looksLikeCredential(value)
      ? "***MASKED***"
      : value?.slice(0, 100);
    const msg = `field="${field}" type="${type}" value="${safe ?? ""}"`;
    console.debug(`[CLIENT INPUT] ${msg}`);
    _send("[CLIENT INPUT]", msg);
  },

  formSubmit(formId: string, data?: Record<string, unknown>) {
    if (!_ENABLED) return;
    const safe = data ? maskSensitiveData(data) : {};
    const pairs = Object.entries(safe)
      .map(([k, v]) => `${k}="${String(v).slice(0, 80)}"`)
      .join(" ");
    const msg = `form="${formId}" ${pairs}`.trim();
    console.debug(`[CLIENT FORM] ${msg}`);
    _send("[CLIENT FORM]", msg, safe);
  },

  modal(action: "open" | "close", name: string, path?: string) {
    if (!_ENABLED) return;
    const msg = `${action} modal="${name}"${path ? ` path="${path}"` : ""}`;
    console.debug(`[CLIENT MODAL] ${msg}`);
    _send("[CLIENT MODAL]", msg);
  },

  toggle(field: string, value: boolean | string) {
    if (!_ENABLED) return;
    const msg = `field="${field}" value="${value}"`;
    console.debug(`[FEATURE TOGGLE] ${msg}`);
    _send("[FEATURE TOGGLE]", msg);
  },

  // ── API client ───────────────────────────────────────────────────────────────

  apiRequest(method: string, path: string) {
    if (!_ENABLED) return;
    if (path.includes(_DEBUG_PATH)) return;
    const msg = `${method} ${path}`;
    console.debug(`[API REQUEST] ${msg}`);
    _send("[API REQUEST]", msg);
  },

  apiResponse(method: string, path: string, status: number, durationMs: number) {
    if (!_ENABLED) return;
    if (path.includes(_DEBUG_PATH)) return;
    const msg = `${status} ${method} ${path} ${durationMs}ms`;
    console.debug(`[API RESPONSE] ${msg}`);
    _send("[API RESPONSE]", msg);
  },

  apiError(method: string, path: string, status: number, message: string) {
    if (!_ENABLED) return;
    if (path.includes(_DEBUG_PATH)) return;
    const msg = `${status} ${method} ${path} message="${message}"`;
    console.warn(`[API ERROR] ${msg}`);
    _send("[API ERROR]", msg);
  },

  // ── Authentication ───────────────────────────────────────────────────────────

  auth(
    action: "attempt" | "success" | "failed" | "logout",
    email?: string,
    reason?: string,
  ) {
    if (!_ENABLED) return;
    const parts: string[] = [];
    if (email) parts.push(`email="${email}"`);
    if (reason) parts.push(`reason="${reason}"`);
    const tag =
      action === "failed" ? "[AUTH FAILED]"
      : action === "success" ? "[AUTH SUCCESS]"
      : action === "logout" ? "[AUTH LOGOUT]"
      : "[AUTH ATTEMPT]";
    const msg = parts.join(" ");
    if (action === "failed") {
      console.warn(`${tag} ${msg}`);
    } else {
      console.debug(`${tag} ${msg}`);
    }
    _send(tag, msg);
  },

  // ── Domain-specific ──────────────────────────────────────────────────────────

  tenant(action: string, data?: Record<string, unknown>) {
    if (!_ENABLED) return;
    console.debug(`[TENANT] ${action}`, data ?? "");
    _send("[TENANT]", action, data);
  },

  servicePlan(action: string, data?: Record<string, unknown>) {
    if (!_ENABLED) return;
    console.debug(`[SERVICE PLAN] ${action}`, data ?? "");
    _send("[SERVICE PLAN]", action, data);
  },

  featureToggle(action: string, data?: Record<string, unknown>) {
    if (!_ENABLED) return;
    console.debug(`[FEATURE TOGGLE] ${action}`, data ?? "");
    _send("[FEATURE TOGGLE]", action, data);
  },

  // ── Errors ───────────────────────────────────────────────────────────────────

  error(code: number, path: string, message?: string) {
    if (!_ENABLED) return;
    const msg = `${code} ${path}${message ? ` message="${message}"` : ""}`;
    console.error(`[ERROR] ${msg}`);
    _send("[ERROR]", msg);
  },
};
