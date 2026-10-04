import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientAlerts } from "./ClientAlerts";
import * as clientApi from "../../../services/clientApi";

const auth = vi.hoisted(() => ({ role: "viewer" }));
vi.mock("../../../services/clientApi");
vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", tenant_id: "tenant-1", permissions: [], ...auth } }),
}));
vi.mock("../../../contexts/FeatureContext", () => ({
  useFeature: () => ({ featuresReady: true, hasFeature: () => true }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={queryClient}><ClientAlerts scopedProjectId="project-1" /></QueryClientProvider></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear();
  auth.role = "viewer";
  vi.mocked(clientApi.listClientAlerts).mockResolvedValue([{ id: "alert-1", title: "Temperature warning", severity: "warning", device_uid: "sensor-1", metric_name: "temperature", metric_value: 40, source: "device", timestamp: "2026-10-01T00:00:00Z" }] as never);
  vi.mocked(clientApi.deleteClientAlert).mockResolvedValue(undefined);
});

describe("Client alert action permissions", () => {
  it("keeps alert details available and hides destructive actions for viewers", async () => {
    renderPage();
    await screen.findByText("Temperature warning");
    expect(clientApi.listClientAlerts).toHaveBeenCalledWith(100, "project-1");
    fireEvent.click(screen.getByRole("button", { name: /Thao tác cho|Actions for/i }));
    expect(screen.queryByText(/Xóa cảnh báo|Delete alert/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Xem chi tiết|View details/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xóa cảnh báo|Delete alert/i })).not.toBeInTheDocument();
    expect(clientApi.deleteClientAlert).not.toHaveBeenCalled();
  });

  it("lets tenant managers delete an alert after confirmation", async () => {
    auth.role = "tenant_owner";
    renderPage();
    await screen.findByText("Temperature warning");
    fireEvent.click(screen.getByRole("button", { name: /Thao tác cho|Actions for/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Xóa cảnh báo|Delete alert/i }));
    fireEvent.click(screen.getByRole("button", { name: /Xóa cảnh báo|Delete alert/i }));
    await waitFor(() => expect(clientApi.deleteClientAlert).toHaveBeenCalledWith("alert-1", expect.anything()));
  });
});
