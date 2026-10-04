import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOtaCampaign, transitionOtaCampaign } from "./otaApi";

vi.mock("../lib/debugLogger", () => ({
  debugLogger: { apiRequest: vi.fn(), apiResponse: vi.fn(), apiError: vi.fn() },
}));

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
  Object.defineProperty(globalThis, "fetch", { value: mockFetch, writable: true, configurable: true });
  Object.defineProperty(window, "fetch", { value: mockFetch, writable: true, configurable: true });
});

describe("OTA campaign API", () => {
  it("creates a server campaign and starts that campaign", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "campaign-1", status: "draft" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "campaign-1", status: "running" }) });

    const result = await createOtaCampaign({
      name: "ESP32 rollout",
      firmware_id: "firmware-1",
      target_scope: "all",
      target_ids: [],
      rollout_strategy: "phased",
      rollout_percentages: [10, 50, 100],
    });

    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/admin/ota/campaigns");
    expect(mockFetch.mock.calls[1][0]).toContain("/api/v1/admin/ota/campaigns/campaign-1/start");
    expect(result.status).toBe("running");
  });

  it("uses the retry-failed lifecycle route", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "campaign-1" }) });
    await transitionOtaCampaign("campaign-1", "retry-failed");
    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/admin/ota/campaigns/campaign-1/retry-failed");
  });
});
