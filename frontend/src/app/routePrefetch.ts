import { queryClient } from "../lib/queryClient";
import { getClientProject } from "../services/clientApi";

type RouteModule = Record<string, unknown>;
type RouteLoader = () => Promise<RouteModule>;

export const loadTelemetryRoute = () => import("../pages/admin/Telemetry");
export const loadProjectsRoute = () => import("../pages/client/projects/ProjectsList");
export const loadClientOtaRoute = () => import("../pages/client/projects/ClientOta");
export const loadFirmwareRoute = () => import("../pages/admin/Firmware");
export const loadWorkspaceHomeRoute = () => import("../pages/client/workspace/WorkspaceHome");

const inFlight = new Map<RouteLoader, Promise<RouteModule>>();

function loaderForPath(pathname: string): RouteLoader | undefined {
  if (pathname === "/console/telemetry") return loadTelemetryRoute;
  if (pathname === "/console/firmware") return loadFirmwareRoute;
  if (pathname === "/client/ota") return loadClientOtaRoute;
  if (pathname === "/client/projects") return loadProjectsRoute;
  if (workspaceProjectId(pathname)) return loadWorkspaceHomeRoute;
  return undefined;
}

export function workspaceProjectId(pathname: string): string | undefined {
  const match = pathname.match(/^\/client\/workspace\/([^/]+)\/home\/?$/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

export function prefetchRoute(pathname: string): void {
  const loader = loaderForPath(pathname);
  const projectId = workspaceProjectId(pathname);

  if (projectId) {
    void queryClient.prefetchQuery({
      queryKey: ["client-project-detail", projectId],
      queryFn: () => getClientProject(projectId),
      staleTime: 60_000,
    });
  }

  if (!loader || inFlight.has(loader)) return;

  const request = loader().catch((error) => {
    inFlight.delete(loader);
    throw error;
  });
  inFlight.set(loader, request);
  void request.catch(() => undefined);
}
