import type { Telemetry, Device } from "../types";

const CACHE_PREFIX = "aifom_telemetry_cache_";
const CACHE_VERSION = 1;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface TelemetryCacheFilters {
  range: string;
}

export interface TelemetryCacheSnapshot {
  version: number;
  savedAt: string; // ISO timestamp
  filters: TelemetryCacheFilters;
  telemetry: Telemetry[];
  devices: Device[];
}

function cacheKey(filters: TelemetryCacheFilters): string {
  return `${CACHE_PREFIX}${filters.range}`;
}

export function saveTelemetrySnapshot(
  filters: TelemetryCacheFilters,
  telemetry: Telemetry[],
  devices: Device[],
): void {
  try {
    const snapshot: TelemetryCacheSnapshot = {
      version: CACHE_VERSION,
      savedAt: new Date().toISOString(),
      filters,
      telemetry,
      devices,
    };
    localStorage.setItem(cacheKey(filters), JSON.stringify(snapshot));
  } catch {
    // localStorage quota exceeded or unavailable — silently ignore
  }
}

export function saveTelemetrySnapshotDeferred(
  filters: TelemetryCacheFilters,
  telemetry: Telemetry[],
  devices: Device[],
): () => void {
  let cancelled = false;
  const save = () => {
    if (!cancelled) saveTelemetrySnapshot(filters, telemetry, devices);
  };

  const id = window.setTimeout(save, 250);
  return () => {
    cancelled = true;
    window.clearTimeout(id);
  };
}

export function readTelemetrySnapshot(
  filters: TelemetryCacheFilters,
): TelemetryCacheSnapshot | null {
  try {
    const raw = localStorage.getItem(cacheKey(filters));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TelemetryCacheSnapshot;
    if (parsed.version !== CACHE_VERSION) return null;
    if (typeof parsed.savedAt !== "string") return null;
    if (!Array.isArray(parsed.telemetry)) return null;
    if (!Array.isArray(parsed.devices)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function readTelemetrySnapshotDeferred(
  filters: TelemetryCacheFilters,
  onRead: (snapshot: TelemetryCacheSnapshot | null) => void,
): () => void {
  let cancelled = false;
  const read = () => {
    if (!cancelled) onRead(readTelemetrySnapshot(filters));
  };

  const id = window.setTimeout(read, 0);
  return () => {
    cancelled = true;
    window.clearTimeout(id);
  };
}

export function isTelemetrySnapshotFresh(snapshot: TelemetryCacheSnapshot): boolean {
  return Date.now() - new Date(snapshot.savedAt).getTime() < CACHE_TTL_MS;
}

export function clearTelemetryCache(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    // ignore
  }
}
