import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiBaseUrl } from "../services/apiClient";
import type { Device, TenantDeviceDetail } from "../types";

interface DeviceStatusEvent {
  device_uid: string;
  tenant_id: string;
  status: string;
  last_seen_at: string | null;
  timestamp: string;
}

export type DeviceStatusStreamState = {
  status: "connected" | "reconnecting" | "disconnected";
  source: "SSE" | "Polling fallback";
  lastEventAt: string | null;
};

/**
 * Opens an SSE connection to the backend device status stream and
 * patches the React Query cache in real time so the UI reflects
 * status changes without waiting for the next polling cycle.
 *
 * Polling remains the fallback. This hook only accelerates updates
 * when the stream is connected and exposes connection state for UI.
 */
export function useDeviceStatusStream(): DeviceStatusStreamState {
  const queryClient = useQueryClient();
  const lastInvalidateRef = useRef<number>(0);
  const [streamState, setStreamState] = useState<DeviceStatusStreamState>({
    status: "disconnected",
    source: "Polling fallback",
    lastEventAt: null,
  });

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      setStreamState((current) => ({
        ...current,
        status: "disconnected",
        source: "Polling fallback",
      }));
      return;
    }

    const url = `${apiBaseUrl}/api/v1/client/devices/status/stream`;
    const es = new EventSource(url, { withCredentials: true });

    es.onopen = () => {
      setStreamState((current) => ({
        ...current,
        status: "connected",
        source: "SSE",
      }));
    };

    es.addEventListener("device_status_changed", (e: MessageEvent) => {
      try {
        const event: DeviceStatusEvent = JSON.parse(e.data);
        const eventAt = event.timestamp ?? new Date().toISOString();
        setStreamState({
          status: "connected",
          source: "SSE",
          lastEventAt: eventAt,
        });

        queryClient.setQueryData<Device[]>(["client-devices"], (old) => {
          if (!old) return old;
          return old.map((d) =>
            d.device_uid === event.device_uid
              ? { ...d, status: event.status, last_seen_at: event.last_seen_at }
              : d,
          );
        });

        queryClient.setQueriesData<TenantDeviceDetail>(
          { queryKey: ["client-device-detail", event.device_uid] },
          (old) => {
            if (!old) return old;
            return {
              ...old,
              device: {
                ...old.device,
                status: event.status,
                last_seen_at: event.last_seen_at,
              },
              live_status: {
                ...old.live_status,
                connection_status: event.status,
              },
            };
          },
        );

        const now = Date.now();
        if (now - lastInvalidateRef.current > 5000) {
          lastInvalidateRef.current = now;
          queryClient.invalidateQueries({ queryKey: ["client-dashboard"] });
        }
      } catch {
        // Ignore malformed stream events.
      }
    });

    es.onerror = () => {
      setStreamState((current) => ({
        ...current,
        status: "reconnecting",
        source: "SSE",
      }));
    };

    return () => {
      es.close();
      setStreamState((current) => ({
        ...current,
        status: "disconnected",
      }));
    };
  }, [queryClient]);

  return streamState;
}
