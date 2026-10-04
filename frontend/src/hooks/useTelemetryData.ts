import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listTelemetry } from "../services/telemetryApi";
import { listDevices } from "../services/deviceApi";
import {
  readTelemetrySnapshotDeferred,
  saveTelemetrySnapshotDeferred,
  isTelemetrySnapshotFresh,
} from "../lib/telemetryCache";
import type { TelemetryCacheSnapshot } from "../lib/telemetryCache";
import type { Telemetry, Device } from "../types";
import type { RangeOption } from "../lib/telemetryUtils";

export function useTelemetryData(range: string, rangeOption: RangeOption) {
  const rangeMinutes = rangeOption.minutes;
  const queryClient = useQueryClient();
  const [cachedSnapshot, setCachedSnapshot] = useState<TelemetryCacheSnapshot | null>(null);

  useEffect(() => {
    setCachedSnapshot(null);
    return readTelemetrySnapshotDeferred({ range }, (snapshot) => {
      setCachedSnapshot(snapshot);
      if (snapshot) {
        queryClient.setQueryData<Telemetry[]>(["telemetry", range], (current) => current ?? snapshot.telemetry);
      }
    });
  }, [queryClient, range]);

  // ── Devices query (fast, no special caching needed) ─────────────
  const devicesQ = useQuery({
    queryKey: ["devices"],
    queryFn: () => listDevices(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // ── Telemetry query with cache-backed initial data ──────────────
  const telQ = useQuery({
    queryKey: ["telemetry", range],
    queryFn: () =>
      listTelemetry({
        from_time: new Date(Date.now() - rangeMinutes * 60_000).toISOString(),
        limit: 1000,
      }),
    staleTime: 10_000,
    refetchInterval: 30_000,
    // Keep previous data while switching range keys
    placeholderData: (prev) => prev,
  });

  // ── UI state flags ──────────────────────────────────────────────
  const hasData = telQ.data !== undefined && telQ.data.length > 0;
  const isCachedData =
    hasData && cachedSnapshot !== null && telQ.data === cachedSnapshot.telemetry;
  const isStale = cachedSnapshot ? !isTelemetrySnapshotFresh(cachedSnapshot) : false;

  const [refreshError, setRefreshError] = useState<string | null>(null);

  // ── Cache the devices snapshot ──────────────────────────────────
  const devices: Device[] = (devicesQ.data ?? []).filter((d) => d.status !== "deleted");

  // ── Persist successful telemetry + devices to cache ─────────────
  useEffect(() => {
    if (telQ.isSuccess && telQ.data && telQ.data.length > 0) {
      setRefreshError(null);
      return saveTelemetrySnapshotDeferred({ range }, telQ.data, devices);
    }
    return undefined;
  }, [telQ.isSuccess, telQ.data, range, devices]);

  // ── Handle fetch errors: show non-blocking error if cached data exists ──
  useEffect(() => {
    if (telQ.isError && hasData && !telQ.isFetching) {
      setRefreshError(
        "Không tải được dữ liệu mới. Đang hiển thị dữ liệu gần nhất.",
      );
    }
    if (telQ.isError && !hasData) {
      setRefreshError(null);
    }
    if (telQ.isSuccess) {
      setRefreshError(null);
    }
  }, [telQ.isError, telQ.isSuccess, telQ.isFetching, hasData]);

  return {
    telQ,
    devicesQ,
    devices,
    hasData,
    isCachedData,
    isStale,
    refreshError,
    setRefreshError,
  };
}
