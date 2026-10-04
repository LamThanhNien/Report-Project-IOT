import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientTelemetry } from "./ClientTelemetry";
import * as clientApi from "../../../services/clientApi";

vi.mock("../../../services/clientApi");
vi.mock("../../../contexts/FeatureContext", () => ({
  useFeature: () => ({ featuresReady: true, hasFeature: () => true }),
}));
vi.mock("../../../components/charts/TelemetryChart", () => ({
  TelemetryChart: ({ metricName }: { metricName: string }) => <div aria-label="telemetry-chart">{metricName}</div>,
}));

const records = [{ id: "record-1", device_uid: "esp32-1", metric_name: "temperature", metric_value: 25.5, unit: "°C", timestamp: "2026-10-01T00:00:00Z" }];

function renderPage(projectId = "project-1") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={queryClient}><ClientTelemetry scopedProjectId={projectId} /></QueryClientProvider></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clientApi.listClientDevices).mockResolvedValue([{ id: "device-1", name: "Sensor", device_uid: "esp32-1" }] as never);
  vi.mocked(clientApi.getClientDeviceTelemetry).mockImplementation(async (_uid, options) => {
    const limit = typeof options === "number" ? options : options?.limit;
    // The tenant telemetry endpoint rejects raw requests above 1,000 records.
    if (limit !== undefined && limit > 1000) throw new Error("422: limit must be at most 1000");
    return records as never;
  });
});

describe("Client telemetry controls", () => {
  it("keeps the device list scoped and sends the selected chart range and aggregate", async () => {
    renderPage();
    await screen.findByRole("option", { name: "Sensor (esp32-1)" });
    expect(clientApi.listClientDevices).toHaveBeenCalledWith("project-1");
    fireEvent.change(screen.getByRole("combobox", { name: /Chọn thiết bị|Select device/i }), { target: { value: "esp32-1" } });
    expect(await screen.findByLabelText("telemetry-chart")).toHaveTextContent("temperature");
    expect(screen.getByRole("combobox", { name: /Tổng hợp|Aggregate/i })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: /Khoảng thời gian|Time range/i }), { target: { value: "1d" } });
    fireEvent.change(screen.getByRole("combobox", { name: /Tổng hợp|Aggregate/i }), { target: { value: "max" } });
    await waitFor(() => expect(clientApi.getClientDeviceTelemetry).toHaveBeenCalledWith("esp32-1", { metric_name: "temperature", time_range: "1d", aggregate: "max", limit: 1000 }));
  });

  it("shows a retry state for a failed chart while retaining the metric summary", async () => {
    vi.mocked(clientApi.getClientDeviceTelemetry).mockImplementation(async (_uid, options) => {
      if (typeof options === "object" && options.metric_name) throw new Error("Unavailable");
      return records as never;
    });
    renderPage();
    await screen.findByRole("option", { name: "Sensor (esp32-1)" });
    fireEvent.change(screen.getByRole("combobox", { name: /Chọn thiết bị|Select device/i }), { target: { value: "esp32-1" } });
    expect(await screen.findByText(/Không thể tải biểu đồ telemetry|Unable to load telemetry chart/i)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "temperature" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thử lại|Retry/i })).toBeInTheDocument();
  });
});
