import { apiGet, apiGetBlob, buildQuery } from "./apiClient";

export interface AuditLog {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
  group_id: string | null;
  session_id: string | null;
  request_id: string | null;
  created_at: string;
}

export interface AuditTimelineEntry {
  date: string;
  events: AuditLog[];
}

export const auditEnhancedApi = {
  list: (params?: Record<string, unknown>) => {
    return apiGet<{ items: AuditLog[]; total: number }>(`/api/v1/client/audit-logs${buildQuery(params)}`);
  },

  // NOTE: /timeline endpoint does not exist in backend — kept for future use
  timeline: (params?: Record<string, unknown>) => {
    return apiGet<AuditTimelineEntry[]>(`/api/v1/client/audit-logs/timeline${buildQuery(params)}`);
  },

  // NOTE: /export endpoint does not exist in backend for client — kept for future use
  export: async (params?: Record<string, unknown>): Promise<Blob> => {
    const query = buildQuery(params);
    return apiGetBlob(`/api/v1/client/audit-logs/export${query}`);
  },
};
