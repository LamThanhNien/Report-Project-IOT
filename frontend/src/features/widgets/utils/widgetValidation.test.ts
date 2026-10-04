import { describe, expect, it } from "vitest";
import { buildWidgetDraft, normalizeWidgetConfig } from "./widgetDefaults";
import { validateWidgetDraft } from "./widgetValidation";

describe("validateWidgetDraft", () => {
  it("requires a physical capability by default for bound widgets", () => {
    const draft = buildWidgetDraft("toggle_switch");
    draft.title = "";
    draft.binding.binding_type = "physical";
    expect(validateWidgetDraft(draft)).toEqual([
      "Title is required.",
      "Assigned device is required.",
      "A command capability is required.",
      "A telemetry field is required.",
    ]);
  });

  it("requires virtual datastream parameters by default for virtual widgets", () => {
    const draft = buildWidgetDraft("toggle_switch");
    draft.title = "";
    draft.binding.binding_type = "virtual";
    expect(validateWidgetDraft(draft)).toEqual([
      "Title is required.",
      "Assigned device is required.",
      "A virtual pin (Datastream) is required.",
    ]);
  });

  it("accepts a virtual command binding", () => {
    const draft = buildWidgetDraft("toggle_switch");
    draft.binding = {
      binding_type: "virtual",
      device_id: "device-1",
      datastream_id: "stream-1",
      command: "virtual_write",
      channel: "v2",
    };
    expect(validateWidgetDraft(draft)).toEqual([]);
  });

  it("accepts a physical hardware binding without a datastream", () => {
    const draft = buildWidgetDraft("toggle_switch");
    draft.binding = {
      binding_type: "physical",
      device_id: "device-1",
      capability_key: "relay_1",
      state_key: "relay_1_state",
    };
    expect(validateWidgetDraft(draft)).toEqual([]);
  });

  it("allows static widgets without device bindings", () => {
    const draft = buildWidgetDraft("project_info_card");
    expect(validateWidgetDraft(draft)).toEqual([]);
  });

  it("catches inverted numeric ranges", () => {
    const draft = buildWidgetDraft("threshold_alert_card");
    draft.title = "Alarm";
    draft.binding.device_id = "device-1";
    draft.binding.feedback_key = "temperature";
    draft.config.min = 100;
    draft.config.max = 0;
    expect(validateWidgetDraft(draft)).toContain("Minimum value cannot be greater than maximum value.");
  });

  it("validates thresholds based on above/below condition", () => {
    const draft = buildWidgetDraft("threshold_alert_card");
    draft.title = "Alarm";
    draft.binding.device_id = "device-1";
    draft.binding.feedback_key = "temperature";

    // above condition (default) warning > danger is error
    draft.config.thresholdCondition = "above";
    draft.config.warningThreshold = 90;
    draft.config.dangerThreshold = 70;
    expect(validateWidgetDraft(draft)).toContain("Warning threshold cannot be greater than danger threshold when monitoring rising values.");

    // above condition warning <= danger is valid
    draft.config.warningThreshold = 70;
    draft.config.dangerThreshold = 90;
    expect(validateWidgetDraft(draft)).not.toContain("Warning threshold cannot be greater than danger threshold when monitoring rising values.");

    // below condition warning < danger is error
    draft.config.thresholdCondition = "below";
    draft.config.warningThreshold = 10;
    draft.config.dangerThreshold = 30;
    expect(validateWidgetDraft(draft)).toContain("Warning threshold cannot be less than danger threshold when monitoring falling values.");

    // below condition warning >= danger is valid
    draft.config.warningThreshold = 30;
    draft.config.dangerThreshold = 10;
    expect(validateWidgetDraft(draft)).not.toContain("Warning threshold cannot be less than danger threshold when monitoring falling values.");
  });

  it("blocks physical bindings for numeric controls", () => {
    const draft = buildWidgetDraft("slider_control");
    draft.title = "Dimmer";
    draft.binding = {
      binding_type: "physical",
      device_id: "device-1",
      capability_key: "relay_1",
    };
    expect(validateWidgetDraft(draft)).toContain("This widget only supports a Virtual Datastream binding.");
  });

  it("blocks physical bindings for a multi telemetry chart", () => {
    const draft = buildWidgetDraft("multi_telemetry_chart");
    draft.title = "Telemetry";
    draft.binding = { binding_type: "physical", device_id: "device-1" };
    expect(validateWidgetDraft(draft)).toContain("This widget only supports a Virtual Datastream binding.");
  });

  it("checks selected datastream type and direction in the editor", () => {
    const draft = buildWidgetDraft("telemetry_chart");
    draft.title = "Temperature";
    draft.binding = { binding_type: "virtual", device_id: "device-1", datastream_id: "stream-1" };
    expect(validateWidgetDraft(draft, { data_type: "boolean", direction: "command" })).toEqual([
      "Selected Datastream type must be one of integer, double.",
      "Selected Datastream direction must be one of telemetry, bidirectional.",
    ]);
  });

  it("normalizes legacy chart aliases before a widget is saved", () => {
    expect(normalizeWidgetConfig("line_chart", { timeRange: "15m", aggregation: "latest" })).toEqual({
      timeRange: "live",
      aggregation: "avg",
    });
  });
});
