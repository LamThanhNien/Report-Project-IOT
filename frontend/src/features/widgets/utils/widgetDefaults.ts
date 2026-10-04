import type { ProjectWidget } from "../../../types";
import type { WidgetDraft } from "../types";
import { resolveWidgetDefinition } from "../registry/widgetRegistry";

const TIME_RANGE_ALIASES: Record<string, string> = { "15m": "live", "24h": "1d", "7d": "1w" };

export function normalizeWidgetConfig(widgetType: string, config: Record<string, unknown>): Record<string, unknown> {
  const definition = resolveWidgetDefinition(widgetType);
  if (definition.category !== "chart") return { ...config };
  const normalized = { ...config };
  if (normalized.chartType == null && normalized.chart_type != null) normalized.chartType = normalized.chart_type;
  if (normalized.curveType == null && normalized.curve_type != null) normalized.curveType = normalized.curve_type;
  if (normalized.timeRange == null && normalized.time_range != null) normalized.timeRange = normalized.time_range;
  if (typeof normalized.timeRange === "string") {
    normalized.timeRange = TIME_RANGE_ALIASES[normalized.timeRange] ?? normalized.timeRange;
  }
  if (normalized.aggregation === "latest") normalized.aggregation = "avg";
  return normalized;
}

export function buildWidgetDraft(widgetType: string, existing?: ProjectWidget | null): WidgetDraft {
  const definition = resolveWidgetDefinition(widgetType);
  return {
    widget_type: definition.id,
    title: existing?.title ?? definition.label,
    sort_order: existing?.sort_order,
    layout: {
      col_span: definition.defaultSize.colSpan,
      row_span: definition.defaultSize.rowSpan,
      width: definition.defaultSize.colSpan,
      height: definition.defaultSize.rowSpan,
      ...(existing?.layout ?? {}),
    },
    config: normalizeWidgetConfig(widgetType, {
      ...definition.defaultConfig,
      ...(existing?.config ?? {}),
    }),
    binding: (() => {
      if (!existing?.binding || Object.keys(existing.binding).length === 0) {
        return definition.datastream?.virtualOnly ? { binding_type: "virtual" } : {};
      }
      const existingBinding = existing.binding;
      const inferredType =
        existingBinding.binding_type ??
        (existingBinding.capability_key || existingBinding.capability_id || existingBinding.gpio_pin != null
          ? "physical"
          : "virtual");
      if (definition.datastream?.virtualOnly && inferredType !== "virtual") {
        return {
          device_id: existingBinding.device_id,
          device_uid: existingBinding.device_uid,
          binding_type: "virtual",
        };
      }
      return {
        binding_type: inferredType,
        ...existingBinding,
      };
    })(),
  };
}
