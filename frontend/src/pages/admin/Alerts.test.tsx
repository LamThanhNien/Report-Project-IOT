import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Alerts } from "./Alerts";
import * as alertApi from "../../services/alertApi";
import type { Alert } from "../../types";

vi.mock("../../services/alertApi");

beforeEach(() => {
  vi.clearAllMocks();
});

const ALERT: Alert = {
  id: "alert-1",
  severity: "critical",
  status: "open",
  title: "Anomaly detected on Lab Node",
  message: "temperature=91 was classified as anomalous",
  device_uid: "esp32-lab-1",
  source: "anomaly",
  source_type: "anomaly",
  source_id: "event-1",
  timestamp: "2026-06-18T08:00:00Z",
  tenant: { id: "tenant-1", name: "AIFOM Lab" },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Alerts /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Admin Alerts page", () => {
  it("renders tenant alerts without exposing lifecycle mutations", async () => {
    vi.mocked(alertApi.listAlerts).mockResolvedValue([ALERT]);
    renderPage();

    fireEvent.click(await screen.findByText(ALERT.title));
    expect(alertApi.listAlerts).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Xác nhận/i })).not.toBeInTheDocument();
    expect(alertApi.acknowledgeAlert).not.toHaveBeenCalled();
    expect(alertApi.resolveAlert).not.toHaveBeenCalled();
  });

  it("refetches persistent alerts when Refresh is clicked", async () => {
    vi.mocked(alertApi.listAlerts).mockResolvedValue([ALERT]);
    renderPage();

    await screen.findByText(ALERT.title);
    fireEvent.click(screen.getByRole("button", { name: /Làm mới/i }));

    await waitFor(() => expect(alertApi.listAlerts).toHaveBeenCalledTimes(2));
  });
});
