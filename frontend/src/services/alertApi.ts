import { apiGet, apiPostJson } from "./apiClient";
import type { Alert } from "../types";

export interface AlertFilters {
  tenant_id?: string;
  severity?: string;
  status?: string;
  source_type?: string;
  device_uid?: string;
  from_time?: string;
  to_time?: string;
}

function queryString(filters: AlertFilters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => value && params.set(key, value));
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function listAlerts(): Promise<Alert[]>;
export function listAlerts(filters: AlertFilters): Promise<Alert[]>;
export function listAlerts(filters: AlertFilters = {}): Promise<Alert[]> {
  return apiGet<Alert[]>(`/api/v1/admin/alerts${queryString(filters)}`);
}

export function acknowledgeAlert(alertId: string): Promise<Alert> {
  return apiPostJson(`/api/v1/admin/alerts/${encodeURIComponent(alertId)}/ack`, {});
}

export function resolveAlert(alertId: string): Promise<Alert> {
  return apiPostJson(`/api/v1/admin/alerts/${encodeURIComponent(alertId)}/resolve`, {});
}
