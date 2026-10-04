import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDatastreams } from "./WorkspaceDatastreams";
import { WorkspaceDevices } from "./WorkspaceDevices";
import * as clientApi from "../../../services/clientApi";
import * as datastreamApi from "../../../services/datastreamApi";

const auth = vi.hoisted(() => ({ role: "viewer", permissions: [] as string[] }));
vi.mock("../../../services/clientApi");
vi.mock("../../../services/datastreamApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../services/datastreamApi")>(),
  listDatastreams: vi.fn(), createDatastream: vi.fn(), updateDatastream: vi.fn(), deleteDatastream: vi.fn(),
}));
vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", tenant_id: "tenant-1", ...auth } }),
}));
vi.mock("../../../contexts/FeatureContext", () => ({
  useFeature: () => ({ featuresReady: true, hasFeature: () => true }),
}));
vi.mock("../../../hooks/useDeviceStatusStream", () => ({ useDeviceStatusStream: () => undefined }));
vi.mock("../../../services/deviceGroupApi", () => ({
  deviceGroupApi: { listDeviceGroups: vi.fn().mockResolvedValue({ items: [] }), listGroupDevices: vi.fn().mockResolvedValue({ items: [] }) },
}));

const stream = {
  id: "stream-1", name: "Temperature", alias: "temperature", pin: 0, data_type: "double", direction: "telemetry", unit: "°C",
  min_value: 0, max_value: 100, default_value: null, supported_model_ids: [], is_custom: true, status: "active",
};

function renderPage(page: "devices" | "datastreams") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter initialEntries={[`/client/workspace/project-1/${page}`]}><QueryClientProvider client={queryClient}><Routes>
    <Route path="/client/workspace/:projectId/devices" element={<WorkspaceDevices />} />
    <Route path="/client/workspace/:projectId/datastreams" element={<WorkspaceDatastreams />} />
  </Routes></QueryClientProvider></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear(); sessionStorage.clear();
  auth.role = "viewer"; auth.permissions = [];
  vi.mocked(clientApi.listClientDevices).mockResolvedValue([]);
  vi.mocked(clientApi.getClientProject).mockResolvedValue({ id: "project-1", name: "Lab" } as never);
  vi.mocked(clientApi.listClientDeviceModels).mockResolvedValue([]);
  vi.mocked(datastreamApi.listDatastreams).mockResolvedValue({ items: [stream], used_pins: [0], total: 1 } as never);
});

describe("Workspace presentation permissions", () => {
  it("keeps empty workspace devices readable without add or assign mutations for viewers", async () => {
    renderPage("devices");
    expect(await screen.findByText(/Dự án này chưa có thiết bị nào|This project has no devices/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Gán thiết bị có sẵn|Assign existing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thêm thiết bị mới|Add new device/i })).not.toBeInTheDocument();
  });

  it("keeps datastream copy available but hides create, edit and delete actions for viewers", async () => {
    renderPage("datastreams");
    await screen.findByText("Temperature");
    expect(screen.queryByRole("button", { name: /Thêm Datastream|Add Datastream/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Chỉnh sửa|Edit/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Thao tác cho|Actions for/i }));
    expect(screen.getByText(/Sao chép Alias|Copy Alias/i)).toBeInTheDocument();
    expect(screen.queryByText(/Xóa Datastream|Delete Datastream/i)).not.toBeInTheDocument();
    expect(datastreamApi.createDatastream).not.toHaveBeenCalled();
    expect(datastreamApi.updateDatastream).not.toHaveBeenCalled();
    expect(datastreamApi.deleteDatastream).not.toHaveBeenCalled();
  });

  it("allows project managers to create datastreams and paginates retained records", async () => {
    auth.role = "tenant_owner";
    const items = Array.from({ length: 13 }, (_, index) => ({ ...stream, id: `stream-${index}`, name: `Metric ${index}`, alias: `metric_${index}`, pin: index }));
    vi.mocked(datastreamApi.listDatastreams).mockResolvedValue({ items, used_pins: items.map((item) => item.pin), total: 13 } as never);
    renderPage("datastreams");
    await screen.findByText("Metric 0");
    expect(screen.queryByText("Metric 12")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thêm Datastream|Add Datastream/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sau|Next|Trang sau/i }));
    expect(await screen.findByText("Metric 12")).toBeInTheDocument();
    expect(screen.queryByText("Metric 0")).not.toBeInTheDocument();
  });
});
