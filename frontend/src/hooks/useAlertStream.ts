import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiBaseUrl } from "../services/apiClient";

export interface AlertEvent {
  id: string;
  tenant_id: string;
  device_id: string | null;
  severity: "info" | "warning" | "critical";
  code: string;
  title: string;
  message: string;
  timestamp: string;
}

export function useAlertStream() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }

    const url = `${apiBaseUrl}/api/v1/client/alerts/stream`;
    const es = new EventSource(url, { withCredentials: true });

    es.addEventListener("alert_created", (e: MessageEvent) => {
      try {
        const event: AlertEvent = JSON.parse(e.data);
        
        // Invalidate queries so the unread badge and alerts list update
        queryClient.invalidateQueries({ queryKey: ["client-alerts"] });
        
        // Dispatch a custom event so the UI can show a toast
        window.dispatchEvent(
          new CustomEvent("new-automation-alert", { detail: event })
        );
      } catch {
        // Ignore malformed stream events
      }
    });

    es.onerror = () => {
      // EventSource handles reconnection automatically
    };

    return () => {
      es.close();
    };
  }, [queryClient]);
}
