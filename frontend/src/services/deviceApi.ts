import { apiGet, apiPostJson } from "./apiClient";
import type { Device, DeviceStatus, Telemetry } from "../types";

export function listDevices(tenantId?: string) {
  const params = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  return apiGet<Device[]>(`/api/v1/devices${params}`);
}

export interface AdminDeviceCreateData {
  device_uid: string;
  name: string;
  hardware_model?: string | null;
  mac_address?: string | null;
  description?: string | null;
  firmware_version?: string | null;
  device_type_id?: string | null;
  tenant_id?: string | null;
}

export function createDevice(data: AdminDeviceCreateData): Promise<Device> {
  return apiPostJson("/api/v1/devices", data);
}

export function getDeviceStatus(deviceUid: string) {
  return apiGet<DeviceStatus>(`/api/v1/devices/${encodeURIComponent(deviceUid)}/status`);
}

export function getDeviceTelemetry(deviceUid: string, limit = 200) {
  return apiGet<Telemetry[]>(
    `/api/v1/devices/${encodeURIComponent(deviceUid)}/telemetry?limit=${limit}`,
  );
}

export function getDeviceLatestTelemetry(deviceUid: string) {
  return apiGet<Telemetry[]>(
    `/api/v1/devices/${encodeURIComponent(deviceUid)}/latest-telemetry`,
  );
}

export interface AdminDeviceCommand {
  id: string;
  command_type: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

export function rebootAdminDevice(deviceUid: string) {
  return apiPostJson<AdminDeviceCommand>(
    `/api/v1/admin/devices/${encodeURIComponent(deviceUid)}/commands/reboot`,
    {},
  );
}

export function setAdminDeviceMaintenance(deviceUid: string, enabled: boolean) {
  return apiPostJson<AdminDeviceCommand>(
    `/api/v1/admin/devices/${encodeURIComponent(deviceUid)}/maintenance/${enabled ? "enable" : "disable"}`,
    {},
  );
}
