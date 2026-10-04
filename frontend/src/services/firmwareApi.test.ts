import { beforeEach, describe, expect, it, vi } from "vitest";
import { previewRetention, signFirmware, uploadFirmware } from "./firmwareApi";

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

describe("firmware governance API", () => {
  it("uploads release policy metadata with the binary", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: "firmware-1" }) });
    await uploadFirmware({
      version: "1.2.3",
      targetDeviceType: "esp32",
      releaseChannel: "stable",
      verificationRequired: true,
      file: new File(["binary"], "firmware.bin"),
    });

    const body = mockFetch.mock.calls[0][1].body as FormData;
    expect(body.get("release_channel")).toBe("stable");
    expect(body.get("verification_required")).toBe("true");
  });

  it("calls explicit signing and retention dry-run endpoints", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "firmware-1", signature_alg: "Ed25519" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ candidate_count: 0 }) });
    await signFirmware("firmware-1");
    await previewRetention();
    expect(mockFetch.mock.calls[0][0]).toContain("/api/v1/admin/firmware/firmware-1/sign");
    expect(mockFetch.mock.calls[1][0]).toContain("/api/v1/admin/firmware/retention/dry-run");
  });
});
