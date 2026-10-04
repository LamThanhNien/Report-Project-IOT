import type { WidgetDraft } from "../types";
import { resolveWidgetDefinition } from "../registry/widgetRegistry";
import { bindingTypeFor, normalizeNumber, supportsCommandBinding, supportsTelemetryBinding } from "./widgetBindings";

export interface WidgetDatastreamSelection {
  data_type?: string;
  direction?: string;
}

export function validateWidgetDraft(
  draft: WidgetDraft,
  selectedDatastream?: WidgetDatastreamSelection | null,
): string[] {
  const definition = resolveWidgetDefinition(draft.widget_type);
  const errors: string[] = [];

  if (!draft.title.trim()) {
    errors.push("Title is required.");
  }

  const deviceIdStr = typeof draft.binding.device_id === "string" ? draft.binding.device_id.trim() : "";
  if (definition.bindingMode !== "static" && !deviceIdStr) {
    errors.push("Assigned device is required.");
  }

  const bindingType = bindingTypeFor(draft.binding);
  if (definition.datastream?.virtualOnly && bindingType !== "virtual") {
    errors.push("This widget only supports a Virtual Datastream binding.");
  }

  if (selectedDatastream && definition.datastream) {
    if (definition.datastream.dataTypes && !definition.datastream.dataTypes.includes(String(selectedDatastream.data_type))) {
      errors.push(`Selected Datastream type must be one of ${definition.datastream.dataTypes.join(", ")}.`);
    }
    if (definition.datastream.directions && !definition.datastream.directions.includes(String(selectedDatastream.direction))) {
      errors.push(`Selected Datastream direction must be one of ${definition.datastream.directions.join(", ")}.`);
    }
  }
  if (definition.bindingMode !== "static" && bindingType === "virtual") {
    if (draft.widget_type === "multi_telemetry_chart") {
      if (!draft.binding.datastream_ids || !Array.isArray(draft.binding.datastream_ids) || draft.binding.datastream_ids.length === 0) {
        errors.push("At least one Datastream is required.");
      }
    } else if (!draft.binding.datastream_id) {
      errors.push("A virtual pin (Datastream) is required.");
    }
  }

  if (bindingType === "physical" && supportsCommandBinding(definition.bindingMode) && definition.binding.requiresCapability && !draft.binding.capability_key) {
    errors.push("A command capability is required.");
  }

  if (bindingType === "physical" && supportsTelemetryBinding(definition.bindingMode) && definition.binding.requiresTelemetryField) {
    const telemetryField = String(
      draft.binding.feedback_key
      ?? draft.binding.telemetry_field
      ?? draft.binding.state_key
      ?? "",
    ).trim();
    if (!telemetryField) errors.push("A telemetry field is required.");
  }

  const min = normalizeNumber(draft.config.min);
  const max = normalizeNumber(draft.config.max);
  if (min !== null && max !== null && min > max) {
    errors.push("Minimum value cannot be greater than maximum value.");
  }

  const step = normalizeNumber(draft.config.step);
  if (step !== null && step <= 0) errors.push("Step must be greater than 0.");

  const decimalPlaces = normalizeNumber(draft.config.decimalPlaces);
  if (decimalPlaces !== null && (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 6)) {
    errors.push("Decimal places must be an integer between 0 and 6.");
  }

  const refreshInterval = normalizeNumber(draft.config.refreshIntervalSeconds);
  if (refreshInterval !== null && (!Number.isInteger(refreshInterval) || refreshInterval < 5 || refreshInterval > 300)) {
    errors.push("Refresh interval must be between 5 and 300 seconds.");
  }

  const maxDataPoints = normalizeNumber(draft.config.maxDataPoints);
  if (maxDataPoints !== null && (!Number.isInteger(maxDataPoints) || maxDataPoints < 10 || maxDataPoints > 500)) {
    errors.push("Max data points must be an integer between 10 and 500.");
  }

  if (definition.category === "chart") {
    const chartType = String(draft.config.chartType ?? draft.config.chart_type ?? "line");
    if (!["line", "area", "bar"].includes(chartType)) errors.push("Chart type is invalid.");
    const curveType = String(draft.config.curveType ?? draft.config.curve_type ?? "monotone");
    if (!["monotone", "linear", "step"].includes(curveType)) errors.push("Curve type is invalid.");
    const timeRange = String(draft.config.timeRange ?? draft.config.time_range ?? "6h");
    if (!["live", "6h", "1d", "1w", "1m", "15m", "24h", "7d"].includes(timeRange)) errors.push("Time range is invalid.");
    const aggregation = String(draft.config.aggregation ?? "avg");
    if (!["avg", "min", "max", "latest"].includes(aggregation)) errors.push("Aggregation is invalid.");
  }

  const warning = normalizeNumber(draft.config.warningThreshold);
  const danger = normalizeNumber(draft.config.dangerThreshold);
  const condition = draft.config.thresholdCondition ?? "above";
  if (warning !== null && danger !== null) {
    if (condition === "below") {
      if (warning < danger) {
        errors.push("Warning threshold cannot be less than danger threshold when monitoring falling values.");
      }
    } else {
      if (warning > danger) {
        errors.push("Warning threshold cannot be greater than danger threshold when monitoring rising values.");
      }
    }
  }

  for (const rule of definition.validationRules) {
    if (bindingType === "physical" && rule === "gpio_override_requires_capability" && draft.binding.capability_key === "custom_gpio_output" && draft.binding.gpio_pin == null) {
      errors.push("GPIO pin is required for custom GPIO output.");
    }
  }

  return errors;
}
