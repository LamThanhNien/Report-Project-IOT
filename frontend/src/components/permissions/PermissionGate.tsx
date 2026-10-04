import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import { hasAnyPermission, hasPermission, type PermissionKey } from "../../lib/permissions";
import { ContentLoader } from "../ContentLoader";

const ACCESS_DENIED_MESSAGE = "Bạn không có quyền xem trang này.";
const READ_ONLY_MESSAGE = "Tài khoản của bạn chỉ có quyền xem. Một số thao tác đã bị tắt.";
export const ACTION_DENIED_MESSAGE = "Bạn không có quyền thực hiện thao tác này.";

export function AccessDenied({ message = ACCESS_DENIED_MESSAGE }: { message?: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center">
      <div className="card max-w-md p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
          <Lock className="h-5 w-5" />
        </div>
        <h1 className="text-base font-semibold text-slate-900 dark:text-text-primary">Không có quyền truy cập</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-text-muted">{message}</p>
      </div>
    </div>
  );
}

export function ReadOnlyNotice({ message = READ_ONLY_MESSAGE }: { message?: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
      {message}
    </div>
  );
}

export function PermissionGate({
  permission,
  anyOf,
  children,
}: {
  permission?: PermissionKey;
  anyOf?: PermissionKey[];
  children: ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) return <ContentLoader />;

  const allowed = permission
    ? hasPermission(user, permission)
    : anyOf
      ? hasAnyPermission(user, anyOf)
      : true;

  if (!allowed) return <AccessDenied />;
  return <>{children}</>;
}
