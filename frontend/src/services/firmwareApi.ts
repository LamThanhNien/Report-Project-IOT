import { apiGet, apiPatch, apiPostForm, apiPostJson } from "./apiClient";
import type { Firmware } from "../types";

export function listFirmware(targetDeviceType?: string) {
  const qs = targetDeviceType ? `?target_device_type=${encodeURIComponent(targetDeviceType)}` : "";
  return apiGet<Firmware[]>(`/api/v1/firmware${qs}`);
}

export function getLatestFirmware(targetDeviceType: string) {
  return apiGet<Firmware>(
    `/api/v1/firmware/latest?target_device_type=${encodeURIComponent(targetDeviceType)}`,
  );
}

export function uploadFirmware(params: {
  version: string;
  targetDeviceType: string;
  releaseNotes?: string;
  releaseChannel?: "dev" | "staging" | "stable";
  verificationRequired?: boolean;
  file: File;
}) {
  const form = new FormData();
  form.append("version", params.version);
  form.append("target_device_type", params.targetDeviceType);
  if (params.releaseNotes) form.append("release_notes", params.releaseNotes);
  form.append("release_channel", params.releaseChannel ?? "dev");
  form.append("verification_required", String(params.verificationRequired ?? false));
  form.append("file", params.file);
  return apiPostForm<Firmware>("/api/v1/firmware", form);
}

export const signFirmware = (id: string) => apiPostJson<Firmware>(`/api/v1/admin/firmware/${id}/sign`, {});
export const bulkDeleteFirmware = (ids: string[], dryRun = false) => apiPostJson<{ dry_run: boolean; deleted_ids: string[]; protected: Array<{ id: string; reasons: string[] }> }>("/api/v1/admin/firmware/bulk-delete", { firmware_ids: ids, dry_run: dryRun });
export const getRetentionPolicy = () => apiGet<{ firmware_retention_days: number; firmware_min_versions_per_target: number }>("/api/v1/admin/firmware/retention-policy");
export const updateRetentionPolicy = (payload: { firmware_retention_days?: number; firmware_min_versions_per_target?: number }) => apiPatch<{ firmware_retention_days: number; firmware_min_versions_per_target: number }>("/api/v1/admin/firmware/retention-policy", payload);
export const previewRetention = () => apiPostJson<{ candidate_count: number; candidates: Array<{ id: string; version: string }>; protected: Array<{ id: string; reasons: string[] }> }>("/api/v1/admin/firmware/retention/dry-run", {});
export const runRetention = () => apiPostJson<{ deleted_ids: string[]; protected: Array<{ id: string; reasons: string[] }> }>("/api/v1/admin/firmware/retention/run", {});
