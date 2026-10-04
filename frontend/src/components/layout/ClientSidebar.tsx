import { memo, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Boxes,
  X,
  Brain,
  ChevronLeft,
  ChevronRight,
  Code,
  Cpu,
  FileDown,
  LayoutDashboard,
  Activity,
  PanelsTopLeft,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { useFeature } from "../../contexts/FeatureContext";
import { useAuth } from "../../contexts/AuthContext";
import { hasAnyPermission, hasPermission, type PermissionKey } from "../../lib/permissions";
import type { FeatureKey } from "../../types";
import { prefetchRoute } from "../../app/routePrefetch";

interface NavItem {
  to: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  feature?: FeatureKey;
  features?: FeatureKey[];
  fallbackRoutes?: { feature: FeatureKey; to: string }[];
  permission?: PermissionKey;
  permissions?: PermissionKey[];
  permissionFallbackRoutes?: { permission: PermissionKey; to: string }[];
  end?: boolean;
  activePaths?: string[];
  ownerOnly?: boolean;
}

const ALL_NAV: NavItem[] = [
  { to: "/client/dashboard", labelKey: "dashboard", icon: LayoutDashboard, permission: "dashboard.view", end: true },
  {
    to: "/client/projects",
    labelKey: "projects",
    icon: PanelsTopLeft,
    feature: "device_management",
    permission: "projects.view",
    activePaths: ["/client/projects"],
  },
  {
    to: "/client/devices",
    labelKey: "devices",
    icon: Cpu,
    feature: "device_management",
    permission: "devices.view",
    activePaths: ["/client/devices", "/client/device-groups", "/client/provisioning"],
  },
  {
    to: "/client/telemetry",
    labelKey: "monitoring",
    icon: Activity,
    permission: "monitoring.view",
    activePaths: ["/client/telemetry", "/client/alerts"],
  },
  { to: "/client/commands", labelKey: "commands", icon: Cpu, permissions: ["commands.view", "command_templates.view"] },
  { to: "/client/automation", labelKey: "automation", icon: Activity, permission: "automation.view" },
  { to: "/client/ota", labelKey: "ota_campaigns", icon: Cpu, permissions: ["firmware.view", "ota.view"] },
  { to: "/client/users", labelKey: "members", icon: Users, feature: "user_management", permission: "members.view" },
  { to: "/client/api-access", labelKey: "api_access", icon: Code, feature: "api_access", activePaths: ["/client/api-access"] },
  {
    to: "/client/account",
    labelKey: "settings",
    icon: SettingsIcon,
    activePaths: ["/client/account", "/client/audit-logs"],
  },
];

export const ClientSidebar = memo(function ClientSidebar({
  collapsed: desktopCollapsed,
  mobileOpen = false,
  onMobileClose,
  onCollapse,
  tenantName,
}: {
  collapsed: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onCollapse: () => void;
  tenantName: string;
}) {
  const collapsed = desktopCollapsed && !mobileOpen;
  const { t } = useTranslation("nav");
  const { hasFeature } = useFeature();
  const { user } = useAuth();
  const location = useLocation();
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const [hoveredTooltip, setHoveredTooltip] = useState<{ label: string; top: number } | null>(null);

  const visibleNav = useMemo(
    () => ALL_NAV.filter((item) => {
      if (item.ownerOnly && user?.role !== "tenant_owner") return false;
      if (item.feature && !hasFeature(item.feature)) return false;
      if (item.features && !item.features.some((feature) => hasFeature(feature))) return false;
      if (item.permission) return hasPermission(user, item.permission);
      if (item.permissions) return hasAnyPermission(user, item.permissions);
      return true;
    }),
    [hasFeature, user],
  );

  useEffect(() => {
    setPendingPath(null);
  }, [location.pathname]);

  function isPathActive(item: NavItem, target: string, isActive: boolean) {
    const pathname = pendingPath ?? location.pathname;
    if (pendingPath ? pathname === target : isActive) return true;
    return item.activePaths?.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );
  }

  function navTarget(item: NavItem) {
    const featureTarget = item.fallbackRoutes?.find((route) => hasFeature(route.feature))?.to ?? item.to;
    return item.permissionFallbackRoutes?.find((route) => hasPermission(user, route.permission))?.to ?? featureTarget;
  }

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 h-dvh w-64 flex shrink-0 flex-col bg-sidebar text-text-secondary transition-transform duration-200 lg:sticky lg:top-0 lg:z-30 lg:translate-x-0 lg:visible",
        "after:absolute after:right-0 after:top-14 after:bottom-0 after:w-px after:bg-border-subtle",
        mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full",
        desktopCollapsed ? "lg:w-16" : "lg:w-64",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 px-4 h-14 border-b border-border-subtle",
          collapsed && "justify-center px-0",
        )}
      >
        <div className="h-8 w-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
          <Boxes className="h-4 w-4" />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="font-bold text-text-primary text-sm tracking-wide">AIFOM</div>
            <div className="text-[10px] uppercase text-text-muted tracking-widest">
              Client Portal
            </div>
          </div>
        )}
      </div>

      <button type="button" onClick={onMobileClose} aria-label="Close navigation" className="absolute right-2 top-3 btn-ghost h-8 w-8 p-0 lg:hidden"><X className="h-4 w-4" /></button>

      <nav className="sidebar-scrollbar scrollbar-hide flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
        {visibleNav.map((item) => {
          const Icon = item.icon;
          const target = navTarget(item);
          const label = t(`sidebar.${item.labelKey}`);
          return (
            <NavLink
              aria-label={label}
              onClick={onMobileClose}
              key={item.to}
              to={target}
              end={item.end}
              onMouseEnter={(e) => {
                prefetchRoute(target);
                if (collapsed) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setHoveredTooltip({ label, top: rect.top + rect.height / 2 });
                }
              }}
              onMouseLeave={() => setHoveredTooltip(null)}
              onFocus={() => prefetchRoute(target)}
              onPointerDown={() => setPendingPath(target)}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  isPathActive(item, target, isActive)
                    ? "bg-surface-elevated text-primary border-l-2 border-primary shadow-sm dark:bg-surface-muted dark:text-primary"
                    : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary border-l-2 border-transparent dark:text-text-secondary dark:hover:bg-surface/70 dark:hover:text-text-primary",
                )
              }
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      <button
        type="button"
        aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        onClick={onCollapse}
        onMouseEnter={(e) => {
          if (collapsed) {
            const rect = e.currentTarget.getBoundingClientRect();
            setHoveredTooltip({ label: t("sidebar.expand"), top: rect.top + rect.height / 2 });
          }
        }}
        onMouseLeave={() => setHoveredTooltip(null)}
        className={cn(
          "border-t border-border-subtle hidden lg:flex items-center gap-2 px-4 py-3 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors",
          collapsed && "justify-center px-0",
        )}
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <>
            <ChevronLeft className="h-3.5 w-3.5" />
            <span>{t("sidebar.collapse")}</span>
          </>
        )}
      </button>

      {/* Fixed position instant tooltip to prevent overflow clipping */}
      {collapsed && hoveredTooltip && (
        <div
          style={{ top: `${hoveredTooltip.top}px` }}
          className="fixed left-16 -translate-y-1/2 ml-2 px-2.5 py-1.5 bg-slate-900 text-white dark:bg-slate-800 dark:text-slate-100 text-xs font-semibold rounded-md shadow-xl whitespace-nowrap z-[9999] pointer-events-none border border-slate-700/50 dark:border-border-subtle"
        >
          {hoveredTooltip.label}
        </div>
      )}
    </aside>
  );
});
