import { apiGet } from "./apiClient";
import type { Telemetry } from "../types";

export interface TelemetryListParams {
  tenant_id?: string;
  device_uid?: string;
  metric_name?: string;
  from_time?: string;
  to_time?: string;
  limit?: number;
  offset?: number;
}

function buildQuery(params: TelemetryListParams = {}): string {
  const q = new URLSearchParams();
  if (params.tenant_id) q.set("tenant_id", params.tenant_id);
  if (params.device_uid) q.set("device_uid", params.device_uid);
  if (params.metric_name) q.set("metric_name", params.metric_name);
  if (params.from_time) q.set("from_time", params.from_time);
  if (params.to_time) q.set("to_time", params.to_time);
  if (params.limit !== undefined) q.set("limit", String(params.limit));
  if (params.offset !== undefined) q.set("offset", String(params.offset));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function listTelemetry(params: TelemetryListParams = {}) {
  return apiGet<Telemetry[]>(`/api/v1/telemetry${buildQuery(params)}`);
}

export function getDeviceTelemetry(deviceUid: string, limit = 100) {
  return apiGet<Telemetry[]>(
    `/api/v1/devices/${encodeURIComponent(deviceUid)}/telemetry?limit=${limit}`,
  );
}

export function getLatestDeviceTelemetry(deviceUid: string) {
  return apiGet<Telemetry[]>(
    `/api/v1/devices/${encodeURIComponent(deviceUid)}/latest-telemetry`,
  );
}
