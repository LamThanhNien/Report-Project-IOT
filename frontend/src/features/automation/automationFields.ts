import type { RuleDataType, RuleOperator } from "../../services/ruleEngineApi";

export type AutomationFieldCategory = "sensor" | "device_status" | "connectivity_system";
export type AutomationSupportedFieldType = Extract<RuleDataType, "number" | "boolean" | "string">;

export interface AutomationFieldDefinition {
  key: string;
  label: string;
  type: AutomationSupportedFieldType;
  category: AutomationFieldCategory;
  unit?: string;
  description?: string;
}

export const AUTOMATION_FIELD_CATEGORIES: Array<{ value: AutomationFieldCategory; label: string }> = [
  { value: "sensor", label: "Dữ liệu cảm biến" },
  { value: "device_status", label: "Trạng thái thiết bị" },
  { value: "connectivity_system", label: "Kết nối & hệ thống" },
];

export const AUTOMATION_SUPPORTED_FIELDS: AutomationFieldDefinition[] = [
  { key: "temperature", label: "Nhiệt độ", type: "number", category: "sensor", unit: "°C" },
  { key: "humidity", label: "Độ ẩm", type: "number", category: "sensor", unit: "%" },
  { key: "pressure", label: "Áp suất", type: "number", category: "sensor", unit: "hPa" },
  { key: "light", label: "Ánh sáng", type: "number", category: "sensor", unit: "lux" },
  { key: "voltage", label: "Điện áp", type: "number", category: "sensor", unit: "V" },
  { key: "current", label: "Dòng điện", type: "number", category: "sensor", unit: "A" },
  { key: "power", label: "Công suất", type: "number", category: "sensor", unit: "W" },
  { key: "battery", label: "Pin", type: "number", category: "sensor", unit: "%" },
  { key: "motion", label: "Phát hiện chuyển động", type: "boolean", category: "sensor" },
  { key: "relay_state", label: "Trạng thái relay", type: "boolean", category: "device_status" },
  { key: "door_open", label: "Trạng thái cửa", type: "boolean", category: "device_status" },
  { key: "smoke_detected", label: "Phát hiện khói", type: "boolean", category: "sensor" },
  { key: "gas_detected", label: "Phát hiện khí gas", type: "boolean", category: "sensor" },
  { key: "status", label: "Trạng thái thiết bị", type: "string", category: "device_status" },
  { key: "firmware_version", label: "Phiên bản firmware", type: "string", category: "connectivity_system" },
  { key: "ip_address", label: "Địa chỉ IP", type: "string", category: "connectivity_system" },
  { key: "mac_address", label: "Địa chỉ MAC", type: "string", category: "connectivity_system" },
  { key: "rssi", label: "Cường độ WiFi", type: "number", category: "connectivity_system", unit: "dBm" },
  { key: "uptime_ms", label: "Thời gian hoạt động", type: "number", category: "connectivity_system", unit: "ms" },
  { key: "free_heap", label: "Bộ nhớ trống", type: "number", category: "connectivity_system", unit: "bytes" },
];

const OPERATOR_BY_TYPE: Record<AutomationSupportedFieldType, RuleOperator[]> = {
  number: ["==", "!=", ">", ">=", "<", "<="],
  boolean: ["==", "!="],
  string: ["==", "!=", "contains", "not_contains"],
};

export function getAutomationFieldByKey(key?: string | null): AutomationFieldDefinition | undefined {
  return AUTOMATION_SUPPORTED_FIELDS.find((field) => field.key === key);
}

export function getAutomationFieldLabel(key?: string | null, t?: (key: string, fallback: string) => string): string {
  const field = getAutomationFieldByKey(key);
  if (!field) return key ? (t ? t("automation:field_unknown", `Trường không xác định: ${key}`) : `Trường không xác định: ${key}`) : "-";
  return t ? t(`automation:field_${field.key}`, field.label) : field.label;
}

export function getAutomationCategoryLabel(category: AutomationFieldCategory, t?: (key: string, fallback: string) => string): string {
  const defaultLabel = AUTOMATION_FIELD_CATEGORIES.find((c) => c.value === category)?.label ?? category;
  return t ? t(`automation:cat_${category}`, defaultLabel) : defaultLabel;
}

export function getOperatorsForFieldType(type: AutomationSupportedFieldType): RuleOperator[] {
  return OPERATOR_BY_TYPE[type];
}
