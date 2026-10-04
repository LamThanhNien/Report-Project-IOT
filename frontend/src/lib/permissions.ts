export const OWNER_ROLE = "tenant_owner";
export const VIEWER_ROLE = "viewer";

export const ROLE_LABELS: Record<string, string> = {
  [OWNER_ROLE]: "Owner",
  [VIEWER_ROLE]: "Viewer",
};

export const PERMISSION_GROUPS = [
  {
    id: "dashboard",
    label: "Dashboard",
    permissions: [
      { key: "dashboard.view", label: "View dashboard" },
      { key: "dashboard.manage", label: "Manage dashboard" },
    ],
  },
  {
    id: "devices",
    label: "Devices",
    permissions: [
      { key: "devices.view", label: "View devices" },
      { key: "devices.manage", label: "Manage devices" },
    ],
  },
  {
    id: "device_groups",
    label: "Device Groups",
    permissions: [
      { key: "device_groups.view", label: "View device groups" },
      { key: "device_groups.manage", label: "Manage device groups" },
    ],
  },
  {
    id: "projects",
    label: "Projects",
    permissions: [
      { key: "projects.view", label: "View projects" },
      { key: "projects.manage", label: "Manage projects" },
    ],
  },
  {
    id: "commands",
    label: "Commands",
    permissions: [
      { key: "commands.view", label: "View command history" },
      { key: "commands.send", label: "Send commands" },
      { key: "command_templates.view", label: "View command templates" },
      { key: "command_templates.manage", label: "Manage command templates" },
    ],
  },
  {
    id: "automation",
    label: "Automation",
    permissions: [
      { key: "automation.view", label: "View automation" },
      { key: "automation.manage", label: "Manage automation" },
    ],
  },
  {
    id: "firmware_ota",
    label: "Firmware / OTA",
    permissions: [
      { key: "firmware.view", label: "View firmware" },
      { key: "firmware.manage", label: "Manage firmware" },
      { key: "ota.view", label: "View OTA jobs" },
      { key: "ota.manage", label: "Manage OTA jobs" },
    ],
  },
  {
    id: "monitoring",
    label: "Monitoring",
    permissions: [
      { key: "monitoring.view", label: "View monitoring" },
      { key: "monitoring.manage", label: "Manage monitoring configuration" },
    ],
  },
  {
    id: "members",
    label: "Members",
    permissions: [
      { key: "members.view", label: "View members" },
      { key: "members.manage", label: "Manage members" },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    permissions: [
      { key: "settings.view", label: "View settings" },
      { key: "settings.manage", label: "Manage settings" },
    ],
  },
] as const;

export type PermissionKey = (typeof PERMISSION_GROUPS)[number]["permissions"][number]["key"];

export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) => group.permissions.map((permission) => permission.key));

export const VIEWER_PERMISSIONS: PermissionKey[] = [
  "dashboard.view",
  "devices.view",
  "device_groups.view",
  "projects.view",
  "commands.view",
  "command_templates.view",
  "automation.view",
  "firmware.view",
  "ota.view",
  "monitoring.view",
  "members.view",
];

export const ROLE_PERMISSION_PRESETS: Record<string, PermissionKey[]> = {
  [OWNER_ROLE]: ALL_PERMISSIONS,
  [VIEWER_ROLE]: VIEWER_PERMISSIONS,
};

export const DEPENDENT_VIEW_PERMISSIONS: Partial<Record<PermissionKey, PermissionKey>> = {
  "dashboard.manage": "dashboard.view",
  "devices.manage": "devices.view",
  "device_groups.manage": "device_groups.view",
  "projects.manage": "projects.view",
  "commands.send": "commands.view",
  "command_templates.manage": "command_templates.view",
  "automation.manage": "automation.view",
  "firmware.manage": "firmware.view",
  "ota.manage": "ota.view",
  "monitoring.manage": "monitoring.view",
  "members.manage": "members.view",
  "settings.manage": "settings.view",
};

type PermissionUser = {
  role?: string | null;
  permissions?: string[] | null;
};

export function isOwner(user: PermissionUser | null | undefined): boolean {
  return user?.role === OWNER_ROLE;
}

export function effectivePermissions(user: PermissionUser | null | undefined): string[] {
  if (!user) return [];
  if (isOwner(user)) return ALL_PERMISSIONS;
  if (user.role !== VIEWER_ROLE) return [];
  if (user.permissions && user.permissions.length > 0) {
    return user.permissions.filter((permission) => VIEWER_PERMISSIONS.includes(permission as PermissionKey));
  }
  return VIEWER_PERMISSIONS;
}

export function hasPermission(user: PermissionUser | null | undefined, permission: PermissionKey): boolean {
  return isOwner(user) || effectivePermissions(user).includes(permission);
}

export function hasAnyPermission(user: PermissionUser | null | undefined, permissions: PermissionKey[]): boolean {
  if (isOwner(user)) return true;
  const current = new Set(effectivePermissions(user));
  return permissions.some((permission) => current.has(permission));
}

export const canManageMembers = (user: PermissionUser | null | undefined) => hasPermission(user, "members.manage");
export const canViewDashboard = (user: PermissionUser | null | undefined) => hasPermission(user, "dashboard.view");
export const canManageDashboard = (user: PermissionUser | null | undefined) => hasPermission(user, "dashboard.manage");
export const canViewDevices = (user: PermissionUser | null | undefined) => hasPermission(user, "devices.view");
export const canManageDevices = (user: PermissionUser | null | undefined) => hasPermission(user, "devices.manage");
export const canViewDeviceGroups = (user: PermissionUser | null | undefined) => hasPermission(user, "device_groups.view");
export const canManageDeviceGroups = (user: PermissionUser | null | undefined) => hasPermission(user, "device_groups.manage");
export const canViewProjects = (user: PermissionUser | null | undefined) => hasPermission(user, "projects.view");
export const canManageProjects = (user: PermissionUser | null | undefined) => hasPermission(user, "projects.manage");
export const canViewCommands = (user: PermissionUser | null | undefined) => hasPermission(user, "commands.view");
export const canSendCommands = (user: PermissionUser | null | undefined) => hasPermission(user, "commands.send");
export const canViewCommandTemplates = (user: PermissionUser | null | undefined) => hasPermission(user, "command_templates.view");
export const canManageCommandTemplates = (user: PermissionUser | null | undefined) => hasPermission(user, "command_templates.manage");
export const canViewAutomation = (user: PermissionUser | null | undefined) => hasPermission(user, "automation.view");
export const canManageAutomation = (user: PermissionUser | null | undefined) => hasPermission(user, "automation.manage");
export const canViewFirmware = (user: PermissionUser | null | undefined) => hasPermission(user, "firmware.view");
export const canManageFirmware = (user: PermissionUser | null | undefined) => hasPermission(user, "firmware.manage");
export const canViewOta = (user: PermissionUser | null | undefined) => hasPermission(user, "ota.view");
export const canManageOta = (user: PermissionUser | null | undefined) => hasPermission(user, "ota.manage");
export const canViewMonitoring = (user: PermissionUser | null | undefined) => hasPermission(user, "monitoring.view");
export const canManageMonitoring = (user: PermissionUser | null | undefined) => hasPermission(user, "monitoring.manage");
export const canViewMembers = (user: PermissionUser | null | undefined) => hasPermission(user, "members.view");
export const canViewSettings = (user: PermissionUser | null | undefined) => hasPermission(user, "settings.view");
export const canManageSettings = (user: PermissionUser | null | undefined) => hasPermission(user, "settings.manage");
