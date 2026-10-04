import { beforeEach, describe, expect, it } from "vitest";
import { clearTelemetryCache } from "./telemetryCache";

describe("clearTelemetryCache", () => {
  beforeEach(() => localStorage.clear());

  it("removes all tenant telemetry snapshots without touching unrelated storage", () => {
    localStorage.setItem("aifom_telemetry_cache_24h", "tenant-a-data");
    localStorage.setItem("aifom_telemetry_cache_7d", "tenant-a-data");
    localStorage.setItem("ui_theme", "dark");

    clearTelemetryCache();

    expect(localStorage.getItem("aifom_telemetry_cache_24h")).toBeNull();
    expect(localStorage.getItem("aifom_telemetry_cache_7d")).toBeNull();
    expect(localStorage.getItem("ui_theme")).toBe("dark");
  });
});
