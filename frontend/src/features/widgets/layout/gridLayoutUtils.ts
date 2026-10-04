/**
 * Dashboard grid layout utilities for react-grid-layout integration.
 *
 * Grid positions are persisted in `widget.layout.grid` as:
 *   { x: number, y: number, w: number, h: number }
 *
 * Backward compatibility: widgets without `layout.grid` get auto-assigned
 * positions based on `layout.col_span`/`layout.row_span` or widget defaults.
 */

import type { LayoutItem } from "react-grid-layout";
import type { ProjectWidget } from "../../../types";
import { resolveWidgetDefinition } from "../registry/widgetRegistry";
import type { WidgetDefinition } from "../types";

// ── Constants ──────────────────────────────────────────────────────────────────

/** Number of columns in the desktop grid */
export const GRID_COLUMNS = 24;

/** Height of one grid row in pixels */
export const GRID_ROW_HEIGHT = 12;

/** Grid margin [horizontal, vertical] in pixels */
export const GRID_MARGIN: [number, number] = [8, 8];

/** Container padding in edit mode */
export const GRID_CONTAINER_PADDING: [number, number] = [12, 12];

/** Minimum widget size in grid units */
export const MIN_WIDGET_W = 2;
export const MIN_WIDGET_H = 4;

/** Default widget size in grid units (used when no layout data exists) */
export const DEFAULT_WIDGET_W = 8;
export const DEFAULT_WIDGET_H = 10;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GridLayoutData {
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

export interface WidgetLayoutPreset extends GridLayoutData {
  category: string;
  label: string;
}

export const WIDGET_LAYOUT_PRESETS: Record<string, WidgetLayoutPreset> = {
  control: { x: 0, y: 0, w: 6, h: 12, minW: 5, minH: 10, category: "control", label: "Control" },
  wide_control: { x: 0, y: 0, w: 8, h: 12, minW: 6, minH: 10, category: "control", label: "Wide control" },
  status: { x: 0, y: 0, w: 6, h: 10, minW: 5, minH: 8, category: "status", label: "Status/value" },
  gauge: { x: 0, y: 0, w: 8, h: 12, minW: 6, minH: 10, category: "display", label: "Gauge" },
  chart: { x: 0, y: 0, w: 12, h: 18, minW: 8, minH: 14, category: "chart", label: "Chart" },
  mini_chart: { x: 0, y: 0, w: 8, h: 10, minW: 6, minH: 8, category: "chart", label: "Mini chart" },
  historical_chart: { x: 0, y: 0, w: 16, h: 22, minW: 10, minH: 16, category: "chart", label: "Historical chart" },
  ota: { x: 0, y: 0, w: 10, h: 12, minW: 8, minH: 10, category: "ota", label: "OTA" },
  utility: { x: 0, y: 0, w: 8, h: 10, minW: 6, minH: 8, category: "utility", label: "Utility" },
  wide_utility: { x: 0, y: 0, w: 12, h: 10, minW: 8, minH: 8, category: "utility", label: "Wide utility" },
  divider: { x: 0, y: 0, w: 24, h: 4, minW: 8, minH: 3, category: "utility", label: "Divider" },
};

function presetKeyForWidget(widgetType: string, definition: WidgetDefinition | null): keyof typeof WIDGET_LAYOUT_PRESETS {
  const id = widgetType.toLowerCase();
  if (id === "divider") return "divider";
  if (id.includes("historical") || id === "telemetry_chart") return "historical_chart";
  if (id.includes("sparkline") || id.includes("mini_chart")) return "mini_chart";
  if (id.includes("ota") || id.includes("firmware")) return "ota";
  if (id.includes("slider") || id.includes("segmented") || id.includes("dropdown") || id.includes("color") || id.includes("joystick")) return "wide_control";
  if (id.includes("gauge") || id.includes("thermometer")) return "gauge";
  if (definition?.category === "chart") return "chart";
  if (definition?.category === "control") return "control";
  if (definition?.category === "status" || definition?.category === "display") return "status";
  if (definition?.category === "utility" && (id.includes("markdown") || id.includes("info") || id.includes("image") || id.includes("group"))) return "wide_utility";
  return "utility";
}

export function getWidgetLayoutPreset(widgetType: string): WidgetLayoutPreset {
  let definition: WidgetDefinition | null = null;
  try {
    definition = resolveWidgetDefinition(widgetType);
  } catch {
    definition = null;
  }
  return WIDGET_LAYOUT_PRESETS[presetKeyForWidget(widgetType, definition)];
}

export interface GridLayoutChange {
  widgetId: string;
  layout: GridLayoutData;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Extract the saved grid position for a widget.
 * Returns null if the widget has no saved grid data.
 */
export function getWidgetSizeConstraints(widgetType: string): Required<Pick<GridLayoutData, "minW" | "minH">> & {
  defaultW: number;
  defaultH: number;
} {
  const preset = getWidgetLayoutPreset(widgetType);
  const isChart = preset.category === "chart";
  return {
    minW: isChart ? (preset.minW ?? MIN_WIDGET_W) : MIN_WIDGET_W,
    minH: isChart ? (preset.minH ?? MIN_WIDGET_H) : MIN_WIDGET_H,
    defaultW: preset.w,
    defaultH: preset.h,
  };
}

export function getSavedGrid(widget: ProjectWidget): GridLayoutData | null {
  const grid = widget.layout?.grid;
  const constraints = getWidgetSizeConstraints(widget.widget_type);
  if (
    grid &&
    typeof grid === "object" &&
    "x" in grid &&
    "y" in grid &&
    "w" in grid &&
    "h" in grid
  ) {
    const g = grid as Record<string, unknown>;
    const x = Number(g.x);
    const y = Number(g.y);
    const w = Number(g.w);
    const h = Number(g.h);
    if (isFinite(x) && isFinite(y) && isFinite(w) && isFinite(h) && x >= 0 && y >= 0 && w > 0 && h > 0) {
      return {
        x,
        y,
        w: Math.max(constraints.minW, w),
        h: Math.max(constraints.minH, h),
        minW: constraints.minW,
        minH: constraints.minH,
      };
    }
  }
  return null;
}

/**
 * Derive default grid dimensions from a widget's layout data or definition.
 */
function getDefaultSize(widget: ProjectWidget): { w: number; h: number } {
  const constraints = getWidgetSizeConstraints(widget.widget_type);
  const layoutW = Number(widget.layout?.col_span ?? widget.layout?.width);
  const layoutH = Number(widget.layout?.row_span ?? widget.layout?.height);

  // Layout width/height cu thuong la 1-3, khong phu hop grid 24 cot.
  const w = isFinite(layoutW) && layoutW >= constraints.minW ? layoutW : constraints.defaultW;
  const h = isFinite(layoutH) && layoutH >= constraints.minH ? layoutH : constraints.defaultH;

  return {
    w: Math.max(constraints.minW, Math.min(GRID_COLUMNS, w)),
    h: Math.max(constraints.minH, h),
  };
}

function clampItem(item: LayoutItem, widgetType?: string, cols = GRID_COLUMNS): LayoutItem {
  const constraints = getWidgetSizeConstraints(widgetType ?? "");
  const minW = Number(item.minW ?? constraints.minW);
  const minH = Number(item.minH ?? constraints.minH);
  const rawW = Number.isFinite(item.w) && item.w > 0 ? item.w : constraints.defaultW;
  const rawH = Number.isFinite(item.h) && item.h > 0 ? item.h : constraints.defaultH;
  const rawX = Number.isFinite(item.x) && item.x >= 0 ? item.x : 0;
  const rawY = Number.isFinite(item.y) && item.y >= 0 ? item.y : 0;
  const w = Math.max(minW, Math.min(cols, Math.round(rawW)));
  const h = Math.max(minH, Math.round(rawH));
  const x = Math.max(0, Math.min(cols - w, Math.round(rawX)));
  const y = Math.max(0, Math.round(rawY));
  return { ...item, x, y, w, h, minW, minH };
}

function collides(a: LayoutItem, b: LayoutItem): boolean {
  if (a.i === b.i) return false;
  if (a.x + a.w <= b.x) return false;
  if (b.x + b.w <= a.x) return false;
  if (a.y + a.h <= b.y) return false;
  if (b.y + b.h <= a.y) return false;
  return true;
}

export function normalizeGridLayout(
  layout: LayoutItem[],
  widgetTypes = new Map<string, string>(),
  cols = GRID_COLUMNS
): LayoutItem[] {
  const placed: LayoutItem[] = [];
  const ordered = [...layout].sort((a, b) => a.y - b.y || a.x - b.x || a.i.localeCompare(b.i));

  for (const rawItem of ordered) {
    let item = clampItem(rawItem, widgetTypes.get(rawItem.i), cols);
    let hasCollision = true;
    let limit = 200;
    while (hasCollision && limit > 0) {
      hasCollision = false;
      limit--;
      for (const other of placed) {
        if (collides(item, other)) {
          item.y = item.y + 1;
          hasCollision = true;
          break; // Break inner loop to re-evaluate collisions from the beginning at the new y position
        }
      }
    }
    placed.push(item);
  }

  return placed;
}

/**
 * Build react-grid-layout LayoutItem[] from a list of widgets.
 * Widgets with saved positions use those; others are auto-placed.
 */
export function buildGridLayout(widgets: ProjectWidget[], cols = GRID_COLUMNS): LayoutItem[] {
  const layout: LayoutItem[] = [];
  const widgetTypes = new Map<string, string>();
  let autoY = 0;
  let autoX = 0;
  let maxRowH = 0;

  for (const widget of widgets) {
    widgetTypes.set(widget.id, widget.widget_type);
    const saved = getSavedGrid(widget);
    const size = getDefaultSize(widget);
    const constraints = getWidgetSizeConstraints(widget.widget_type);

    if (saved) {
      layout.push({
        i: widget.id,
        x: saved.x,
        y: saved.y,
        w: saved.w,
        h: saved.h,
        minW: constraints.minW,
        minH: constraints.minH,
      });
      // Track max Y for auto-placement fallback
      autoY = Math.max(autoY, saved.y + saved.h);
    } else {
      // Auto-place: find next available position
      const width = Math.min(cols, size.w);
      if (autoX + width > cols) {
        autoX = 0;
        autoY += maxRowH;
        maxRowH = 0;
      }
      layout.push({
        i: widget.id,
        x: autoX,
        y: autoY,
        w: width,
        h: size.h,
        minW: constraints.minW,
        minH: constraints.minH,
      });
      autoX += width;
      maxRowH = Math.max(maxRowH, size.h);
    }
  }

  return normalizeGridLayout(layout, widgetTypes, cols);
}

/**
 * Convert react-grid-layout LayoutItem[] to a map of widgetId -> GridLayoutData
 * for persistence.
 */
export function layoutToGridMap(layouts: LayoutItem[]): Map<string, GridLayoutData> {
  const map = new Map<string, GridLayoutData>();
  for (const item of layouts) {
    map.set(item.i, {
      x: item.x,
      y: item.y,
      w: item.w,
      h: item.h,
    });
  }
  return map;
}

/**
 * Check if two layout maps have any differences.
 */
export function layoutsChanged(
  a: Map<string, GridLayoutData>,
  b: Map<string, GridLayoutData>,
): boolean {
  if (a.size !== b.size) return true;
  for (const [id, la] of a) {
    const lb = b.get(id);
    if (!lb) return true;
    if (la.x !== lb.x || la.y !== lb.y || la.w !== lb.w || la.h !== lb.h) return true;
  }
  return false;
}

/**
 * Generate a "reset" layout map where all widgets get default sizes
 * in a simple left-to-right, top-to-bottom flow.
 */
export function buildDefaultLayoutMap(widgets: ProjectWidget[], cols = GRID_COLUMNS): Map<string, GridLayoutData> {
  const cleanWidgets = widgets.map((w) => {
    // Clear saved grid so auto-placement kicks in
    const rest = { ...(w.layout ?? {}) } as Record<string, unknown>;
    delete rest.grid;
    return { ...w, layout: rest as ProjectWidget["layout"] };
  });
  const layout = buildGridLayout(cleanWidgets, cols);
  return layoutToGridMap(layout);
}

/**
 * Resolve overlaps dynamically by pushing colliding items down.
 * The activeItem's position is locked, and other items are pushed down.
 */
export function resolveLayoutCollisions(
  layout: LayoutItem[],
  activeItem: LayoutItem,
  widgetTypes = new Map<string, string>(),
  cols = GRID_COLUMNS
): LayoutItem[] {
  const items = layout.map(item => ({ ...item }));
  
  const activeIndex = items.findIndex(item => item.i === activeItem.i);
  if (activeIndex !== -1) {
    items[activeIndex] = { ...items[activeIndex], x: activeItem.x, y: activeItem.y, w: activeItem.w, h: activeItem.h };
  }

  const placed: LayoutItem[] = [items.find(item => item.i === activeItem.i)!].filter(Boolean);

  const toProcess = items
    .filter(item => item.i !== activeItem.i)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  for (const rawItem of toProcess) {
    let item = clampItem(rawItem, widgetTypes.get(rawItem.i), cols);
    
    let hasCollision = true;
    let limit = 200;
    while (hasCollision && limit > 0) {
      hasCollision = false;
      limit--;
      for (const other of placed) {
        if (collides(item, other)) {
          item.y = item.y + 1;
          hasCollision = true;
          break; // Break inner loop to re-evaluate collisions from the beginning at the new y position
        }
      }
    }
    placed.push(item);
  }

  const idToPlaced = new Map(placed.map(item => [item.i, item]));
  return layout.map(item => idToPlaced.get(item.i) || item);
}
