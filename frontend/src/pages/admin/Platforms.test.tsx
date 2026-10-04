import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platforms } from "./Platforms";
import * as platformApi from "../../services/platformApi";

vi.mock("../../services/platformApi");
const platform = { id: "platform-1", key: "esp32", name: "ESP32", description: "Wi-Fi MCU", sdk_toolchain: "ESP-IDF", wifi_required: true, supports_mqtt: true, supports_ota: true, supports_gpio_config: true, created_at: "2026-10-01", updated_at: "2026-10-01" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(platformApi.listPlatforms).mockResolvedValue([platform]);
  vi.mocked(platformApi.listDeviceModels).mockResolvedValue([]);
  vi.mocked(platformApi.listCapabilityTemplates).mockResolvedValue([]);
  vi.mocked(platformApi.createPlatform).mockResolvedValue(platform);
});
function renderPage(readOnly = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><Platforms readOnly={readOnly} /></QueryClientProvider>);
}
describe("Platform registry presentation", () => {
  it("opens platform creation on demand and preserves the API payload", async () => {
    renderPage();
    await screen.findByText("ESP32");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New Platform" }));
    fireEvent.change(screen.getByLabelText("Key"), { target: { value: "esp32" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "ESP32" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(platformApi.createPlatform).toHaveBeenCalledWith(expect.objectContaining({ key: "esp32", name: "ESP32", supports_mqtt: true })));
  });
  it("filters real registry records and supports read-only registry inspection", async () => {
    renderPage(true);
    await screen.findByText("ESP32");
    expect(screen.queryByRole("button", { name: "New Platform" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit ESP32" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search platform registry"), { target: { value: "unmatched" } });
    expect(screen.queryByText("ESP32")).not.toBeInTheDocument();
    expect(platformApi.createPlatform).not.toHaveBeenCalled();
  });
});
