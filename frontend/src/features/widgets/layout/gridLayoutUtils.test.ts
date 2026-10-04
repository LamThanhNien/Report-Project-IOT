import { describe, expect, it } from "vitest";
import type { ProjectWidget } from "../../../types";
import {
  buildGridLayout,
  getWidgetSizeConstraints,
  MIN_WIDGET_H,
  MIN_WIDGET_W,
  resolveLayoutCollisions,
} from "./gridLayoutUtils";

function widget(id: string, widget_type = "toggle_switch", grid?: Record<string, number>): ProjectWidget {
  return {
    id,
    page_id: "page-1",
    widget_type,
    title: id,
    sort_order: 0,
    layout: grid ? { grid } : {},
    config: {},
    binding: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

describe("gridLayoutUtils", () => {
  it("normalizes old overlapping widget grid positions", () => {
    const layout = buildGridLayout([
      widget("w1", "toggle_switch", { x: 0, y: 0, w: 3, h: 2 }),
      widget("w2", "toggle_switch", { x: 0, y: 0, w: 3, h: 2 }),
      widget("w3", "telemetry_chart", { x: 0, y: 0, w: 5, h: 3 }),
    ]);

    for (let i = 0; i < layout.length; i += 1) {
      for (let j = i + 1; j < layout.length; j += 1) {
        expect(overlaps(layout[i], layout[j])).toBe(false);
      }
    }
  });

  it("gives charts larger default canvas space than compact controls", () => {
    const layout = buildGridLayout([widget("chart", "telemetry_chart"), widget("control", "toggle_switch")]);
    const chart = layout.find((item) => item.i === "chart")!;
    const control = layout.find((item) => item.i === "control")!;

    expect(chart.w).toBeGreaterThan(control.w);
    expect(chart.h).toBeGreaterThan(control.h);
    expect(chart.w).toBeGreaterThanOrEqual(getWidgetSizeConstraints("telemetry_chart").minW);
    expect(control.h).toBeGreaterThanOrEqual(getWidgetSizeConstraints("toggle_switch").minH);
  });

  it("clamps unsafe old layouts to the dashboard design minimum", () => {
    const layout = buildGridLayout([
      widget("tiny", "toggle_switch", { x: 99, y: 0, w: 1, h: 1 }),
    ]);
    const item = layout[0];

    expect(item.x + item.w).toBeLessThanOrEqual(24);
    expect(item.y).toBeGreaterThanOrEqual(0);
    expect(item.w).toBe(MIN_WIDGET_W);
    expect(item.h).toBe(MIN_WIDGET_H);
  });

  it("keeps saved compact widget layouts instead of expanding to widget presets", () => {
    const layout = buildGridLayout([
      widget("small-control", "toggle_switch", { x: 0, y: 0, w: 2, h: 4 }),
      widget("small-chart", "telemetry_chart", { x: 2, y: 0, w: 2, h: 4 }),
    ]);

    expect(layout.find((item) => item.i === "small-control")).toMatchObject({ w: 2, h: 4, minW: 2, minH: 4 });
    expect(layout.find((item) => item.i === "small-chart")).toMatchObject({ w: 10, h: 16, minW: 10, minH: 16 });
  });

  it("uses custom minimum resize constraints for charts and 2x4 for other widgets", () => {
    expect(getWidgetSizeConstraints("toggle_switch")).toMatchObject({ minW: 2, minH: 4 });
    expect(getWidgetSizeConstraints("telemetry_chart")).toMatchObject({ minW: 10, minH: 16 });
    expect(getWidgetSizeConstraints("divider")).toMatchObject({ minW: 2, minH: 4 });
  });

  it("keeps collision preview stable across consecutive drag frames", () => {
    const baseline = [
      { i: "active", x: 0, y: 0, w: 6, h: 10 },
      { i: "static", x: 6, y: 0, w: 6, h: 10 },
    ];
    const dragFrames = [
      { x: 4, y: 0 },
      { x: 6, y: 0 },
      { x: 7, y: 0 },
      { x: 6, y: 0 },
    ];

    const previews = dragFrames.map(({ x, y }) => {
      const active = { ...baseline[0], x, y };
      return resolveLayoutCollisions(
        baseline.map((item) => ({ ...item })),
        active,
      );
    });

    expect(previews.map((layout) => layout.find((item) => item.i === "static")?.y)).toEqual([
      10,
      10,
      10,
      10,
    ]);
    expect(previews[previews.length - 1]).toEqual(
      resolveLayoutCollisions(
        baseline.map((item) => ({ ...item })),
        { ...baseline[0], x: 6, y: 0 },
      ),
    );
  });
});
