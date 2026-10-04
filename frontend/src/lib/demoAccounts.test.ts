import { describe, expect, it } from "vitest";
import { getDemoCredentials } from "./demoAccounts";

describe("local demo credentials", () => {
  it("hides placeholder and incomplete accounts", () => {
    expect(getDemoCredentials({ VITE_DEMO_ADMIN_EMAIL: "REPLACE_ME", VITE_DEMO_ADMIN_PASSWORD: "unused" }, true)).toEqual([]);
    expect(getDemoCredentials({ VITE_DEMO_TENANT_EMAIL: "demo@aifom.local" }, true)).toEqual([]);
  });
  it("uses matching password when no hint is configured and includes viewer", () => {
    const accounts = getDemoCredentials({ VITE_DEMO_VIEWER_EMAIL: "demo-viewer@aifom.local", VITE_DEMO_VIEWER_PASSWORD: "test-only-123", VITE_DEMO_VIEWER_PASSWORD_HINT: "REPLACE_ME" }, true);
    expect(accounts[0]).toMatchObject({ role: "Viewer", passwordValue: "test-only-123", passwordLabel: "test-only-123" });
  });
  it("never exposes the local demo panel in production", () => {
    expect(getDemoCredentials({ VITE_DEMO_ADMIN_EMAIL: "demo@aifom.local", VITE_DEMO_ADMIN_PASSWORD: "test-only-123" }, false)).toEqual([]);
  });
  it("exposes only supported accounts even when old environment keys remain", () => {
    const accounts = getDemoCredentials({
      VITE_DEMO_ENGINEER_EMAIL: "retired@aifom.local",
      VITE_DEMO_ENGINEER_PASSWORD: "test-only-123",
      VITE_DEMO_ADMIN_EMAIL: "demo-admin@aifom.local",
      VITE_DEMO_ADMIN_PASSWORD: "test-only-456",
    }, true);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].role).toBe("Admin");
  });
});
