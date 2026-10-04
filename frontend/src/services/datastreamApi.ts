import { apiDelete, apiGet, apiPostJson, apiPut } from "./apiClient";
import type { Datastream, DatastreamDataType, DatastreamListResponse } from "../types";

export interface DatastreamCreatePayload {
  project_id: string;
  name: string;
  alias?: string;
  pin: number;
  data_type: DatastreamDataType;
  direction: "telemetry" | "command" | "bidirectional";
  unit?: string | null;
  min_value?: number | null;
  max_value?: number | null;
  default_value?: string | null;
  description?: string | null;
  is_custom?: boolean;
  status?: string;
  supported_model_ids?: string[];
}

export interface DatastreamUpdatePayload {
  name?: string;
  alias?: string;
  data_type?: DatastreamDataType;
  direction?: "telemetry" | "command" | "bidirectional";
  unit?: string | null;
  min_value?: number | null;
  max_value?: number | null;
  default_value?: string | null;
  description?: string | null;
  is_custom?: boolean;
  status?: string;
  supported_model_ids?: string[];
}

export interface DatastreamListParams {
  project_id: string;
  search?: string;
  data_type?: DatastreamDataType;
  skip?: number;
  limit?: number;
}

/**
 * Lấy danh sách Datastreams (Virtual Pins) của tenant.
 * Trả về kèm `used_pins` để biết pin nào đã bị chiếm.
 */
export function listDatastreams(
  params: DatastreamListParams,
): Promise<DatastreamListResponse> {
  const qs = new URLSearchParams();
  qs.set("project_id", params.project_id);
  if (params.search) qs.set("search", params.search);
  if (params.data_type) qs.set("data_type", params.data_type);
  if (params.skip !== undefined) qs.set("skip", String(params.skip));
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  const query = qs.toString();
  return apiGet(`/api/v1/client/datastreams${query ? `?${query}` : ""}`);
}

/**
 * Tạo mới một Datastream (Virtual Pin).
 */
export function createDatastream(
  payload: DatastreamCreatePayload,
): Promise<Datastream> {
  return apiPostJson("/api/v1/client/datastreams", payload);
}

/**
 * Cập nhật thông tin Datastream.
 */
export function updateDatastream(
  datastreamId: string,
  payload: DatastreamUpdatePayload,
): Promise<Datastream> {
  return apiPut(`/api/v1/client/datastreams/${encodeURIComponent(datastreamId)}`, payload);
}

/**
 * Xóa Datastream.
 * Datastream được quản lý theo workspace và hợp đồng dữ liệu ESP32.
 */
export function deleteDatastream(datastreamId: string): Promise<void> {
  return apiDelete(`/api/v1/client/datastreams/${encodeURIComponent(datastreamId)}`);
}

/**
 * Helper: chuyển pin number thành label hiển thị.
 */
export function pinLabel(pin: number): string {
  return `V${pin}`;
}

/**
 * Tạo danh sách tất cả các options pin V0-V255.
 */
export function allPinOptions(): { label: string; value: number }[] {
  return Array.from({ length: 256 }, (_, i) => ({ label: `V${i}`, value: i }));
}
