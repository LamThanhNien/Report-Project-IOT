import { lazy, Suspense } from "react";
import { BrowserRouter, Outlet, Route, Routes, Navigate, useParams } from "react-router-dom";

function NavigateToWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  return <Navigate to={`/client/workspace/${projectId}/home`} replace />;
}
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../contexts/AuthContext";
import { ThemeProvider } from "../contexts/ThemeContext";
import { ConfirmProvider } from "../contexts/ConfirmContext";
import { ToastProvider } from "../contexts/ToastContext";
import { FeatureProvider } from "../contexts/FeatureContext";
import { AdminRoute, ClientRoute } from "../components/ProtectedRoute";
import { AppShell } from "../components/layout/AppShell";
import { ClientLayout } from "../components/layout/ClientLayout";
import { WorkspaceLayout } from "../components/layout/WorkspaceLayout";
const WorkspaceDevices = lazy(() => import("../pages/client/workspace/WorkspaceDevices").then(m => ({ default: m.WorkspaceDevices })));
const WorkspaceOta = lazy(() => import("../pages/client/workspace/WorkspaceOta").then(m => ({ default: m.WorkspaceOta })));
const WorkspaceCommands = lazy(() => import("../pages/client/workspace/WorkspaceCommands").then(m => ({ default: m.WorkspaceCommands })));
const WorkspaceAutomation = lazy(() => import("../pages/client/workspace/WorkspaceAutomation").then(m => ({ default: m.WorkspaceAutomation })));
const WorkspaceAutomationBuilder = lazy(() => import("../pages/client/workspace/WorkspaceAutomationBuilder"));
const WorkspaceAlerts = lazy(() => import("../pages/client/workspace/WorkspaceAlerts").then(m => ({ default: m.WorkspaceAlerts })));
const WorkspaceTelemetry = lazy(() => import("../pages/client/workspace/WorkspaceTelemetry").then(m => ({ default: m.WorkspaceTelemetry })));
const WorkspaceDatastreams = lazy(() => import("../pages/client/workspace/WorkspaceDatastreams").then(m => ({ default: m.WorkspaceDatastreams })));
import { DebugLoggerProvider } from "../components/DebugLoggerProvider";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { PermissionGate } from "../components/permissions/PermissionGate";
import { useAuth } from "../contexts/AuthContext";
import { queryClient } from "../lib/queryClient";
import {
  loadClientOtaRoute,
  loadFirmwareRoute,
  loadProjectsRoute,
  loadTelemetryRoute,
  loadWorkspaceHomeRoute,
} from "./routePrefetch";

const WorkspaceHome = lazy(() => loadWorkspaceHomeRoute().then(m => ({ default: m.WorkspaceHome })));

// Lazy-loaded page components — split into separate chunks
const Login = lazy(() => import("../pages/auth/Login").then(m => ({ default: m.Login })));
const Register = lazy(() => import("../pages/auth/Register").then(m => ({ default: m.Register })));

// Admin pages
const Dashboard = lazy(() => import("../pages/admin/Dashboard").then(m => ({ default: m.Dashboard })));
const Devices = lazy(() => import("../pages/admin/Devices").then(m => ({ default: m.Devices })));
const DeviceDetail = lazy(() => import("../pages/admin/DeviceDetail").then(m => ({ default: m.DeviceDetail })));
const Firmware = lazy(() => loadFirmwareRoute().then(m => ({ default: m.Firmware })));
const OtaJobs = lazy(() => import("../pages/admin/OtaJobs").then(m => ({ default: m.OtaJobs })));

const Telemetry = lazy(() => loadTelemetryRoute().then(m => ({ default: m.Telemetry })));
const Alerts = lazy(() => import("../pages/admin/Alerts").then(m => ({ default: m.Alerts })));

const System = lazy(() => import("../pages/admin/System").then(m => ({ default: m.System })));
const Settings = lazy(() => import("../pages/admin/Settings").then(m => ({ default: m.Settings })));

// Admin - tenant management
const Tenants = lazy(() => import("../pages/admin/Tenants").then(m => ({ default: m.Tenants })));
const TenantDetail = lazy(() => import("../pages/admin/TenantDetail").then(m => ({ default: m.TenantDetail })));
const AdminProjectDetail = lazy(() => import("../pages/admin/AdminProjectDetail").then(m => ({ default: m.AdminProjectDetail })));
const AuditLogs = lazy(() => import("../pages/admin/AuditLogs").then(m => ({ default: m.AuditLogs })));
const Platforms = lazy(() => import("../pages/admin/Platforms").then(m => ({ default: m.Platforms })));
const AdminDeviceGroups = lazy(() => import("../pages/admin/AdminDeviceGroups").then(m => ({ default: m.default })));
const AdminProvisioning = lazy(() => import("../pages/admin/AdminProvisioning").then(m => ({ default: m.default })));
const AdminCommandHistory = lazy(() => import("../pages/admin/AdminCommandHistory").then(m => ({ default: m.default })));



// Client portal pages
const ClientDashboard = lazy(() => import("../pages/client/projects/ClientDashboard").then(m => ({ default: m.ClientDashboard })));
const ClientDevices = lazy(() => import("../pages/client/projects/ClientDevices").then(m => ({ default: m.ClientDevices })));
const ClientDeviceDetail = lazy(() => import("../pages/client/projects/ClientDeviceDetail").then(m => ({ default: m.ClientDeviceDetail })));
const ClientOta = lazy(() => loadClientOtaRoute().then(m => ({ default: m.ClientOta })));
const ClientAlerts = lazy(() => import("../pages/client/projects/ClientAlerts").then(m => ({ default: m.ClientAlerts })));
const ClientUsers = lazy(() => import("../pages/client/projects/ClientUsers").then(m => ({ default: m.ClientUsers })));
const ClientDeviceOnboarding = lazy(() => import("../pages/client/projects/ClientDeviceOnboarding").then(m => ({ default: m.ClientDeviceOnboarding })));
const ClientFirmwareHistory = lazy(() => import("../pages/client/projects/ClientFirmwareHistory").then(m => ({ default: m.ClientFirmwareHistory })));
const ClientTelemetry = lazy(() => import("../pages/client/projects/ClientTelemetry").then(m => ({ default: m.ClientTelemetry })));
const ClientApiAccess = lazy(() => import("../pages/client/projects/ClientApiAccess").then(m => ({ default: m.ClientApiAccess })));
const ClientAccount = lazy(() => import("../pages/client/projects/ClientAccount").then(m => ({ default: m.ClientAccount })));
const ClientAuditLogs = lazy(() => import("../pages/client/projects/ClientAuditLogs").then(m => ({ default: m.ClientAuditLogs })));
const ClientDeviceGroups = lazy(() => import("../pages/client/projects/ClientDeviceGroups").then(m => ({ default: m.default })));
const ClientProvisioning = lazy(() => import("../pages/client/projects/ClientProvisioning").then(m => ({ default: m.default })));
const ClientCommandCenter = lazy(() => import("../pages/client/projects/ClientCommandCenter").then(m => ({ default: m.default })));
const ClientAutomation = lazy(() => import("../pages/client/projects/ClientAutomation").then(m => ({ default: m.default })));
const ClientAutomationBuilder = lazy(() => import("../pages/client/projects/ClientAutomationBuilder").then(m => ({ default: m.default })));
const ProjectsList = lazy(() => loadProjectsRoute().then(m => ({ default: m.ProjectsList })));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-app">
      <div className="flex items-center gap-3 text-slate-400 text-sm">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
        </svg>
        Đang tải…
      </div>
    </div>
  );
}

function FeatureAwareProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <FeatureProvider role={user?.role ?? null}>{children}</FeatureProvider>;
}

function RequirePermission({
  permission,
  anyOf,
  children,
}: {
  permission?: React.ComponentProps<typeof PermissionGate>["permission"];
  anyOf?: React.ComponentProps<typeof PermissionGate>["anyOf"];
  children: React.ReactNode;
}) {
  return (
    <PermissionGate permission={permission} anyOf={anyOf}>
      {children}
    </PermissionGate>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
        <ConfirmProvider>
        <BrowserRouter future={{ v7_startTransition: true }}>
          <AuthProvider>
            <DebugLoggerProvider>
            <FeatureAwareProvider>
              <ErrorBoundary>
              <Routes>
                {/* Authentication entry points */}
                <Route element={<Suspense fallback={<PageLoader />}><Outlet /></Suspense>}>
                  <Route index element={<Navigate to="/login" replace />} />
                  <Route path="login" element={<Login />} />
                  <Route path="register" element={<Register />} />
                </Route>

                {/* Admin / operator console */}
                <Route element={<AdminRoute />}>
                  <Route element={<AppShell />}>
                    <Route path="console" element={<Dashboard />} />
                    <Route path="console/devices" element={<Devices />} />
                    <Route path="console/devices/:deviceUid" element={<DeviceDetail />} />
                    <Route path="console/firmware" element={<Firmware />} />
                    <Route path="console/ota" element={<OtaJobs />} />
                    <Route path="console/ota/new" element={<Navigate to="/console/ota" replace />} />
                    <Route path="console/ota-jobs" element={<Navigate to="/console/ota" replace />} />
                    <Route path="console/telemetry" element={<Telemetry />} />
                    <Route path="console/alerts" element={<Alerts />} />

                    <Route path="console/system" element={<System />} />
                    <Route path="console/settings" element={<Settings />} />
                    {/* Platform management */}
                    <Route path="console/admin/tenants" element={<Tenants />} />
                    <Route path="console/admin/tenants/:id" element={<TenantDetail />} />
                    <Route path="console/admin/tenants/:tenantId/projects/:projectId" element={<AdminProjectDetail />} />
                    <Route path="console/admin/audit-logs" element={<AuditLogs />} />
                    <Route path="console/admin/platforms" element={<Platforms />} />
                    <Route path="console/admin/device-models" element={<Navigate to="/console/admin/platforms" replace />} />
                    <Route path="console/admin/capability-templates" element={<Navigate to="/console/admin/platforms" replace />} />
                    <Route path="console/admin/audit-timeline" element={<Navigate to="/console/admin/audit-logs?view=timeline" replace />} />
                    <Route path="console/admin/device-groups" element={<AdminDeviceGroups />} />
                    <Route path="console/admin/provisioning" element={<AdminProvisioning />} />
                    <Route path="console/admin/commands" element={<AdminCommandHistory />} />
                    {/* Giu URL admin cu sau lop auth, roi dua ve namespace console moi. */}
                    <Route path="devices" element={<Navigate to="/console/devices" replace />} />
                    <Route path="devices/:deviceUid" element={<DeviceDetail />} />
                    <Route path="firmware" element={<Navigate to="/console/firmware" replace />} />
                    <Route path="ota" element={<Navigate to="/console/ota" replace />} />
                    <Route path="ota/new" element={<Navigate to="/console/ota/new" replace />} />
                    <Route path="ota-jobs" element={<Navigate to="/console/ota" replace />} />
                    <Route path="telemetry" element={<Navigate to="/console/telemetry" replace />} />
                    <Route path="alerts" element={<Navigate to="/console/alerts" replace />} />

                    <Route path="system" element={<Navigate to="/console/system" replace />} />
                    <Route path="settings" element={<Navigate to="/console/settings" replace />} />
                    <Route path="admin/tenants" element={<Navigate to="/console/admin/tenants" replace />} />
                    <Route path="admin/tenants/:id" element={<TenantDetail />} />
                    <Route path="admin/tenants/:tenantId/projects/:projectId" element={<AdminProjectDetail />} />
                    <Route path="admin/audit-logs" element={<Navigate to="/console/admin/audit-logs" replace />} />
                    <Route path="admin/platforms" element={<Navigate to="/console/admin/platforms" replace />} />
                    <Route path="admin/device-models" element={<Navigate to="/console/admin/platforms" replace />} />
                    <Route path="admin/capability-templates" element={<Navigate to="/console/admin/platforms" replace />} />
                  </Route>
                </Route>

                {/* Client / tenant portal */}
                <Route element={<ClientRoute />}>
                  <Route element={<ClientLayout />}>
                    <Route path="client/dashboard" element={<RequirePermission permission="dashboard.view"><ClientDashboard /></RequirePermission>} />
                    <Route path="client/devices" element={<RequirePermission permission="devices.view"><ClientDevices /></RequirePermission>} />
                    <Route path="client/devices/onboard" element={<RequirePermission permission="devices.manage"><ClientDeviceOnboarding /></RequirePermission>} />
                    <Route path="client/devices/:deviceUid" element={<RequirePermission permission="devices.view"><ClientDeviceDetail /></RequirePermission>} />
                    <Route path="client/projects" element={<RequirePermission permission="projects.view"><ProjectsList /></RequirePermission>} />
                    <Route path="client/projects/:projectId" element={<NavigateToWorkspace />} />
                    <Route path="client/ota" element={<RequirePermission anyOf={["firmware.view", "ota.view"]}><ClientOta /></RequirePermission>} />
                    <Route path="client/firmware-history" element={<RequirePermission permission="firmware.view"><ClientFirmwareHistory /></RequirePermission>} />
                    <Route path="client/telemetry" element={<RequirePermission permission="monitoring.view"><ClientTelemetry /></RequirePermission>} />
                    <Route path="client/alerts" element={<RequirePermission permission="monitoring.view"><ClientAlerts /></RequirePermission>} />
                    <Route path="client/account" element={<ClientAccount />} />
                    <Route path="client/api-access" element={<RequirePermission permission="settings.view"><ClientApiAccess /></RequirePermission>} />
                    <Route path="client/users" element={<RequirePermission permission="members.view"><ClientUsers /></RequirePermission>} />
                    <Route path="client/audit-logs" element={<ClientAuditLogs />} />
                    <Route path="client/audit-timeline" element={<Navigate to="/client/audit-logs?view=timeline" replace />} />
                    <Route path="client/device-groups" element={<RequirePermission permission="device_groups.view"><ClientDeviceGroups /></RequirePermission>} />
                    <Route path="client/provisioning" element={<RequirePermission permission="devices.view"><ClientProvisioning /></RequirePermission>} />
                    <Route path="client/commands" element={<RequirePermission anyOf={["commands.view", "command_templates.view"]}><ClientCommandCenter /></RequirePermission>} />
                    <Route path="client/command-center" element={<Navigate to="/client/commands" replace />} />
                    <Route path="client/automation" element={<RequirePermission permission="automation.view"><ClientAutomation /></RequirePermission>} />
                    <Route path="client/automation/new" element={<RequirePermission permission="automation.manage"><ClientAutomationBuilder /></RequirePermission>} />
                    <Route path="client/automation/:ruleId/edit" element={<RequirePermission permission="automation.manage"><ClientAutomationBuilder /></RequirePermission>} />
                    <Route path="client/automation/:ruleId" element={<RequirePermission permission="automation.view"><ClientAutomationBuilder readOnly /></RequirePermission>} />
                    <Route path="client/*" element={<Navigate to="/client/dashboard" replace />} />
                  </Route>

                  {/* Page 2 - Dedicated Scoped Project Workspace Layout */}
                  <Route path="client/workspace/:projectId" element={<WorkspaceLayout />}>
                    <Route path="home" element={<RequirePermission permission="projects.view"><WorkspaceHome /></RequirePermission>} />
                    <Route path="devices" element={<RequirePermission permission="devices.view"><WorkspaceDevices /></RequirePermission>} />
                    <Route path="devices/onboard" element={<RequirePermission permission="devices.manage"><ClientDeviceOnboarding /></RequirePermission>} />
                    <Route path="devices/:deviceUid" element={<RequirePermission permission="devices.view"><ClientDeviceDetail /></RequirePermission>} />
                    <Route path="commands" element={<RequirePermission anyOf={["commands.view", "command_templates.view"]}><WorkspaceCommands /></RequirePermission>} />
                    <Route path="automation" element={<RequirePermission permission="automation.view"><WorkspaceAutomation /></RequirePermission>} />
                    <Route path="automation/new" element={<RequirePermission permission="automation.manage"><WorkspaceAutomationBuilder /></RequirePermission>} />
                    <Route path="automation/:ruleId/edit" element={<RequirePermission permission="automation.manage"><WorkspaceAutomationBuilder /></RequirePermission>} />
                    <Route path="automation/:ruleId" element={<RequirePermission permission="automation.view"><WorkspaceAutomationBuilder readOnly /></RequirePermission>} />
                    <Route path="ota" element={<RequirePermission anyOf={["firmware.view", "ota.view"]}><WorkspaceOta /></RequirePermission>} />
                    <Route path="telemetry" element={<RequirePermission permission="monitoring.view"><WorkspaceTelemetry /></RequirePermission>} />
                    <Route path="alerts" element={<RequirePermission permission="monitoring.view"><WorkspaceAlerts /></RequirePermission>} />
                    <Route path="datastreams" element={<RequirePermission permission="projects.view"><WorkspaceDatastreams /></RequirePermission>} />
                    <Route path="*" element={<Navigate to="home" replace />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              </ErrorBoundary>
            </FeatureAwareProvider>
            </DebugLoggerProvider>
          </AuthProvider>
        </BrowserRouter>
        </ConfirmProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
