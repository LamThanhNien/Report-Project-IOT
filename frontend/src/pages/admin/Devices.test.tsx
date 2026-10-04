import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { Devices } from "./Devices";
import * as deviceApi from "../../services/deviceApi";
import type { Device } from "../../types";

vi.mock("../../services/deviceApi");

const DEVICE: Device = {
  id: "uuid-1",
  device_uid: "esp32-demo-001",
  name: "Lab Bench Node",
  firmware_version: "0.1.0",
  status: "online",
  last_seen_at: "2026-05-19T10:00:00Z",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

function renderDevices() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Devices />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Devices page", () => {
  it("renders device rows on success", async () => {
    vi.mocked(deviceApi.listDevices).mockResolvedValue([DEVICE]);
    renderDevices();

    expect(await screen.findByText("esp32-demo-001")).toBeInTheDocument();
    expect(screen.getByText("Lab Bench Node")).toBeInTheDocument();
    expect(screen.getByText("online")).toBeInTheDocument();
    expect(screen.getAllByText("0.1.0").length).toBeGreaterThan(0);
  });

  it("renders empty-state when there are no devices", async () => {
    vi.mocked(deviceApi.listDevices).mockResolvedValue([]);
    renderDevices();

    expect(await screen.findByText(/Không có thiết bị phù hợp/i)).toBeInTheDocument();
  });

  it("renders detail link pointing to device uid path", async () => {
    vi.mocked(deviceApi.listDevices).mockResolvedValue([DEVICE]);
    renderDevices();

    const links = await screen.findAllByRole("link", { name: /Chi tiết/i });
    expect(links[0]).toHaveAttribute("href", `/console/devices/${DEVICE.device_uid}`);
  });
});
