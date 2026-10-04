import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiGet, apiPostJson } from "./apiClient";

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
  Object.defineProperty(globalThis, "fetch", {
    value: mockFetch,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(window, "fetch", {
    value: mockFetch,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ApiError", () => {
  it("stores status, body, and message", () => {
    const err = new ApiError("404 not found", 404, { detail: "not found" });
    expect(err.status).toBe(404);
    expect(err.body).toEqual({ detail: "not found" });
    expect(err.message).toBe("404 not found");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("apiGet", () => {
  it("returns parsed JSON on 2xx", async () => {
    const payload = [{ id: "1", device_uid: "esp32-001" }];
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => payload });

    const result = await apiGet("/api/v1/devices");

    expect(result).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/devices"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("throws ApiError with detail on JSON error response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ detail: "device not found" }),
      text: async () => "",
    });

    await expect(apiGet("/api/v1/devices/ghost")).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("device not found"),
    });
  });

  it("formats FastAPI validation detail arrays", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      json: async () => ({
        detail: [{ loc: ["body", "expires_in_hours"], msg: "Input should be greater than or equal to 1" }],
      }),
      text: async () => "",
    });

    await expect(apiGet("/api/v1/client/provisioning/claim-code")).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining("expires_in_hours: Input should be greater than or equal to 1"),
    });
  });

  it("does not send bearer tokens from legacy localStorage auth", async () => {
    localStorage.setItem("aifom_access_token", "jwt-token");
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    await apiGet("/api/v1/auth/me");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/auth/me"),
      expect.objectContaining({
        headers: expect.not.objectContaining({ Authorization: expect.any(String) }),
      }),
    );
  });

  it("refreshes an expired access token and retries the request once", async () => {
    localStorage.setItem("aifom_access_token", "expired-token");
    localStorage.setItem("aifom_refresh_token", "refresh-token");
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ detail: "Invalid or expired token" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "new-token", refresh_token: "new-refresh" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });

    const result = await apiGet("/api/v1/client/projects");

    expect(result).toEqual({ ok: true });
    expect(localStorage.getItem("aifom_access_token")).toBeNull();
    expect(localStorage.getItem("aifom_refresh_token")).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[1][0]).toContain("/api/v1/auth/refresh");
    expect(mockFetch.mock.calls[2][1]).toEqual(expect.objectContaining({
      credentials: "include",
      headers: expect.not.objectContaining({ Authorization: expect.any(String) }),
    }));
  });

  it("shares one refresh request across concurrent 401 responses", async () => {
    localStorage.setItem("aifom_access_token", "expired-token");
    localStorage.setItem("aifom_refresh_token", "refresh-token");
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ detail: "Invalid or expired token" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        json: async () => ({ detail: "Invalid or expired token" }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "new-token", refresh_token: "new-refresh" }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "projects" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "devices" }) });

    const [projects, devices] = await Promise.all([
      apiGet("/api/v1/client/projects"),
      apiGet("/api/v1/client/devices"),
    ]);

    expect(projects).toEqual({ id: "projects" });
    expect(devices).toEqual({ id: "devices" });
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes("/api/v1/auth/refresh"))).toHaveLength(1);
  });

  it("falls back to statusText when body is not JSON", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => { throw new SyntaxError("bad json"); },
      text: async () => "upstream failure",
    });

    const err = await apiGet("/api/v1/health").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });
});

describe("apiPostJson", () => {
  it("sends Content-Type application/json and returns response", async () => {
    const resp = { job_id: "abc", status: "sent" };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => resp });

    const result = await apiPostJson("/api/v1/ota/jobs", {
      device_uid: "esp32-001",
      firmware_version_id: "fw-uuid",
    });

    expect(result).toEqual(resp);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/ota/jobs"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("throws ApiError on non-2xx", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      json: async () => ({ detail: "validation error" }),
      text: async () => "",
    });

    await expect(
      apiPostJson("/api/v1/ota/jobs", {}),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("does not refresh recursively for login failures", async () => {
    localStorage.setItem("aifom_refresh_token", "refresh-token");
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ detail: "Invalid email or password" }),
      text: async () => "",
    });

    await expect(
      apiPostJson("/api/v1/auth/login", { email: "bad@example.com", password: "bad" }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
