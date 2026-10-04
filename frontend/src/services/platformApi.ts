import { apiDelete, apiGet, apiPostJson, apiPut } from "./apiClient";
import type { DevicePlatform, DeviceModel, CapabilityTemplate } from "../types";

export type DevicePlatformInput = Omit<DevicePlatform, "id" | "created_at" | "updated_at">;
export type DeviceModelInput = Omit<DeviceModel, "id" | "created_at" | "updated_at" | "platform">;
export type CapabilityTemplateInput = Omit<
  CapabilityTemplate,
  "id" | "created_at" | "updated_at"
>;

/**
 * List all device platforms (admin).
 */
export function listPlatforms(): Promise<DevicePlatform[]> {
  return apiGet("/api/v1/admin/platforms");
}

/**
 * Get a single platform by ID (admin).
 */
export function getPlatform(platformId: string): Promise<DevicePlatform> {
  return apiGet(`/api/v1/admin/platforms/${platformId}`);
}

export function createPlatform(data: DevicePlatformInput): Promise<DevicePlatform> {
  return apiPostJson("/api/v1/admin/platforms", data);
}

export function updatePlatform(platformId: string, data: DevicePlatformInput): Promise<DevicePlatform> {
  return apiPut(`/api/v1/admin/platforms/${platformId}`, data);
}

export function deletePlatform(platformId: string): Promise<void> {
  return apiDelete(`/api/v1/admin/platforms/${platformId}`);
}

/**
 * List device models, optionally filtered by platform (admin).
 */
export function listDeviceModels(platformId?: string): Promise<DeviceModel[]> {
  const qs = platformId ? `?platform_id=${encodeURIComponent(platformId)}` : "";
  return apiGet(`/api/v1/admin/device-models${qs}`);
}

/**
 * Get a single device model by ID (admin).
 */
export function getDeviceModel(modelId: string): Promise<DeviceModel> {
  return apiGet(`/api/v1/admin/device-models/${modelId}`);
}

export function createDeviceModel(data: DeviceModelInput): Promise<DeviceModel> {
  return apiPostJson("/api/v1/admin/device-models", data);
}

export function updateDeviceModel(modelId: string, data: DeviceModelInput): Promise<DeviceModel> {
  return apiPut(`/api/v1/admin/device-models/${modelId}`, data);
}

export function deleteDeviceModel(modelId: string): Promise<void> {
  return apiDelete(`/api/v1/admin/device-models/${modelId}`);
}

/**
 * List capability templates, optionally filtered by device model (admin).
 */
export function listCapabilityTemplates(deviceModelId?: string): Promise<CapabilityTemplate[]> {
  const qs = deviceModelId ? `?device_model_id=${encodeURIComponent(deviceModelId)}` : "";
  return apiGet(`/api/v1/admin/capability-templates${qs}`);
}

export function createCapabilityTemplate(
  data: CapabilityTemplateInput,
): Promise<CapabilityTemplate> {
  return apiPostJson("/api/v1/admin/capability-templates", data);
}

export function updateCapabilityTemplate(
  templateId: string,
  data: CapabilityTemplateInput,
): Promise<CapabilityTemplate> {
  return apiPut(`/api/v1/admin/capability-templates/${templateId}`, data);
}

export function deleteCapabilityTemplate(templateId: string): Promise<void> {
  return apiDelete(`/api/v1/admin/capability-templates/${templateId}`);
}

// ── Client (tenant) APIs ─────────────────────────────────────────────────────

/**
 * List available platforms for device onboarding (tenant).
 */
export function listClientPlatforms(): Promise<DevicePlatform[]> {
  return apiGet("/api/v1/client/platforms");
}

/**
 * List available device models for onboarding, optionally by platform (tenant).
 */
export function listClientDeviceModels(platformId?: string): Promise<DeviceModel[]> {
  const qs = platformId ? `?platform_id=${encodeURIComponent(platformId)}` : "";
  return apiGet(`/api/v1/client/device-models${qs}`);
}

/**
 * List capability templates for a device model (tenant).
 */
export function listClientModelCapabilities(modelId: string): Promise<CapabilityTemplate[]> {
  return apiGet(`/api/v1/client/device-models/${modelId}/capabilities`);
}
