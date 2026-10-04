import { Suspense, useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ContentLoader } from "../ContentLoader";

const KEY = "aifom_sidebar_collapsed";

export function AppShell() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(KEY) === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileOpen]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const toggle = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const toggleMobile = useCallback(() => setMobileOpen((open) => !open), []);

  return (
    <div className="flex min-h-screen h-dvh overflow-hidden bg-app text-text-primary">
      <Sidebar
        collapsed={collapsed}
        onCollapse={toggle}
        mobileOpen={mobileOpen}
        onMobileClose={closeMobile}
      />
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={closeMobile}
        />
      )}
      <div className="flex min-h-screen h-dvh flex-1 min-w-0 flex-col overflow-hidden">
        <Topbar onMobileMenuToggle={toggleMobile} />
        <main className="flex-1 overflow-y-auto px-4 pt-4 pb-5 lg:px-5 lg:pt-5 flex flex-col">
          <Suspense fallback={<ContentLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
