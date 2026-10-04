import { apiDelete, apiGet, apiPostJson, apiPut, buildQuery } from "./apiClient";

export interface DeviceGroup {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  group_type: string;
  status: string;
  tags: string[];
  metadata: Record<string, unknown>;
  device_count: number;
  created_at: string;
  updated_at: string;
}

export interface DeviceGroupMember {
  member_id: string;
  device_id: string;
  device_uid: string;
  device_name: string;
  device_status: string;
  added_at: string;
}

export interface DeviceGroupCreateData {
  name: string;
  description?: string;
  group_type?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface DeviceGroupUpdateData {
  name?: string;
  description?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  status?: string;
}

export const deviceGroupApi = {
  listDeviceGroups: (params?: Record<string, unknown>) => {
    return apiGet<{ items: DeviceGroup[]; total: number }>(`/api/v1/client/device-groups${buildQuery(params)}`);
  },
  list: (params?: Record<string, unknown>) => {
    return apiGet<{ items: DeviceGroup[]; total: number }>(`/api/v1/client/device-groups${buildQuery(params)}`);
  },

  getDeviceGroup: (id: string) =>
    apiGet<DeviceGroup>(`/api/v1/client/device-groups/${id}`),
  get: (id: string) =>
    apiGet<DeviceGroup>(`/api/v1/client/device-groups/${id}`),

  createDeviceGroup: (data: DeviceGroupCreateData) =>
    apiPostJson<DeviceGroup>("/api/v1/client/device-groups", data),
  create: (data: DeviceGroupCreateData) =>
    apiPostJson<DeviceGroup>("/api/v1/client/device-groups", data),

  updateDeviceGroup: (id: string, data: DeviceGroupUpdateData) =>
    apiPut<DeviceGroup>(`/api/v1/client/device-groups/${id}`, data),
  update: (id: string, data: DeviceGroupUpdateData) =>
    apiPut<DeviceGroup>(`/api/v1/client/device-groups/${id}`, data),

  deleteDeviceGroup: (id: string) =>
    apiDelete(`/api/v1/client/device-groups/${id}`),

  archive: (id: string) =>
    apiPostJson<{ message: string }>(`/api/v1/client/device-groups/${id}/archive`, {}),

  addDeviceToGroup: (id: string, deviceId: string) =>
    apiPostJson<{ added: number }>(`/api/v1/client/device-groups/${id}/members`, { device_ids: [deviceId] }),

  addMembers: (id: string, device_ids: string[]) =>
    apiPostJson<{ added: number }>(`/api/v1/client/device-groups/${id}/members`, { device_ids }),

  removeDeviceFromGroup: (id: string, deviceId: string) =>
    apiPostJson<{ removed: number }>(`/api/v1/client/device-groups/${id}/members/remove`, { device_ids: [deviceId] }),

  removeMembers: (id: string, device_ids: string[]) =>
    apiPostJson<{ removed: number }>(`/api/v1/client/device-groups/${id}/members/remove`, { device_ids }),

  listDeviceGroupsForDevice: (deviceId: string, params?: Record<string, unknown>) => {
    return apiGet<{ items: DeviceGroup[]; total: number }>(
      `/api/v1/client/devices/${encodeURIComponent(deviceId)}/groups${buildQuery(params)}`,
    );
  },

  listGroupDevices: (id: string, params?: Record<string, unknown>) => {
    return apiGet<{ items: DeviceGroupMember[]; total: number }>(`/api/v1/client/device-groups/${id}/devices${buildQuery(params)}`);
  },
  listDevices: (id: string, params?: Record<string, unknown>) => {
    return apiGet<{ items: DeviceGroupMember[]; total: number }>(`/api/v1/client/device-groups/${id}/devices${buildQuery(params)}`);
  },
};
