import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientOta } from "./ClientOta";
import * as clientApi from "../../../services/clientApi";

vi.mock("../../../services/clientApi");
vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", tenant_id: "tenant-1", role: "tenant_owner", permissions: [] } }),
}));
vi.mock("../../../contexts/FeatureContext", () => ({
  useFeature: () => ({ featuresReady: true, hasFeature: () => true }),
}));
vi.mock("../../../services/deviceGroupApi", () => ({
  deviceGroupApi: { listDeviceGroups: vi.fn().mockResolvedValue({ items: [] }) },
}));

const unsignedFirmware = {
  id: "firmware-1", version: "1.2.3", target_device_type: "esp32", file_name: "app.bin",
  object_key: "esp32/1.2.3/app.bin", file_size: 1024, checksum_sha256: "a".repeat(64),
  release_notes: null, is_active: true, uploaded_by_tenant_id: "tenant-1", created_at: "2026-06-19T00:00:00Z",
  source_type: "binary", source_code: null, signature: null,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}><ClientOta /></QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(clientApi.listClientDeviceModels).mockResolvedValue([]);
  vi.mocked(clientApi.listClientFirmware).mockResolvedValue([unsignedFirmware] as never);
  vi.mocked(clientApi.listClientOtaJobs).mockResolvedValue([]);
  vi.mocked(clientApi.listClientDevices).mockResolvedValue([]);
  vi.mocked(clientApi.signClientFirmware).mockResolvedValue({ ...unsignedFirmware, signature: "signed", signature_alg: "Ed25519" } as never);
});

describe("Tenant firmware signing", () => {
  it("lets a tenant manager sign firmware owned by the tenant", async () => {
    renderPage();

    expect(await screen.findByText(/Chưa ký|Unsigned/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thao tác" }));
    fireEvent.click(await screen.findByRole("button", { name: /Ký xác thực|Sign/i }));

    await waitFor(() => expect(clientApi.signClientFirmware).toHaveBeenCalledWith("firmware-1"));
  });
});
