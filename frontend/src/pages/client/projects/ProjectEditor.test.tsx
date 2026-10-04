import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceHome } from "../workspace/WorkspaceHome";
import { ConfirmProvider } from "../../../contexts/ConfirmContext";
import { ToastProvider } from "../../../contexts/ToastContext";
import * as api from "../../../services/clientApi";
import { ApiError } from "../../../services/apiClient";
import i18n from "../../../lib/i18n";
import type { Device, ProjectWidget, TenantProjectDetail } from "../../../types";

const auth = vi.hoisted(() => ({ role: "viewer", permissions: [] as string[] }));
vi.mock("../../../services/clientApi");
vi.mock("../../../contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1", tenant_id: "tenant-1", ...auth } }) }));
vi.mock("../../../services/datastreamApi", () => ({ listDatastreams: vi.fn().mockResolvedValue({ items: [] }) }));

const device: Device = { id: "device-1", device_uid: "sensor-lab-1", name: "Lab sensor", status: "online", firmware_version: "1.0", last_seen_at: "2026-10-02T12:00:00Z", created_at: "", updated_at: "" };
const numberWidget: ProjectWidget = {
  id: "widget-temperature", page_id: "page-1", widget_type: "number_card", title: "Room temperature", sort_order: 0,
  layout: { col_span: 1, row_span: 1 }, config: { unit: "°C", decimalPlaces: 1 },
  binding: { binding_type: "physical", device_id: device.id, device_uid: device.device_uid, state_key: "temperature", telemetry_field: "temperature" },
  created_at: "", updated_at: "",
};
const controlWidget: ProjectWidget = {
  ...numberWidget, id: "widget-relay", widget_type: "toggle_switch", title: "Ventilation", sort_order: 1,
  config: { confirmBeforeSend: false },
  binding: { device_id: device.id, device_uid: device.device_uid, state_key: "relay_state", command: "set_output", channel: "relay_1", params: { target: "relay_1", value: false } },
};
const project = (): TenantProjectDetail => ({
  id: "project-1", tenant_id: "tenant-1", name: "Sensor workspace", description: "", created_at: "", updated_at: "",
  pages: [{ id: "page-1", project_id: "project-1", title: "Home", slug: "home", sort_order: 0, widgets: [numberWidget, controlWidget], created_at: "", updated_at: "" }],
  latest_state: { [device.id]: { temperature: 18.2, relay_state: false, ts: "2026-10-02T12:00:00Z" } },
});

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<MemoryRouter initialEntries={["/client/workspace/project-1/home"]}><QueryClientProvider client={client}><ToastProvider><ConfirmProvider><Routes>
    <Route path="/client/workspace/:projectId/home" element={<WorkspaceHome />} />
  </Routes></ConfirmProvider></ToastProvider></QueryClientProvider></MemoryRouter>);
}

beforeEach(async () => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear();
  await i18n.changeLanguage("en");
  auth.role = "viewer"; auth.permissions = [];
  vi.mocked(api.getClientProject).mockResolvedValue(project());
  vi.mocked(api.getClientProjectRuntimeState).mockResolvedValue({ project_id: "project-1", latest_state: { [device.id]: { temperature: 24.7, relay_state: false, ts: "2026-10-02T12:01:00Z" } } });
  vi.mocked(api.listClientDevices).mockResolvedValue([device]);
  vi.mocked(api.listClientDeviceCapabilities).mockResolvedValue([]);
  vi.mocked(api.updateClientProjectWidget).mockResolvedValue(numberWidget);
  vi.mocked(api.sendClientDeviceCommand).mockResolvedValue({ status: "sent", command_id: "command-1" } as never);
});

describe("workspace Home source canvas", () => {
  it.each(["viewer", "tenant_engineer", "platform_engineer"])("denies canvas and command writes for %s despite legacy grants", async role => {
    auth.role = role;
    auth.permissions = ["projects.view", "projects.manage", "commands.send"];
    renderHome();
    await screen.findByText("24.7 °C");
    expect(screen.queryByRole("button", { name: /Edit dashboard/i })).not.toBeInTheDocument();
    const control = screen.getByRole("switch", { name: /Ventilation: OFF/i });
    expect(control).toBeDisabled();
    fireEvent.click(control);
    expect(api.sendClientDeviceCommand).not.toHaveBeenCalled();
    expect(api.updateClientProjectWidget).not.toHaveBeenCalled();
  });
  it("loads persisted widgets and real runtime state for a viewer without mutation controls", async () => {
    sessionStorage.setItem("aifom_dashboard_editing_project-1", "true");
    sessionStorage.setItem("aifom_dashboard_preview_project-1", "true");
    const { container } = renderHome();
    await waitFor(() => expect(screen.getByText("24.7 °C")).toBeInTheDocument());
    expect(screen.getByText("Room temperature")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-grid")).toBeInTheDocument();
    expect(container.querySelector(".dashboard-grid--editing")).not.toBeInTheDocument();
    expect(api.getClientProject).toHaveBeenCalledWith("project-1");
    expect(api.getClientProjectRuntimeState).toHaveBeenCalledWith("project-1");
    expect(api.listClientDevices).toHaveBeenCalledWith("project-1");
    expect(screen.queryByRole("button", { name: /Edit dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit$|Delete Ventilation/i })).not.toBeInTheDocument();
    const control = screen.getByRole("switch", { name: /Ventilation: OFF/i });
    expect(control).toBeDisabled();
    fireEvent.click(control);
    expect(api.sendClientDeviceCommand).not.toHaveBeenCalled();
    expect(api.createClientProjectWidget).not.toHaveBeenCalled();
    expect(api.updateClientProjectWidget).not.toHaveBeenCalled();
  });

  it("uses the persisted snapshot when an older runtime endpoint responds 404", async () => {
    vi.mocked(api.getClientProjectRuntimeState).mockRejectedValue(new ApiError("Not found", 404, {}));
    renderHome();
    await waitFor(() => expect(screen.getByText("18.2 °C")).toBeInTheDocument());
    expect(api.getClientProjectRuntimeState).toHaveBeenCalledTimes(1);
  });

  it("persists source grid layout for an owner without dispatching commands on save", async () => {
    auth.role = "tenant_owner"; auth.permissions = ["projects.view", "projects.manage"];
    renderHome();
    await screen.findByText("24.7 °C");
    expect(screen.getByRole("switch", { name: /Ventilation: OFF/i })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Edit dashboard/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save layout/i }));
    await waitFor(() => expect(api.updateClientProjectWidget).toHaveBeenCalledWith("widget-temperature", expect.objectContaining({ layout: expect.objectContaining({ grid: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), w: expect.any(Number), h: expect.any(Number) }) }) })));
    expect(api.sendClientDeviceCommand).not.toHaveBeenCalled();
  });

  it("allows an owner to dispatch persisted widget commands and manage the canvas", async () => {
    auth.role = "tenant_owner"; auth.permissions = ["projects.view", "commands.send"];
    renderHome();
    await screen.findByText("24.7 °C");
    fireEvent.click(screen.getByRole("switch", { name: /Ventilation: OFF/i }));
    await waitFor(() => expect(api.sendClientDeviceCommand).toHaveBeenCalledWith(device.id, { command: "set_output", params: expect.objectContaining({ target: "relay_1", value: true }) }));
    expect(screen.getByRole("button", { name: /Edit dashboard/i })).toBeInTheDocument();
  });

  it("edits persisted configuration while previewing the real device value", async () => {
    auth.role = "tenant_owner"; auth.permissions = ["projects.view", "projects.manage"];
    renderHome();
    await screen.findByText("24.7 °C");
    fireEvent.click(screen.getAllByRole("button", { name: /^Edit$/i })[0]);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Design|Thiết kế/i }));
    expect(within(dialog).getByText("24.7 °C")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Title|Tiêu đề/i }), { target: { value: "Lab temperature" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save$/i }));
    await waitFor(() => expect(api.updateClientProjectWidget).toHaveBeenCalledWith(numberWidget.id, expect.objectContaining({ title: "Lab temperature", widget_type: "number_card", binding: expect.objectContaining({ device_id: device.id, telemetry_field: "temperature" }) })));
    expect(api.createClientProjectWidget).not.toHaveBeenCalled();
  });

  it("creates a Main canvas page only after a manager requests it for an older project", async () => {
    auth.role = "tenant_owner"; auth.permissions = ["projects.view", "projects.manage"];
    vi.mocked(api.getClientProject).mockResolvedValue({ ...project(), pages: [] });
    vi.mocked(api.createClientProjectPage).mockResolvedValue(project().pages[0]);
    renderHome();
    const button = await screen.findByRole("button", { name: /Create canvas/i });
    expect(api.createClientProjectPage).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(api.createClientProjectPage).toHaveBeenCalledWith("project-1", { title: "Main", slug: "main", sort_order: 0 }));
  });

  it("keeps a project without pages read-only for viewers", async () => {
    vi.mocked(api.getClientProject).mockResolvedValue({ ...project(), pages: [] });
    const { container } = renderHome();
    await waitFor(() => expect(container.querySelector(".dashboard-grid")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Create canvas|Edit dashboard/i })).not.toBeInTheDocument();
    expect(api.createClientProjectPage).not.toHaveBeenCalled();
    expect(api.createClientProjectWidget).not.toHaveBeenCalled();
  });
});
