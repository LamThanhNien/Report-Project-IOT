import type { DeviceCapability } from "../../../types";
import type { WidgetBindingMode, WidgetCapabilityContext } from "../types";

export type WidgetBindingType = "physical" | "virtual";

export function bindingTypeFor(binding: Record<string, unknown>): WidgetBindingType {
  return binding.binding_type === "virtual" || typeof binding.datastream_id === "string"
    ? "virtual"
    : "physical";
}

export const CONTROL_CAPABILITY_TYPES = new Set(["digital_output", "relay", "led"]);

export const ESP32_OUTPUT_PINS = [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33];
const ESP32_RESERVED_PINS = new Set([6, 7, 8, 9, 10, 11]);
const ESP32_INPUT_ONLY_PINS = new Set([34, 35, 36, 39]);
const ESP32_BOOTSTRAP_PINS = new Set([0, 1, 3, 5, 12]);

export function gpioPinWarning(pin: number): string | null {
  if (ESP32_RESERVED_PINS.has(pin)) return "This GPIO is reserved for flash and cannot be used.";
  if (ESP32_INPUT_ONLY_PINS.has(pin)) return "This GPIO is input-only and cannot be used for output.";
  if (pin < 0 || pin > 39) return "GPIO pin must be between 0 and 39.";
  if (ESP32_BOOTSTRAP_PINS.has(pin)) return "This pin may affect ESP32 boot mode. Use only if you understand your board wiring.";
  return null;
}

export function normalizeBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number" && Number.isFinite(value) && value !== 0) return true;
  if (value === "1") return true;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    if (["true", "on", "high", "online", "connected", "ok"].includes(lower)) return true;
  }
  return false;
}

export function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function stateFieldForBinding(binding: Record<string, unknown>): string {
  if (typeof binding.feedback_key === "string" && binding.feedback_key) return binding.feedback_key;
  if (typeof binding.state_key === "string" && binding.state_key) return binding.state_key;
  if (typeof binding.telemetry_field === "string" && binding.telemetry_field) return binding.telemetry_field;
  if (typeof binding.state_field === "string" && binding.state_field) return binding.state_field;
  if (typeof binding.channel === "string" && binding.channel) return `${binding.channel}_state`;
  if (typeof binding.gpio_pin === "number") return `gpio_${binding.gpio_pin}_state`;
  return "state";
}

export function filterCapabilitiesForWidget({ definition, capabilities }: WidgetCapabilityContext): DeviceCapability[] {
  const bindable = capabilities.filter((cap) => cap.is_bindable !== false);
  if (definition.bindingMode === "static") return [];
  if (definition.bindingMode === "command" || definition.bindingMode === "commandTelemetry") {
    return bindable.filter((cap) => {
      if (!cap.command_name) return false;
      if (definition.binding.capabilityTypes?.length) {
        return definition.binding.capabilityTypes.includes(cap.capability_type);
      }
      return CONTROL_CAPABILITY_TYPES.has(cap.capability_type) || !!cap.command_name;
    });
  }
  return bindable.filter((cap) => cap.telemetry_state_key != null || !!cap.command_name);
}

export function supportsTelemetryBinding(bindingMode: WidgetBindingMode): boolean {
  return bindingMode === "telemetry" || bindingMode === "commandTelemetry";
}

export function supportsCommandBinding(bindingMode: WidgetBindingMode): boolean {
  return bindingMode === "command" || bindingMode === "commandTelemetry";
}

export function normalizeCommandParams(
  binding: Record<string, unknown>,
  nextValue: unknown,
  valueType?: string,
): Record<string, unknown> {
  const existing = typeof binding.params === "object" && binding.params !== null
    ? { ...(binding.params as Record<string, unknown>) }
    : {};
  const gpioPin = typeof binding.gpio_pin === "number" ? binding.gpio_pin : undefined;
  const target = typeof binding.channel === "string" && binding.channel
    ? binding.channel
    : typeof binding.capability_key === "string" && binding.capability_key
      ? binding.capability_key
      : existing.target;

  if (binding.command === "virtual_write") {
    const channel = typeof binding.channel === "string" ? binding.channel : "";
    return {
      ...existing,
      channel,
      value: nextValue,
      state: nextValue,
    };
  }

  if (binding.command === "set_gpio") {
    const pinValue = gpioPin ?? existing.pin;
    return {
      ...existing,
      pin: typeof pinValue === "number" ? pinValue : Number(pinValue),
      state: normalizeBoolean(nextValue),
      ...(gpioPin != null ? { gpio_pin: gpioPin } : {}),
    };
  }
  if (binding.command === "set_output") {
    const stringValue = typeof nextValue === "string" ? nextValue.trim().toLowerCase() : "";
    const isBooleanLiteral = ["true", "false", "on", "off", "1", "0", "high", "low"].includes(stringValue);
    return {
      ...existing,
      target,
      value: valueType === "string" && !isBooleanLiteral ? nextValue : normalizeBoolean(nextValue),
      ...(gpioPin != null ? { gpio_pin: gpioPin, pin: gpioPin } : {}),
    };
  }
  if (binding.command === "toggle_output") {
    return {
      ...existing,
      target,
      ...(gpioPin != null ? { gpio_pin: gpioPin, pin: gpioPin } : {}),
    };
  }
  if (typeof binding.channel === "string" && binding.channel) {
    return {
      ...existing,
      channel: binding.channel,
      value: nextValue,
      state: nextValue,
      ...(gpioPin != null ? { gpio_pin: gpioPin } : {}),
    };
  }
  return {
    ...existing,
    value: nextValue,
    state: nextValue,
    ...(gpioPin != null ? { gpio_pin: gpioPin } : {}),
  };
}

export function parseOptionValue(valStr: string): boolean | number | string {
  const lower = valStr.trim().toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  const num = Number(valStr);
  if (!isNaN(num)) return num;
  return valStr;
}

export function parseOptionsCsv(csv: string): { label: string; value: boolean | number | string }[] {
  if (!csv || !csv.trim()) return [];
  const lines = csv.split(/[,\n]/);
  return lines.map((item) => {
    const itemStr = item.trim();
    if (!itemStr) return null;
    const separatorIdx = itemStr.indexOf("=") !== -1 ? itemStr.indexOf("=") : itemStr.indexOf(":");
    if (separatorIdx !== -1) {
      const label = itemStr.slice(0, separatorIdx).trim();
      const valueStr = itemStr.slice(separatorIdx + 1).trim();
      return { label, value: parseOptionValue(valueStr) };
    }
    return { label: itemStr, value: parseOptionValue(itemStr) };
  }).filter((x): x is { label: string; value: boolean | number | string } => x !== null);
}
