import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { AuthProvider, useAuth } from "./AuthContext";
import * as authApi from "../services/authApi";
import { ApiError } from "../services/apiClient";
vi.mock("../services/authApi");
const user = (role: string): authApi.UserRead => ({ id: "user-1", email: "account@example.com", full_name: null, role, is_active: true, tenant_id: role === "admin" ? null : "tenant-1", permissions: ["projects.manage", "commands.send"], created_at: "" });
function Probe() {
  const auth = useAuth(); const [error, setError] = useState("");
  return <><div>{auth.loading ? "Loading" : auth.user?.role ?? "Signed out"}</div><div>{auth.token ?? "No session"}</div><button onClick={() => { void auth.login("account@example.com", "password").catch(err => setError(err.message)); }}>Login attempt</button>{error && <div role="alert">{error}</div>}</>;
}
function mount() { render(<AuthProvider><Probe /></AuthProvider>); }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.mocked(authApi.getMe).mockRejectedValue(new ApiError("Not authenticated", 401, null));
  vi.mocked(authApi.refreshAccessToken).mockRejectedValue(new ApiError("Not authenticated", 401, null));
});
describe("supported session roles", () => {
  it.each(["admin", "tenant_owner", "viewer"])("restores supported role %s", async role => {
    vi.mocked(authApi.getMe).mockResolvedValue(user(role)); mount();
    expect(await screen.findByText(role)).toBeInTheDocument();
    expect(screen.getByText("cookie-session")).toBeInTheDocument();
  });
  it.each(["tenant_engineer", "platform_engineer", "unknown"])("rejects retired role %s during bootstrap and refresh", async role => {
    vi.mocked(authApi.getMe).mockResolvedValue(user(role));
    vi.mocked(authApi.refreshAccessToken).mockResolvedValue({ token_type: "bearer", user: user(role) });
    mount(); expect(await screen.findByText("Signed out")).toBeInTheDocument();
    expect(screen.getByText("No session")).toBeInTheDocument();
    expect(screen.queryByText(role)).not.toBeInTheDocument();
  });
  it.each(["tenant_engineer", "platform_engineer"])("rejects retired role %s from a stale login response", async role => {
    vi.mocked(authApi.login).mockResolvedValue({ token_type: "bearer", user: user(role) });
    mount(); await screen.findByText("Signed out");
    fireEvent.click(screen.getByRole("button", { name: "Login attempt" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This account cannot access the application.");
    expect(screen.getByText("No session")).toBeInTheDocument();
    expect(screen.getByText("Signed out")).toBeInTheDocument();
  });
});
