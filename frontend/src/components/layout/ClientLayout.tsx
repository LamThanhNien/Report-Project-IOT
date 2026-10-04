import { Suspense, useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { ClientSidebar } from "./ClientSidebar";
import { ClientTopbar } from "./ClientTopbar";
import { useAuth } from "../../contexts/AuthContext";
import { TENANT_DISABLED_KEY } from "../../services/apiClient";
import { TenantDisabled } from "../../pages/client/projects/TenantDisabled";
import { ContentLoader } from "../ContentLoader";

const KEY = "aifom_client_sidebar_collapsed";

export function ClientLayout() {
  const { user } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(KEY) === "1");
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [mobileOpen]);
  const [tenantDisabled, setTenantDisabled] = useState<boolean>(
    () => localStorage.getItem(TENANT_DISABLED_KEY) === "1",
  );

  useEffect(() => {
    function handleTenantDisabled() {
      setTenantDisabled(true);
    }
    window.addEventListener("tenant-disabled", handleTenantDisabled);
    return () => window.removeEventListener("tenant-disabled", handleTenantDisabled);
  }, []);

  // Clear the flag when user changes (e.g. logout + login as different user)
  useEffect(() => {
    setTenantDisabled(false);
  }, [user?.tenant_id]);

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

  if (tenantDisabled) {
    return (
      <div className="flex min-h-screen h-dvh overflow-hidden bg-app">
        <ClientSidebar
          collapsed={collapsed}
          onCollapse={toggle}
          tenantName={user?.full_name ?? user?.email ?? "My Portal"}
          mobileOpen={mobileOpen}
          onMobileClose={closeMobile}
        />
        {mobileOpen && <button type="button" aria-label="Close navigation menu" className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" onClick={closeMobile} />}
        <div className="flex min-h-screen h-dvh flex-1 min-w-0 flex-col overflow-hidden">
          <ClientTopbar onMobileMenuToggle={toggleMobile} />
          <main className="flex-1 overflow-y-auto px-4 pt-4 pb-5 lg:px-5 lg:pt-5 flex flex-col">
            <TenantDisabled />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen h-dvh overflow-hidden bg-app">
      <ClientSidebar
        collapsed={collapsed}
        onCollapse={toggle}
        tenantName={user?.full_name ?? user?.email ?? "My Portal"}
        mobileOpen={mobileOpen}
        onMobileClose={closeMobile}
      />
      {mobileOpen && <button type="button" aria-label="Close navigation menu" className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden" onClick={closeMobile} />}
      <div className="flex min-h-screen h-dvh flex-1 min-w-0 flex-col overflow-hidden">
        <ClientTopbar onMobileMenuToggle={toggleMobile} />
        <main className="flex-1 overflow-y-auto px-4 pt-4 pb-5 lg:px-5 lg:pt-5 flex flex-col">
          <Suspense fallback={<ContentLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
