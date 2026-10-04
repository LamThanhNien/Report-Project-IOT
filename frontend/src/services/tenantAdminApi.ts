import { apiDelete, apiGet, apiPatch, apiPostJson, apiPut } from "./apiClient";
import type {
  AdminTenantProjectReadOnly,
  Tenant,
  ServicePlan,
  TenantProjectSummary,
  TenantUser,
} from "../types";
import type { Device } from "../types";

// ── Audit Logs ────────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export function listAuditLogs(params?: {
  limit?: number;
  offset?: number;
  action?: string;
  tenant_id?: string;
}): Promise<AuditLogEntry[]> {
  const qs = new URLSearchParams();
  if (params?.limit !== undefined) qs.set("limit", String(params.limit));
  if (params?.offset !== undefined) qs.set("offset", String(params.offset));
  if (params?.action) qs.set("action", params.action);
  if (params?.tenant_id) qs.set("tenant_id", params.tenant_id);
  const query = qs.toString();
  return apiGet(`/api/v1/admin/audit-logs${query ? `?${query}` : ""}`);
}

// Core tenant quota mapping: the dedicated commercial plan editor has been removed.
export function listServicePlans(): Promise<ServicePlan[]> {
  return apiGet("/api/v1/admin/service-plans");
}

// ── Tenants ───────────────────────────────────────────────────────────────────

export function listTenants(): Promise<Tenant[]> {
  return apiGet("/api/v1/admin/tenants");
}

export function getTenant(id: string): Promise<Tenant> {
  return apiGet(`/api/v1/admin/tenants/${id}`);
}

export function createTenant(data: {
  name: string;
  slug: string;
  plan_id?: string | null;
  owner_email?: string;
  owner_password?: string;
  owner_full_name?: string;
}): Promise<Tenant> {
  return apiPostJson("/api/v1/admin/tenants", data);
}

export function updateTenant(id: string, data: Partial<Tenant>): Promise<Tenant> {
  return apiPut(`/api/v1/admin/tenants/${id}`, data);
}

export function setTenantStatus(id: string, is_active: boolean): Promise<Tenant> {
  return apiPatch(`/api/v1/admin/tenants/${id}/status`, { is_active });
}

// ── Tenant devices ────────────────────────────────────────────────────────────

export function listTenantDevices(tenantId: string): Promise<Device[]> {
  return apiGet(`/api/v1/admin/tenants/${tenantId}/devices`);
}

export function assignDeviceToTenant(tenantId: string, deviceId: string): Promise<void> {
  return apiPostJson(`/api/v1/admin/tenants/${tenantId}/devices`, { device_id: deviceId });
}

export function removeDeviceFromTenant(tenantId: string, deviceId: string): Promise<void> {
  return apiDelete(`/api/v1/admin/tenants/${tenantId}/devices/${deviceId}`);
}

export function listTenantProjects(tenantId: string): Promise<TenantProjectSummary[]> {
  return apiGet(`/api/v1/admin/tenants/${tenantId}/projects`);
}

export function getTenantProjectReadOnly(
  tenantId: string,
  projectId: string,
): Promise<AdminTenantProjectReadOnly> {
  return apiGet(`/api/v1/admin/tenants/${tenantId}/projects/${projectId}`);
}

// ── Tenant users ──────────────────────────────────────────────────────────────

export function listTenantUsers(tenantId: string): Promise<TenantUser[]> {
  return apiGet(`/api/v1/admin/tenants/${tenantId}/users`);
}

export function createTenantUser(
  tenantId: string,
  data: { email: string; password: string; full_name?: string; role: string },
): Promise<TenantUser> {
  return apiPostJson(`/api/v1/admin/tenants/${tenantId}/users`, data);
}

export function deleteTenantUser(tenantId: string, userId: string): Promise<void> {
  return apiDelete(`/api/v1/admin/tenants/${tenantId}/users/${userId}`);
}
