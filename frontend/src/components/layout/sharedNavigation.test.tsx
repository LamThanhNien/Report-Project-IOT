import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientSidebar } from "./ClientSidebar";
import { Sidebar } from "./Sidebar";

const state = vi.hoisted(() => ({
  user: { role: "tenant_owner", permissions: [] as string[] },
  features: true,
}));
vi.mock("../../contexts/AuthContext", () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock("../../contexts/FeatureContext", () => ({ useFeature: () => ({ hasFeature: () => state.features }) }));
vi.mock("../../app/routePrefetch", () => ({ prefetchRoute: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

afterEach(cleanup);
beforeEach(() => { state.user = { role: "tenant_owner", permissions: [] }; state.features = true; });

describe("shared navigation restoration", () => {
  it("keeps client Commands, Automation, and OTA available with meaningful collapsed link names", () => {
    render(<MemoryRouter><ClientSidebar collapsed onCollapse={vi.fn()} tenantName="Tenant" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "sidebar.commands" })).toHaveAttribute("href", "/client/commands");
    expect(screen.getByRole("link", { name: "sidebar.automation" })).toHaveAttribute("href", "/client/automation");
    expect(screen.getByRole("link", { name: "sidebar.ota_campaigns" })).toHaveAttribute("href", "/client/ota");
    for (const link of screen.getAllByRole("link")) expect(link).toHaveAccessibleName();
    expect(screen.getByRole("button", { name: "sidebar.expand" })).toBeInTheDocument();
  });

  it("closes the mobile client drawer when a route is selected", () => {
    const close = vi.fn();
    render(<MemoryRouter><ClientSidebar collapsed mobileOpen onMobileClose={close} onCollapse={vi.fn()} tenantName="Tenant" /></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "sidebar.commands" }));
    expect(close).toHaveBeenCalledOnce();
    expect(screen.getByText("sidebar.commands")).toBeInTheDocument();
  });

  it("preserves tenant permission and feature filtering without exposing retired feature links", () => {
    state.user = { role: "viewer", permissions: ["dashboard.view", "devices.view"] };
    state.features = false;
    render(<MemoryRouter><ClientSidebar collapsed={false} onCollapse={vi.fn()} tenantName="Tenant" /></MemoryRouter>);
    expect(screen.getByRole("link", { name: "sidebar.dashboard" })).toBeInTheDocument();
    for (const name of ["devices", "commands", "automation", "ota_campaigns", "members"]) {
      expect(screen.queryByRole("link", { name: `sidebar.${name}` })).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole("link").map(link => link.getAttribute("href"))).toEqual(["/client/dashboard", "/client/account"]);
  });

  it("keeps collapsed admin links named and closes the mobile drawer on navigation", () => {
    const close = vi.fn();
    const { rerender } = render(<MemoryRouter><Sidebar collapsed onCollapse={vi.fn()} onMobileClose={close} /></MemoryRouter>);
    for (const link of screen.getAllByRole("link")) expect(link).toHaveAccessibleName();
    expect(screen.getByRole("link", { name: "Firmware / OTA" })).toHaveAttribute("href", "/console/firmware");
    expect(screen.getByRole("button", { name: "Expand navigation" })).toBeInTheDocument();
    rerender(<MemoryRouter><Sidebar collapsed mobileOpen onCollapse={vi.fn()} onMobileClose={close} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("link", { name: "Firmware / OTA" }));
    expect(close).toHaveBeenCalledOnce();
    for (const label of ["AI / TinyML", "Gói dịch vụ", "Feature Control", "API Docs"]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
  });

  it.each(["tenant_engineer", "platform_engineer", "unknown"])("does not grant retired role %s tenant navigation", (role) => {
    state.user = { role, permissions: ["dashboard.view", "devices.manage", "commands.send", "platform.devices.view"] };
    render(<MemoryRouter><ClientSidebar collapsed={false} onCollapse={vi.fn()} tenantName="Tenant" /></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "sidebar.dashboard" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "sidebar.commands" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link").some(link => link.getAttribute("href")?.includes("engineer"))).toBe(false);
  });
});
