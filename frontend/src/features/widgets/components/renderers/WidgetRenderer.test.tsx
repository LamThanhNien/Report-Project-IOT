import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChartWidgetRenderer, ControlWidgetRenderer, DisplayWidgetRenderer, mapMultiTelemetry, resolveChartType, resolveTimeRange, timeRangeAxisTicks, timeRangeDurationMs, WidgetChrome } from "./WidgetRenderer";
import { resolveWidgetDefinition } from "../../registry/widgetRegistry";
import type { Device, ProjectWidget } from "../../../../types";

import * as clientApi from "../../../../services/clientApi";
vi.mock("../../../../services/clientApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../../services/clientApi")>(),
  getClientDeviceTelemetry: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clientApi.getClientDeviceTelemetry).mockResolvedValue([]);
});

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const DEVICE: Device = {
  id: "device-1",
  device_uid: "esp32-demo-001",
  name: "Demo Device",
  firmware_version: "1.0.0",
  status: "online",
  last_seen_at: "2026-05-26T06:00:00Z",
  created_at: "2026-05-26T06:00:00Z",
  updated_at: "2026-05-26T06:00:00Z",
};

function widget(partial: Partial<ProjectWidget>): ProjectWidget {
  return {
    id: "widget-1",
    page_id: "page-1",
    widget_type: "toggle_switch",
    title: "Switch",
    sort_order: 0,
    layout: { col_span: 1, row_span: 1 },
    config: {},
    binding: {
      device_id: DEVICE.id,
      device_uid: DEVICE.device_uid,
      command: "set_output",
      capability_key: "relay_1",
      channel: "relay_1",
      state_key: "relay_1_state",
      telemetry_field: "relay_1_state",
      params: { target: "relay_1", value: false },
    },
    created_at: "2026-05-26T06:00:00Z",
    updated_at: "2026-05-26T06:00:00Z",
    ...partial,
  };
}

describe("widget renderers", () => {
  it("resolves the configured chart type for new and legacy widget configs", () => {
    expect(resolveChartType("telemetry_chart", { chartType: "bar" })).toBe("bar");
    expect(resolveChartType("telemetry_chart", { chart_type: "area" })).toBe("area");
    expect(resolveChartType("telemetry_chart", { chartType: " LINE " })).toBe("line");
    expect(resolveChartType("realtime_mini_chart", {})).toBe("bar");
  });

  it("normalizes configured time ranges to the chart axis ranges", () => {
    expect(resolveTimeRange("15m")).toBe("live");
    expect(resolveTimeRange("6h")).toBe("6h");
    expect(resolveTimeRange("1h")).toBe("6h");
    expect(resolveTimeRange("24h")).toBe("1d");
    expect(resolveTimeRange("7d")).toBe("1w");
  });

  it("keeps historical chart axes anchored to the selected range", () => {
    const end = Date.UTC(2026, 6, 20, 12, 0, 0);

    expect(timeRangeDurationMs("6h")).toBe(6 * 60 * 60 * 1000);
    expect(timeRangeDurationMs("1d")).toBe(24 * 60 * 60 * 1000);
    expect(timeRangeDurationMs("1w")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(timeRangeDurationMs("1m")).toBe(30 * 24 * 60 * 60 * 1000);
    expect(timeRangeDurationMs("live")).toBeNull();

    const ticks = timeRangeAxisTicks("6h", 400, false, end);
    expect(ticks[0]).toBe(end - 6 * 60 * 60 * 1000);
    expect(ticks[ticks.length - 1]).toBe(end);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps an early missing channel empty while retaining the configured channel key", () => {
    const series = mapMultiTelemetry([
      [{ timestamp: "2026-09-06T14:15:35Z", metric_name: "temperature", metric_value: 32 }],
      [
        { timestamp: "2026-09-06T14:14:15Z", metric_name: "humidity", metric_value: 67 },
        { timestamp: "2026-09-06T14:15:35Z", metric_name: "humidity", metric_value: 68 },
      ],
    ] as never, ["ch_v1", "ch_v2"], "live");

    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ ch_v2: 67 });
    expect(series[0]).not.toHaveProperty("ch_v1");
    expect(series[1]).toMatchObject({ ch_v1: 32, ch_v2: 68 });
  });

  it("renders display widgets with formatted values", () => {
    render(
      <DisplayWidgetRenderer
        widget={widget({
          widget_type: "number_card",
          config: { unit: "°C", decimalPlaces: 1 },
          binding: {
            device_id: DEVICE.id,
            device_uid: DEVICE.device_uid,
            state_key: "temperature",
            telemetry_field: "temperature",
          },
        })}
        definition={resolveWidgetDefinition("number_card")}
        device={DEVICE}
        latestState={{ relay_1_state: 0, temperature: 23.456 }}
        visualState={{ status: "online", message: "Live" }}
        onCommand={() => undefined}
      />,
    );

    expect(screen.getByText("23.5 °C")).toBeInTheDocument();
  });

  it("renders control widgets and emits command requests", () => {
    const onCommand = vi.fn();
    render(
      <ControlWidgetRenderer
        widget={widget({ widget_type: "toggle_switch", title: "Pump" })}
        definition={resolveWidgetDefinition("toggle_switch")}
        device={DEVICE}
        latestState={{ relay_1_state: false }}
        visualState={{ status: "online", message: "Live" }}
        onCommand={onCommand}
      />,
    );

    fireEvent.click(screen.getByRole("switch", { name: /pump: off/i }));
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: DEVICE.id,
      command: "set_output",
      widgetId: "widget-1",
      expectedValue: true,
    }));
  });

  it("renders gauge widget with circular display style", () => {
    render(
      <DisplayWidgetRenderer
        widget={widget({
          widget_type: "gauge_widget",
          config: { min: 0, max: 100, decimalPlaces: 1, color: "#2563eb", displayStyle: "circular", unit: "°C" },
          binding: { device_id: DEVICE.id, device_uid: DEVICE.device_uid, state_key: "temperature", telemetry_field: "temperature" },
        })}
        definition={resolveWidgetDefinition("gauge_widget")}
        device={DEVICE}
        latestState={{ temperature: 42.5 }}
        visualState={{ status: "online", message: "Live" }}
        onCommand={() => undefined}
      />,
    );

    expect(screen.getByText("42.5 °C")).toBeInTheDocument();
  });

  it("renders legacy circular_gauge through gauge_widget definition", () => {
    const definition = resolveWidgetDefinition("circular_gauge");
    expect(definition.id).toBe("gauge_widget");
  });

  it("renders telemetry chart with bar chartType", async () => {
    renderWithQueryClient(
      <ChartWidgetRenderer
        widget={widget({
          widget_type: "telemetry_chart",
          config: { chartType: "bar", timeRange: "1h", maxDataPoints: 30 },
          binding: { device_id: DEVICE.id, device_uid: DEVICE.device_uid, telemetry_field: "temperature" },
        })}
        definition={resolveWidgetDefinition("telemetry_chart")}
        device={DEVICE}
        latestState={{ temperature: 25 }}
        visualState={{ status: "online", message: "Live" }}
        onCommand={() => undefined}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Chart data could not be loaded|No telemetry points yet|Chưa có dữ liệu/)).toBeInTheDocument();
    });
  });

  it("loads the chart renderer on demand when telemetry is available", async () => {
    vi.mocked(clientApi.getClientDeviceTelemetry).mockResolvedValue([{
      id: "telemetry-1",
      device_id: DEVICE.id,
      device_uid: DEVICE.device_uid,
      timestamp: "2026-10-03T10:00:00Z",
      metric_name: "temperature",
      metric_value: 25.5,
      unit: "°C",
      raw_payload: null,
      created_at: "2026-10-03T10:00:00Z",
    }]);

    const { container } = renderWithQueryClient(
      <ChartWidgetRenderer
        widget={widget({
          widget_type: "telemetry_chart",
          config: { chartType: "line" },
          binding: { device_id: DEVICE.id, device_uid: DEVICE.device_uid, telemetry_field: "temperature" },
        })}
        definition={resolveWidgetDefinition("telemetry_chart")}
        device={DEVICE}
        latestState={{ temperature: 25.5 }}
        visualState={{ status: "online", message: "Live" }}
        onCommand={() => undefined}
      />,
    );

    await waitFor(() => expect(container.querySelector(".recharts-responsive-container")).toBeInTheDocument());
  });

  it.each([
    ["telemetry_chart", 5000, 1000],
    ["multi_telemetry_chart", 5000, 1000],
    ["telemetry_chart", "5000", 1000],
    ["multi_telemetry_chart", "invalid", 60],
    ["telemetry_chart", Number.POSITIVE_INFINITY, 60],
    ["telemetry_chart", 35.8, 35],
  ])("caps API requests for %s with legacy maxDataPoints %s", async (type, maxDataPoints, limit) => {
    renderWithQueryClient(<ChartWidgetRenderer
      widget={widget({ widget_type: type, config: { maxDataPoints }, binding: {
        device_id: DEVICE.id, device_uid: DEVICE.device_uid, telemetry_field: "temperature", channels: ["temperature", "humidity"],
      } })}
      definition={resolveWidgetDefinition(type)} device={DEVICE} latestState={{}}
      visualState={{ status: "online", message: "Live" }} onCommand={() => undefined}
    />);
    await waitFor(() => expect(clientApi.getClientDeviceTelemetry).toHaveBeenCalled());
    for (const [, request] of vi.mocked(clientApi.getClientDeviceTelemetry).mock.calls) {
      if (!request || typeof request === "number") throw new Error("Expected scoped widget telemetry query options");
      expect(request?.limit).toBe(limit);
      expect(Number.isInteger(request?.limit)).toBe(true);
    }
  });

  it("resolves legacy line_chart to telemetry_chart definition", () => {
    const definition = resolveWidgetDefinition("line_chart");
    expect(definition.id).toBe("telemetry_chart");
  });

  it("slider bound to boolean capability sends boolean value", () => {
    const onCommand = vi.fn();
    render(
      <ControlWidgetRenderer
        widget={widget({
          widget_type: "slider_control",
          title: "Dimmer",
          config: { min: 0, max: 100, step: 1 },
          binding: {
            device_id: DEVICE.id,
            device_uid: DEVICE.device_uid,
            command: "set_output",
            capability_key: "relay_1",
            channel: "relay_1",
            gpio_pin: 2,
            params: { target: "relay_1", value: false },
          },
        })}
        definition={resolveWidgetDefinition("slider_control")}
        device={DEVICE}
        latestState={{ relay_1_state: false }}
        visualState={{ status: "online", message: "Live" }}
        onCommand={onCommand}
      />,
    );

    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "75" } });

    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "set_output",
      params: expect.objectContaining({ value: true }),
    }));
  });

  it("segmented control bound to boolean capability sends boolean value", () => {
    const onCommand = vi.fn();
    render(
      <ControlWidgetRenderer
        widget={widget({
          widget_type: "segmented_control",
          title: "Mode",
          config: { optionsCsv: "off,on,auto" },
          binding: {
            device_id: DEVICE.id,
            device_uid: DEVICE.device_uid,
            command: "set_output",
            capability_key: "relay_1",
            channel: "relay_1",
            gpio_pin: 2,
            params: { target: "relay_1", value: false },
          },
        })}
        definition={resolveWidgetDefinition("segmented_control")}
        device={DEVICE}
        latestState={{ relay_1_state: false }}
        visualState={{ status: "online", message: "Live" }}
        onCommand={onCommand}
      />,
    );

    fireEvent.click(screen.getByText("on"));

    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "set_output",
      params: expect.objectContaining({ value: true }),
    }));
  });

  it("closes compact widget details when clicking outside", async () => {
    render(
      <div>
        <WidgetChrome
          widget={widget({ title: "Pump Switch", binding: { ...widget({}).binding, gpio_pin: 2 } })}
          definition={resolveWidgetDefinition("toggle_switch")}
          device={DEVICE}
          visualState={{ status: "offline", message: "Offline" }}
          readOnly={false}
          isEditing={true}
          onEdit={() => undefined}
          onDelete={() => undefined}
        >
          <span>Switch body</span>
        </WidgetChrome>
        <button>Outside target</button>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: /options for pump switch/i }));
    expect(screen.getAllByText("GPIO 2")).toHaveLength(2);

    fireEvent.pointerDown(screen.getByRole("button", { name: /outside target/i }));

    await waitFor(() => {
      expect(screen.getAllByText("GPIO 2")).toHaveLength(1);
    });
  });
});
