import { describe, expect, it } from "vitest";
import { isSensitiveField, maskSensitiveData } from "./debugLogger";

describe("debug logger credential masking", () => {
  it("recognizes common credential field names", () => {
    expect(isSensitiveField("accessToken")).toBe(true);
    expect(isSensitiveField("refresh_token")).toBe(true);
    expect(isSensitiveField("confirmPassword")).toBe(true);
    expect(isSensitiveField("api-key")).toBe(true);
    expect(isSensitiveField("device_name")).toBe(false);
  });

  it("masks nested credentials, array entries, JWTs, and bearer values", () => {
    const masked = maskSensitiveData({
      accessToken: "secret",
      nested: { pwd: "secret", value: "Bearer abc" },
      items: [{ apiKey: "secret" }, "eyJhbGciOiJIUzI1NiJ9.payload.signature"],
      device: "esp32-001",
    });

    expect(masked).toEqual({
      accessToken: "***MASKED***",
      nested: { pwd: "***MASKED***", value: "***MASKED***" },
      items: [{ apiKey: "***MASKED***" }, "***MASKED***"],
      device: "esp32-001",
    });
  });
});
