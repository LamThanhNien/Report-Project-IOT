import { apiDelete, apiGet, apiPut, apiPostJson, buildQuery } from "./apiClient";

export interface CommandTemplate {
  id: string;
  tenant_id: string | null;
  name: string;
  description: string | null;
  command_type: string;
  payload_template: Record<string, unknown>;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommandDispatch {
  id: string;
  tenant_id: string | null;
  command_type: string;
  target_type: string;
  status: string;
  sent_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  retry_count: number;
  created_at: string;
  targets: CommandTarget[];
}

export interface CommandTarget {
  id: string;
  device_id: string;
  status: string;
  sent_at: string | null;
  acked_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export interface CommandTemplateCreateData {
  name: string;
  description?: string;
  command_type: string;
  payload_template?: Record<string, unknown>;
}

export interface CommandTemplateUpdateData {
  name?: string;
  description?: string | null;
  command_type?: string;
  payload_template?: Record<string, unknown>;
}

export interface CommandDispatchData {
  template_id?: string;
  command_type: string;
  payload?: Record<string, unknown>;
  target_type: 'device' | 'group';
  target_device_id?: string;
  target_group_id?: string;
}

export const commandCenterApi = {
  listTemplates: (projectId?: string) => {
    const url = projectId ? `/api/v1/client/commands/templates?project_id=${encodeURIComponent(projectId)}` : "/api/v1/client/commands/templates";
    return apiGet<CommandTemplate[]>(url);
  },

  getTemplate: (id: string) =>
    apiGet<CommandTemplate>(`/api/v1/client/commands/templates/${id}`),

  createTemplate: (data: CommandTemplateCreateData) =>
    apiPostJson<CommandTemplate>("/api/v1/client/commands/templates", data),

  updateTemplate: (id: string, data: CommandTemplateUpdateData) =>
    apiPut<CommandTemplate>(`/api/v1/client/commands/templates/${id}`, data),

  deleteTemplate: (id: string) =>
    apiDelete(`/api/v1/client/commands/templates/${id}`),

  dispatch: (data: CommandDispatchData) =>
    apiPostJson<CommandDispatch>("/api/v1/client/commands/dispatch", data),

  getDispatch: (id: string) =>
    apiGet<CommandDispatch>(`/api/v1/client/commands/dispatch/${id}`),

  listHistory: (params?: Record<string, unknown>) => {
    return apiGet<{ items: CommandDispatch[]; total: number }>(`/api/v1/client/commands/history${buildQuery(params)}`);
  },

  retry: (id: string) =>
    apiPostJson<CommandDispatch>(`/api/v1/client/commands/dispatch/${id}/retry`, {}),
};
