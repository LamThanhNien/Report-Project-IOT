import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard";
import { listDevices } from "../../services/deviceApi";
import { listFirmware } from "../../services/firmwareApi";
import { listOtaJobs } from "../../services/otaApi";
import { listAlerts } from "../../services/alertApi";
import { listTenants, listServicePlans } from "../../services/tenantAdminApi";
import { getSystemHealth } from "../../services/systemApi";
import { listTelemetry } from "../../services/telemetryApi";
import type { Device } from "../../types";

vi.mock("../../services/deviceApi");
vi.mock("../../services/firmwareApi");
vi.mock("../../services/otaApi");
vi.mock("../../services/alertApi");
vi.mock("../../services/tenantAdminApi");
vi.mock("../../services/systemApi");
vi.mock("../../services/telemetryApi");
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: { full_name: "Admin" } }) }));
vi.mock("../../components/charts/DonutChart", () => ({ DonutChart: () => <div>Device status chart</div> }));

const device: Device = { id: "device-1", device_uid: "esp32-001", name: "Lab node", status: "online", firmware_version: "1.2.3", last_seen_at: "2026-10-02T00:00:00Z", created_at: "2026-10-01", updated_at: "2026-10-02" };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><Dashboard /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listDevices).mockResolvedValue([device, { ...device, id: "deleted-1", device_uid: "deleted-node", name: "Deleted node", status: "deleted" }]);
  vi.mocked(listFirmware).mockResolvedValue([]);
  vi.mocked(listOtaJobs).mockResolvedValue([]);
  vi.mocked(listAlerts).mockResolvedValue([]);
  vi.mocked(listTenants).mockResolvedValue([]);
  vi.mocked(listServicePlans).mockResolvedValue([]);
  vi.mocked(listTelemetry).mockResolvedValue([]);
  vi.mocked(getSystemHealth).mockResolvedValue({ api: "healthy", database: "healthy", mqtt: "unknown", storage: "unknown" });
});

describe("Admin Dashboard operational data", () => {
  it("excludes deleted devices and exposes retained operational destinations", async () => {
    renderPage();
    expect(await screen.findByText("Lab node")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Tổng thiết bị/ })).getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("Deleted node")).not.toBeInTheDocument();
    expect(screen.getByText("Chưa đủ mẫu để đánh giá tỷ lệ thành công")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Lịch sử lệnh/ })).toHaveAttribute("href", "/console/admin/commands");
    expect(screen.queryByRole("link", { name: /TinyML|billing|builder/i })).not.toBeInTheDocument();
  });

  it("shows unavailable counts when the device API fails", async () => {
    vi.mocked(listDevices).mockRejectedValue(new Error("Device registry unavailable"));
    renderPage();
    expect(await screen.findByText("Device registry unavailable")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /Tổng thiết bị/ })).getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("Device status chart")).not.toBeInTheDocument();
  });

  it("loads telemetry only after an explicit tenant selection", async () => {
    vi.mocked(listTenants).mockResolvedValue([{ id: "tenant-1", name: "IoT Lab", slug: "iot-lab", is_active: true, plan_id: null, plan_name: null, device_count: 1, user_count: 1, created_at: "2026-10-01" }]);
    renderPage();
    await screen.findByRole("option", { name: "IoT Lab" });
    expect(listTelemetry).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Tenant hoạt động"), { target: { value: "tenant-1" } });
    await waitFor(() => expect(listTelemetry).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: "tenant-1", limit: 500 })));
    expect(listOtaJobs).toHaveBeenCalledWith(undefined, 100, "tenant-1");
    expect(listAlerts).toHaveBeenCalledWith({ tenant_id: "tenant-1" });
  });
});
