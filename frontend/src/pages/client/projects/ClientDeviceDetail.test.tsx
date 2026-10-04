import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ClientDeviceDetail } from "./ClientDeviceDetail";
import * as clientApi from "../../../services/clientApi";
import type { TenantDeviceDetail } from "../../../types";

vi.mock("../../../services/clientApi");
vi.mock("../../../contexts/FeatureContext", () => ({
  useFeature: () => ({
    hasFeature: () => true,
    featuresReady: true,
  }),
}));
vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { role: "tenant_owner" },
  }),
}));

const DETAIL: TenantDeviceDetail = {
  device: {
    id: "device-1",
    device_uid: "esp32-demo-001",
    name: "Greenhouse Node",
    hardware_model: "esp32",
    description: "Irrigation controller",
    firmware_version: "1.2.3",
    status: "online",
    ip_address: "192.168.1.10",
    rssi: -61,
    free_heap: 123456,
    uptime_ms: 987654,
    last_status_payload: { relay_1_state: true },
    last_seen_at: "2026-05-25T09:30:00Z",
    offline_timeout_seconds: 60,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-05-25T09:30:00Z",
  },
  live_status: {
    connection_status: "online",
    mqtt_status: "connected",
    last_telemetry_at: "2026-05-25T09:29:00Z",
    latest_payload: { relay_1_state: true, temperature: 28.5 },
    sensor_values: { temperature: 28.5, humidity: 63.2 },
    output_states: { relay_1_state: true },
    system_values: { rssi: -61, free_heap: 123456, uptime_ms: 987654 },
  },
  device_channel_states: [
    {
      id: "channel-state-1",
      device_id: "device-1",
      channel: "relay_1",
      gpio_pin: 2,
      capability_key: "relay_1",
      capability_type: "digital_output",
      desired_value: true,
      reported_value: true,
      sync_status: "synced",
      last_reported_at: "2026-05-25T09:29:30Z",
      updated_at: "2026-05-25T09:29:30Z",
      telemetry_state_key: "relay_1_state",
    },
  ],
  project_bindings: [
    {
      project_id: "project-1",
      project_name: "Greenhouse Control",
    },
  ],
  recent_telemetry: [
    {
      id: "tel-1",
      device_id: "device-1",
      device_uid: "esp32-demo-001",
      timestamp: "2026-05-25T09:29:00Z",
      metric_name: "temperature",
      metric_value: 28.5,
      unit: "C",
      raw_payload: { temperature: 28.5 },
      created_at: "2026-05-25T09:29:00Z",
    },
  ],
  ota_jobs: [
    {
      id: "ota-1",
      device_id: "device-1",
      device_uid: "esp32-demo-001",
      firmware_version_id: "fw-1",
      firmware_version: "1.2.3",
      status: "sent",
      requested_at: "2026-05-24T10:00:00Z",
      started_at: "2026-05-24T10:01:00Z",
      completed_at: null,
      progress: 50,
      last_message: "Halfway",
      error_message: null,
      created_at: "2026-05-24T10:00:00Z",
      updated_at: "2026-05-24T10:05:00Z",
    },
  ],
  alerts: [
    {
      id: "alert-1",
      device_uid: "esp32-demo-001",
      timestamp: "2026-05-24T08:00:00Z",
      metric_name: "temperature",
      metric_value: 40,
      anomaly_score: 0.91,
      severity: "critical",
    },
  ],
  available_firmware: [
    {
      id: "fw-1",
      version: "1.2.3",
      target_device_type: "esp32",
      file_name: "fw.bin",
      object_key: "esp32/1.2.3/fw.bin",
      file_size: 1024,
      checksum_sha256: "abc",
      release_notes: "Stable release",
      is_active: true,
      source_type: "binary",
      source_code: null,
      board_fqbn: null,
      uploaded_by_tenant_id: "tenant-1",
      created_at: "2026-05-20T00:00:00Z",
    },
  ],
  activity: [
    {
      kind: "command",
      title: "Send Device Command",
      timestamp: "2026-05-24T10:10:00Z",
      severity: null,
      status: "send_device_command",
      detail: { command: "set_output" },
    },
  ],
  can_send_commands: true,
  can_reboot: true,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/client/devices/esp32-demo-001"]}>
        <Routes>
          <Route path="/client/devices/:deviceUid" element={<ClientDeviceDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ClientDeviceDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(clientApi.getClientDeviceDetail).mockResolvedValue(DETAIL);
    vi.mocked(clientApi.listClientDeviceModels).mockResolvedValue([]);
    vi.mocked(clientApi.sendClientDeviceCommand).mockResolvedValue({
      accepted: true,
      request_id: "req-1",
      topic: "devices/esp32-demo-001/commands",
    });
    vi.mocked(clientApi.updateClientDeviceOfflineTimeout).mockResolvedValue({
      device_uid: "esp32-demo-001",
      offline_timeout_seconds: 45,
    });
  });

  it("renders detailed tenant-safe device information", async () => {
    renderPage();

    expect((await screen.findAllByText("Greenhouse Node")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Greenhouse Control").length).toBeGreaterThan(0);
    expect(screen.queryByText(/widget bindings/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Pump Relay")).not.toBeInTheDocument();
    expect(screen.getAllByText(/GPIO 2/i).length).toBeGreaterThan(0);
    expect(screen.getByText("Stable release")).toBeInTheDocument();
  });

  it("allows tenant to update offline timeout", async () => {
    renderPage();

    const timeoutInput = await screen.findByDisplayValue("60");
    fireEvent.change(timeoutInput, { target: { value: "45" } });

    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(clientApi.updateClientDeviceOfflineTimeout).toHaveBeenCalledWith("esp32-demo-001", 45);
    });

    expect(await screen.findByText("Offline timeout updated.")).toBeInTheDocument();
  });

  it("keeps unsaved offline timeout draft after blur", async () => {
    renderPage();

    const timeoutInput = await screen.findByDisplayValue("60");
    fireEvent.change(timeoutInput, { target: { value: "120" } });
    fireEvent.blur(timeoutInput);

    expect(screen.getByDisplayValue("120")).toBeInTheDocument();
    expect(clientApi.updateClientDeviceOfflineTimeout).not.toHaveBeenCalled();
  });

  it("maps stored hardware model name to catalog key in Edit device", async () => {
    vi.mocked(clientApi.getClientDeviceDetail).mockResolvedValue({
      ...DETAIL,
      device: {
        ...DETAIL.device,
        // Backend create path persists model.name, while the select options use model.key.
        hardware_model: "Generic ESP32",
      },
    });
    vi.mocked(clientApi.listClientDeviceModels).mockResolvedValue([
      {
        id: "model-1",
        platform_id: "platform-esp32",
        key: "generic_esp32",
        name: "Generic ESP32",
        description: "ESP32-WROOM-32 DevKit V1",
        gpio_pins_json: {},
        default_capabilities_json: [],
        platform: {
          id: "platform-esp32",
          key: "esp32",
          name: "ESP32 (ESP-IDF)",
          wifi_required: true,
          supports_mqtt: true,
          supports_ota: true,
          supports_gpio_config: true,
        },
      },
    ]);

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Edit/i }));

    const select = await screen.findByDisplayValue(/Generic ESP32/i);
    expect(select).toHaveValue("generic_esp32");
    expect(select).not.toHaveValue("");
  });

  it("renders professional live status telemetry and channel state details", async () => {
    renderPage();

    expect(await screen.findByText("Live status")).toBeInTheDocument();
    expect(screen.getByText("Realtime: Disconnected")).toBeInTheDocument();
    expect(screen.getByText("Source: Polling fallback")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Temperature")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getAllByText("28.5 °C").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/GPIO 2/i).length).toBeGreaterThan(0);
    expect(screen.getByText("synced")).toBeInTheDocument();
    expect(screen.getByText("Backend channel state")).toBeInTheDocument();
    expect(screen.getByText("16m 27s")).toBeInTheDocument();
    expect(screen.getByText("120.6 KB")).toBeInTheDocument();
    expect(screen.getByText("-61 dBm")).toBeInTheDocument();
  });

  it("shows per-command loading and success feedback", async () => {
    renderPage();

    const requestTelemetry = await screen.findByRole("button", { name: /Request telemetry/i });
    fireEvent.click(requestTelemetry);

    expect(requestTelemetry).toBeDisabled();
    await waitFor(() => {
      expect(clientApi.sendClientDeviceCommand).toHaveBeenCalledWith("device-1", {
        command: "request_telemetry",
        params: {},
      });
    });
    expect(await screen.findByText("Accepted")).toBeInTheDocument();
  });

  it("confirms before rebooting the device", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Reboot device/i }));
    expect(await screen.findByText("Reboot device?")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Reboot device" })[1]);

    await waitFor(() => {
      expect(clientApi.sendClientDeviceCommand).toHaveBeenCalledWith("device-1", {
        command: "reboot",
        params: {},
      });
    });
  });
});
