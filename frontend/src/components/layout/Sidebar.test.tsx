import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

const MENU_LABELS = [
  "Dashboard",
  "Thiết bị",
  "Firmware / OTA",
  "Telemetry",
  "Cảnh báo",
  "Tenants",
  "Device Registry",
  "Nhật ký audit",
  "Tình trạng",
  "Cài đặt",
];

function renderSidebar(initialPath = "/console/admin/tenants", collapsed = false) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Sidebar collapsed={collapsed} onCollapse={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  it("renders one unified menu without section headings", () => {
    renderSidebar();
    ["TỔNG QUAN", "QUẢN LÝ FLEET", "AI / TINYML", "PLATFORM", "HỆ THỐNG"].forEach((heading) => {
      expect(screen.queryByText(heading)).not.toBeInTheDocument();
    });
  });

  it("renders menu items in the required order", () => {
    renderSidebar();

    const links = within(screen.getByRole("navigation")).getAllByRole("link");

    expect(links.map((link) => link.textContent)).toEqual(MENU_LABELS);
  });

  it("marks only the current route item active", () => {
    renderSidebar("/console/admin/tenants");

    const activeLinks = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");

    expect(activeLinks).toHaveLength(1);
    expect(activeLinks[0]).toHaveTextContent("Tenants");
    expect(screen.getByRole("link", { name: "Nhật ký audit" })).not.toHaveAttribute("aria-current");
  });

  it("does not expose retired account management navigation", () => {
    renderSidebar("/console/admin/engineers");
    expect(screen.queryByRole("link", { name: "Engineers" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link").some(link => link.getAttribute("href")?.includes("engineer"))).toBe(false);
  });

  it("keeps device routes active on the single device sidebar item", () => {
    renderSidebar("/console/admin/provisioning");

    const activeLinks = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");

    expect(activeLinks).toHaveLength(1);
    expect(activeLinks[0]).toHaveTextContent("Thiết bị");
    expect(screen.queryByRole("link", { name: "Cấp phát thiết bị" })).not.toBeInTheDocument();
  });

  it("keeps OTA routes active on the single firmware sidebar item", () => {
    renderSidebar("/console/ota/new");

    const activeLinks = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");

    expect(activeLinks).toHaveLength(1);
    expect(activeLinks[0]).toHaveTextContent("Firmware / OTA");
    expect(screen.queryByRole("link", { name: "Chiến dịch OTA" })).not.toBeInTheDocument();
  });

  it("does not expose retired feature navigation", () => {
    renderSidebar();
    ["AI / TinyML", "Gói dịch vụ", "Feature Control", "API Docs"].forEach((name) => {
      expect(screen.queryByRole("link", { name })).not.toBeInTheDocument();
    });
  });

  it("keeps icons available and hides labels when collapsed", () => {
    renderSidebar("/console/admin/tenants", true);

    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(MENU_LABELS.length);
    expect(screen.queryByText("Tenants")).not.toBeInTheDocument();
    expect(screen.queryByText("Thu gọn")).not.toBeInTheDocument();
    expect(screen.getByTitle("Tenants")).toHaveAttribute("aria-current", "page");
  });
});
