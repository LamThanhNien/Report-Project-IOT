import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenantDetail } from "./TenantDetail";
import * as tenantApi from "../../services/tenantAdminApi";

vi.mock("../../services/tenantAdminApi");
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tenantApi.getTenant).mockResolvedValue({ id: "tenant-1", name: "IoT Lab", slug: "iot-lab", is_active: true, plan_id: null, plan_name: null, device_count: 1, user_count: 1, created_at: "2026-10-01" });
  vi.mocked(tenantApi.listTenantUsers).mockResolvedValue([{ id: "user-1", email: "owner@lab.test", full_name: "Owner", role: "tenant_owner", is_active: true, permissions: [], tenant_id: "tenant-1", created_at: "2026-10-01" }]);
  vi.mocked(tenantApi.listTenantDevices).mockResolvedValue([{ id: "device-1", name: "Lab node", device_uid: "esp32-001", status: "online", firmware_version: null, last_seen_at: null, created_at: "2026-10-01", updated_at: "2026-10-01" }]);
  vi.mocked(tenantApi.listTenantProjects).mockResolvedValue([]);
  vi.mocked(tenantApi.listServicePlans).mockResolvedValue([]);
});

describe("Tenant admin support boundaries", () => {
  it("keeps tenant members and device assignment read-only", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/tenants/tenant-1"]}><Routes><Route path="/tenants/:id" element={<TenantDetail />} /></Routes></MemoryRouter></QueryClientProvider>);
    await screen.findByRole("heading", { name: "IoT Lab" });
    fireEvent.click(screen.getByRole("button", { name: /Users \(/ }));
    expect(await screen.findByText("owner@lab.test")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add user|Delete|Thêm thành viên/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Devices \(/ }));
    expect(await screen.findByText("Lab node")).toBeInTheDocument();
    expect(screen.queryByTitle("Assign to tenant")).not.toBeInTheDocument();
    expect(tenantApi.assignDeviceToTenant).not.toHaveBeenCalled();
    expect(tenantApi.removeDeviceFromTenant).not.toHaveBeenCalled();
    expect(tenantApi.createTenantUser).not.toHaveBeenCalled();
    expect(tenantApi.deleteTenantUser).not.toHaveBeenCalled();
  });
});
