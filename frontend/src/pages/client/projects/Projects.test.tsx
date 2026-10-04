import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsList } from "./ProjectsList";
import * as clientApi from "../../../services/clientApi";
import "../../../lib/i18n";

let role = "tenant_owner";
vi.mock("../../../services/clientApi");
vi.mock("../../../contexts/AuthContext", () => ({ useAuth: () => ({ user: { role } }) }));
const project = { id: "project-1", tenant_id: "tenant-1", name: "ESP32 Lab", description: "Device workspace", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/client/projects"]}><Routes><Route path="/client/projects" element={<ProjectsList />} /><Route path="/client/workspace/:projectId/home" element={<p>Workspace overview</p>} /></Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); window.localStorage.clear(); role = "tenant_owner";
  vi.mocked(clientApi.listClientProjects).mockResolvedValue([project]);
  vi.mocked(clientApi.listClientDevices).mockResolvedValue([
    { id: "device-1", device_uid: "esp32-1", name: "Lab Device", project_id: project.id, status: "online", firmware_version: "1", last_seen_at: null, created_at: "2026-10-01", updated_at: "2026-10-01" },
  ]);
});
describe("Project workspaces", () => {
  it("opens a fixed workspace without custom dashboard editing", async () => {
    renderPage();
    expect(await screen.findByRole("link", { name: "ESP32 Lab" })).toHaveAttribute("href", "/client/workspace/project-1/home");
    expect(screen.queryByText(/widget/i)).not.toBeInTheDocument();
  });
  it("creates a workspace and navigates to its overview", async () => {
    vi.mocked(clientApi.createClientProject).mockResolvedValue(project);
    renderPage(); await screen.findByRole("link", { name: "ESP32 Lab" });
    fireEvent.click(screen.getByRole("button", { name: "Tạo dự án" }));
    fireEvent.change(screen.getByLabelText("Tên dự án"), { target: { value: "ESP32 Lab" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu|Save/ }));
    await waitFor(() => expect(clientApi.createClientProject).toHaveBeenCalledWith({ name: "ESP32 Lab", description: null }));
    expect(await screen.findByText("Workspace overview")).toBeInTheDocument();
  });
  it("keeps viewer accounts read-only", async () => {
    role = "viewer"; renderPage();
    await screen.findByRole("link", { name: "ESP32 Lab" });
    expect(screen.queryByRole("button", { name: "Tạo dự án" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sửa" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xóa" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Thao tác cho ESP32 Lab")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dạng danh sách" }));
    expect(screen.getByRole("link", { name: "ESP32 Lab" })).toHaveAttribute("href", "/client/workspace/project-1/home");
    expect(screen.queryByLabelText("Thao tác cho ESP32 Lab")).not.toBeInTheDocument();
  });
  it("searches descriptions and restores results after clearing filters", async () => {
    renderPage(); await screen.findByRole("link", { name: "ESP32 Lab" });
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm kiếm dự án" }), { target: { value: "no match" } });
    expect(screen.queryByRole("link", { name: "ESP32 Lab" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xóa bộ lọc" }));
    expect(screen.getByRole("link", { name: "ESP32 Lab" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Tìm kiếm dự án" }), { target: { value: "workspace" } });
    expect(screen.getByRole("link", { name: "ESP32 Lab" })).toBeInTheDocument();
  });
  it("filters using real device presence and keeps list links on workspace routes", async () => {
    renderPage(); await screen.findByRole("link", { name: "ESP32 Lab" });
    await waitFor(() => expect(screen.getAllByText("Đang hoạt động")).toHaveLength(3));
    fireEvent.click(screen.getByRole("button", { name: "Chưa có thiết bị" }));
    expect(screen.queryByRole("link", { name: "ESP32 Lab" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tất cả" }));
    fireEvent.click(screen.getByRole("button", { name: "Dạng danh sách" }));
    expect(screen.getByRole("link", { name: "ESP32 Lab" })).toHaveAttribute("href", "/client/workspace/project-1/home");
  });
  it("does not remove a project until the confirmation is submitted", async () => {
    vi.mocked(clientApi.deleteClientProject).mockResolvedValue(undefined);
    renderPage(); await screen.findByRole("link", { name: "ESP32 Lab" });
    fireEvent.click(screen.getByLabelText("Thao tác cho ESP32 Lab"));
    fireEvent.click(screen.getByRole("button", { name: "Xóa" }));
    expect(clientApi.deleteClientProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(clientApi.deleteClientProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Thao tác cho ESP32 Lab"));
    fireEvent.click(screen.getByRole("button", { name: "Xóa" }));
    const deleteButtons = screen.getAllByRole("button", { name: "Xóa" });
    fireEvent.click(deleteButtons[deleteButtons.length - 1]);
    await waitFor(() => expect(clientApi.deleteClientProject).toHaveBeenCalledWith(project.id));
  });
});
