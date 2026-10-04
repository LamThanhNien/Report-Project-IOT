import { describe, expect, it } from "vitest";
import {
  buildFleetChartData,
  calculateDeviceTelemetrySummary,
  formatMetricValue,
  sortDeviceSummaries,
} from "./telemetryUtils";
import type { Device, Telemetry } from "../types";

const NOW = new Date("2026-05-29T10:00:00.000Z").getTime();

function telemetry(partial: Partial<Telemetry>): Telemetry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    device_id: partial.device_id ?? "device-1",
    device_uid: partial.device_uid ?? "esp32-a",
    timestamp: partial.timestamp ?? new Date(NOW).toISOString(),
    metric_name: partial.metric_name ?? "temperature",
    metric_value: partial.metric_value ?? 1,
    unit: partial.unit ?? null,
    raw_payload: partial.raw_payload ?? null,
    created_at: partial.created_at ?? new Date(NOW).toISOString(),
  };
}

function device(partial: Partial<Device>): Device {
  return {
    id: partial.id ?? "device-1",
    device_uid: partial.device_uid ?? "esp32-a",
    name: partial.name ?? "ESP32 A",
    firmware_version: partial.firmware_version ?? null,
    status: partial.status ?? "online",
    rssi: partial.rssi ?? null,
    free_heap: partial.free_heap ?? null,
    uptime_ms: partial.uptime_ms ?? null,
    last_seen_at: partial.last_seen_at ?? null,
    created_at: partial.created_at ?? new Date(NOW).toISOString(),
    updated_at: partial.updated_at ?? new Date(NOW).toISOString(),
  };
}

describe("telemetryUtils", () => {
  it("aggregates message rate into readable bucketed chart points", () => {
    const records = Array.from({ length: 600 }, (_, index) =>
      telemetry({
        id: `t-${index}`,
        timestamp: new Date(NOW - 59 * 60_000 + index * 6_000).toISOString(),
        metric_name: index % 2 === 0 ? "temperature" : "humidity",
      }),
    );

    const chart = buildFleetChartData(records, "message_rate", "auto", 60, NOW, 250);

    expect(chart.length).toBeLessThanOrEqual(250);
    expect(chart[0].unit).toBe("msg/min");
    expect(chart.some((point) => point.value > 0)).toBe(true);
  });

  it("filters custom metric charts to a single metric unit", () => {
    const records = [
      telemetry({ id: "temp", metric_name: "temperature", metric_value: 28, unit: "C" }),
      telemetry({ id: "rssi", metric_name: "rssi", metric_value: -72, unit: "dBm" }),
    ];

    const chart = buildFleetChartData(records, "metric:temperature", "avg", 5, NOW);

    expect(chart).toHaveLength(1);
    expect(chart[0].value).toBe(28);
    expect(chart[0].unit).toBe("°C");
  });

  it("summarizes and sorts devices needing attention first", () => {
    const records = [
      telemetry({ id: "ok-1", device_uid: "esp32-ok", metric_name: "temperature", metric_value: 22 }),
      telemetry({ id: "bad-1", device_uid: "esp32-bad", metric_name: "parse_error", metric_value: 1 }),
      telemetry({ id: "bad-rssi", device_uid: "esp32-bad", metric_name: "rssi", metric_value: -86 }),
    ];
    const devices = [
      device({ device_uid: "esp32-ok", name: "OK Node", status: "online" }),
      device({ device_uid: "esp32-bad", name: "Bad Node", status: "online" }),
      device({ device_uid: "esp32-silent", name: "Silent Node", status: "offline" }),
    ];

    const summaries = calculateDeviceTelemetrySummary(records, devices, 60);
    const sorted = sortDeviceSummaries(summaries, "attention");

    expect(sorted[0].deviceUid).toBe("esp32-bad");
    expect(summaries.find((item) => item.deviceUid === "esp32-silent")?.totalMessages).toBe(0);
    expect(summaries.find((item) => item.deviceUid === "esp32-bad")?.healthStatus).toBe("critical");
  });

  it("formats fleet metric values with explicit units", () => {
    expect(formatMetricValue(12.345, "msg/min")).toBe("12.3 msg/min");
    expect(formatMetricValue(-74.8, "dBm")).toBe("-75 dBm");
    expect(formatMetricValue(0.125, "error_rate")).toBe("12.5%");
  });
});
