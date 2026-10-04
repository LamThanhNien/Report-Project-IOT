import { apiGet, apiPostJson, buildQuery } from "./apiClient";

export interface ProvisioningSession {
  id: string;
  device_id: string | null;
  device_name: string | null;
  tenant_id: string | null;
  claim_code: string | null;
  status: string;
  expires_at: string | null;
  claimed_at: string | null;
  claimed_by: string | null;
  created_at: string;
}

export interface ClaimCodeCreateData {
  device_id?: string;
  expires_in_hours?: number;
}

export const provisioningApi = {
  createClaimCode: (data: ClaimCodeCreateData) =>
    apiPostJson<ProvisioningSession>("/api/v1/client/provisioning/claim-code", data),

  listSessions: (params?: Record<string, unknown>) =>
    apiGet<{ items: ProvisioningSession[]; total: number }>(`/api/v1/client/provisioning/sessions${buildQuery(params)}`),

  getDetail: (sessionId: string) =>
    apiGet<ProvisioningSession>(`/api/v1/client/provisioning/sessions/${sessionId}`),

  claimDevice: (claimCode: string) =>
    apiPostJson<ProvisioningSession>("/api/v1/client/provisioning/claim", { claim_code: claimCode }),

  revokeClaim: (id: string) =>
    apiPostJson<{ message: string }>(`/api/v1/client/provisioning/revoke/${id}`, {}),
};