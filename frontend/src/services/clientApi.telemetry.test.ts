import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getClientDeviceTelemetry } from "./clientApi";

const fetchMock = vi.fn();
beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("canvas telemetry query contracts", () => {
  it("requests the same bounded live window for every channel in a multi chart", async () => {
    const window = { time_range: "live" as const, limit: 1000, from_time: "2026-10-02T12:00:00.000Z", to_time: "2026-10-02T12:10:00.000Z" };
    await Promise.all(["ch_v0", "ch_v1"].map((metric_name) => getClientDeviceTelemetry("sensor/lab", { ...window, metric_name })));
    for (const [requestUrl] of fetchMock.mock.calls) {
      const url = new URL(requestUrl, "http://localhost");
      expect(url.pathname).toBe("/api/v1/client/devices/sensor%2Flab/telemetry");
      expect(url.searchParams.get("from_time")).toBe(window.from_time);
      expect(url.searchParams.get("to_time")).toBe(window.to_time);
      expect(url.searchParams.get("limit")).toBe("1000");
      expect(url.searchParams.has("time_range")).toBe(false);
      expect(["ch_v0", "ch_v1"]).toContain(url.searchParams.get("metric_name"));
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves the aggregated range request independently of a live window", async () => {
    await getClientDeviceTelemetry("sensor-1", { metric_name: "temperature", time_range: "1d", aggregate: "max", from_time: "2026-10-02T12:00:00Z", limit: 60 });
    const url = new URL(fetchMock.mock.calls[0][0], "http://localhost");
    expect(url.searchParams.get("time_range")).toBe("1d");
    expect(url.searchParams.get("aggregate")).toBe("max");
    expect(url.searchParams.has("from_time")).toBe(false);
    expect(url.searchParams.has("limit")).toBe(false);
  });
});
