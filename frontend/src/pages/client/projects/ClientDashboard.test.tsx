import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientDashboard } from "./ClientDashboard";
import * as clientApi from "../../../services/clientApi";
import "../../../lib/i18n";
let role = "tenant_owner";
vi.mock("../../../services/clientApi");
vi.mock("../../../contexts/AuthContext", () => ({ useAuth: () => ({ user: { role } }) }));
vi.mock("../../../hooks/useDeviceStatusStream", () => ({ useDeviceStatusStream: () => ({ status: "connected" }) }));
function renderPage(projectId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><ClientDashboard scopedProjectId={projectId} /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  role = "tenant_owner"; vi.clearAllMocks();
  vi.mocked(clientApi.listClientDevices).mockResolvedValue([{ id: "device-1", device_uid: "esp32-1", name: "Lab Device", status: "online", firmware_version: "1", last_seen_at: null, created_at: "2026-10-01", updated_at: "2026-10-01" }]);
  vi.mocked(clientApi.listClientOtaJobs).mockResolvedValue([]);
  vi.mocked(clientApi.listClientAlerts).mockResolvedValue([]);
  vi.mocked(clientApi.listClientProjects).mockResolvedValue([]);
});
describe("Fixed device overview", () => {
  it("keeps all workspace queries and actions in the selected project", async () => {
    renderPage("project-1");
    expect(await screen.findByRole("link", { name: /Lab Device/ })).toHaveAttribute("href", "/client/workspace/project-1/devices/esp32-1");
    await waitFor(() => expect(clientApi.listClientDevices).toHaveBeenCalledWith("project-1"));
    expect(clientApi.listClientOtaJobs).toHaveBeenCalledWith("project-1");
    expect(clientApi.listClientAlerts).toHaveBeenCalledWith(10, "project-1");
    expect(screen.getByRole("link", { name: "Automation" })).toHaveAttribute("href", "/client/workspace/project-1/automation");
    expect(screen.getByRole("link", { name: "Firmware / OTA" })).toHaveAttribute("href", "/client/workspace/project-1/ota");
  });
  it("does not show registration to viewer accounts", async () => {
    role = "viewer"; renderPage();
    await screen.findByRole("link", { name: /Lab Device/ });
    expect(screen.queryByRole("link", { name: "Thêm thiết bị" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Automation" })).toHaveAttribute("href", "/client/automation");
  });
  it("renders fleet state and OTA summaries without querying removed features", async () => {
    renderPage();
    await screen.findByRole("link", { name: /Lab Device/ });
    expect(screen.getByTestId("kpi-total-devices")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-online-devices")).toHaveTextContent("100%");
    expect(screen.getByTestId("kpi-offline-devices")).toHaveTextContent("0");
    expect(screen.getByTestId("kpi-running-ota")).toHaveTextContent("0");
    expect(screen.queryByText(/widget|TinyML|MLflow/i)).not.toBeInTheDocument();
  });
  it("shows unavailable metrics when device retrieval fails", async () => {
    vi.mocked(clientApi.listClientDevices).mockRejectedValue(new Error("Device service unavailable"));
    renderPage();
    await screen.findByText("Device service unavailable");
    expect(screen.getByTestId("kpi-total-devices")).toHaveTextContent("—");
    expect(screen.getByTestId("kpi-online-devices")).not.toHaveTextContent("100%");
  });
});
