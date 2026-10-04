import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Settings } from "./Settings";
import * as settingsApi from "../../services/settingsApi";
import * as authApi from "../../services/authApi";

vi.mock("../../services/settingsApi");
vi.mock("../../services/authApi");
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "admin-1", email: "admin@aifom.local", role: "admin", is_active: true } }),
}));
vi.mock("../../contexts/ThemeContext", () => ({ useTheme: () => ({ theme: "dark", toggle: vi.fn() }) }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><Settings /></QueryClientProvider>);
}

beforeEach(() => {
  vi.mocked(settingsApi.getSystemSettings).mockResolvedValue({
    organization_name: "AIFOM Lab", timezone: "Asia/Ho_Chi_Minh",      default_locale: "en",
      email_notifications_enabled: true,
      updated_at: "2026-06-25T12:00:00Z",
  });
  vi.mocked(settingsApi.getOtaPolicy).mockResolvedValue({
    auto_update_enabled: false, maintenance_window_start: "02:00", maintenance_window_end: "05:00",
    rollback_threshold: 30, max_concurrent_updates: 10, updated_at: "2026-06-18T00:00:00Z",
  });
  vi.mocked(settingsApi.listAdmins).mockResolvedValue([]);
});

describe("Settings", () => {
  it("loads backend settings and saves edits", async () => {
    vi.mocked(settingsApi.updateSystemSettings).mockResolvedValue({
      organization_name: "New Org", timezone: "UTC",      default_locale: "vi",
      email_notifications_enabled: true,
      updated_at: "2026-06-25T12:00:00Z",
    });
    renderPage();

    const organization = await screen.findByLabelText("Tên tổ chức");
    await waitFor(() => expect(organization).toHaveValue("AIFOM Lab"));
    fireEvent.change(organization, { target: { value: "New Org" } });
    fireEvent.change(screen.getByLabelText("Múi giờ"), { target: { value: "UTC" } });
    fireEvent.click(screen.getByText("Lưu thay đổi"));

    await waitFor(() => expect(settingsApi.updateSystemSettings).toHaveBeenCalledWith(expect.objectContaining({ organization_name: "New Org", timezone: "UTC" })));
  });

  it("validates password confirmation before calling the API", async () => {
    renderPage();
    await screen.findByLabelText("Tên tổ chức");
    fireEvent.click(screen.getByText("Tài khoản"));
    fireEvent.change(screen.getByLabelText("Mật khẩu hiện tại"), { target: { value: "Current1" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: "Different2" } });
    fireEvent.change(screen.getByLabelText("Xác nhận mật khẩu"), { target: { value: "Mismatch2" } });
    fireEvent.click(screen.getByText("Đổi mật khẩu"));

    expect(await screen.findByRole("alert")).toHaveTextContent("không khớp");
    expect(authApi.changePassword).not.toHaveBeenCalled();
  });

  it("renders admin accounts and creates an admin", async () => {
    vi.mocked(settingsApi.listAdmins).mockResolvedValue([{ id: "admin-2", email: "other@aifom.local", full_name: "Other", role: "admin", is_active: true, permissions: [], tenant_id: null, created_at: "2026-06-18T00:00:00Z" }]);
    vi.mocked(settingsApi.createAdmin).mockResolvedValue({ id: "admin-3", email: "new@aifom.local", full_name: "New", role: "admin", is_active: true, permissions: [], tenant_id: null, created_at: "2026-06-18T00:00:00Z" });
    renderPage();
    await screen.findByLabelText("Tên tổ chức");
    fireEvent.click(screen.getByText("Quản trị viên"));
    expect(await screen.findByText("other@aifom.local")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email quản trị viên"), { target: { value: "new@aifom.local" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu tạm thời"), { target: { value: "Temporary1" } });
    fireEvent.click(screen.getByText("Tạo quản trị viên"));
    await waitFor(() => expect(settingsApi.createAdmin).toHaveBeenCalledWith(expect.objectContaining({ email: "new@aifom.local", password: "Temporary1" })));
  });
});
