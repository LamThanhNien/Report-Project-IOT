import { apiGet, apiPatch, apiPostJson } from "./apiClient";

export interface TokenResponse {
  access_token?: string | null;
  refresh_token?: string | null;
  token_type: string;
  user?: UserRead;
}

export interface UserRead {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  permissions: string[];
  tenant_id: string | null;
  created_at: string;
}

export interface RegisterRequest {
  tenant_name: string;
  tenant_slug?: string | null;
  owner_email: string;
  owner_password: string;
  owner_full_name?: string | null;
}

export function login(email: string, password: string): Promise<TokenResponse> {
  return apiPostJson<TokenResponse>("/api/v1/auth/login", { email, password });
}

export function registerTenantOwner(payload: RegisterRequest): Promise<TokenResponse> {
  return apiPostJson<TokenResponse>("/api/v1/auth/register", payload);
}

export function getMe(): Promise<UserRead> {
  return apiGet<UserRead>("/api/v1/auth/me");
}

export function updateMe(payload: { full_name: string | null }): Promise<UserRead> {
  return apiPatch<UserRead>("/api/v1/auth/me", payload);
}

export function changePassword(payload: { current_password: string; new_password: string }): Promise<{ detail: string }> {
  return apiPostJson("/api/v1/auth/change-password", payload);
}

export function refreshAccessToken(): Promise<TokenResponse> {
  return apiPostJson<TokenResponse>("/api/v1/auth/refresh", {});
}

export async function logout(): Promise<void> {
  await apiPostJson<{ detail: string }>("/api/v1/auth/logout", {});
}
