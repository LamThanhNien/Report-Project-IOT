import { beforeEach, describe, expect, it, vi } from "vitest";
import { acknowledgeAlert, listAlerts, resolveAlert } from "./alertApi";

vi.mock("../lib/debugLogger", () => ({
  debugLogger: {
    apiRequest: vi.fn(),
    apiResponse: vi.fn(),
    apiError: vi.fn(),
  },
}));

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  localStorage.clear();
  Object.defineProperty(globalThis, "fetch", { value: mockFetch, writable: true, configurable: true });
  Object.defineProperty(window, "fetch", { value: mockFetch, writable: true, configurable: true });
});

describe("admin alert API", () => {
  it("requests the explicitly mounted persistent alert route", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    await listAlerts();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/admin/alerts"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("uses canonical ack and resolve lifecycle routes", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "alert-1", status: "acknowledged" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "alert-1", status: "resolved" }) });

    await acknowledgeAlert("alert-1");
    await resolveAlert("alert-1");

    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/admin/alerts/alert-1/ack");
    expect(mockFetch.mock.calls[1][0]).toContain("/api/v1/admin/alerts/alert-1/resolve");
  });
});
