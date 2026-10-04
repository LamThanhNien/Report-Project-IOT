import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ClientSidebar } from "./ClientSidebar";
import "../../lib/i18n";

vi.mock("../../contexts/FeatureContext", () => ({
  useFeature: () => ({ hasFeature: () => true }),
}));

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      role: "tenant_owner",
      permissions: [
        "dashboard.view",
        "devices.view",
        "device_groups.view",
        "projects.view",
        "commands.view",
        "command_templates.view",
        "automation.view",
        "ota.view",
        "firmware.view",
        "monitoring.view",
        "anomaly.view",
        "ai.view",
        "reports.view",
        "members.view",
      ],
    },
  }),
}));

describe("ClientSidebar", () => {
  it("does not show the admin Engineers item", () => {
    render(
      <MemoryRouter initialEntries={["/client/dashboard"]}>
        <ClientSidebar collapsed={false} onCollapse={vi.fn()} tenantName="Tenant Portal" />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "Engineers" })).not.toBeInTheDocument();
  });

  it("does not expose Support access", () => {
    render(
      <MemoryRouter initialEntries={["/client/support-access"]}>
        <ClientSidebar collapsed={false} onCollapse={vi.fn()} tenantName="Tenant Portal" />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: "Support access" })).not.toBeInTheDocument();
  });

  it("renders Projects item before Devices item", () => {
    render(
      <MemoryRouter initialEntries={["/client/dashboard"]}>
        <ClientSidebar collapsed={false} onCollapse={vi.fn()} tenantName="Tenant Portal" />
      </MemoryRouter>,
    );

    const links = screen.getAllByRole("link");
    const linkLabels = links.map((l) => l.textContent);

    const projectsIndex = linkLabels.indexOf("Dự án");
    const devicesIndex = linkLabels.indexOf("Thiết bị");

    expect(projectsIndex).toBeGreaterThan(-1);
    expect(devicesIndex).toBeGreaterThan(-1);
    expect(projectsIndex).toBeLessThan(devicesIndex);
  });

  it("renders instant tooltip elements when hovered while collapsed", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/client/dashboard"]}>
        <ClientSidebar collapsed={true} onCollapse={vi.fn()} tenantName="Tenant Portal" />
      </MemoryRouter>,
    );

    const links = container.querySelectorAll("a");
    expect(links.length).toBeGreaterThan(1);

    fireEvent.mouseEnter(links[1]); // Projects link
    expect(screen.getByText("Dự án")).toBeInTheDocument();
  });
});
