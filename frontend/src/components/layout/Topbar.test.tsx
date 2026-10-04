import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { Topbar } from "./Topbar";
vi.mock("../../services/systemApi", () => ({ getSystemHealth: vi.fn().mockResolvedValue({ api: "healthy" }) }));
vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { email: "admin@example.com", role: "admin" }, logout: vi.fn() }),
}));
vi.mock("../../contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", toggle: vi.fn() }),
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

function renderTopbar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/console/dashboard"]}>
        <Topbar />
        <Routes>
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Topbar alerts", () => {
  it("does not render a support-grant selector", () => {
    renderTopbar();

    expect(screen.queryByRole("combobox", { name: "Phiên hỗ trợ đang hoạt động" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cảnh báo" })).toBeInTheDocument();
  });
});
