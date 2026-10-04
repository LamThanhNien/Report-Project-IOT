import { debugLogger } from "../lib/debugLogger";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/$/, "");
export const API_REQUEST_TIMEOUT_MS = 15_000;

export const TOKEN_KEY = "aifom_access_token";
export const REFRESH_TOKEN_KEY = "aifom_refresh_token";
export const TENANT_DISABLED_KEY = "aifom_tenant_disabled";
export const AUTH_SESSION_EXPIRED_EVENT = "aifom-auth-session-expired";
export const AUTH_SESSION_REFRESHED_EVENT = "aifom-auth-session-refreshed";
const CSRF_COOKIE_KEY = "aifom_csrf_token";
const REFRESH_PATH = "/api/v1/auth/refresh";
const AUTH_REFRESH_EXCLUDED_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/register",
  REFRESH_PATH,
  "/api/v1/auth/logout",
]);

interface TokenRefreshResponse {
  access_token?: string | null;
  refresh_token?: string | null;
}

let refreshPromise: Promise<boolean> | null = null;
let sessionExpiredNotified = false;

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const token = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CSRF_COOKIE_KEY}=`))
    ?.split("=")[1];
  return token ? { "X-CSRF-Token": decodeURIComponent(token) } : {};
}

function discardLegacyTokens(_payload?: TokenRefreshResponse): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function clearAuthStorage(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(TENANT_DISABLED_KEY);
}

function dispatchAuthEvent(name: string, detail?: unknown): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function isPublicPath(path: string): boolean {
  const normalized = path.replace(/\/$/, "");
  const publicPaths = ["", "/login", "/register"];
  return publicPaths.includes(normalized);
}

function notifySessionExpired(): void {
  if (sessionExpiredNotified) return;
  sessionExpiredNotified = true;
  clearAuthStorage();
  dispatchAuthEvent(AUTH_SESSION_EXPIRED_EVENT, {
    message: "Your session has expired. Please sign in again.",
  });
  if (typeof window !== "undefined" && !isPublicPath(window.location.pathname)) {
    window.location.assign("/login?session=expired");
  }
}

function isAuthRefreshExcluded(path: string): boolean {
  return AUTH_REFRESH_EXCLUDED_PATHS.has(path);
}

/** Create an AbortController that times out after REQUEST_TIMEOUT_MS. */
function timeoutSignal(): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
  return controller.signal;
}

/** Wrap fetch with timeout handling — converts AbortError to a user-friendly ApiError. */
async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, credentials: "include", signal: timeoutSignal() });
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("Request timed out", 408, null);
    }
    throw err;
  }
}

function formatErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (!item || typeof item !== "object") return String(item);
        const record = item as Record<string, unknown>;
        const loc = (Array.isArray(record.loc) ? record.loc : [])
          .filter((part) => part !== "body" && part !== "query" && part !== "path")
          .join(".");
        const msg = typeof record.msg === "string" ? record.msg : String(record.type ?? "Invalid value");
        return loc ? `${loc}: ${msg}` : msg;
      })
      .filter(Boolean);
    return messages.length > 0 ? messages.join("; ") : fallback;
  }
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return fallback;
}

async function parseError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text().catch(() => "");
  }
  const detail =
    body && typeof body === "object" && "detail" in (body as Record<string, unknown>)
      ? formatErrorDetail((body as Record<string, unknown>).detail, response.statusText)
      : response.statusText;
  // NOTE: 401 auto-redirect removed — AuthContext handles token refresh
  // before falling back to logout. This prevents killing the refresh flow.
  if (
    response.status === 403 &&
    typeof detail === "string" &&
    detail.toLowerCase().includes("tenant is disabled")
  ) {
    localStorage.setItem(TENANT_DISABLED_KEY, "1");
    window.dispatchEvent(new CustomEvent("tenant-disabled"));
  }
  if (
    response.status === 403 &&
    typeof detail === "string" &&
    detail.toLowerCase().includes("permission")
  ) {
    return new ApiError("Bạn không có quyền thực hiện thao tác này.", response.status, body);
  }
  if (response.status === 409 && typeof detail === "string") {
    const lowerDetail = detail.toLowerCase();
    if (lowerDetail === "email already exists") {
      return new ApiError("Email này đã được sử dụng.", response.status, body);
    }
    if (lowerDetail === "owner email already exists") {
      return new ApiError("Email chủ sở hữu đã được sử dụng.", response.status, body);
    }
    if (lowerDetail === "workspace or email already exists") {
      return new ApiError("Tên không gian làm việc hoặc email đã được sử dụng.", response.status, body);
    }
  }

  return new ApiError(String(detail), response.status, body);
}

async function refreshSessionOnce(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await timedFetch(`${BASE_URL}${REFRESH_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeader() },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        return false;
      }
      const payload = (await response.json()) as TokenRefreshResponse;
      discardLegacyTokens(payload);
      sessionExpiredNotified = false;
      dispatchAuthEvent(AUTH_SESSION_REFRESHED_EVENT, payload);
      return true;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function requestWithAuthRecovery(
  method: string,
  path: string,
  init: RequestInit,
  retried = false,
): Promise<Response> {
  const response = await timedFetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined) },
  });
  if (response.ok) {
    if (
      path === "/api/v1/auth/login" ||
      path === "/api/v1/auth/register" ||
      path === "/api/v1/auth/me" ||
      path === "/api/v1/auth/logout"
    ) {
      sessionExpiredNotified = false;
    }
  }
  if (
    response.status !== 401 ||
    retried ||
    isAuthRefreshExcluded(path)
  ) {
    return response;
  }

  debugLogger.apiError(method, path, response.status, "access token expired; refreshing session");
  try {
    const refreshed = await refreshSessionOnce();
    if (!refreshed) {
      notifySessionExpired();
      return response;
    }
  } catch (err) {
    if (!isNetworkError(err)) {
      notifySessionExpired();
    }
    throw err;
  }

  debugLogger.apiRequest(method, `${path} (retry after refresh)`);
  return requestWithAuthRecovery(method, path, init, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Instrumented fetch helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function apiGet<T>(path: string): Promise<T> {
  const t0 = Date.now();
  debugLogger.apiRequest("GET", path);
  const r = await requestWithAuthRecovery("GET", path, { headers: {} });
  if (!r.ok) {
    const err = await parseError(r);
    debugLogger.apiError("GET", path, r.status, err.message);
    throw err;
  }
  debugLogger.apiResponse("GET", path, r.status, Date.now() - t0);
  return (await r.json()) as T;
}

export async function apiGetBlob(path: string): Promise<Blob> {
  const t0 = Date.now();
  debugLogger.apiRequest("GET", path);
  const r = await requestWithAuthRecovery("GET", path, { headers: {} });
  if (!r.ok) {
    const err = await parseError(r);
    debugLogger.apiError("GET", path, r.status, err.message);
    throw err;
  }
  debugLogger.apiResponse("GET", path, r.status, Date.now() - t0);
  return r.blob();
}

export async function apiPostJson<T>(path: string, body: unknown): Promise<T> {
  const t0 = Date.now();
  debugLogger.apiRequest("POST", path);
  const r = await requestWithAuthRecovery("POST", path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await parseError(r);
    debugLogger.apiError("POST", path, r.status, err.message);
    throw err;
  }
  debugLogger.apiResponse("POST", path, r.status, Date.now() - t0);
  return (await r.json()) as T;
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  const t0 = Date.now();
  debugLogger.apiRequest("POST", path);
  const r = await requestWithAuthRecovery("POST", path, {
    method: "POST",
    headers: { ...csrfHeader() },
    body: form,
  });
  if (!r.ok) {
    const err = await parseError(r);
    debugLogger.apiError("POST", path, r.status, err.message);
    throw err;
  }
  debugLogger.apiResponse("POST", path, r.status, Date.now() - t0);
  return (await r.json()) as T;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const t0 = Date.now();
  debugLogger.apiRequest("PUT", path);
  const r = await requestWithAuthRecovery("PUT", path, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await parseError(r);
    debugLogger.apiError("PUT", path, r.status, err.message);
    throw err;
  }
  debugLogger.apiResponse("PUT", path, r.status, Date.now() - t0);
  return (await r.json()) as T;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const t0 = Date.now();
  debugLogger.apiRequest("PATCH", path);
  const r = await requestWithAuthRecovery("PATCH", path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...csrfHeader() },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await parseError(r);
    debugLogger.apiError("PATCH", path, r.status, err.message);
    throw err;
  }
  debugLogger.apiResponse("PATCH", path, r.status, Date.now() - t0);
  return (await r.json()) as T;
}

export async function apiDelete(path: string): Promise<void> {
  const t0 = Date.now();
  debugLogger.apiRequest("DELETE", path);
  const r = await requestWithAuthRecovery("DELETE", path, {
    method: "DELETE",
    headers: { ...csrfHeader() },
  });
  if (!r.ok) {
    const err = await parseError(r);
    debugLogger.apiError("DELETE", path, r.status, err.message);
    throw err;
  }
  debugLogger.apiResponse("DELETE", path, r.status, Date.now() - t0);
}

export const apiBaseUrl = BASE_URL;

/**
 * Check if an ApiError is a 401 (unauthorized).
 * Useful for callers that want to handle auth errors specifically.
 */
export function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/**
 * Check if an error is a transient network failure (ECONNRESET, socket hang up, etc.).
 * These are NOT auth errors — the API may be restarting or unreachable temporarily.
 * Distinguishing these from 401s prevents false logouts during startup race conditions.
 */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof ApiError) return false; // HTTP response received → not a network error
  if (err instanceof TypeError) return true;  // fetch() throws TypeError on network failure
  if (err instanceof DOMException && err.name === "AbortError") return true; // timeout
  return false;
}

/**
 * Build a query string from params, filtering out undefined/null/empty values.
 * Returns "" (no leading ?) when there are no valid params.
 */
export function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return "";
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v != null && v !== ""),
  );
  if (Object.keys(filtered).length === 0) return "";
  return "?" + new URLSearchParams(filtered as Record<string, string>).toString();
}
