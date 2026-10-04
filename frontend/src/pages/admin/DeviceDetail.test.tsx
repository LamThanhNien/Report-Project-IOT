import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DeviceDetail } from "./DeviceDetail";
import * as deviceApi from "../../services/deviceApi";
import * as otaApi from "../../services/otaApi";
import * as firmwareApi from "../../services/firmwareApi";
import * as alertApi from "../../services/alertApi";

vi.mock("../../services/deviceApi");
vi.mock("../../services/otaApi");
vi.mock("../../services/firmwareApi");
vi.mock("../../services/alertApi");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/console/devices/esp32-lab-1"]}>
        <Routes><Route path="/console/devices/:deviceUid" element={<DeviceDetail />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Admin Device Detail", () => {
  it("shows RSSI, uptime, and persistent operational alerts", async () => {
    vi.mocked(deviceApi.getDeviceStatus).mockResolvedValue({
      device_uid: "esp32-lab-1", name: "Lab Node", firmware_version: "1.0.0", status: "online",
      rssi: -61, uptime_ms: 7_200_000, last_seen_at: "2026-06-18T08:00:00Z",
      tenant: { id: "tenant-1", name: "Tenant 1", slug: "tenant-1" },
    });
    vi.mocked(deviceApi.getDeviceTelemetry).mockResolvedValue([]);
    vi.mocked(otaApi.listOtaJobs).mockResolvedValue([]);
    vi.mocked(firmwareApi.listFirmware).mockResolvedValue([]);
    vi.mocked(alertApi.listAlerts).mockResolvedValue([{
      id: "alert-1", severity: "critical", status: "open", title: "Automation alert on Lab Node",
      message: "temperature exceeded automation threshold", device_uid: "esp32-lab-1", source: "automation",
      timestamp: "2026-06-18T08:00:00Z",
    }]);
    renderPage();

    expect(await screen.findAllByText("-61 dBm")).toHaveLength(2);
    expect(screen.getAllByText("2h 0m")).toHaveLength(2);

    fireEvent.click(screen.getByText("Sự kiện"));
    expect(await screen.findByText("Automation alert on Lab Node")).toBeInTheDocument();
    expect(screen.getByText("Automation alert on Lab Node")).toBeInTheDocument();
  });

  it("does not expose tenant device command controls", async () => {
    vi.mocked(deviceApi.getDeviceStatus).mockResolvedValue({
      device_uid: "esp32-lab-1", name: "Lab Node", firmware_version: "1.0.0", status: "online",
      rssi: -61, uptime_ms: 7_200_000, last_seen_at: "2026-06-18T08:00:00Z",
      tenant: { id: "tenant-1", name: "Tenant 1", slug: "tenant-1" },
    });
    vi.mocked(deviceApi.getDeviceTelemetry).mockResolvedValue([]);
    vi.mocked(otaApi.listOtaJobs).mockResolvedValue([]);
    vi.mocked(firmwareApi.listFirmware).mockResolvedValue([]);
    vi.mocked(alertApi.listAlerts).mockResolvedValue([]);
    renderPage();

    await screen.findAllByText("-61 dBm");
    expect(screen.queryByText("Khởi động lại")).not.toBeInTheDocument();
    expect(screen.queryByText("Bảo trì")).not.toBeInTheDocument();
    expect(screen.getByText("Chỉ đọc · Admin không điều khiển thiết bị tenant")).toBeInTheDocument();
  });
});
