import { apiBaseUrl, apiGet, ApiError } from "./apiClient";
import type { SystemHealth } from "../types";

interface ComponentHealthResp {
  status: string;
  latency_ms?: number;
  detail?: string;
}

interface SystemHealthResp {
  api: ComponentHealthResp;
  database: ComponentHealthResp;
  mqtt: ComponentHealthResp;
  storage: ComponentHealthResp;
  overall: string;
  timestamp: string;
}

interface LegacyHealthResp {
  status?: string;
}

/**
 * Fetch real per-component health from the backend.
 * Falls back to the legacy /health + /ready probe if the new endpoint is unavailable.
 */
export async function getSystemHealth(): Promise<SystemHealth> {
  // Try the new real health endpoint first
  try {
    const data = await apiGet<SystemHealthResp>("/api/v1/debug/system-health");
    return {
      api: (data.api?.status ?? "unknown") as SystemHealth["api"],
      database: (data.database?.status ?? "unknown") as SystemHealth["database"],
      mqtt: (data.mqtt?.status ?? "unknown") as SystemHealth["mqtt"],
      storage: (data.storage?.status ?? "unknown") as SystemHealth["storage"],
      ready: data.overall === "healthy",
      // Pass additional details for enhanced UI
      _details: {
        api: data.api,
        database: data.database,
        mqtt: data.mqtt,
        storage: data.storage,
        overall: data.overall,
        timestamp: data.timestamp,
      },
    } as SystemHealth & { _details: Record<string, unknown> };
  } catch (err) {
    // Authentication/authorization errors should not break the System page.
    // Fall through to legacy probe (/health + /ready) with public visibility.
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      // no-op: continue fallback below
    }
    // Fall through to legacy probe
  }

  // Legacy fallback: probe /health and /ready
  const fetchJson = async (path: string): Promise<LegacyHealthResp | null> => {
    try {
      const r = await fetch(`${apiBaseUrl}${path}`);
      if (!r.ok) return null;
      return (await r.json()) as LegacyHealthResp;
    } catch {
      return null;
    }
  };

  const [health, ready] = await Promise.all([fetchJson("/health"), fetchJson("/ready")]);
  const apiHealthy = !!health;
  const readyOk = !!ready;

  return {
    api: apiHealthy ? "healthy" : "down",
    database: readyOk ? "healthy" : apiHealthy ? "degraded" : "unknown",
    mqtt: readyOk ? "healthy" : "unknown",
    storage: readyOk ? "healthy" : "unknown",
    metrics_endpoint: `${apiBaseUrl}/metrics`,
    ready: readyOk,
  };
}
