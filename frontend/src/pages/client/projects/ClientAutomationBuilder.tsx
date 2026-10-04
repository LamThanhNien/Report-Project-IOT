import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useProjectScope } from "../../../hooks/useProjectScope";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Edit3, Save, TestTube2 } from "lucide-react";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { useAuth } from "../../../contexts/AuthContext";
import {
  AUTOMATION_FIELD_CATEGORIES,
  AUTOMATION_SUPPORTED_FIELDS,
  getAutomationFieldByKey,
  getAutomationFieldLabel,
  getOperatorsForFieldType,
  type AutomationSupportedFieldType,
} from "../../../features/automation/automationFields";
import { canManageAutomation } from "../../../lib/permissions";
import { listClientDevices } from "../../../services/clientApi";
import { deviceGroupApi } from "../../../services/deviceGroupApi";
import {
  ruleEngineApi,
  type AutomationRuleData,
  type RuleAction,
  type RuleCondition,
  type RuleDataType,
  type RuleOperator,
} from "../../../services/ruleEngineApi";

const DEFAULT_EVENT = JSON.stringify({ temperature: 32, humidity: 70, status: "online" }, null, 2);

function getEventOptions(t: (key: string, fallback: string) => string): Array<{ value: AutomationRuleData["trigger_type"]; label: string }> {
  return [
    { value: "device_event", label: t("automation:trigger_device_event", "Sự kiện lệnh thiết bị") },
    { value: "telemetry", label: t("automation:trigger_telemetry", "Thiết bị gửi dữ liệu") },
    { value: "device_status", label: t("automation:trigger_device_status", "Trạng thái thiết bị thay đổi") },
    { value: "ota", label: t("automation:trigger_ota", "Sự kiện OTA/Firmware") },
    { value: "schedule", label: t("automation:trigger_schedule", "Lịch chạy") },
  ];
}

function getDataTypeOptions(t: (key: string, fallback: string) => string): Array<{ value: RuleDataType; label: string }> {
  return [
    { value: "number", label: t("automation:type_number", "Số") },
    { value: "string", label: t("automation:type_string", "Chuỗi") },
    { value: "boolean", label: t("automation:type_boolean", "Đúng/Sai") },
    { value: "enum", label: t("automation:type_enum", "Danh sách") },
  ];
}

function getOperatorOptions(t: (key: string, fallback: string) => string): Array<{ value: RuleOperator; label: string }> {
  return [
    { value: ">", label: t("automation:op_gt", "lớn hơn") },
    { value: ">=", label: t("automation:op_gte", "lớn hơn hoặc bằng") },
    { value: "<", label: t("automation:op_lt", "nhỏ hơn") },
    { value: "<=", label: t("automation:op_lte", "nhỏ hơn hoặc bằng") },
    { value: "==", label: t("automation:op_eq", "bằng") },
    { value: "!=", label: t("automation:op_neq", "khác") },
    { value: "contains", label: t("automation:op_contains", "chứa") },
    { value: "not_contains", label: t("automation:op_not_contains", "không chứa") },
    { value: "exists", label: t("automation:op_exists", "tồn tại") },
    { value: "not_exists", label: t("automation:op_not_exists", "không tồn tại") },
    { value: "is_true", label: t("automation:op_is_true", "là đúng") },
    { value: "is_false", label: t("automation:op_is_false", "là sai") },
  ];
}



const DEFAULT_RULE: AutomationRuleData = {
  name: "",
  description: "",
  enabled: true,
  severity: "warning",
  cooldown_seconds: 60,
  trigger_type: "telemetry",
  target_scope: { scope_type: "all_devices" },
  condition_logic: "and",
  conditions: [{ field: "temperature", operator: ">", value: 30, data_type: "number" }],
  actions: [
    {
      type: "create_alert",
      config: {
        title: "Cảnh báo thiết bị",
        message: "Thiết bị {device_name} gửi giá trị {field_value}",
        severity: "warning",
      },
    },
  ],
};

function getBooleanValueOptions(t: (key: string, fallback: string) => string): Array<{ value: string; label: string }> {
  return [
    { value: "true", label: t("automation:bool_true", "Có / Bật / Đúng") },
    { value: "false", label: t("automation:bool_false", "Không / Tắt / Sai") },
  ];
}

function isSupportedFieldType(type: RuleDataType): type is AutomationSupportedFieldType {
  return type === "number" || type === "boolean" || type === "string";
}

function defaultValueForType(type: AutomationSupportedFieldType): unknown {
  if (type === "number") return 0;
  if (type === "boolean") return "true";
  return "";
}

function coerceValueForType(value: unknown, type: AutomationSupportedFieldType): unknown {
  if (type === "number") {
    if (typeof value === "boolean") return defaultValueForType(type);
    const numeric = Number(value);
    return Number.isFinite(numeric) ? value : defaultValueForType(type);
  }
  if (type === "boolean") {
    return value === true || value === "true" ? "true" : value === false || value === "false" ? "false" : defaultValueForType(type);
  }
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : defaultValueForType(type);
}

function normalizeValue(condition: RuleCondition): unknown {
  if (condition.operator === "exists" || condition.operator === "not_exists") return null;
  if (condition.operator === "is_true") return true;
  if (condition.operator === "is_false") return false;
  if (condition.data_type === "number") return Number(condition.value);
  if (condition.data_type === "boolean") return String(condition.value) === "true";
  if (condition.data_type === "enum" && typeof condition.value === "string") {
    return condition.value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return condition.value ?? "";
}

function toPayload(state: AutomationRuleData): AutomationRuleData {
  return {
    ...state,
    description: state.description || null,
    cooldown_seconds: Number(state.cooldown_seconds) || 0,
    conditions: state.conditions.map((condition) => {
      const field = getAutomationFieldByKey(condition.field);
      const normalizedCondition = {
        ...condition,
        data_type: field?.type ?? condition.data_type,
      };
      return { ...normalizedCondition, value: normalizeValue(normalizedCondition) };
    }),
    actions: state.actions.map((action) => {
      if (action.type === "create_alert") {
        return {
          ...action,
          config: {
            ...action.config,
            severity: state.severity,
          },
        };
      }
      return action;
    }),
  };
}

function firstAction(state: AutomationRuleData): RuleAction {
  return state.actions[0] ?? DEFAULT_RULE.actions[0];
}

function operatorLabel(operator: RuleOperator, t: (key: string, fallback: string) => string): string {
  return getOperatorOptions(t).find((option) => option.value === operator)?.label ?? operator;
}

function dataTypeLabel(type: RuleDataType, t: (key: string, fallback: string) => string): string {
  return getDataTypeOptions(t).find((option) => option.value === type)?.label ?? type;
}

function formatConditionValue(condition: RuleCondition, t: (key: string, fallback: string) => string): string {
  if (condition.operator === "exists" || condition.operator === "not_exists") return "";
  if (condition.data_type === "boolean") {
    return condition.value === true || condition.value === "true"
      ? t("automation:bool_true", "Có / Bật / Đúng")
      : t("automation:bool_false", "Không / Tắt / Sai");
  }
  return String(condition.value ?? "");
}

export default function ClientAutomationBuilder({ readOnly = false, scopedProjectId }: { readOnly?: boolean; scopedProjectId?: string }) {
  const { t } = useTranslation(["automation", "common"]);
  const eventOptions = getEventOptions(t);
  const dataTypeOptions = getDataTypeOptions(t);
  const operatorOptions = getOperatorOptions(t);
  const booleanValueOptions = getBooleanValueOptions(t);

  const { isWorkspace, projectId, resolveLink } = useProjectScope();
  const effectiveProjectId = scopedProjectId || projectId;
  const { user } = useAuth();
  const canManage = canManageAutomation(user);
  const { ruleId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = Boolean(ruleId);

  const [state, setState] = useState<AutomationRuleData>(DEFAULT_RULE);
  const [sampleEvent, setSampleEvent] = useState(DEFAULT_EVENT);
  const [formError, setFormError] = useState<string | null>(null);

  const ruleQuery = useQuery({
    queryKey: ["client-automation-rule", ruleId],
    queryFn: () => ruleEngineApi.getRule(ruleId ?? ""),
    enabled: Boolean(ruleId),
  });
  const { data: devices = [] } = useQuery({ queryKey: ["client-devices", effectiveProjectId], queryFn: () => listClientDevices(effectiveProjectId || undefined) });
  const groupsQ = useQuery({
    queryKey: ["automation-device-groups", effectiveProjectId],
    queryFn: () => deviceGroupApi.listDeviceGroups(effectiveProjectId ? { limit: 200, project_id: effectiveProjectId || undefined } : { limit: 200 }),
  });

  useEffect(() => {
    if (ruleQuery.data) setState(ruleQuery.data);
  }, [ruleQuery.data]);

  const saveMut = useMutation({
    mutationFn: (payload: AutomationRuleData) =>
      ruleId ? ruleEngineApi.updateRule(ruleId, payload) : ruleEngineApi.createRule(payload),
    onSuccess: async (rule) => {
      await qc.invalidateQueries({ queryKey: ["client-automation-rules"] });
      await qc.invalidateQueries({ queryKey: ["client-automation-stats"] });
      navigate(resolveLink(`/automation/${rule.id}`));
    },
  });

  const testMut = useMutation({
    mutationFn: (event: Record<string, unknown>) => ruleEngineApi.testRule({ ...toPayload(state), ...(effectiveProjectId ? { project_id: effectiveProjectId } : {}) }, event),
  });

  const condition = state.conditions[0] ?? DEFAULT_RULE.conditions[0];
  const action = firstAction(state);
  const alertConfig = action.config;
  const selectedField = getAutomationFieldByKey(condition.field);
  const effectiveDataType = selectedField?.type ?? condition.data_type;
  const availableOperators = selectedField && isSupportedFieldType(effectiveDataType)
    ? getOperatorsForFieldType(effectiveDataType)
    : operatorOptions.map((option) => option.value);
  const visibleOperatorOptions = operatorOptions.filter((option) => availableOperators.includes(option.value));
  const fieldHasUnknownValue = Boolean(condition.field && !selectedField);
  const conditionForSummary: RuleCondition = { ...condition, data_type: effectiveDataType };
  const selectedGroup = groupsQ.data?.items.find((group) => group.id === state.target_scope.group_id);

  function update(patch: Partial<AutomationRuleData>) {
    setState((current) => ({ ...current, ...patch }));
  }

  function updateCondition(patch: Partial<RuleCondition>) {
    setState((current) => ({
      ...current,
      conditions: [{ ...condition, ...patch }],
    }));
  }

  function updateConditionField(fieldKey: string) {
    const field = getAutomationFieldByKey(fieldKey);
    if (!field) {
      updateCondition({ field: fieldKey });
      return;
    }
    const operators = getOperatorsForFieldType(field.type);
    updateCondition({
      field: field.key,
      data_type: field.type,
      operator: operators.includes(condition.operator) ? condition.operator : operators[0],
      value: coerceValueForType(condition.value, field.type),
    });
  }

  function updateAlertConfig(patch: Record<string, unknown>) {
    setState((current) => ({
      ...current,
      actions: [{ type: "create_alert", config: { ...alertConfig, ...patch } }],
    }));
  }

  function updateTarget(scopeType: AutomationRuleData["target_scope"]["scope_type"], value = "") {
    update({
      target_scope: {
        scope_type: scopeType,
        device_id: scopeType === "device" ? value : null,
        device_type: scopeType === "device_type" ? value : null,
        group_id: scopeType === "group" ? value : null,
      },
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!state.name.trim()) {
      setFormError(t("automation:err_rule_name_required", "Vui lòng nhập tên quy tắc."));
      return;
    }
    if (!condition.field.trim() || (!isEdit && !getAutomationFieldByKey(condition.field))) {
      setFormError(t("automation:err_field_required", "Vui lòng chọn trường dữ liệu hợp lệ cần kiểm tra."));
      return;
    }
    if (state.target_scope.scope_type === "group" && !state.target_scope.group_id) {
      setFormError(t("automation:err_group_required", "Vui lòng chọn nhóm thiết bị cho rule áp dụng theo nhóm."));
      return;
    }
    saveMut.mutate({ ...toPayload(state), ...(effectiveProjectId ? { project_id: effectiveProjectId } : {}) });
  }

  function testRule() {
    setFormError(null);
    try {
      const parsed = JSON.parse(sampleEvent) as Record<string, unknown>;
      testMut.mutate(parsed);
    } catch {
      setFormError(t("automation:err_invalid_sample_json", "Dữ liệu mẫu phải là JSON hợp lệ."));
    }
  }

  function targetScopeSummary(): string {
    if (state.target_scope.scope_type === "all_devices") return t("automation:target_all_devices", "Tất cả thiết bị");
    if (state.target_scope.scope_type === "device") {
      const device = devices.find((item) => item.id === state.target_scope.device_id);
      return device ? t("automation:target_device_name", "Thiết bị: {{name}}", { name: device.name || device.device_uid }) : t("automation:target_device_selected", "Thiết bị đã chọn");
    }
    if (state.target_scope.scope_type === "group") {
      return selectedGroup ? t("automation:target_group_name", "Nhóm: {{name}}", { name: selectedGroup.name }) : t("automation:target_group_selected", "Nhóm đã chọn");
    }
    if (state.target_scope.scope_type === "device_type") return t("automation:target_device_type", "Loại thiết bị: {{type}}", { type: state.target_scope.device_type || "-" });
    return t("automation:target_custom", "Đối tượng tùy chỉnh");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={readOnly ? t("automation:detail_title", "Chi tiết quy tắc tự động hóa") : isEdit ? t("automation:edit_title", "Sửa quy tắc tự động hóa") : t("automation:create_title", "Tạo quy tắc tự động hóa")}
        subtitle={t("automation:builder_subtitle", "Cấu hình nguồn sự kiện, đối tượng áp dụng, điều kiện và hành động bằng biểu mẫu.")}
        actions={
          <>
            <Link className="btn-secondary" to={resolveLink("/automation")}>
              <ArrowLeft className="h-4 w-4" />
              {t("automation:back_to_automation", "Quay lại tự động hóa")}
            </Link>
            {readOnly && ruleId && canManage ? (
              <Link className="btn-primary" to={resolveLink(`/automation/${ruleId}/edit`)}>
                <Edit3 className="h-4 w-4" />
                {t("common:actions.edit", "Sửa")}
              </Link>
            ) : !readOnly ? (
              <button type="button" className="btn-primary" onClick={submit} disabled={saveMut.isPending}>
                <Save className="h-4 w-4" />
                {saveMut.isPending ? t("common:actions.saving", "Đang lưu...") : t("automation:save_rule", "Lưu quy tắc")}
              </button>
            ) : null}
          </>
        }
      />

      {ruleQuery.isLoading ? (
        <div className="card h-80 animate-pulse" />
      ) : (
        <form className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]" onSubmit={submit}>
          <main className="space-y-4">
            {(formError || saveMut.isError || ruleQuery.isError) && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {formError || t("automation:err_process_rule", "Không thể xử lý quy tắc. Vui lòng thử lại.")}
              </div>
            )}

            <section className="card space-y-4 p-5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-text-primary">{t("automation:section_rule_info", "Thông tin quy tắc")}</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <LabeledInput label={t("automation:label_rule_name", "Tên quy tắc")} value={state.name} disabled={readOnly} onChange={(value) => update({ name: value })} placeholder={t("automation:ph_rule_name", "Ví dụ: Cảnh báo nhiệt độ cao")} />
                <label className="space-y-1">
                  <span className="text-sm font-medium">{t("automation:label_severity", "Mức độ")}</span>
                  <select className="input w-full" value={state.severity} disabled={readOnly} onChange={(event) => update({ severity: event.target.value as AutomationRuleData["severity"] })}>
                    <option value="info">{t("automation:severity_info", "Thông tin")}</option>
                    <option value="warning">{t("automation:severity_warning", "Cảnh báo")}</option>
                    <option value="critical">{t("automation:severity_critical", "Nghiêm trọng")}</option>
                  </select>
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-sm font-medium">{t("automation:label_description", "Mô tả")}</span>
                  <textarea className="input min-h-20 w-full" value={state.description ?? ""} disabled={readOnly} onChange={(event) => update({ description: event.target.value })} />
                </label>
              </div>
            </section>

            <section className="card space-y-4 p-5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-text-primary">{t("automation:section_event_and_target", "Nguồn sự kiện và đối tượng")}</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-sm font-medium">{t("automation:label_event_source", "Nguồn sự kiện")}</span>
                  <select className="input w-full" value={state.trigger_type} disabled={readOnly} onChange={(event) => update({ trigger_type: event.target.value as AutomationRuleData["trigger_type"] })}>
                    {eventOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium">{t("automation:label_applied_target", "Đối tượng áp dụng")}</span>
                  <select className="input w-full" value={state.target_scope.scope_type} disabled={readOnly} onChange={(event) => updateTarget(event.target.value as AutomationRuleData["target_scope"]["scope_type"])}>
                    <option value="all_devices">{t("automation:target_all_devices", "Tất cả thiết bị")}</option>
                    <option value="device">{t("automation:target_single_device", "Một thiết bị")}</option>
                    <option value="group">{t("automation:target_group", "Nhóm thiết bị")}</option>
                    <option value="device_type">{t("automation:target_device_type_opt", "Loại thiết bị")}</option>
                  </select>
                </label>
                {state.target_scope.scope_type === "device" && (
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-sm font-medium">{t("automation:label_device", "Thiết bị")}</span>
                    <select className="input w-full" value={state.target_scope.device_id ?? ""} disabled={readOnly} onChange={(event) => updateTarget("device", event.target.value)}>
                      <option value="">{t("automation:select_device", "Chọn thiết bị")}</option>
                      {devices.map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.name || device.device_uid} - {device.status || t("automation:unknown", "không rõ")}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {state.target_scope.scope_type === "group" && (
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-sm font-medium">{t("automation:label_group", "Nhóm thiết bị")}</span>
                    <select
                      className="input w-full"
                      value={state.target_scope.group_id ?? ""}
                      disabled={readOnly}
                      onChange={(event) => updateTarget("group", event.target.value)}
                    >
                      <option value="">{t("automation:select_group", "Chọn nhóm thiết bị")}</option>
                      {(groupsQ.data?.items ?? []).map((group) => (
                        <option key={group.id} value={group.id}>
                          {t("automation:group_device_count", "{{name}} - {{count}} thiết bị", { name: group.name, count: group.device_count })}
                        </option>
                      ))}
                    </select>
                    {(groupsQ.data?.items ?? []).length === 0 && (
                      <span className="block text-xs text-slate-500">{t("automation:no_groups_to_select", "Chưa có nhóm thiết bị để chọn.")}</span>
                    )}
                  </label>
                )}
                {state.target_scope.scope_type === "device_type" && (
                  <LabeledInput label={t("automation:label_device_type", "Loại thiết bị")} value={state.target_scope.device_type ?? ""} disabled={readOnly} onChange={(value) => updateTarget("device_type", value)} placeholder={t("automation:ph_device_type", "Ví dụ: esp32")} />
                )}
              </div>
            </section>

            <section className="card space-y-4 p-5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-text-primary">{t("automation:section_conditions", "Điều kiện")}</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <label className="space-y-1">
                  <span className="text-sm font-medium">{t("automation:label_field", "Trường dữ liệu")}</span>
                  <select className="input w-full" value={condition.field} disabled={readOnly} onChange={(event) => updateConditionField(event.target.value)}>
                    {fieldHasUnknownValue && (
                      <option value={condition.field}>{getAutomationFieldLabel(condition.field)}</option>
                    )}
                    {AUTOMATION_FIELD_CATEGORIES.map((category) => (
                      <optgroup key={category.value} label={category.label}>
                        {AUTOMATION_SUPPORTED_FIELDS.filter((field) => field.category === category.value).map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label} ({field.key}){field.unit ? ` - ${field.unit}` : ""}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <span className="block text-xs text-slate-500">
                    {t("automation:field_hint", "Chọn trường dữ liệu mà hệ thống sẽ kiểm tra khi rule chạy.")}
                  </span>
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium">{t("automation:label_data_type", "Kiểu dữ liệu")}</span>
                  <input className="input w-full" value={dataTypeLabel(effectiveDataType, t)} disabled readOnly />
                </label>
                <label className="space-y-1">
                  <span className="text-sm font-medium">{t("automation:label_operator", "Toán tử")}</span>
                  <select className="input w-full" value={condition.operator} disabled={readOnly} onChange={(event) => updateCondition({ operator: event.target.value as RuleOperator })}>
                    {visibleOperatorOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                {effectiveDataType === "boolean" ? (
                  <label className="space-y-1">
                    <span className="text-sm font-medium">{t("automation:label_value", "Giá trị")}</span>
                    <select className="input w-full" value={String(coerceValueForType(condition.value, "boolean"))} disabled={readOnly} onChange={(event) => updateCondition({ value: event.target.value })}>
                      {booleanValueOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <LabeledInput
                    label={t("automation:label_value", "Giá trị")}
                    type={effectiveDataType === "number" ? "number" : "text"}
                    value={String(condition.value ?? "")}
                    disabled={readOnly || condition.operator === "exists" || condition.operator === "not_exists"}
                    onChange={(value) => updateCondition({ value })}
                    placeholder={effectiveDataType === "number" ? "30" : "online"}
                  />
                )}
              </div>
            </section>

            <section className="card space-y-4 p-5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-text-primary">{t("automation:section_actions", "Hành động")}</h2>
              <div className="grid grid-cols-1 gap-4">
                <LabeledInput label={t("automation:label_alert_title", "Tiêu đề cảnh báo")} value={String(alertConfig.title ?? "")} disabled={readOnly} onChange={(value) => updateAlertConfig({ title: value })} />
                <label className="space-y-1">
                  <span className="text-sm font-medium">{t("automation:label_alert_message", "Nội dung cảnh báo")}</span>
                  <textarea className="input min-h-20 w-full" value={String(alertConfig.message ?? "")} disabled={readOnly} onChange={(event) => updateAlertConfig({ message: event.target.value })} />
                </label>
              </div>
            </section>
          </main>

          <aside className="space-y-4">
            <section className="card space-y-3 p-5">
              <h2 className="text-base font-semibold text-slate-900 dark:text-text-primary">{t("automation:summary_title", "Tóm tắt")}</h2>
              <SummaryItem label={t("automation:col_status", "Trạng thái")} value={state.enabled ? t("automation:status_enabled", "Đang bật") : t("automation:status_disabled", "Đang tắt")} />
              <SummaryItem label={t("automation:col_triggered_by", "Nguồn sự kiện")} value={eventOptions.find((item) => item.value === state.trigger_type)?.label ?? state.trigger_type} />
              <SummaryItem label={t("automation:col_target", "Đối tượng")} value={targetScopeSummary()} />
              <SummaryItem label={t("automation:label_condition", "Điều kiện")} value={`${getAutomationFieldLabel(condition.field) || "-"} ${operatorLabel(condition.operator, t)} ${formatConditionValue(conditionForSummary, t)}`.trim()} />
              {readOnly && <StatusBadge tone={state.enabled ? "success" : "neutral"} label={state.enabled ? t("automation:status_enabled", "Đang bật") : t("automation:status_disabled", "Đang tắt")} />}
            </section>

            <section className="card space-y-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-900 dark:text-text-primary">{t("automation:quick_test_title", "Kiểm tra nhanh")}</h2>
                <button type="button" className="btn-secondary h-8 px-2 text-xs" onClick={testRule} disabled={readOnly || !canManage || testMut.isPending}>
                  <TestTube2 className="h-3.5 w-3.5" />
                  {t("automation:test_btn", "Kiểm tra")}
                </button>
              </div>
              <textarea className="input min-h-40 w-full font-mono text-xs" value={sampleEvent} onChange={(event) => setSampleEvent(event.target.value)} />
              {testMut.data && (
                <div className="rounded-md bg-slate-50 p-3 text-sm dark:bg-app">
                  {t("automation:test_result_prefix", "Kết quả: ")}{testMut.data.matched ? t("automation:test_matched", "Khớp điều kiện") : t("automation:test_not_matched", "Không khớp")}
                </div>
              )}
            </section>
          </aside>
        </form>
      )}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  type?: "number" | "text";
}) {
  return (
    <label className="space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <input type={type} className="input w-full" value={value} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 p-3 dark:bg-app">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900 dark:text-text-primary">{value}</div>
    </div>
  );
}
