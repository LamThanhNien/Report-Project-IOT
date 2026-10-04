import { apiGet, apiPatch, apiPostJson } from "./apiClient";
import type { UserRead } from "./authApi";

export interface SystemSettings {
  organization_name: string;
  timezone: string;
  default_locale: string;
  email_notifications_enabled: boolean;
  updated_at: string;
}

export interface OtaPolicy {
  auto_update_enabled: boolean;
  maintenance_window_start: string;
  maintenance_window_end: string;
  rollback_threshold: number;
  max_concurrent_updates: number;
  updated_at: string;
}

export const getSystemSettings = () => apiGet<SystemSettings>("/api/v1/admin/settings");
export const updateSystemSettings = (payload: Partial<SystemSettings>) =>
  apiPatch<SystemSettings>("/api/v1/admin/settings", payload);
export const getOtaPolicy = () => apiGet<OtaPolicy>("/api/v1/admin/settings/ota-policy");
export const updateOtaPolicy = (payload: Partial<OtaPolicy>) =>
  apiPatch<OtaPolicy>("/api/v1/admin/settings/ota-policy", payload);

export const listAdmins = () => apiGet<UserRead[]>("/api/v1/admin/users/admins");
export const createAdmin = (payload: { email: string; full_name?: string; password: string }) =>
  apiPostJson<UserRead>("/api/v1/admin/users/admins", payload);
export const updateAdmin = (id: string, payload: { full_name: string | null }) =>
  apiPatch<UserRead>(`/api/v1/admin/users/admins/${id}`, payload);
export const setAdminActive = (id: string, active: boolean) =>
  apiPostJson<UserRead>(`/api/v1/admin/users/admins/${id}/${active ? "activate" : "deactivate"}`, {});
