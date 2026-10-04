import { describe, expect, it } from "vitest";
import { listWidgetDefinitions, resolveWidgetDefinition } from "./widgetRegistry";
import { getVisibleWidgetEditorFields } from "../components/editors/WidgetConfigEditor";
import { buildWidgetDraft } from "../utils/widgetDefaults";
import viProjects from "../../../locales/vi/projects.json";
import enProjects from "../../../locales/en/projects.json";
import i18n from "../../../lib/i18n";

describe("widgetRegistry", () => {
  it("resolves legacy widget ids to the new registry definitions", () => {
    expect(resolveWidgetDefinition("switch").id).toBe("toggle_switch");
    expect(resolveWidgetDefinition("button").id).toBe("push_button");
    expect(resolveWidgetDefinition("text").id).toBe("text_value");
    expect(resolveWidgetDefinition("led").id).toBe("led_indicator");
  });

  it("resolves consolidated widget legacy ids", () => {
    expect(resolveWidgetDefinition("gauge").id).toBe("gauge_widget");
    expect(resolveWidgetDefinition("circular_gauge").id).toBe("gauge_widget");
    expect(resolveWidgetDefinition("linear_gauge").id).toBe("gauge_widget");
    expect(resolveWidgetDefinition("line_chart").id).toBe("telemetry_chart");
    expect(resolveWidgetDefinition("area_chart").id).toBe("telemetry_chart");
    expect(resolveWidgetDefinition("bar_chart").id).toBe("telemetry_chart");
    expect(resolveWidgetDefinition("historical_telemetry_chart").id).toBe("telemetry_chart");
    expect(resolveWidgetDefinition("humidity_card").id).toBe("number_card");
    expect(resolveWidgetDefinition("thermometer").id).toBe("number_card");
  });

  it("hides deprecated widgets from the default catalog", () => {
    const visible = listWidgetDefinitions();
    expect(visible.some((item) => item.id === "line_chart")).toBe(false);
    expect(visible.some((item) => item.id === "area_chart")).toBe(false);
    expect(visible.some((item) => item.id === "bar_chart")).toBe(false);
    expect(visible.some((item) => item.id === "donut_pie_chart")).toBe(false);
    expect(visible.some((item) => item.id === "sparkline")).toBe(false);
    expect(visible.some((item) => item.id === "historical_telemetry_chart")).toBe(false);
    expect(visible.some((item) => item.id === "circular_gauge")).toBe(false);
    expect(visible.some((item) => item.id === "linear_gauge")).toBe(false);
    expect(visible.some((item) => item.id === "thermometer")).toBe(false);
    expect(visible.some((item) => item.id === "humidity_card")).toBe(false);
    expect(visible.some((item) => item.id === "color_picker")).toBe(false);
    expect(visible.some((item) => item.id === "direction_pad_joystick")).toBe(false);
    expect(visible.some((item) => item.id === "knob_dial_control")).toBe(false);
    expect(visible.some((item) => item.id === "stepper_control")).toBe(false);
    expect(visible.some((item) => item.id === "schedule_button_timer")).toBe(false);
    expect(visible.some((item) => item.id === "anomaly_detection_card")).toBe(false);
    expect(visible.some((item) => item.id === "divider")).toBe(false);
    expect(visible.some((item) => item.id === "image_card")).toBe(false);
  });

  it("shows consolidated widgets in the catalog", () => {
    const visible = listWidgetDefinitions();
    expect(visible.some((item) => item.id === "telemetry_chart")).toBe(true);
    expect(visible.some((item) => item.id === "gauge_widget")).toBe(true);
    expect(visible.some((item) => item.id === "number_card")).toBe(true);
    expect(visible.some((item) => item.id === "realtime_mini_chart")).toBe(true);
    expect(new Set(visible.filter((item) => item.category === "chart").map((item) => item.id))).toEqual(new Set([
      "realtime_mini_chart",
      "multi_telemetry_chart",
      "telemetry_chart",
    ]));
  });

  it("supports grouped search across the expanded widget catalog", () => {
    const matches = listWidgetDefinitions("biểu đồ");
    expect(matches.some((item) => item.id === "telemetry_chart")).toBe(true);
    expect(matches.some((item) => item.category === "chart")).toBe(true);
  });

  it("includes hidden widgets when requested", () => {
    const all = listWidgetDefinitions("", true);
    expect(all.some((item) => item.id === "line_chart")).toBe(true);
    expect(all.some((item) => item.id === "circular_gauge")).toBe(true);
  });

  it("exposes binding compatibility metadata from the registry", () => {
    expect(resolveWidgetDefinition("toggle_switch").datastream).toEqual({
      dataTypes: ["boolean"],
      directions: ["command", "bidirectional"],
    });
    expect(resolveWidgetDefinition("slider_control").datastream).toEqual({
      dataTypes: ["integer", "double"],
      directions: ["command", "bidirectional"],
      virtualOnly: true,
    });
    expect(resolveWidgetDefinition("multi_telemetry_chart").datastream?.virtualOnly).toBe(true);
    expect(resolveWidgetDefinition("segmented_control").datastream?.virtualOnly).toBe(true);
    expect(resolveWidgetDefinition("telemetry_chart").datastream?.dataTypes).toEqual(["integer", "double"]);
  });

  it("keeps maxDataPoints visible for every canonical chart range", () => {
    const definition = resolveWidgetDefinition("telemetry_chart");
    for (const timeRange of ["live", "6h", "1d", "1w", "1m"]) {
      const draft = buildWidgetDraft("telemetry_chart");
      draft.config.timeRange = timeRange;
      const keys = getVisibleWidgetEditorFields(definition, draft).map((field) => field.key);
      expect(keys).toContain("maxDataPoints");
    }
  });

  it("provides nested translations for widget configuration labels and options", () => {
    const viUi = viProjects.editor.ui;
    const enUi = enProjects.editor.ui;

    expect(viUi.field.min).toBe("Tối thiểu");
    expect(enUi.field.min).toBe("Minimum");
    expect(viUi.option.chartType.line).toBe("Đường");
    expect(enUi.option.chartType.line).toBe("Line");
    expect(viUi.option.displayStyle.circular).toBe("Hình tròn");
    expect(enUi.option.displayStyle.circular).toBe("Circular");
    expect(viUi.dynamic.channel_color).toBe("Màu kênh telemetry");
    expect(enUi.dynamic.channel_color).toBe("Telemetry channel color");
    expect(viUi.placeholder.text).toBe("Nhập ghi chú hoặc nhãn hiển thị");
    expect(enUi.placeholder.text).toBe("Display note or label");
    expect(viUi.select).toBe("Chọn");
    expect(enUi.select).toBe("Select");
  });

  it("resolves widget configuration keys through the configured i18n instance", async () => {
    const previousLanguage = i18n.language;
    await i18n.changeLanguage("vi");
    expect(i18n.t("projects:editor.ui.field.min")).toBe("Tối thiểu");
    expect(i18n.t("projects:editor.ui.option.timeRange.1d")).toBe("1 ngày");
    expect(i18n.t("projects:editor.ui.placeholder.text")).toBe("Nhập ghi chú hoặc nhãn hiển thị");

    await i18n.changeLanguage("en");
    expect(i18n.t("projects:editor.ui.field.min")).toBe("Minimum");
    expect(i18n.t("projects:editor.ui.option.timeRange.1d")).toBe("1 day");
    expect(i18n.t("projects:editor.ui.placeholder.text")).toBe("Display note or label");
    await i18n.changeLanguage(previousLanguage);
  });
});
