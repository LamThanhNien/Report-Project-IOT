import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Tenants } from "./Tenants";
import * as tenantApi from "../../services/tenantAdminApi";
vi.mock("../../services/tenantAdminApi");
describe("Tenant quota mapping", () => {
  it("requires a configured quota profile before creating an operational tenant", async () => {
    vi.mocked(tenantApi.listTenants).mockResolvedValue([]);
    vi.mocked(tenantApi.listServicePlans).mockResolvedValue([{ id: "plan-1", name: "IoT Lab", max_devices: 100, max_users: 10, telemetry_retention_days: 7, created_at: "2026-10-01", updated_at: "2026-10-01", features: { device_management: true, ota_update: true, firmware_history: true, telemetry_view: true, advanced_monitoring: false, alert_management: true, api_access: true, user_management: true, audit_log: true } }]);
    vi.mocked(tenantApi.createTenant).mockResolvedValue({ id: "tenant-1", name: "Lab", slug: "lab", plan_id: "plan-1", plan_name: "IoT Lab", is_active: true, device_count: 0, user_count: 0, created_at: "2026-10-01" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><Tenants /></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Tạo Tenant" }));
    fireEvent.change(screen.getByLabelText("Tên Tenant"), { target: { value: "Lab" } });
    expect(screen.getByRole("button", { name: "Tạo" })).toBeDisabled();
    await screen.findByRole("option", { name: /IoT Lab/ });
    fireEvent.change(screen.getByLabelText("Giới hạn workspace"), { target: { value: "plan-1" } });
    expect(screen.getByRole("button", { name: "Tạo" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await waitFor(() => expect(tenantApi.createTenant).toHaveBeenCalledTimes(1));
    expect(vi.mocked(tenantApi.createTenant).mock.calls[0][0]).toEqual(
      expect.objectContaining({ name: "Lab", slug: "lab", plan_id: "plan-1" }),
    );
  });
});
