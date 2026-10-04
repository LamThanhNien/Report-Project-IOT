import { NavLink, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { Cpu, KeyRound, Package, Rocket, Send, UsersRound } from "lucide-react";
import { cn } from "../../lib/cn";

interface AdminSectionNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  activePaths?: string[];
}

export const ADMIN_DEVICE_SECTION_NAV: AdminSectionNavItem[] = [
  { to: "/console/devices", label: "Thiết bị", icon: Cpu, activePaths: ["/console/devices"] },
  { to: "/console/admin/device-groups", label: "Nhóm thiết bị", icon: UsersRound },
  { to: "/console/admin/provisioning", label: "Cấp phát thiết bị", icon: KeyRound },
  { to: "/console/admin/commands", label: "Lịch sử lệnh", icon: Send },
];

export const ADMIN_FIRMWARE_SECTION_NAV: AdminSectionNavItem[] = [
  { to: "/console/firmware", label: "Firmware", icon: Package },
  { to: "/console/ota", label: "Chiến dịch OTA", icon: Rocket, activePaths: ["/console/ota"] },
];

export function AdminSectionNav({
  items,
  className,
}: {
  items: AdminSectionNavItem[];
  className?: string;
}) {
  const location = useLocation();

  function isPathActive(item: AdminSectionNavItem, isActive: boolean) {
    if (isActive) return true;
    const paths = item.activePaths ?? [item.to];
    return paths.some((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));
  }

  return (
    <nav
      className={cn(
        "flex shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200 dark:border-border-subtle",
        className,
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors -mb-px",
                isPathActive(item, isActive)
                  ? "border-primary text-primary"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:text-text-muted dark:hover:text-text-secondary",
              )
            }
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
