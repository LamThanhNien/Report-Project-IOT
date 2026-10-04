import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import { ClientUsers } from "./ClientUsers";
import * as api from "../../../services/clientApi";
import i18n from "../../../lib/i18n";
const auth = vi.hoisted(() => ({ role: "tenant_owner", permissions: [] as string[] }));
vi.mock("../../../services/clientApi");
vi.mock("../../../contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner-1", ...auth } }) }));
vi.mock("../../../contexts/FeatureContext", () => ({ useFeature: () => ({ hasFeature: () => true, featuresReady: true }) }));
const viewer = { id: "viewer-1", email: "viewer@example.com", full_name: "Reader", role: "viewer", permissions: ["devices.view"], is_active: true, tenant_id: "tenant-1", created_at: "" };
function mount() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ClientUsers /></QueryClientProvider>);
}
beforeEach(async () => {
  vi.clearAllMocks(); await i18n.changeLanguage("en"); auth.role = "tenant_owner"; auth.permissions = [];
  vi.mocked(api.listClientUsers).mockResolvedValue([viewer]);
  vi.mocked(api.createClientUser).mockResolvedValue(viewer);
});
it("allows owners to create viewer accounts with read-only permission choices", async () => {
  mount(); await screen.findByText(viewer.email);
  fireEvent.click(screen.getByRole("button", { name: "Add sub-user" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getAllByRole("option").map(option => option.getAttribute("value"))).toEqual(["viewer"]);
  expect(within(dialog).queryByRole("checkbox", { name: /Manage|Send/i })).not.toBeInTheDocument();
  fireEvent.change(within(dialog).getByLabelText("Email *"), { target: { value: "reader@example.com" } });
  fireEvent.change(within(dialog).getByLabelText("Password *"), { target: { value: "Reader123" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Create sub-user" }));
  await waitFor(() => expect(api.createClientUser).toHaveBeenCalled());
  const payload = vi.mocked(api.createClientUser).mock.calls[0][0];
  expect(payload.role).toBe("viewer");
  expect(payload.permissions?.length).toBeGreaterThan(0);
  expect(payload.permissions?.every(permission => permission.endsWith(".view"))).toBe(true);
});
it("keeps a viewer with legacy member-management grants read-only", async () => {
  auth.role = "viewer"; auth.permissions = ["members.view", "members.manage"];
  mount(); await screen.findByText(viewer.email);
  expect(screen.queryByRole("button", { name: "Add sub-user" })).not.toBeInTheDocument();
  expect(screen.queryByTitle("Edit sub-user")).not.toBeInTheDocument();
  expect(screen.queryByTitle("Remove sub-user")).not.toBeInTheDocument();
});
it("does not display stale unsupported-role accounts returned by an older API", async () => {
  vi.mocked(api.listClientUsers).mockResolvedValue([viewer, { ...viewer, id: "retired", email: "retired@example.com", role: "tenant_engineer" }]);
  mount(); await screen.findByText(viewer.email);
  expect(screen.queryByText("retired@example.com")).not.toBeInTheDocument();
});
