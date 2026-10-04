import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminRoute, ClientRoute, ProtectedRoute } from "./ProtectedRoute";

let mockAuth: { token: string | null; loading: boolean; user: { role: string; permissions?: string[]; is_active?: boolean } | null };
vi.mock("../contexts/AuthContext", async importOriginal => ({
  ...(await importOriginal<typeof import("../contexts/AuthContext")>()),
  useAuth: () => mockAuth,
}));
function renderRoute(kind: "admin" | "client" | "protected") {
  const path = kind === "admin" ? "/console" : kind === "client" ? "/client/dashboard" : "/protected";
  const gate = kind === "admin" ? <AdminRoute /> : kind === "client" ? <ClientRoute /> : <ProtectedRoute />;
  render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route element={gate}><Route path={path} element={<div>Allowed content</div>} /></Route>
    {kind !== "admin" && <Route path="/console" element={<div>Admin redirect</div>} />}
    {kind !== "client" && <Route path="/client/dashboard" element={<div>Client redirect</div>} />}
    <Route path="/login" element={<div>Login</div>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => { mockAuth = { token: "cookie-session", loading: false, user: { role: "admin", is_active: true } }; });
describe("supported role route authorization", () => {
  it("allows the exact admin role in the admin console", () => {
    renderRoute("admin"); expect(screen.getByText("Allowed content")).toBeInTheDocument();
  });
  it.each(["tenant_owner", "viewer"])("redirects supported tenant role %s from the admin console", role => {
    mockAuth.user = { role }; renderRoute("admin");
    expect(screen.getByText("Client redirect")).toBeInTheDocument();
    expect(screen.queryByText("Allowed content")).not.toBeInTheDocument();
  });
  it.each(["tenant_owner", "viewer"])("allows supported tenant role %s in the client portal", role => {
    mockAuth.user = { role }; renderRoute("client"); expect(screen.getByText("Allowed content")).toBeInTheDocument();
  });
  it("redirects an admin from the client portal to the admin console", () => {
    renderRoute("client"); expect(screen.getByText("Admin redirect")).toBeInTheDocument();
  });
  for (const kind of ["admin", "client", "protected"] as const) {
    it.each(["tenant_engineer", "platform_engineer", "unknown"])(`rejects unsupported role %s at ${kind} routes despite stored permissions`, role => {
      mockAuth.user = { role, permissions: ["devices.manage", "commands.send", "platform.devices.view"], is_active: true };
      renderRoute(kind);
      expect(screen.getByText("Login")).toBeInTheDocument();
      expect(screen.queryByText("Allowed content")).not.toBeInTheDocument();
    });
    it(`rejects disabled supported accounts at ${kind} routes`, () => {
      mockAuth.user = { role: kind === "admin" ? "admin" : "tenant_owner", is_active: false };
      renderRoute(kind); expect(screen.getByText("Login")).toBeInTheDocument();
    });
  }
});
