import { Navigate, Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { ADMIN_ROLE, TENANT_ROLES, isSupportedRole, useAuth } from "../contexts/AuthContext";

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-app">
      <div className="flex items-center gap-3 text-slate-500 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Đang xác thực…
      </div>
    </div>
  );
}

/** Any authenticated user */
export function ProtectedRoute() {
  const { token, loading, user } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!token) return <Navigate to="/login" replace />;
  if (!user) return <LoadingScreen />;
  if (!isSupportedRole(user.role) || user.is_active === false) return <Navigate to="/login" replace />;
  return <Outlet />;
}

/** Admin only — redirects tenant users to client portal */
export function AdminRoute() {
  const { token, loading, user } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!token) return <Navigate to="/login" replace />;
  if (!user) return <LoadingScreen />;
  if (!isSupportedRole(user.role) || user.is_active === false) return <Navigate to="/login" replace />;
  if (user && TENANT_ROLES.includes(user.role)) {
    return <Navigate to="/client/dashboard" replace />;
  }
  if (user.role !== ADMIN_ROLE) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

/** Tenant users only — redirects admins to admin console */
export function ClientRoute() {
  const { token, loading, user } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!token) return <Navigate to="/login" replace />;
  if (!user) return <LoadingScreen />;
  if (!isSupportedRole(user.role) || user.is_active === false) return <Navigate to="/login" replace />;
  if (user.role === ADMIN_ROLE) {
    return <Navigate to="/console" replace />;
  }
  if (user && !TENANT_ROLES.includes(user.role)) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
