import { NavLink, useLocation } from "react-router-dom";
import {
  Activity,
  Bell,
  Binary,
  Code,
  Cpu,
  CreditCard,
  KeyRound,
  Network,
  ScrollText,
  Sparkles,
  UserCog,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import { useFeature } from "../../contexts/FeatureContext";
import { useProjectScope } from "../../hooks/useProjectScope";
import type { FeatureKey } from "../../types";
import { useTranslation } from "react-i18next";

export interface ClientSectionNavItem {
  to: string;
  label: string;
  labelKey?: string;
  icon: LucideIcon;
  feature?: FeatureKey;
  activePaths?: string[];
}

export const DEVICES_SECTION_NAV: ClientSectionNavItem[] = [
  { to: "/devices", label: "Device List", labelKey: "devices:section.device_list", icon: Cpu, feature: "device_management" },
  { to: "/device-groups", label: "Device Groups", labelKey: "devices:section.device_groups", icon: Network, feature: "device_management" },
  { to: "/provisioning", label: "Add / Claim Device", labelKey: "devices:section.provisioning", icon: KeyRound, feature: "device_management" },
];

export const MONITORING_SECTION_NAV: ClientSectionNavItem[] = [
  { to: "/telemetry", label: "Telemetry", labelKey: "monitoring:section.telemetry", icon: Binary, feature: "telemetry_view" },
  { to: "/alerts", label: "Alerts", labelKey: "alerts:section.alerts", icon: Bell, feature: "alert_management" },
];

export const SETTINGS_SECTION_NAV: ClientSectionNavItem[] = [
  { to: "/account", label: "Account", labelKey: "account:section.account", icon: UserCog },
  { to: "/audit-logs", label: "Activity Log", labelKey: "audit:section.activity_log", icon: ScrollText, feature: "audit_log" },
];

export function ClientSectionNav({
  items,
  className,
  actions,
}: {
  items: ClientSectionNavItem[];
  className?: string;
  actions?: React.ReactNode;
}) {
  const location = useLocation();
  const { t } = useTranslation(["devices", "monitoring", "alerts", "account", "audit"]);
  const { hasFeature } = useFeature();
  const { resolveLink } = useProjectScope();
  const visibleItems = items.filter((item) => !item.feature || hasFeature(item.feature));

  if (visibleItems.length <= 1 && !actions) return null;

  function isPathActive(item: ClientSectionNavItem, isActive: boolean, resolvedPath: string) {
    if (isActive) return true;
    if (location.pathname === resolvedPath || location.pathname.startsWith(`${resolvedPath}/`)) return true;
    return item.activePaths?.some(
      (path) => {
        const p = resolveLink(path);
        return location.pathname === p || location.pathname.startsWith(`${p}/`);
      }
    );
  }

  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 backdrop-blur-sm dark:border-border-subtle dark:bg-app/95",
        className,
      )}
    >
      <nav className="flex min-w-0 flex-1 basis-full items-center gap-1 overflow-x-auto overflow-y-hidden md:basis-auto">
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const resolvedPath = resolveLink(item.to);
        return (
          <NavLink
            key={item.to}
            to={resolvedPath}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors -mb-px",
                isPathActive(item, isActive, resolvedPath)
                  ? "border-primary text-primary"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:text-text-muted dark:hover:text-text-secondary",
              )
            }
          >
            <Icon className="h-4 w-4" />
            {item.labelKey ? t(item.labelKey, item.label) : item.label}
          </NavLink>
        );
      })}
      </nav>
      {actions && (
        <div className="ml-auto flex shrink-0 items-center px-1 pb-1">
          {actions}
        </div>
      )}
    </div>
  );
}
