import { memo, useState, useRef, useEffect, useMemo } from "react";
import { Menu, Search, Bell, Moon, Sun, ChevronDown, LogOut, User, AlertTriangle, ShieldAlert, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { useTheme } from "../../contexts/ThemeContext";
import { useQuery } from "@tanstack/react-query";
import { getSystemHealth } from "../../services/systemApi";
import { HealthIndicator } from "../ui/HealthIndicator";
import { cn } from "../../lib/cn";
import { useAdminAlertReadState } from "../../hooks/useAdminAlertReadState";
import { formatRelative } from "../../lib/formatters";
import type { Alert } from "../../types";

export const Topbar = memo(function Topbar({ onMobileMenuToggle }: { onMobileMenuToggle?: () => void }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const { isRead, markRead } = useAdminAlertReadState();

  const { data: health } = useQuery({
    queryKey: ["system-health"],
    queryFn: getSystemHealth,
    refetchInterval: 30_000,
  });

  const alerts: Alert[] = [];

  const unreadAlerts = useMemo(() => alerts.filter((alert) => !isRead(alert.id)), [alerts, isRead]);
  const criticalCount = unreadAlerts.filter((alert) => alert.severity === "critical").length;
  const preview = unreadAlerts.slice(0, 5);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  function openAlert(alertId: string): void {
    markRead(alertId);
    setBellOpen(false);
    navigate(`/console/alerts?alert=${encodeURIComponent(alertId)}`);
  }

  const envBadge = (import.meta.env.VITE_ENV ?? "local").toLowerCase();
  const envClass =
    envBadge === "production"
      ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
      : envBadge === "staging"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      : "bg-slate-200 text-slate-700 dark:bg-surface-elevated dark:text-text-secondary";

  const apiTone =
    health?.api === "healthy" ? "success" : health?.api === "degraded" ? "warning" : "danger";

  return (
    <header className="sticky top-0 z-20 h-16 w-full bg-white/80 dark:bg-topbar/90 backdrop-blur border-b border-slate-200 dark:border-border-subtle">
      <div className="h-full w-full px-4 lg:px-6 flex items-center gap-3 lg:gap-4">
        <button type="button" onClick={onMobileMenuToggle} aria-label="Open navigation" className="btn-ghost h-9 w-9 shrink-0 p-0 lg:hidden"><Menu className="h-5 w-5" /></button>
        {/* Left cluster — search */}
        <div className="relative flex-1 min-w-0 max-w-xl xl:max-w-2xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <input
            type="search"
            placeholder="Tìm thiết bị, firmware, OTA…"
            className="input pl-9 pr-12"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 kbd hidden sm:inline-flex">/</span>
        </div>

        {/* Center-left cluster — system status, sits next to search */}
        <div className="hidden md:flex items-center gap-3 pl-1">
          <span className={cn("chip", envClass)}>{envBadge.toUpperCase()}</span>
          <div className="hidden lg:block h-6 w-px bg-slate-200 dark:bg-border-subtle" />
          <div className="hidden lg:block">
            <HealthIndicator
              status={apiTone}
              label={apiTone === "success" ? "API hoạt động" : apiTone === "warning" ? "API suy giảm" : "API mất kết nối"}
            />
          </div>
        </div>

        {/* Right cluster — user actions, pushed to the far right */}
        <div className="ml-auto flex items-center gap-1 lg:gap-2">
          <button
            type="button"
            onClick={toggle}
            className="btn-ghost h-9 w-9 p-0"
            title={theme === "dark" ? "Chế độ sáng" : "Chế độ tối"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <div ref={bellRef} className="relative">
            <button
              type="button"
              onClick={() => setBellOpen((open) => !open)}
              className="btn-ghost h-9 w-9 p-0 relative"
              title="Cảnh báo"
              aria-label="Cảnh báo"
              aria-expanded={bellOpen}
            >
              <Bell className="h-4 w-4" />
              {unreadAlerts.length > 0 && (
                <span className={cn(
                  "absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full text-[10px] font-bold text-white flex items-center justify-center leading-none",
                  criticalCount > 0 ? "bg-rose-500" : "bg-amber-500",
                )}>
                  {unreadAlerts.length > 99 ? "99+" : unreadAlerts.length}
                </span>
              )}
            </button>

            {bellOpen && (
              <div className="absolute right-0 top-full mt-2 w-80 card py-0 z-30 overflow-hidden shadow-lg">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-border-subtle">
                  <span className="text-sm font-semibold text-slate-800 dark:text-text-primary">Cảnh báo gần đây</span>
                  <button type="button" onClick={() => setBellOpen(false)} aria-label="Đóng cảnh báo" className="text-slate-400 hover:text-slate-600 dark:hover:text-text-secondary">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {preview.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-500">Không có cảnh báo chưa đọc</div>
                ) : (
                  <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-border-subtle">
                    {preview.map((alert) => (
                      <li key={alert.id}>
                        <button type="button" onClick={() => openAlert(alert.id)} className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-surface-elevated/70">
                          <div className="flex items-start gap-2">
                            <div className="flex-shrink-0 mt-0.5">
                              {alert.severity === "critical" ? <ShieldAlert className="h-3.5 w-3.5 text-rose-500" /> : <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                                <div className="min-w-0 truncate text-xs font-medium text-slate-800 dark:text-text-primary">{alert.title}</div>
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono truncate">{alert.device_uid ?? alert.tenant?.name ?? alert.source}</div>
                              <div className="text-[11px] text-slate-400 mt-0.5">{formatRelative(alert.timestamp)}</div>
                            </div>
                            <span className={cn(
                              "flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase",
                              alert.severity === "critical" ? "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400" : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400",
                            )}>{alert.severity}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="border-t border-slate-200 dark:border-border-subtle px-4 py-2.5">
                  <button type="button" onClick={() => { setBellOpen(false); navigate("/console/alerts"); }} className="w-full text-xs text-primary hover:underline font-medium text-center">
                    Xem tất cả cảnh báo ({unreadAlerts.length} chưa đọc)
                  </button>
                </div>
              </div>
            )}
          </div>

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
                <div className="text-[10px] text-slate-500 uppercase">{user?.role}</div>
              </div>
              <ChevronDown className="h-3 w-3 text-slate-500" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 card py-2 z-30">
                <div className="px-3 py-2 text-xs">
                  <div className="font-medium text-slate-700 dark:text-text-secondary truncate">{user?.email}</div>
                  <div className="text-slate-500 dark:text-text-muted mt-0.5">Role: {user?.role}</div>
                </div>
                <div className="border-t border-slate-200 dark:border-border-subtle my-1" />
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    navigate("/console/settings");
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-surface-elevated flex items-center gap-2"
                >
                  <User className="h-3.5 w-3.5" /> Cài đặt tài khoản
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-surface-elevated flex items-center gap-2 text-rose-600 dark:text-rose-400"
                >
                  <LogOut className="h-3.5 w-3.5" /> Đăng xuất
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
});
