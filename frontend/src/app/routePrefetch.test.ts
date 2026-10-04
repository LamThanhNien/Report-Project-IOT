import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../lib/queryClient";
import * as clientApi from "../services/clientApi";
import { prefetchRoute, workspaceProjectId } from "./routePrefetch";

vi.mock("../services/clientApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/clientApi")>(),
  getClientProject: vi.fn(),
}));
vi.mock("../pages/client/workspace/WorkspaceHome", () => ({ WorkspaceHome: () => null }));

describe("workspace route prefetch", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
  });

  it("recognizes only a workspace home route", () => {
    expect(workspaceProjectId("/client/workspace/project-1/home")).toBe("project-1");
    expect(workspaceProjectId("/client/workspace/project%202/home/")).toBe("project 2");
    expect(workspaceProjectId("/client/workspace/project-1/devices")).toBeUndefined();
  });

  it("warms the project detail cache before navigation", async () => {
    const detail = { id: "project-1", pages: [], latest_state: {} };
    vi.mocked(clientApi.getClientProject).mockResolvedValue(detail as never);

    prefetchRoute("/client/workspace/project-1/home");

    await waitFor(() => expect(clientApi.getClientProject).toHaveBeenCalledTimes(1));
    expect(queryClient.getQueryData(["client-project-detail", "project-1"])).toEqual(detail);
  });
});
