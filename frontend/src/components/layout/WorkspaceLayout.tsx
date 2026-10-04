import { Suspense, useCallback, useEffect, useState } from "react";
import { Outlet, useNavigate, useParams, NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Menu,
  X,
  ArrowLeft,
  LayoutDashboard,
  Cpu,
  Terminal,
  Zap,
  Rocket,
  Activity,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  GitBranch,
  Bell,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { getClientProject } from "../../services/clientApi";
import { ClientTopbar } from "./ClientTopbar";
import { ContentLoader } from "../ContentLoader";
import { cn } from "../../lib/cn";
import { hasAnyPermission, hasPermission } from "../../lib/permissions";

const KEY = "aifom_client_sidebar_collapsed";

// ── Logo helpers (shared with ProjectCard) ──────────────────────────────────
const LOGO_COLORS = [
  "bg-orange-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-teal-500",
  "bg-indigo-500",
];

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function getLogoColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return LOGO_COLORS[hash % LOGO_COLORS.length];
}

export function WorkspaceLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { t, i18n } = useTranslation("nav");

  const [desktopCollapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(KEY) === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileOpen]);
  const collapsed = desktopCollapsed && !mobileOpen;
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  const [hoveredTooltip, setHoveredTooltip] = useState<{ label: string; top: number } | null>(null);

  const projectQ = useQuery({
    queryKey: ["client-project-detail", projectId],
    queryFn: () => (projectId ? getClientProject(projectId) : Promise.reject("No project id")),
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(KEY, next ? "1" : "0");
      return next;
    });
    setHoveredTooltip(null);
  }, []);

  const project = projectQ.data;

  const spokeNavItems = [
    {
      to: `/client/workspace/${projectId}/home`,
      labelKey: "home",
      icon: LayoutDashboard,
    },
    {
      to: `/client/workspace/${projectId}/devices`,
      labelKey: "devices",
      icon: Cpu,
    },
    {
      to: `/client/workspace/${projectId}/datastreams`,
      labelKey: "datastreams",
      icon: GitBranch,
    },
    {
      to: `/client/workspace/${projectId}/commands`,
      labelKey: "commands",
      icon: Terminal,
    },
    {
      to: `/client/workspace/${projectId}/automation`,
      labelKey: "automation",
      icon: Zap,
    },
    {
      to: `/client/workspace/${projectId}/ota`,
      labelKey: "ota_campaigns",
      icon: Rocket,
    },
    {
      to: `/client/workspace/${projectId}/telemetry`,
      labelKey: "monitoring",
      icon: Activity,
      activePaths: [
        `/client/workspace/${projectId}/telemetry`,
        `/client/workspace/${projectId}/alerts`,

      ]
    },
  ].filter((item) => {
    if (item.labelKey === "commands") return hasAnyPermission(user, ["commands.view", "command_templates.view"]);
    if (item.labelKey === "ota_campaigns") return hasAnyPermission(user, ["firmware.view", "ota.view"]);
    const permission = item.labelKey === "devices" ? "devices.view" : item.labelKey === "automation" ? "automation.view" : item.labelKey === "monitoring" ? "monitoring.view" : "projects.view";
    return hasPermission(user, permission);
  });

  return (
    <div className="flex h-dvh overflow-hidden bg-app">
      {/* Dedicated Spoke Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-dvh w-64 shrink-0 flex-col border-r border-slate-200 bg-sidebar transition-transform duration-200 dark:border-border-subtle lg:sticky lg:top-0 lg:z-30 lg:translate-x-0 lg:visible",
          mobileOpen ? "visible translate-x-0" : "invisible -translate-x-full",
          desktopCollapsed ? "lg:w-16" : "lg:w-64",
        )}
      >
        {/* Top Header inside Spoke Sidebar: Back button */}
        <div className="p-3 pr-12 lg:pr-3 border-b border-slate-200 dark:border-border-subtle">
          <button
            onClick={() => navigate("/client/projects")}
            onMouseEnter={(e) => {
              if (collapsed) {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredTooltip({ label: t("sidebar.back_to_projects"), top: rect.top + rect.height / 2 });
              }
            }}
            onMouseLeave={() => setHoveredTooltip(null)}
            className="btn-secondary h-8 text-xs flex items-center justify-center gap-1.5 w-full text-brand-600 dark:text-brand-400 font-medium"
          >
            <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
            {!collapsed && <span>{t("sidebar.back_to_projects")}</span>}
          </button>
        </div>

        {/* Spoke Navigation Links */}
        <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="absolute right-2 top-3 btn-ghost h-8 w-8 p-0 lg:hidden"><X className="h-4 w-4" /></button>
        <nav className="sidebar-scrollbar scrollbar-hide flex-1 overflow-y-auto px-2 py-4 space-y-0.5">
          {spokeNavItems.map((item) => {
            const Icon = item.icon;
            const label = t(`sidebar.${item.labelKey}`);
            return (
              <NavLink
                aria-label={label}
                onClick={() => setMobileOpen(false)}
                key={item.to}
                to={item.to}
                onMouseEnter={(e) => {
                  if (collapsed) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoveredTooltip({ label, top: rect.top + rect.height / 2 });
                  }
                }}
                onMouseLeave={() => setHoveredTooltip(null)}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    collapsed && "justify-center px-0",
                    (isActive || location.pathname.startsWith(item.to) || (item.activePaths && item.activePaths.some(p => location.pathname.startsWith(p))))
                      ? "bg-surface-elevated text-primary border-l-2 border-primary shadow-sm dark:bg-surface-muted dark:text-primary font-semibold"
                      : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary border-l-2 border-transparent dark:text-text-secondary dark:hover:bg-surface/70 dark:hover:text-text-primary",
                  )
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{label}</span>}
              </NavLink>
            );
          })}
        </nav>

        {/* Project Info Badge & Name at bottom of Workspace Sidebar */}
        <div className="border-t border-slate-200 dark:border-border-subtle p-3">
          <div
            className={cn("flex items-center gap-2", collapsed && "justify-center px-0")}
            onMouseEnter={(e) => {
              if (collapsed) {
                const rect = e.currentTarget.getBoundingClientRect();
                setHoveredTooltip({
                  label: project?.name ?? "Project Workspace",
                  top: rect.top + rect.height / 2,
                });
              }
            }}
            onMouseLeave={() => setHoveredTooltip(null)}
          >
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-white shadow-sm",
                project?.id ? getLogoColor(project.id) : "bg-slate-500",
              )}
            >
              {project?.name ? getInitials(project.name) : "--"}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-800 dark:text-text-primary truncate">
                  {project?.name ?? "Project Workspace"}
                </p>
                <p className="text-[10px] text-slate-400 truncate">
                  {project?.id ? `ID: ${project.id.slice(0, 8)}...` : "Scoped Workspace"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Collapse toggle button */}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? t("sidebar.expand", "Expand navigation") : t("sidebar.collapse", "Collapse navigation")}
          onMouseEnter={(e) => {
            if (collapsed) {
              const rect = e.currentTarget.getBoundingClientRect();
              setHoveredTooltip({ label: t("sidebar.expand", "Mở rộng"), top: rect.top + rect.height / 2 });
            }
          }}
          onMouseLeave={() => setHoveredTooltip(null)}
          className={cn(
            "border-t border-slate-200 dark:border-border-subtle hidden lg:flex items-center gap-2 px-4 py-3 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <>
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>{t("sidebar.collapse", "Thu gọn")}</span>
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

      {mobileOpen && <button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" />}
      {/* Main Content Area */}
      <div className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
        <ClientTopbar onMobileMenuToggle={() => setMobileOpen(v => !v)} />
        <main className="flex-1 overflow-y-auto px-4 pt-4 pb-5 lg:px-5 lg:pt-5 flex flex-col">
          <Suspense fallback={<ContentLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
