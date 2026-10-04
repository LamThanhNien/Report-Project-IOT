import { apiDelete, apiGet, apiPatch, apiPostJson, buildQuery } from "./apiClient";

export type RuleDataType = "number" | "string" | "boolean" | "enum";
export type RuleOperator =
  | ">"
  | ">="
  | "<"
  | "<="
  | "=="
  | "!="
  | "contains"
  | "not_contains"
  | "starts_with"
  | "ends_with"
  | "is_true"
  | "is_false"
  | "in"
  | "not_in"
  | "exists"
  | "not_exists";

export interface RuleCondition {
  field: string;
  operator: RuleOperator;
  value?: unknown;
  data_type: RuleDataType;
}

export interface RuleAction {
  type: "create_alert" | "send_command" | "mqtt_publish" | "call_webhook" | "create_audit_event";
  config: Record<string, unknown>;
}

export interface RuleTargetScope {
  scope_type: "all_devices" | "device" | "group" | "device_type";
  device_id?: string | null;
  group_id?: string | null;
  device_type?: string | null;
  project_id?: string | null;
}

export interface AutomationRuleData {
  name: string;
  description?: string | null;
  enabled: boolean;
  severity: "info" | "warning" | "critical";
  cooldown_seconds: number;
  trigger_type: "telemetry" | "device_event" | "device_status" | "ota" | "model_inference" | "schedule";
  target_scope: RuleTargetScope;
  condition_logic: "and" | "or";
  conditions: RuleCondition[];
  condition_config?: Record<string, unknown>;
  actions: RuleAction[];
  project_id?: string | null;
}

export interface AutomationRule extends AutomationRuleData {
  id: string;
  tenant_id: string;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface FieldDefinition {
  id: string;
  tenant_id: string;
  project_id: string | null;
  device_type: string | null;
  field_key: string;
  display_name: string;
  data_type: RuleDataType;
  unit: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export type FieldDefinitionCreateData = Omit<FieldDefinition, "id" | "tenant_id" | "created_at" | "updated_at">;

export interface RuleTestResult {
  matched: boolean;
  evaluated_fields: Record<string, unknown>;
  matched_conditions: Record<string, unknown>[];
  failed_conditions: Record<string, unknown>[];
  action_preview: Record<string, unknown>[];
  rendered_placeholders: Record<string, unknown>;
}

export interface RuleExecution {
  id: string;
  rule_id: string | null;
  tenant_id: string;
  device_id: string | null;
  trigger_type: string;
  matched: boolean;
  event_payload: Record<string, unknown>;
  evaluated_fields: Record<string, unknown>;
  matched_conditions: Record<string, unknown>[];
  failed_conditions: Record<string, unknown>[];
  action_preview: Record<string, unknown>[];
  executed_actions: Record<string, unknown>[];
  error_message: string | null;
  created_at: string;
}

export interface RuleStats {
  total_rules: number;
  enabled_rules: number;
  disabled_rules: number;
  executions_24h: number;
  matched_24h: number;
  failed_24h: number;
}

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  rule: AutomationRuleData;
}

export const ruleEngineApi = {
  listRules: (projectId?: string) => {
    const url = projectId ? `/api/v1/client/automation/rules?project_id=${encodeURIComponent(projectId)}` : "/api/v1/client/automation/rules";
    return apiGet<AutomationRule[]>(url);
  },
  getRule: (id: string) => apiGet<AutomationRule>(`/api/v1/client/automation/rules/${id}`),
  createRule: (data: AutomationRuleData) =>
    apiPostJson<AutomationRule>("/api/v1/client/automation/rules", data),
  updateRule: (id: string, data: Partial<AutomationRuleData>) =>
    apiPatch<AutomationRule>(`/api/v1/client/automation/rules/${id}`, data),
  deleteRule: (id: string) => apiDelete(`/api/v1/client/automation/rules/${id}`),
  enableRule: (id: string) =>
    apiPostJson<AutomationRule>(`/api/v1/client/automation/rules/${id}/enable`, {}),
  disableRule: (id: string) =>
    apiPostJson<AutomationRule>(`/api/v1/client/automation/rules/${id}/disable`, {}),
  duplicateRule: (id: string) =>
    apiPostJson<AutomationRule>(`/api/v1/client/automation/rules/${id}/duplicate`, {}),
  testRule: (rule: AutomationRuleData, event: Record<string, unknown>) =>
    apiPostJson<RuleTestResult>("/api/v1/client/automation/rules/test", { rule, event }),
  listExecutions: (params?: { limit?: number; offset?: number }) =>
    apiGet<RuleExecution[]>(`/api/v1/client/automation/executions${buildQuery(params)}`),
  stats: () => apiGet<RuleStats>("/api/v1/client/automation/stats"),
  templates: () => apiGet<RuleTemplate[]>("/api/v1/client/automation/templates"),
  listFieldDefinitions: () =>
    apiGet<FieldDefinition[]>("/api/v1/client/automation/field-definitions"),
  createFieldDefinition: (data: FieldDefinitionCreateData) =>
    apiPostJson<FieldDefinition>("/api/v1/client/automation/field-definitions", data),
  suggestFields: (params?: { device_id?: string }) =>
    apiGet<string[]>(`/api/v1/client/automation/field-suggestions${buildQuery(params)}`),
};
