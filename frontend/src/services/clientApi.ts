import { ApiError, apiDelete, apiGet, apiPatch, apiPostForm, apiPostJson, apiPut } from "./apiClient";
import type {
  AnomalyAlert,
  AuditLog,
  ClientDashboard,
  ClientMe,
  DeviceCapability,
  Device,
  FeatureMap,
  Firmware,
  MqttConfig,
  OtaJob,
  OtaJobCreateResponse,
  Telemetry,
  TenantUser,
  DeviceCommandResponse,
  TenantProject,
  TenantProjectDetail,
  ProjectPage,
  ProjectWidget,
  ProjectWidgetType,
  TenantProjectSummary,
  TenantDeviceDetail,
  DeviceOfflineTimeoutResponse,
  DeviceModel,
} from "../types";

export function getClientMe(): Promise<ClientMe> {
  return apiGet("/api/v1/client/me");
}

export function getClientFeatures(): Promise<FeatureMap> {
  return apiGet("/api/v1/client/features");
}

export function getClientDashboard(projectId?: string): Promise<ClientDashboard> {
  const url = projectId ? `/api/v1/client/dashboard?project_id=${encodeURIComponent(projectId)}` : "/api/v1/client/dashboard";
  return apiGet(url);
}

export function listClientDevices(projectId?: string): Promise<Device[]> {
  const url = projectId ? `/api/v1/client/devices?project_id=${encodeURIComponent(projectId)}` : "/api/v1/client/devices";
  return apiGet(url);
}

export function getClientDevice(deviceUid: string): Promise<Device> {
  return apiGet(`/api/v1/client/devices/${encodeURIComponent(deviceUid)}`);
}

export function getClientDeviceDetail(deviceUid: string): Promise<TenantDeviceDetail> {
  return apiGet(`/api/v1/client/devices/${encodeURIComponent(deviceUid)}/detail`);
}

export function updateClientDeviceOfflineTimeout(
  deviceUid: string,
  offlineTimeoutSeconds: number,
): Promise<DeviceOfflineTimeoutResponse> {
  return apiPatch(`/api/v1/client/devices/${encodeURIComponent(deviceUid)}/offline-timeout`, {
    offline_timeout_seconds: offlineTimeoutSeconds,
  });
}

export function listClientDeviceCapabilities(deviceId: string): Promise<DeviceCapability[]> {
  return apiGet(`/api/v1/client/devices/${encodeURIComponent(deviceId)}/capabilities`);
}

export interface TelemetryAggregatedResponse {
  aggregated: boolean;
  grouping: string | null;
  data: Telemetry[];
}

export function getClientDeviceTelemetry(
  deviceUid: string,
  options: number | { metric_name?: string; limit?: number; time_range?: "live" | "6h" | "1d" | "1w" | "1m"; aggregate?: "avg" | "min" | "max"; from_time?: string; to_time?: string } = 60,
): Promise<Telemetry[] | TelemetryAggregatedResponse> {
  const params = new URLSearchParams();
  if (typeof options === "number") {
    params.set("limit", String(options));
  } else {
    const isLive = !options.time_range || options.time_range === "live";
    if (isLive) {
      // Live streaming mode — query raw recent records with limit
      params.set("limit", String(options.limit ?? 60));
      if (options.from_time) params.set("from_time", options.from_time);
      if (options.to_time) params.set("to_time", options.to_time);
    } else {
      if (options.time_range) params.set("time_range", options.time_range);
      if (options.aggregate) params.set("aggregate", options.aggregate);
    }

    if (options.metric_name) params.set("metric_name", options.metric_name);
  }
  return apiGet(`/api/v1/client/devices/${encodeURIComponent(deviceUid)}/telemetry?${params.toString()}`);
}


export async function generateDeviceToken(): Promise<{ auth_token: string; auth_token_hash: string }> {
  const res = await apiGet<{ raw_token: string; token_hash: string }>("/api/v1/client/devices/generate-token");
  return {
    auth_token: res.raw_token,
    auth_token_hash: res.token_hash,
  };
}

export async function regenerateDeviceToken(deviceUid: string): Promise<{ auth_token: string; auth_token_hash: string }> {
  const res = await apiPostJson<{ raw_token: string; token_hash: string }>(`/api/v1/client/devices/${encodeURIComponent(deviceUid)}/regenerate-token`, {});
  return {
    auth_token: res.raw_token,
    auth_token_hash: res.token_hash,
  };
}

export function registerClientDevice(
  deviceUid: string,
  name: string,
  options: {
    firmwareVersion?: string;
    hardwareModel?: string;
    description?: string;
    authTokenHash?: string;
    projectId?: string;
  } = {},
): Promise<Device> {
  const hardwareModel = options.hardwareModel?.trim();
  const description = options.description?.trim();
  return apiPostJson("/api/v1/client/devices", {
    device_uid: deviceUid,
    name,
    ...(options.firmwareVersion ? { firmware_version: options.firmwareVersion } : {}),
    ...(hardwareModel ? { hardware_model: hardwareModel } : {}),
    ...(description ? { description } : {}),
    ...(options.authTokenHash ? { auth_token_hash: options.authTokenHash } : {}),
    ...(options.projectId ? { project_id: options.projectId } : {}),
  });
}

export function updateClientDevice(
  deviceUid: string,
  data: {
    name?: string;
    hardware_model?: string | null;
    mac_address?: string | null;
    description?: string | null;
    auth_token_hash?: string | null;
  },
): Promise<Device> {
  const path = `/api/v1/client/devices/${encodeURIComponent(deviceUid)}`;
  return apiPatch<Device>(path, data).catch((error) => {
    if (error instanceof ApiError && error.status === 405) {
      return apiPut<Device>(path, data);
    }
    throw error;
  });
}

export function getDeviceMqttConfig(deviceUid: string): Promise<MqttConfig> {
  return apiGet(`/api/v1/client/devices/${encodeURIComponent(deviceUid)}/mqtt-config`);
}

export function listClientOtaJobs(projectId?: string): Promise<OtaJob[]> {
  const url = projectId ? `/api/v1/client/ota-jobs?project_id=${encodeURIComponent(projectId)}` : "/api/v1/client/ota-jobs";
  return apiGet(url);
}

export function listClientAlerts(limit = 50, projectId?: string): Promise<AnomalyAlert[]> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (projectId) query.set("project_id", projectId);
  return apiGet(`/api/v1/client/alerts?${query.toString()}`);
}

export function deleteClientAlert(alertId: string): Promise<void> {
  return apiDelete(`/api/v1/client/alerts/${alertId}`);
}

export function listClientUsers(): Promise<TenantUser[]> {
  return apiGet("/api/v1/client/users");
}

export function createClientUser(data: {
  email: string;
  password: string;
  full_name?: string;
  role: string;
  permissions?: string[];
}): Promise<TenantUser> {
  return apiPostJson("/api/v1/client/users", data);
}

export function updateClientUser(
  userId: string,
  data: {
    full_name?: string | null;
    role?: string;
    permissions?: string[];
    is_active?: boolean;
  },
): Promise<TenantUser> {
  return apiPatch(`/api/v1/client/users/${userId}`, data);
}

export function deleteClientUser(userId: string): Promise<void> {
  return apiDelete(`/api/v1/client/users/${userId}`);
}

export function listClientFirmware(targetDeviceType?: string): Promise<Firmware[]> {
  const qs = targetDeviceType ? `?target_device_type=${encodeURIComponent(targetDeviceType)}` : "";
  return apiGet(`/api/v1/client/firmware${qs}`);
}

export function uploadClientFirmware(params: {
  version: string;
  targetDeviceType: string;
  releaseNotes?: string;
  file: File;
}): Promise<Firmware> {
  const form = new FormData();
  form.append("version", params.version);
  form.append("target_device_type", params.targetDeviceType);
  if (params.releaseNotes) form.append("release_notes", params.releaseNotes);
  form.append("file", params.file);
  return apiPostForm("/api/v1/client/firmware", form);
}

export function signClientFirmware(firmwareId: string): Promise<Firmware> {
  return apiPostJson(`/api/v1/client/firmware/${firmwareId}/sign`, {});
}

export function archiveClientFirmware(firmwareId: string): Promise<Firmware> {
  return apiPostJson(`/api/v1/client/firmware/${firmwareId}/archive`, {});
}

export function unarchiveClientFirmware(firmwareId: string): Promise<Firmware> {
  return apiPostJson(`/api/v1/client/firmware/${firmwareId}/unarchive`, {});
}

export function deleteClientFirmware(firmwareId: string): Promise<void> {
  return apiDelete(`/api/v1/client/firmware/${firmwareId}`);
}

export function unassignClientDevice(deviceUid: string): Promise<void> {
  return apiDelete(`/api/v1/client/devices/${encodeURIComponent(deviceUid)}`);
}

export function createClientOtaJob(
  deviceUid: string | null,
  firmwareVersionId: string,
  groupId?: string | null,
): Promise<OtaJobCreateResponse> {
  return apiPostJson("/api/v1/client/ota-jobs", {
    ...(deviceUid ? { device_uid: deviceUid } : {}),
    ...(groupId ? { group_id: groupId } : {}),
    firmware_version_id: firmwareVersionId,
  });
}

export function archiveClientOtaJob(jobId: string): Promise<OtaJob> {
  return apiPostJson(`/api/v1/client/ota-jobs/${jobId}/archive`, {});
}

export function unarchiveClientOtaJob(jobId: string): Promise<OtaJob> {
  return apiPostJson(`/api/v1/client/ota-jobs/${jobId}/unarchive`, {});
}

export function uploadClientFirmwareFromSource(params: {
  version: string;
  targetDeviceType: string;
  boardFqbn?: string;
  sourceCode: string;
  releaseNotes?: string;
}): Promise<Firmware> {
  return apiPostJson("/api/v1/client/firmware/from-source", {
    version: params.version,
    target_device_type: params.targetDeviceType,
    board_fqbn: params.boardFqbn ?? "esp32:esp32:esp32",
    source_code: params.sourceCode,
    release_notes: params.releaseNotes ?? null,
  });
}

export function listClientProjects(): Promise<TenantProjectSummary[]> {
  return apiGet("/api/v1/client/projects");
}

export function createClientProject(data: {
  name: string;
  description?: string | null;
}): Promise<TenantProject> {
  return apiPostJson("/api/v1/client/projects", data);
}

export function getClientProject(projectId: string): Promise<TenantProjectDetail> {
  return apiGet(`/api/v1/client/projects/${projectId}`);
}

export function assignClientDeviceToProject(projectId: string, deviceUid: string): Promise<void> {
  return apiPut(`/api/v1/client/projects/${encodeURIComponent(projectId)}/devices/${encodeURIComponent(deviceUid)}/assign`, {});
}

export function updateClientProject(
  projectId: string,
  data: { name?: string; description?: string | null },
): Promise<TenantProject> {
  return apiPut(`/api/v1/client/projects/${projectId}`, data);
}

export function deleteClientProject(projectId: string): Promise<void> {
  return apiDelete(`/api/v1/client/projects/${projectId}`);
}

export function sendClientDeviceCommand(
  deviceId: string,
  data: { command: string; params: Record<string, unknown> },
): Promise<DeviceCommandResponse> {
  return apiPostJson(`/api/v1/client/devices/${encodeURIComponent(deviceId)}/commands`, data);
}

export function listClientAuditLogs(limit = 100): Promise<AuditLog[]> {
  return apiGet(`/api/v1/client/audit-logs?limit=${limit}`);
}

export function listClientDeviceModels(platformId?: string): Promise<DeviceModel[]> {
  const qs = platformId ? `?platform_id=${encodeURIComponent(platformId)}` : "";
  return apiGet(`/api/v1/client/device-models${qs}`);
}

export function getClientProjectRuntimeState(projectId: string): Promise<{ project_id: string; latest_state: TenantProjectDetail["latest_state"] }> {
  return apiGet(`/api/v1/client/projects/${encodeURIComponent(projectId)}/runtime-state`);
}


export function createClientProjectPage(
  projectId: string,
  data: { title: string; slug?: string; sort_order?: number },
): Promise<ProjectPage> {
  return apiPostJson(`/api/v1/client/projects/${projectId}/pages`, data);
}

export function createClientProjectWidget(
  pageId: string,
  data: {
    widget_type: ProjectWidgetType;
    title: string;
    sort_order?: number;
    layout?: Record<string, unknown>;
    config?: Record<string, unknown>;
    binding?: Record<string, unknown>;
  },
): Promise<ProjectWidget> {
  return apiPostJson(`/api/v1/client/pages/${pageId}/widgets`, data);
}

export function updateClientProjectWidget(
  widgetId: string,
  data: {
    widget_type?: ProjectWidgetType;
    title?: string;
    sort_order?: number;
    layout?: Record<string, unknown>;
    config?: Record<string, unknown>;
    binding?: Record<string, unknown>;
  },
): Promise<ProjectWidget> {
  return apiPut(`/api/v1/client/widgets/${widgetId}`, data);
}

export function deleteClientProjectWidget(widgetId: string): Promise<void> {
  return apiDelete(`/api/v1/client/widgets/${widgetId}`);
}
