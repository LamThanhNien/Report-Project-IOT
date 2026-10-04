import { apiGet, apiPatch, apiPostJson } from "./apiClient";
import type { OtaCampaign, OtaJob, OtaJobCreateResponse } from "../types";

export function listOtaJobs(deviceUid?: string, limit = 100, tenantId?: string) {
  const qs = new URLSearchParams();
  if (tenantId) qs.set("tenant_id", tenantId);
  if (deviceUid) qs.set("device_uid", deviceUid);
  qs.set("limit", String(limit));
  return apiGet<OtaJob[]>(`/api/v1/ota/jobs?${qs.toString()}`);
}

export const getOtaJob = (jobId: string) => apiGet<OtaJob>(`/api/v1/ota/jobs/${encodeURIComponent(jobId)}`);
export const createOtaJob = (deviceUid: string, firmwareVersionId: string) =>
  apiPostJson<OtaJobCreateResponse>("/api/v1/ota/jobs", { device_uid: deviceUid, firmware_version_id: firmwareVersionId });

export interface CampaignCreateInput {
  tenant_id?: string;
  name: string;
  firmware_id: string;
  target_scope: "all" | "device_group" | "device_model" | "selected_devices";
  target_ids: string[];
  rollout_strategy: "all_at_once" | "phased" | "canary";
  rollout_percentages?: number[];
}

export const listOtaCampaigns = (tenantId?: string) => {
  return apiGet<OtaCampaign[]>(`/api/v1/admin/ota/campaigns${tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : ""}`);
};
export const getOtaCampaign = (id: string) => apiGet<OtaCampaign>(`/api/v1/admin/ota/campaigns/${id}`);
export const createOtaCampaignDraft = (payload: CampaignCreateInput) => apiPostJson<OtaCampaign>("/api/v1/admin/ota/campaigns", {
  ...payload,
});
export const updateOtaCampaign = (id: string, payload: Partial<CampaignCreateInput>) => apiPatch<OtaCampaign>(`/api/v1/admin/ota/campaigns/${id}`, payload);
export const transitionOtaCampaign = (id: string, action: "start" | "pause" | "resume" | "cancel" | "retry-failed") =>
  apiPostJson<OtaCampaign>(`/api/v1/admin/ota/campaigns/${id}/${action}`, {});

export async function createOtaCampaign(payload: CampaignCreateInput) {
  const campaign = await createOtaCampaignDraft(payload);
  return transitionOtaCampaign(campaign.id, "start");
}
