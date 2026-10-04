import { describe, expect, it } from "vitest";
import { bindingTypeFor, normalizeCommandParams, normalizeBoolean, normalizeNumber, parseOptionsCsv, stateFieldForBinding } from "./widgetBindings";

describe("normalizeCommandParams", () => {
  const booleanBinding = { command: "set_output", channel: "relay_1", capability_key: "relay_1", gpio_pin: 2 };

  it("always coerces to boolean for set_output regardless of valueType", () => {
    const result = normalizeCommandParams(booleanBinding, 50);
    expect(result.value).toBe(true);
  });

  it("coerces number to boolean for set_output", () => {
    const result = normalizeCommandParams(booleanBinding, 50, "boolean");
    expect(result.value).toBe(true);
  });

  it("coerces zero to false for set_output when valueType is boolean", () => {
    const result = normalizeCommandParams(booleanBinding, 0, "boolean");
    expect(result.value).toBe(false);
  });

  it("coerces string to boolean for set_output when valueType is boolean", () => {
    const result = normalizeCommandParams(booleanBinding, "on", "boolean");
    expect(result.value).toBe(true);
  });

  it("coerces empty string to false for set_output when valueType is boolean", () => {
    const result = normalizeCommandParams(booleanBinding, "", "boolean");
    expect(result.value).toBe(false);
  });

  it("passes boolean directly for set_output when valueType is boolean", () => {
    const result = normalizeCommandParams(booleanBinding, true, "boolean");
    expect(result.value).toBe(true);
  });

  it("preserves target and gpio_pin for set_output", () => {
    const result = normalizeCommandParams(booleanBinding, true, "boolean");
    expect(result.target).toBe("relay_1");
    expect(result.gpio_pin).toBe(2);
    expect(result.pin).toBe(2);
  });

  it("always normalizes to boolean for set_gpio regardless of valueType", () => {
    const gpioBinding = { command: "set_gpio", gpio_pin: 2 };
    const result = normalizeCommandParams(gpioBinding, 50);
    expect(result.state).toBe(true);
  });

  it("passes raw value for toggle_output", () => {
    const toggleBinding = { command: "toggle_output", channel: "relay_1" };
    const result = normalizeCommandParams(toggleBinding, undefined);
    expect(result.target).toBe("relay_1");
    expect(result.value).toBeUndefined();
  });

  it("passes raw value for unknown commands", () => {
    const customBinding = { command: "custom_command", channel: "relay_1" };
    const result = normalizeCommandParams(customBinding, "auto");
    expect(result.value).toBe("auto");
    expect(result.state).toBe("auto");
  });

  it("preserves virtual channel and raw values for virtual_write", () => {
    const result = normalizeCommandParams(
      { command: "virtual_write", channel: "v2", params: { value: null } },
      true,
    );
    expect(result).toEqual({ channel: "v2", value: true, state: true });
  });
});

describe("normalizeBoolean", () => {
  it("returns true for boolean true", () => expect(normalizeBoolean(true)).toBe(true));
  it("returns false for boolean false", () => expect(normalizeBoolean(false)).toBe(false));
  it("returns true for number 1", () => expect(normalizeBoolean(1)).toBe(true));
  it("returns false for number 0", () => expect(normalizeBoolean(0)).toBe(false));
  it("returns true for string 'on'", () => expect(normalizeBoolean("on")).toBe(true));
  it("returns true for string 'true'", () => expect(normalizeBoolean("true")).toBe(true));
  it("returns false for string 'off'", () => expect(normalizeBoolean("off")).toBe(false));
  it("returns false for null", () => expect(normalizeBoolean(null)).toBe(false));
  it("returns false for undefined", () => expect(normalizeBoolean(undefined)).toBe(false));
  it("returns true for number 50", () => expect(normalizeBoolean(50)).toBe(true));
});

describe("normalizeNumber", () => {
  it("returns number for valid number", () => expect(normalizeNumber(42)).toBe(42));
  it("returns number for valid string", () => expect(normalizeNumber("3.14")).toBe(3.14));
  it("returns null for empty string", () => expect(normalizeNumber("")).toBeNull());
  it("returns null for non-numeric string", () => expect(normalizeNumber("abc")).toBeNull());
  it("returns null for null", () => expect(normalizeNumber(null)).toBeNull());
  it("returns null for NaN", () => expect(normalizeNumber(NaN)).toBeNull());
});

describe("explicit widget binding types", () => {
  it("recognizes legacy hardware bindings as physical", () => {
    expect(bindingTypeFor({ capability_key: "relay_1" })).toBe("physical");
  });

  it("uses canonical virtual channel telemetry fields", () => {
    const binding = {
      binding_type: "virtual",
      datastream_id: "stream-2",
      channel: "v2",
      state_key: "ch_v2",
    };
    expect(bindingTypeFor(binding)).toBe("virtual");
    expect(stateFieldForBinding(binding)).toBe("ch_v2");
  });
});

describe("parseOptionsCsv", () => {
  it("parses simple CSV lists", () => {
    expect(parseOptionsCsv("auto,on,off")).toEqual([
      { label: "auto", value: "auto" },
      { label: "on", value: "on" },
      { label: "off", value: "off" },
    ]);
  });

  it("parses key-value option pairs using colon or equals", () => {
    expect(parseOptionsCsv("Tắt:false,Bật:true")).toEqual([
      { label: "Tắt", value: false },
      { label: "Bật", value: true },
    ]);
    expect(parseOptionsCsv("Off=0,On=1,Auto=2")).toEqual([
      { label: "Off", value: 0 },
      { label: "On", value: 1 },
      { label: "Auto", value: 2 },
    ]);
  });

  it("handles newlines and extra spaces gracefully", () => {
    expect(parseOptionsCsv("Tự động = auto\nThủ công = manual\n Bảo trì : maintenance ")).toEqual([
      { label: "Tự động", value: "auto" },
      { label: "Thủ công", value: "manual" },
      { label: "Bảo trì", value: "maintenance" },
    ]);
  });

  it("returns empty array for empty inputs", () => {
    expect(parseOptionsCsv("")).toEqual([]);
    expect(parseOptionsCsv("   ")).toEqual([]);
  });
});
