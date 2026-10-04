import { apiGet, apiGetBlob, buildQuery } from "./apiClient";

export const adminApi = {
  listDeviceGroups: (params?: Record<string, unknown>) => {
    return apiGet<{ items: unknown[]; total: number }>(`/api/v1/admin/device-groups${buildQuery(params)}`);
  },

  listProvisioningSessions: (params?: Record<string, unknown>) => {
    return apiGet<{ items: unknown[]; total: number }>(`/api/v1/admin/provisioning/sessions${buildQuery(params)}`);
  },

  listCommandHistory: (params?: Record<string, unknown>) => {
    return apiGet<{ items: unknown[]; total: number }>(`/api/v1/admin/commands/history${buildQuery(params)}`);
  },

  listAuditLogs: (params?: Record<string, unknown>) => {
    return apiGet<{ items: unknown[]; total: number }>(`/api/v1/admin/audit-logs${buildQuery(params)}`);
  },

  getAuditTimeline: (params?: Record<string, unknown>) => {
    return apiGet<unknown[]>(`/api/v1/admin/audit-logs/timeline${buildQuery(params)}`);
  },

  exportAuditLogs: async (params?: Record<string, unknown>): Promise<Blob> => {
    const query = buildQuery(params);
    return apiGetBlob(`/api/v1/admin/audit-logs/export${query}`);
  },
};
