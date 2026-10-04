import { memo, useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Menu, Bell, Moon, Sun, ChevronDown, LogOut, AlertTriangle, ShieldAlert, UserCog, X, Info } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { useFeature } from "../../contexts/FeatureContext";
import { listClientAlerts } from "../../services/clientApi";
import { useClientAlertReadState } from "../../hooks/useClientAlertReadState";
import { useAlertStream, type AlertEvent } from "../../hooks/useAlertStream";
import { formatRelative } from "../../lib/formatters";
import { cn } from "../../lib/cn";
import { useProjectScope } from "../../hooks/useProjectScope";
import { LanguageSwitcher } from "./LanguageSwitcher";
import type { AnomalyAlert } from "../../types";

export const ClientTopbar = memo(function ClientTopbar({ onMobileMenuToggle }: { onMobileMenuToggle?: () => void }) {
  const { t } = useTranslation(["alerts", "nav", "common"]);
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { hasFeature } = useFeature();
  const { resolveLink } = useProjectScope();
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const { isRead, markRead } = useClientAlertReadState();
  const [latestToast, setLatestToast] = useState<AlertEvent | null>(null);

  // Initialize the real-time alert SSE stream
  useAlertStream();

  const canAlert = hasFeature("alert_management");

  const { data: alerts = [] } = useQuery<AnomalyAlert[]>({
    queryKey: ["client-alerts-topbar"],
    queryFn: () => listClientAlerts(20),
    enabled: canAlert,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const unreadAlerts = useMemo(() => alerts.filter((a) => !isRead(a.id)), [alerts, isRead]);
  const criticalCount = unreadAlerts.filter((a) => a.severity === "critical").length;
  const badgeCount = unreadAlerts.length;

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Listen for the custom event emitted by the stream
  useEffect(() => {
    function handleNewAlert(e: Event) {
      const customEvent = e as CustomEvent<AlertEvent>;
      setLatestToast(customEvent.detail);
      
      // Auto-hide toast after 5 seconds
      setTimeout(() => {
        setLatestToast((current) => {
          if (current?.id === customEvent.detail.id) {
            return null;
          }
          return current;
        });
      }, 5000);
    }
    window.addEventListener("new-automation-alert", handleNewAlert);
    return () => window.removeEventListener("new-automation-alert", handleNewAlert);
  }, []);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const roleLabel: Record<string, string> = {
    tenant_owner: "Owner",
    viewer: "Viewer",
  };

  const preview = unreadAlerts.slice(0, 5);

  function openAlert(alertId: string): void {
    markRead(alertId);
    setBellOpen(false);
    navigate(`${resolveLink("/alerts")}?alert=${encodeURIComponent(alertId)}`);
  }

  return (
    <header className="sticky top-0 z-20 h-14 w-full bg-white/80 dark:bg-topbar/90 backdrop-blur border-b border-slate-200 dark:border-border-subtle">
      <div className="h-full w-full px-4 lg:px-6 flex items-center gap-3">
        <button type="button" onClick={onMobileMenuToggle} aria-label="Open navigation" className="btn-ghost h-9 w-9 shrink-0 p-0 lg:hidden"><Menu className="h-5 w-5" /></button>
        <div className="flex-1 min-w-0" />

        <div className="flex shrink-0 items-center gap-1 lg:gap-2">
          {/* Language Switcher */}
          <LanguageSwitcher />

          {/* Theme toggle */}
          <button
            type="button"
            onClick={toggle}
            className="btn-ghost h-9 w-9 p-0"
            title={t(theme === "dark" ? "nav:topbar.light_mode" : "nav:topbar.dark_mode", theme === "dark" ? "Light mode" : "Dark mode")}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {/* Bell notification */}
          <div ref={bellRef} className="relative">
            <button
              type="button"
              onClick={() => setBellOpen((o) => !o)}
              className={cn(
                "btn-ghost h-9 w-9 p-0 relative flex items-center justify-center",
                bellOpen && "bg-slate-100 dark:bg-surface-elevated",
                !canAlert && "opacity-40 cursor-default",
              )}
              title={canAlert ? t("alerts:title", "Cảnh báo") : t("alerts:no_permission", "Bạn không có quyền xem cảnh báo")}
              aria-label={canAlert ? t("alerts:title", "Cảnh báo") : t("alerts:no_permission", "Bạn không có quyền xem cảnh báo")}
            >
              <Bell className="h-4 w-4" />
              {canAlert && badgeCount > 0 && (
                <span
                  className={cn(
                    "absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full text-[10px] font-bold text-white flex items-center justify-center leading-none",
                    criticalCount > 0 ? "bg-rose-500" : "bg-amber-500",
                  )}
                >
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </button>

            {bellOpen && canAlert && (
              <div className="absolute right-0 top-full mt-2 w-80 card py-0 z-30 overflow-hidden shadow-lg">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-border-subtle">
                  <span className="text-sm font-semibold text-slate-800 dark:text-text-primary">
                    {t("alerts:recent_alerts", "Cảnh báo gần đây")}
                  </span>
                  <button
                    onClick={() => setBellOpen(false)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-text-secondary"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Alert list */}
                {preview.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">
                    {t("alerts:no_unread", "Không có cảnh báo chưa đọc")}
                  </div>
                ) : (
                  <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-border-subtle">
                    {preview.map((a) => {
                      const read = isRead(a.id);
                      return (
                        <li key={a.id}>
                          <button
                            type="button"
                            onClick={() => openAlert(a.id)}
                            className={cn(
                              "w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-surface-elevated/70",
                              read && "opacity-70",
                            )}
                          >
                            <div className="flex items-start gap-2">
                              <div className="flex-shrink-0 mt-0.5">
                                {a.severity === "critical" ? (
                                  <ShieldAlert className="h-3.5 w-3.5 text-rose-500" />
                                ) : (
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  {!read && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
                                  <div className="min-w-0 truncate text-xs font-medium text-slate-800 dark:text-text-primary">
                                    {a.metric_name}
                                  </div>
                                </div>
                                <div className="text-[11px] text-slate-500 font-mono truncate">
                                  {a.device_uid}
                                </div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  {formatRelative(a.timestamp)}
                                </div>
                              </div>
                              <span
                                className={cn(
                                  "flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase",
                                  a.severity === "critical"
                                    ? "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"
                                    : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
                                )}
                              >
                                {a.severity}
                              </span>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Footer */}
                <div className="border-t border-slate-200 dark:border-border-subtle px-4 py-2.5">
                  <button
                    type="button"
                    onClick={() => { setBellOpen(false); navigate(resolveLink("/alerts")); }}
                    className="w-full text-xs text-primary hover:underline font-medium text-center"
                  >
                    {t("alerts:view_all_unread", "Xem tất cả cảnh báo ({{count}} chưa đọc)", { count: unreadAlerts.length })}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* User menu */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 h-9 px-2 rounded-md hover:bg-slate-100 dark:hover:bg-surface-elevated"
            >
              <div className="h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-semibold">
                {user?.email?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="hidden md:block text-left">
                <div className="text-xs font-medium text-slate-800 dark:text-text-primary leading-tight truncate max-w-[140px]">
                  {user?.full_name ?? user?.email ?? "—"}
                </div>
                <div className="text-[10px] text-primary">
                  {roleLabel[user?.role ?? ""] ?? user?.role}
                </div>
              </div>
              <ChevronDown className="h-3 w-3 text-slate-500" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 card py-2 z-30">
                <div className="px-3 py-2 text-xs">
                  <div className="font-medium text-slate-700 dark:text-text-secondary truncate">
                    {user?.email}
                  </div>
                  <div className="text-primary mt-0.5">
                    {roleLabel[user?.role ?? ""] ?? user?.role}
                  </div>
                </div>
                <div className="border-t border-slate-200 dark:border-border-subtle my-1" />
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    navigate("/client/account");
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-surface-elevated flex items-center gap-2 text-slate-700 dark:text-text-secondary"
                >
                  <UserCog className="h-3.5 w-3.5" /> {t("nav:account", "Tài khoản")}
                </button>
                <button
                  onClick={handleLogout}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-surface-elevated",
                    "flex items-center gap-2 text-rose-600 dark:text-rose-400",
                  )}
                >
                  <LogOut className="h-3.5 w-3.5" /> {t("nav:logout", "Đăng xuất")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Global Real-time Toast */}
      {latestToast && (
        <div className="fixed bottom-4 left-4 sm:left-auto right-4 z-50 animate-in slide-in-from-bottom-2 fade-in duration-300">
          <div className="bg-white dark:bg-surface-elevated rounded-lg shadow-lg border border-slate-200 dark:border-border-subtle p-4 max-w-sm flex items-start gap-3 relative">
            <button 
              aria-label={t("common:actions.dismiss", "Dismiss notification")}
              onClick={() => setLatestToast(null)}
              className="absolute top-2 right-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="shrink-0 mt-0.5">
              {latestToast.severity === "critical" ? (
                <ShieldAlert className="h-5 w-5 text-rose-500" />
              ) : latestToast.severity === "warning" ? (
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              ) : (
                <Info className="h-5 w-5 text-blue-500" />
              )}
            </div>
            <div className="flex-1 pr-6">
              <h4 className="text-sm font-semibold text-slate-900 dark:text-text-primary">
                {latestToast.title || t("alerts:new_alert", "Cảnh báo mới")}
              </h4>
              <p className="text-xs text-slate-600 dark:text-text-secondary mt-1">
                {latestToast.message}
              </p>
              <div className="mt-2 text-[10px] text-slate-400">
                {formatRelative(latestToast.timestamp)}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  );
});
