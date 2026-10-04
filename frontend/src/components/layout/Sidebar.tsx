import { memo, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Cpu,
  Package,
  Activity,
  Bell,
  Server,
  Settings,
  Boxes,
  X,
  Building2,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { prefetchRoute } from "../../app/routePrefetch";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  activePaths?: string[];
  openInNewTab?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/console", label: "Dashboard", icon: LayoutDashboard, end: true },
  {
    to: "/console/devices",
    label: "Thiết bị",
    icon: Cpu,
    activePaths: ["/console/devices", "/console/admin/device-groups", "/console/admin/provisioning", "/console/admin/commands"],
  },
  {
    to: "/console/firmware",
    label: "Firmware / OTA",
    icon: Package,
    activePaths: ["/console/firmware", "/console/ota"],
  },
  { to: "/console/telemetry", label: "Telemetry", icon: Activity },
  { to: "/console/alerts", label: "Cảnh báo", icon: Bell },
  { to: "/console/admin/tenants", label: "Tenants", icon: Building2 },
  { to: "/console/admin/platforms", label: "Device Registry", icon: Cpu },
  { to: "/console/admin/audit-logs", label: "Nhật ký audit", icon: ShieldCheck },
  { to: "/console/system", label: "Tình trạng", icon: Server },
  { to: "/console/settings", label: "Cài đặt", icon: Settings },
];

function getActivePath(pathname: string) {
  const matches = NAV_ITEMS.filter((item) => {
    if (item.end) return pathname === item.to;
    const paths = item.activePaths ?? [item.to];
    return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  });

  return matches.sort((a, b) => b.to.length - a.to.length)[0]?.to;
}

export const Sidebar = memo(function Sidebar({ collapsed: desktopCollapsed, onCollapse, mobileOpen = false, onMobileClose }: { collapsed: boolean; onCollapse: () => void; mobileOpen?: boolean; onMobileClose?: () => void }) {
  const collapsed = desktopCollapsed && !mobileOpen;
  const { pathname } = useLocation();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const activePath = pendingPath ?? getActivePath(pathname);

  useEffect(() => {
    setPendingPath(null);
  }, [pathname]);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 h-dvh w-64 flex shrink-0 flex-col bg-sidebar text-text-secondary transition-transform duration-200 lg:sticky lg:top-0 lg:z-30 lg:translate-x-0 lg:visible",
        "after:absolute after:right-0 after:top-16 after:bottom-0 after:w-px after:bg-border-subtle",
        mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full",
        desktopCollapsed ? "lg:w-16" : "lg:w-64",
      )}
    >
      <div className={cn("flex items-center gap-3 px-4 h-16 border-b border-border-subtle", collapsed && "justify-center px-0")}>
        <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
          <Boxes className="h-4 w-4" />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="font-bold text-text-primary text-sm tracking-wide">AIFOM</div>
            <div className="text-[10px] uppercase text-text-muted tracking-widest">Edge Fleet Console</div>
          </div>
        )}
      </div>

      <button type="button" onClick={onMobileClose} aria-label="Close navigation" className="absolute right-2 top-3 btn-ghost h-8 w-8 p-0 lg:hidden"><X className="h-4 w-4" /></button>

      <nav className="sidebar-scrollbar scrollbar-hide flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        <div className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = item.to === activePath;

            return (
              <Link
                onClick={onMobileClose}
                key={item.to}
                to={item.to}
                target={item.openInNewTab ? "_blank" : undefined}
                rel={item.openInNewTab ? "noopener noreferrer" : undefined}
                onMouseEnter={() => prefetchRoute(item.to)}
                onFocus={() => prefetchRoute(item.to)}
                onPointerDown={() => !item.openInNewTab && setPendingPath(item.to)}
                title={collapsed ? item.label : undefined}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-3 rounded-md border-l-2 px-3 text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "border-primary bg-surface-elevated text-primary shadow-sm dark:bg-surface-muted dark:text-primary"
                    : "border-transparent text-text-secondary hover:bg-surface-elevated/70 hover:text-text-primary dark:text-text-secondary dark:hover:bg-surface/50 dark:hover:text-text-primary",
                )}
              >
                <Icon className="h-4 w-4 flex-shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </div>
      </nav>

      <button
        onClick={onCollapse}
        type="button"
        aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        className="border-t border-border-subtle hidden lg:flex items-center gap-2 px-4 py-3 text-xs font-medium text-text-secondary hover:text-text-primary"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <>
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>Thu gọn</span>
          </>
        )}
      </button>
    </aside>
  );
});
