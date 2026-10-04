import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, VIEWER_PERMISSIONS, effectivePermissions, hasAnyPermission, hasPermission } from "./permissions";

describe("supported tenant permissions", () => {
  it("retains full owner capabilities even with a partial stored permission list", () => {
    const owner = { role: "tenant_owner", permissions: ["projects.view"] };
    expect(effectivePermissions(owner)).toEqual(ALL_PERMISSIONS);
    for (const permission of ["projects.manage", "commands.send", "ota.manage", "automation.manage"] as const) expect(hasPermission(owner, permission)).toBe(true);
  });
  it("caps viewers at read-only permissions despite legacy stored write grants", () => {
    const viewer = { role: "viewer", permissions: ["projects.view", "projects.manage", "commands.send", "ota.manage", "automation.manage", "members.manage"] };
    expect(effectivePermissions(viewer)).toEqual(["projects.view"]);
    for (const permission of ["projects.manage", "commands.send", "ota.manage", "automation.manage", "members.manage"] as const) expect(hasPermission(viewer, permission)).toBe(false);
    expect(hasAnyPermission(viewer, ["commands.send", "projects.manage"])).toBe(false);
  });
  it("keeps the viewer preset and read permission customization", () => {
    expect(effectivePermissions({ role: "viewer", permissions: [] })).toEqual(VIEWER_PERMISSIONS);
    expect(effectivePermissions({ role: "viewer", permissions: ["commands.view", "ota.view"] })).toEqual(["commands.view", "ota.view"]);
  });
  it.each(["tenant_engineer", "platform_engineer", "unknown", "admin"])("does not grant tenant privileges to unsupported tenant actor %s", role => {
    const actor = { role, permissions: [...ALL_PERMISSIONS, "platform.devices.view"] };
    expect(effectivePermissions(actor)).toEqual([]);
    expect(hasPermission(actor, "devices.view")).toBe(false);
    expect(hasAnyPermission(actor, ["projects.manage", "commands.send"])).toBe(false);
  });
});
