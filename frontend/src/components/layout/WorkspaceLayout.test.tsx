import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspaceLayout } from "./WorkspaceLayout";
import "../../lib/i18n";

vi.mock("../../contexts/FeatureContext", () => ({
  useFeature: () => ({ hasFeature: () => true }),
}));

vi.mock("../../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggle: vi.fn() }),
}));

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      email: "test@example.com",
      role: "tenant_owner",
      permissions: ["projects.view", "devices.view"],
    },
  }),
}));

vi.mock("../../services/clientApi", () => ({
  getClientProject: vi.fn().mockResolvedValue({ id: "proj-1", name: "Test Project" }),
  listClientAlerts: vi.fn().mockResolvedValue([]),
}));

describe("WorkspaceLayout", () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  it("renders back button with 'Danh sách dự án' label and translated 'Thiết bị'", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/client/workspace/proj-1/home"]}>
          <Routes>
            <Route path="/client/workspace/:projectId/*" element={<WorkspaceLayout />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByText("Danh sách dự án")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Thiết bị" })).toBeInTheDocument();
  });
});
