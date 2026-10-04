import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Firmware } from "./Firmware";
import * as firmwareApi from "../../services/firmwareApi";

vi.mock("../../services/firmwareApi");

const release = {
  id: "firmware-1", version: "1.2.3", target_device_type: "esp32", file_name: "firmware.bin",
  object_key: "firmware/1.2.3.bin", file_size: 1024, checksum_sha256: "a".repeat(64),
  release_notes: null, is_active: true, source_type: "binary", source_code: null,
  board_fqbn: null, uploaded_by_tenant_id: "tenant-1", release_channel: "stable",
  signature: "signature", signature_alg: "Ed25519", signature_payload: "a".repeat(64),
  signing_key_id: "production-key", signing_public_key: "public-key", signed_at: "2026-06-18T00:00:00Z",
  verification_required: true, created_at: "2026-06-18T00:00:00Z",
} as const;

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}><Firmware showSectionNav={false} /></QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(firmwareApi.listFirmware).mockResolvedValue([release] as never);
});

describe("Admin Firmware read-only UI", () => {
  it("shows tenant firmware without mutation controls", async () => {
    renderPage();

    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    expect(screen.queryByLabelText("Chọn firmware 1.2.3")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xoá đã chọn/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tải firmware/i })).not.toBeInTheDocument();
    expect(firmwareApi.bulkDeleteFirmware).not.toHaveBeenCalled();
  });
});
