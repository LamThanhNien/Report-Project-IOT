import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OtaJobs } from "./OtaJobs";
import * as otaApi from "../../services/otaApi";

vi.mock("../../services/otaApi");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}><OtaJobs showSectionNav={false} /></QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(otaApi.listOtaJobs).mockResolvedValue([]);
});

describe("Admin OTA page", () => {
  it("loads jobs without exposing tenant campaign mutations", async () => {
    renderPage();

    await waitFor(() => expect(otaApi.listOtaJobs).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: /Tạo campaign/i })).not.toBeInTheDocument();
    expect(otaApi.listOtaCampaigns).not.toHaveBeenCalled();
    expect(otaApi.transitionOtaCampaign).not.toHaveBeenCalled();
  });
});
