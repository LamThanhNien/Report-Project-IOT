import { createContext, useContext, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Toast, ToastViewport } from "../components/ui/Toast";
import { userSafeErrorMessage } from "../lib/errorPresentation";
import {
  notificationApi,
  notifications,
  type NotificationApi,
} from "../lib/notifications";

const ToastContext = createContext<NotificationApi | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation("common");
  const items = useSyncExternalStore(
    notifications.subscribe,
    notifications.getSnapshot,
    notifications.getSnapshot,
  );

  return (
    <ToastContext.Provider value={notificationApi}>
      {children}
      <ToastViewport ariaLabel={t("notifications.label", { defaultValue: "Notifications" })}>
        {items.map((item) => (
          <Toast
            key={item.id}
            open
            portal={false}
            tone={item.tone}
            duration={item.duration}
            message={item.message ?? userSafeErrorMessage(item.error, t)}
            dismissLabel={t("notifications.dismiss", { defaultValue: "Close notification" })}
            onClose={() => notificationApi.dismiss(item.id)}
          />
        ))}
      </ToastViewport>
    </ToastContext.Provider>
  );
}

export function useToast(): NotificationApi {
  return useContext(ToastContext) ?? notificationApi;
}

/** Imperative API for infrastructure code such as TanStack Query callbacks. */
export const toast = notificationApi;
