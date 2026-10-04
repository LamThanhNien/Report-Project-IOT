export type TenantSummary = {
  id: string;
  name: string;
  slug?: string | null;
  email?: string | null;
};

export interface Device {
  id: string;
  device_uid: string;
  name: string;
  hardware_model?: string | null;
  mac_address?: string | null;
  description?: string | null;
  firmware_version: string | null;
  status: string;
  ip_address?: string | null;
  rssi?: number | null;
  free_heap?: number | null;
  uptime_ms?: number | null;
  last_status_payload?: Record<string, unknown> | null;
  last_seen_at: string | null;
  offline_timeout_seconds?: number | null;
  device_model_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  deleted_by?: string | null;
  project_id?: string | null;
  tenant?: TenantSummary | null;
}

export interface DeviceStatus {
  device_uid: string;
  name: string;
  firmware_version: string | null;
  status: string;
  ip_address?: string | null;
  rssi?: number | null;
  free_heap?: number | null;
  uptime_ms?: number | null;
  last_status_payload?: Record<string, unknown> | null;
  last_seen_at: string | null;
  offline_timeout_seconds?: number;
  tenant?: TenantSummary | null;
}

export interface Telemetry {
  id: string;
  device_id: string;
  device_uid: string;
  timestamp: string;
  metric_name: string;
  metric_value: number;
  unit: string | null;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
}

export interface Firmware {
  id: string;
  version: string;
  target_device_type: string;
  file_name: string | null;
  object_key: string | null;
  file_size: number | null;
  checksum_sha256: string | null;
  release_notes: string | null;
  is_active: boolean;
  /** "binary" | "ino_source" | "ino_compiled" */
  source_type: string;
  source_code: string | null;
  board_fqbn: string | null;
  uploaded_by_tenant_id: string | null;
  tenant?: TenantSummary | null;
  release_channel?: "dev" | "staging" | "stable" | null;
  signature?: string | null;
  signature_alg?: string | null;
  signature_payload?: string | null;
  signing_key_id?: string | null;
  signing_public_key?: string | null;
  signed_at?: string | null;
  verification_required?: boolean;
  archived_at?: string | null;
  created_at: string;
}

export interface OtaCampaign {
  id: string;
  tenant_id: string | null;
  name: string;
  firmware_id: string;
  firmware_version: string;
  target_scope: "all" | "device_group" | "device_model" | "selected_devices";
  target_ids: string[];
  rollout_strategy: "all_at_once" | "phased" | "canary";
  rollout_percentages: number[];
  current_phase: number;
  status: "draft" | "scheduled" | "running" | "paused" | "completed" | "failed" | "cancelled";
  max_concurrent_updates: number;
  retry_limit: number;
  rollback_threshold: number;
  maintenance_window_start: string | null;
  maintenance_window_end: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  total_targets: number;
  pending_count: number;
  running_count: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  failure_rate: number;
  last_error: string | null;
}

export interface OtaJob {
  id: string;
  device_id: string;
  device_uid: string;
  firmware_version_id: string;
  firmware_version: string;
  status: string;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  progress?: number | null;
  last_message?: string | null;
  error_code?: string | null;
  error_message: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
  tenant?: TenantSummary | null;
}

export interface OtaJobCreateResponse {
  job_id: string;
  device_uid: string;
  status: string;
  job_ids?: string[] | null;
  group_id?: string | null;
  created_count?: number | null;
  target_type?: "device" | "group";
}

export type Severity = "info" | "warning" | "critical";

export interface Alert {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  device_uid: string | null;
  device_id?: string | null;
  source: string;
  source_type?: string;
  source_id?: string | null;
  timestamp: string;
  status: "open" | "acknowledged" | "resolved";
  first_seen_at?: string;
  last_seen_at?: string;
  acknowledged_at?: string | null;
  resolved_at?: string | null;
  metadata?: Record<string, unknown>;
  tenant?: TenantSummary | null;
}

export interface SystemHealth {
  api: "healthy" | "degraded" | "down";
  database: "healthy" | "degraded" | "down" | "unknown";
  mqtt: "healthy" | "degraded" | "down" | "unknown";
  storage: "healthy" | "degraded" | "down" | "unknown";
  metrics_endpoint?: string;
  ready?: boolean;
}

export type ReleaseChannel = "dev" | "staging" | "stable";

export interface DeviceGroup {
  id: string;
  name: string;
  description: string;
  device_count: number;
}

// ── Tenant / SaaS platform types ─────────────────────────────────────────────

export type FeatureKey =
  | "device_management"
  | "ota_update"
  | "firmware_history"
  | "telemetry_view"
  | "advanced_monitoring"
  | "alert_management"
  | "api_access"
  | "user_management"
  | "audit_log";

export type FeatureMap = Record<FeatureKey, boolean>;

export interface ServicePlan {
  id: string;
  name: string;
  max_devices: number;
  max_users: number;
  telemetry_retention_days: number;
  features: FeatureMap;
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  plan_id: string | null;
  plan_name: string | null;
  device_count: number;
  user_count: number;
  created_at: string;
}

export interface ClientMe {
  user_id: string;
  email: string;
  full_name: string | null;
  role: string;
  permissions: string[];
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  plan_name: string | null;
  features: FeatureMap;
}

export interface ClientDashboard {
  total_devices: number;
  online_devices: number;
  offline_devices: number;
  total_telemetry_today: number;
  device_status_summary: Record<string, number>;
}

export interface TenantUser {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  permissions: string[];
  tenant_id: string | null;
  created_at: string;
}

export interface AnomalyAlert {
  id: string;
  device_uid: string;
  timestamp: string;
  metric_name: string;
  metric_value: number | null;
  anomaly_score: number | null;
  severity: "info" | "warning" | "critical";
  title?: string;
  message?: string;
  source?: string;
  status?: string;
  details?: Record<string, unknown>;
}

export interface MqttConfig {
  broker_host: string;
  broker_port: number;
  client_id_suggestion: string;
  topic_telemetry: string;
  topic_status: string;
  topic_events: string;
  topic_commands: string;
  topic_ota: string;
  topic_ota_status: string;
  sdkconfig_snippet: string;
}

export interface TenantProject {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantProjectSummary {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantProjectDetail extends TenantProject {
  pages: ProjectPage[];
  latest_state: Record<string, Record<string, unknown>>;
}

export interface DeviceProjectBindingSummary {
  project_id: string;
  project_name: string;
}

export interface DeviceLiveStatus {
  connection_status: string | null;
  mqtt_status: string | null;
  last_telemetry_at: string | null;
  latest_payload: Record<string, unknown>;
  sensor_values: Record<string, unknown>;
  output_states: Record<string, unknown>;
  system_values: Record<string, unknown>;
}

export interface DeviceChannelState {
  id?: string;
  device_id?: string;
  channel?: string | null;
  gpio_pin?: number | null;
  capability_key?: string | null;
  capability_type?: string | null;
  desired_value?: unknown;
  reported_value?: unknown;
  sync_status?: "synced" | "pending" | "failed" | "unknown" | string | null;
  last_reported_at?: string | null;
  updated_at?: string | null;
  telemetry_state_key?: string | null;
}

export interface DeviceActivityItem {
  kind: string;
  title: string;
  timestamp: string;
  severity: string | null;
  status: string | null;
  detail: Record<string, unknown>;
}

export interface TenantDeviceDetail {
  device: Device;
  live_status: DeviceLiveStatus;
  project_bindings: DeviceProjectBindingSummary[];
  channel_states?: DeviceChannelState[];
  device_channel_states?: DeviceChannelState[];
  recent_telemetry: Telemetry[];
  ota_jobs: OtaJob[];
  alerts: AnomalyAlert[];
  available_firmware: Firmware[];
  activity: DeviceActivityItem[];
  can_send_commands: boolean;
  can_reboot: boolean;
}

export interface ProjectDeviceSummary {
  device: Device;
  latest_state: Record<string, unknown>;
  last_telemetry_at: string | null;
  latest_ota_status: string | null;
  latest_ota_progress: number | null;
  recent_alert_count: number;
  recent_alerts: AnomalyAlert[];
}

export interface ProjectAccessPolicy {
  tenant_ownership_rule: string;
  admin_access_rule: string;
  support_mode_rule: string;
  read_only: boolean;
}

export interface AdminTenantProjectReadOnly extends TenantProjectDetail {
  tenant_name: string;
  tenant_slug: string;
  read_only: boolean;
  access_policy: ProjectAccessPolicy;
  device_summaries: ProjectDeviceSummary[];
  recent_ota_jobs: OtaJob[];
  recent_alerts: AnomalyAlert[];
}

export interface DeviceCommandResponse {
  accepted: boolean;
  request_id: string;
  topic: string;
}

export interface DeviceOfflineTimeoutResponse {
  device_uid: string;
  offline_timeout_seconds: number;
}

export interface DeviceCapability {
  id: string;
  device_id: string;
  tenant_id: string | null;
  capability_key: string;
  capability_type: string;
  label: string;
  gpio_pin: number | null;
  channel: string | null;
  command_name: string;
  telemetry_state_key: string | null;
  is_bindable: boolean;
  config_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

// ── Platform & Model types ────────────────────────────────────────────────────

export interface DevicePlatform {
  id: string;
  key: string;
  name: string;
  sdk_toolchain?: string | null;
  description?: string | null;
  wifi_required: boolean;
  supports_mqtt: boolean;
  supports_ota: boolean;
  supports_gpio_config: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DeviceModel {
  id: string;
  platform_id: string;
  key: string;
  name: string;
  description?: string | null;
  gpio_pins_json: {
    min?: number;
    max?: number;
    reserved?: number[];
    bootstraps?: number[];
    output_capable?: number[];
    [key: string]: unknown;
  };
  default_capabilities_json: unknown[];
  created_at?: string | null;
  updated_at?: string | null;
  platform?: DevicePlatform | null;
}

export interface CapabilityTemplate {
  id: string;
  device_model_id: string;
  capability_key: string;
  capability_type: string;
  label: string;
  gpio_pin?: number | null;
  channel?: string | null;
  command_name: string;
  telemetry_state_key?: string | null;
  is_bindable: boolean;
  config_json: Record<string, unknown>;
  created_at?: string | null;
  updated_at?: string | null;
}

// API Docs management
export type DatastreamDataType = "integer" | "double" | "string" | "boolean";

export interface Datastream {
  id: string;
  tenant_id: string;
  name: string;
  alias: string;
  pin: number; // 0-255, hiển thị dạng V0-V255
  data_type: DatastreamDataType;
  direction: "telemetry" | "command" | "bidirectional";
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  default_value: string | null;
  description: string | null;
  is_custom: boolean;
  status: string;
  supported_model_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface DatastreamListResponse {
  items: Datastream[];
  total: number;
  used_pins: number[]; // danh sách pin đã được sử dụng (để ẩn trong dropdown)
}

export type ProjectWidgetType = string;

export interface ProjectWidget {
  id: string;
  page_id: string;
  widget_type: ProjectWidgetType;
  title: string;
  sort_order: number;
  layout: Record<string, unknown>;
  config: Record<string, unknown>;
  generic_requirements?: string[];
  logical_binding?: {
    device_slot_key?: string;
    datastream_key?: string;
    command_key?: string;
  };
  binding: {
    device_id?: string;
    device_uid?: string;
    capability_id?: string;
    capability_key?: string;
    capability_type?: string;
    gpio_pin?: number;
    command?: string;
    state_key?: string;
    params?: Record<string, unknown>;
    telemetry_field?: string;
    state_field?: string;
  } & Record<string, unknown>;
  created_at: string;
  updated_at: string;
  is_temporary?: boolean;
}

export interface ProjectPage {
  id: string;
  project_id: string;
  title: string;
  slug: string;
  sort_order: number;
  layout?: Record<string, unknown>;
  widgets: ProjectWidget[];
  created_at: string;
  updated_at: string;
}
