import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePersistedState } from "../../../hooks/usePersistedState";
import type { CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { cn } from "../../../lib/cn";
import {
  createClientProjectWidget,
  createClientProjectPage,
  deleteClientProjectWidget,
  getClientProject,
  getClientProjectRuntimeState,
  listClientDeviceCapabilities,
  listClientDevices,
  sendClientDeviceCommand,
  updateClientProjectWidget,
} from "../../../services/clientApi";
import { listDatastreams } from "../../../services/datastreamApi";
import { ApiError } from "../../../services/apiClient";
import { PageHeader } from "../../../components/ui/PageHeader";
import { Card, CardBody } from "../../../components/ui/Card";
import { Modal } from "../../../components/ui/Modal";
import { Tabs } from "../../../components/ui/Tabs";
import { useAuth } from "../../../contexts/AuthContext";
import { useToast } from "../../../contexts/ToastContext";
import { ReadOnlyNotice } from "../../../components/permissions/PermissionGate";
import { canManageProjects, canSendCommands } from "../../../lib/permissions";
import { Trash2 } from "lucide-react";
import type { Device, DeviceCapability, ProjectWidget } from "../../../types";
import type { WidgetCommandRequest, WidgetDefinition, WidgetDraft, WidgetEditorField, WidgetRuntimeState, WidgetVisualState } from "../../../features/widgets/types";
import { WidgetFieldSections, WidgetTypeSelector, getVisibleWidgetEditorFields } from "../../../features/widgets/components/editors/WidgetConfigEditor";
import { WidgetChrome } from "../../../features/widgets/components/renderers/WidgetRenderer";
import { listWidgetDefinitions, resolveWidgetDefinition } from "../../../features/widgets/registry/widgetRegistry";
import { buildWidgetDraft } from "../../../features/widgets/utils/widgetDefaults";
import {
  bindingTypeFor,
  filterCapabilitiesForWidget,
  normalizeBoolean,
  normalizeNumber,
  parseOptionsCsv,
  stateFieldForBinding,
} from "../../../features/widgets/utils/widgetBindings";
import { validateWidgetDraft } from "../../../features/widgets/utils/widgetValidation";
import { userSafeErrorMessage } from "../../../lib/errorPresentation";
import "../../../styles/widget-canvas.css";
import { DashboardGrid } from "../../../features/widgets/layout/DashboardGrid";
import {
  type GridLayoutData,
} from "../../../features/widgets/layout/gridLayoutUtils";

type ClientProjectWidgetInput = Parameters<typeof createClientProjectWidget>[1];

function bindingForLayoutPersistence(binding: Record<string, unknown>): Record<string, unknown> {
  const deviceId = binding.device_id;
  const deviceUid = binding.device_uid;
  const hasDevice = [deviceId, deviceUid].some((value) =>
    typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null,
  );

  // A palette widget can carry a binding mode before the user assigns a
  // device. The API deliberately accepts an empty binding for these draft
  // widgets, but rejects a standalone `binding_type` without a device.
  return hasDevice ? binding : {};
}

function errorMessage(error: unknown, t?: (key: string, fallback: string) => string): string {
  if (error instanceof ApiError) {
    const msg = userSafeErrorMessage(error);
    if (msg.includes("must be boolean")) {
      return t ? t("projects:editor.err_bool_only", "Thiết bị chỉ hỗ trợ điều khiển ON/OFF. Giá trị đã được chuyển đổi từ dạng khác.") : "Thiết bị chỉ hỗ trợ điều khiển ON/OFF. Giá trị đã được chuyển đổi từ dạng khác.";
    }
    if (msg.includes("must be boolean for digital_output")) {
      return t ? t("projects:editor.err_gpio_bool_only", "GPIO này chỉ hỗ trợ điều khiển ON/OFF.") : "GPIO này chỉ hỗ trợ điều khiển ON/OFF.";
    }
    return msg;
  }
  return userSafeErrorMessage(error);
}

function valuesMatch(actual: unknown, expected: unknown): boolean {
  if (expected === undefined) return false;
  if (actual === expected) return true;
  if (typeof expected === "boolean") {
    return normalizeBoolean(actual) === expected;
  }
  const actualNumber = normalizeNumber(actual);
  const expectedNumber = normalizeNumber(expected);
  if (actualNumber !== null && expectedNumber !== null) return actualNumber === expectedNumber;
  return String(actual ?? "") === String(expected ?? "");
}

function latestForDevice(
  latestState: Record<string, Record<string, unknown>>,
  device?: Device,
): Record<string, unknown> {
  if (!device || !latestState) return {};
  return latestState[device.id] ?? latestState[device.device_uid] ?? {};
}

function getVisualState(device: Device | undefined, latestState: Record<string, unknown>, error?: string | null): WidgetVisualState {
  if (error) return { status: "error", message: error };
  if (!device) return { status: "idle", message: "No device" };
  if (device.status === "offline") return { status: "offline", message: "Offline" };
  if (latestState.ts == null && !device.last_seen_at) return { status: "stale", message: "No telemetry" };
  return { status: "online", message: "Live" };
}

function defaultCommandValue(draft: WidgetDraft): unknown {
  const definition = resolveWidgetDefinition(draft.widget_type);
  const valueType = String(definition.configSchema.valueType ?? "");
  if (valueType === "number") return normalizeNumber(draft.config.min) ?? 0;
  if (valueType === "string") {
    if (typeof draft.config.color === "string") return draft.config.color;
    if (typeof draft.config.optionsCsv === "string") return draft.config.optionsCsv.split(",")[0]?.trim() ?? "";
    return "";
  }
  return false;
}

function buildCapabilityBinding(
  draft: WidgetDraft,
  device: Device | undefined,
  capability: DeviceCapability | null,
): Record<string, unknown> {
  const binding: Record<string, unknown> = { ...draft.binding, binding_type: "physical" };
  if (device) {
    binding.device_id = device.id;
    binding.device_uid = device.device_uid;
  }
  if (!capability) return binding;
  const gpioPin = capability.gpio_pin;
  const stateKey = capability.telemetry_state_key ?? "";
  binding.capability_id = capability.id;
  binding.capability_key = capability.capability_key;
  binding.capability_type = capability.capability_type;
  binding.command = capability.command_name;
  binding.channel = capability.channel;
  if (gpioPin != null) binding.gpio_pin = gpioPin;
  if (stateKey) {
    binding.state_key = stateKey;
    binding.telemetry_field = stateKey;
    binding.feedback_key = stateKey;
  }
  const initialValue = defaultCommandValue(draft);
  if (capability.command_name === "set_gpio") binding.params = { pin: gpioPin, state: Boolean(initialValue), ...(gpioPin != null ? { gpio_pin: gpioPin } : {}) };
  else if (capability.command_name === "set_output") binding.params = { target: capability.channel ?? capability.capability_key, value: initialValue, ...(gpioPin != null ? { gpio_pin: gpioPin, pin: gpioPin } : {}) };
  else if (capability.command_name === "toggle_output") binding.params = { target: capability.channel ?? capability.capability_key, ...(gpioPin != null ? { gpio_pin: gpioPin, pin: gpioPin } : {}) };
  else if (capability.channel) binding.params = { channel: capability.channel, value: initialValue, state: initialValue };
  return binding;
}


type WidgetConfigTabKey = "widget" | "data" | "design";

const DESIGN_FIELD_KEYS = new Set([
  "prefix",
  "suffix",
  "icon",
  "color",
  "unit",
  "decimalPlaces",
  "hideTitle",
  "showStateLabels",
  "onLabel",
  "offLabel",
  "labelPosition",
  "text",
  "markdown",
  "imageUrl",
]);

function mapFieldSection(field: WidgetEditorField, nextSection: string): WidgetEditorField {
  return { ...field, section: nextSection };
}

function designFieldsForDraft(fields: WidgetEditorField[]): WidgetEditorField[] {
  return fields
    .filter((field) => field.scope === "layout" || DESIGN_FIELD_KEYS.has(field.key))
    .map((field) => {
      if (field.scope === "layout") return mapFieldSection(field, "Layout");
      if (["text", "markdown", "imageUrl"].includes(field.key)) return mapFieldSection(field, "Content");
      if (["showStateLabels", "onLabel", "offLabel", "labelPosition"].includes(field.key)) return mapFieldSection(field, "Labels");
      return mapFieldSection(field, "Appearance");
    });
}

function dataFieldsForDraft(fields: WidgetEditorField[]): WidgetEditorField[] {
  return fields
    .filter((field) => field.scope !== "layout" && !DESIGN_FIELD_KEYS.has(field.key) && !field.key.startsWith("color_"))
    .map((field) => {
      if (["Behavior", "Numeric", "Thresholds", "Chart"].includes(field.section)) {
        return mapFieldSection(field, "Command / Telemetry mapping");
      }
      return field;
    });
}

function buildPreviewWidget(draft: WidgetDraft, definition: WidgetDefinition): ProjectWidget {
  return {
    id: "widget-preview",
    page_id: "preview-page",
    widget_type: draft.widget_type,
    title: draft.title.trim() || definition.label,
    sort_order: draft.sort_order ?? 0,
    layout: draft.layout,
    config: draft.config,
    binding: draft.binding as ProjectWidget["binding"],
    created_at: "",
    updated_at: "",
  };
}

function previewFrameStyle(layout: Record<string, unknown>): CSSProperties {
  const width = Math.max(1, Math.min(3, Number(layout.width ?? layout.col_span ?? 1) || 1));
  const height = Math.max(1, Math.min(3, Number(layout.height ?? layout.row_span ?? 1) || 1));
  return {
    width: `${220 + (width - 1) * 92}px`,
    minHeight: `${132 + (height - 1) * 68}px`,
  };
}

interface ProjectEditorProps {
  overrideProjectId?: string;
}

export function ProjectEditor({ overrideProjectId }: ProjectEditorProps = {}) {
  const { t } = useTranslation(["projects", "common"]);
  const params = useParams();
  const projectId = overrideProjectId || params.projectId || "";
  const qc = useQueryClient();
  const { user } = useAuth();
  const toast = useToast();
  const canManage = canManageProjects(user);
  const canSend = canSendCommands(user);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<ProjectWidget | null>(null);
  const [droppedWidgetType, setDroppedWidgetType] = useState<string | null>(null);
  const [droppedLayout, setDroppedLayout] = useState<GridLayoutData | null>(null);
  const [draftWidgets, setDraftWidgets] = useState<ProjectWidget[]>([]);
  const [widgetStates, setWidgetStates] = useState<Map<string, WidgetRuntimeState>>(new Map());
  const pendingTimeouts = useRef<Map<string, number>>(new Map());
  const commandCounters = useRef<Map<string, number>>(new Map());
  const runtimeEndpointUnavailable = useRef(false);

  useEffect(() => {
    runtimeEndpointUnavailable.current = false;
    setDraftWidgets([]);
  }, [projectId]);

  const hasPending = useMemo(() => {
    for (const state of widgetStates.values()) {
      if (state.pending) return true;
    }
    return false;
  }, [widgetStates]);

  const projectQ = useQuery({
    queryKey: ["client-project-detail", projectId],
    queryFn: () => getClientProject(projectId),
    staleTime: 60_000,
    enabled: !!projectId,
  });
  const runtimeQ = useQuery({
    queryKey: ["client-project-runtime", projectId],
    queryFn: async () => {
      try {
        return (await getClientProjectRuntimeState(projectId)) ?? {
          project_id: projectId,
          latest_state: projectQ.data?.latest_state ?? {},
        };
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        // Older API processes do not expose runtime-state yet. The project
        // detail already contains a valid snapshot, so keep the editor usable
        // and stop generating repeated 404 requests until the page is reloaded.
        runtimeEndpointUnavailable.current = true;
        return {
          project_id: projectId,
          latest_state: projectQ.data?.latest_state ?? {},
        };
      }
    },
    refetchInterval: () => {
      if (runtimeEndpointUnavailable.current) return false;
      return hasPending ? 2_000 : 10_000;
    },
    enabled: !!projectId && projectQ.isSuccess,
  });
  const devicesQ = useQuery({
    queryKey: ["client-devices", projectId],
    queryFn: () => listClientDevices(projectId),
    enabled: !!projectId && projectQ.isSuccess,
  });

  const createPageMut = useMutation({
    mutationFn: () => createClientProjectPage(projectId, { title: "Main", slug: "main", sort_order: 0 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-project-detail", projectId] }),
  });

  const updateWidgetState = useCallback((widgetId: string, update: Partial<WidgetRuntimeState>) => {
    setWidgetStates((prev) => {
      const next = new Map(prev);
      const existing = next.get(widgetId) ?? { pending: false, lastCommandAt: 0, error: null };
      next.set(widgetId, { ...existing, ...update });
      return next;
    });
    if (update.pending === false) {
      const timeout = pendingTimeouts.current.get(widgetId);
      if (timeout) {
        window.clearTimeout(timeout);
        pendingTimeouts.current.delete(widgetId);
      }
    }
  }, []);

  const deleteMut = useMutation({
    mutationFn: (widgetId: string) => deleteClientProjectWidget(widgetId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-project-detail", projectId] });
      toast.success(t("projects:editor.widget_deleted", "Widget deleted."));
    },
  });

  const addWidgetMut = useMutation({
    mutationFn: ({ pageId, payload }: { pageId: string; payload: ClientProjectWidgetInput }) => {
      return createClientProjectWidget(pageId, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client-project-detail", projectId] });
      toast.success(t("projects:editor.widget_added", "Widget added."));
    },
    onError: (err) => toast.error(err),
  });

  const commandMut = useMutation({
    mutationFn: (request: WidgetCommandRequest) =>
      sendClientDeviceCommand(request.deviceId, { command: request.command, params: request.params }),
    onSuccess: (_data, request) => {
      const activeTimeout = pendingTimeouts.current.get(request.widgetId);
      if (activeTimeout) {
        window.clearTimeout(activeTimeout);
        pendingTimeouts.current.delete(request.widgetId);
      }
      updateWidgetState(request.widgetId, {
        pending: false,
        optimisticValue: request.expectedValue,
        commandExpectedValue: request.expectedValue,
        error: null,
      });
    },
  });

  const project = projectQ.data;
  const page = project?.pages[0];
  const latestState = runtimeQ.data?.latest_state && Object.keys(runtimeQ.data.latest_state).length > 0
    ? runtimeQ.data.latest_state
    : project?.latest_state ?? {};

  const serverWidgets = useMemo(
    () => [...(page?.widgets ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [page?.widgets],
  );

  const widgets = useMemo(
    () => [...serverWidgets, ...draftWidgets],
    [serverWidgets, draftWidgets],
  );

  // -- Dashboard layout persistence ------------------------------------------

  const handleSaveLayout = useCallback(
    async (layoutMap: Map<string, GridLayoutData>) => {
      if (!canManage || !page?.id) return;

      type LayoutSaveOperation = {
        kind: "draft" | "server";
        widgetId: string;
        promise: Promise<unknown>;
      };

      const draftsWithLayout = draftWidgets.map((widget) => {
        const gridPos = layoutMap.get(widget.id);
        return gridPos
          ? { ...widget, layout: { ...widget.layout, grid: gridPos } }
          : widget;
      });
      setDraftWidgets(draftsWithLayout);

      const operations: LayoutSaveOperation[] = [];
      for (const widget of draftsWithLayout) {
        operations.push({
          kind: "draft",
          widgetId: widget.id,
          promise: createClientProjectWidget(page.id, {
            widget_type: widget.widget_type,
            title: widget.title,
            sort_order: widget.sort_order,
            layout: widget.layout,
            config: widget.config,
            binding: bindingForLayoutPersistence(widget.binding),
          }),
        });
      }

      for (const widget of serverWidgets) {
        const gridPos = layoutMap.get(widget.id);
        if (!gridPos) continue;
        const existingGrid = widget.layout?.grid as Record<string, unknown> | undefined;
        if (
          existingGrid &&
          existingGrid.x === gridPos.x &&
          existingGrid.y === gridPos.y &&
          existingGrid.w === gridPos.w &&
          existingGrid.h === gridPos.h
        ) {
          continue;
        }
        operations.push({
          kind: "server",
          widgetId: widget.id,
          promise: updateClientProjectWidget(widget.id, {
            layout: {
              ...widget.layout,
              grid: gridPos,
            },
          }),
        });
      }

      if (operations.length === 0) return;

      const results = await Promise.allSettled(operations.map((operation) => operation.promise));
      const successfulDraftIds = operations.flatMap((operation, index) =>
        operation.kind === "draft" && results[index]?.status === "fulfilled" ? [operation.widgetId] : [],
      );
      if (successfulDraftIds.length > 0) {
        setDraftWidgets((prev) => prev.filter((widget) => !successfulDraftIds.includes(widget.id)));
      }

      // Refresh both successful updates and successful creates. Failed drafts
      // remain in local state so the user can correct or retry them.
      await qc.invalidateQueries({ queryKey: ["client-project-detail", projectId] });

      const failedResult = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failedResult) {
        throw failedResult.reason;
      }

      toast.success(t("projects:editor.layout_saved", "Đã lưu bố cục dashboard."));
    },
    [canManage, draftWidgets, page?.id, projectId, qc, serverWidgets, t, toast],
  );

  const handleCancel = useCallback(() => {
    setDraftWidgets([]);
  }, []);

  function openEdit(widget: ProjectWidget) {
    if (!canManage) return;
    setEditingWidget(widget);
    setDroppedWidgetType(null);
    setDroppedLayout(null);
    setModalOpen(true);
  }

  const handleDropTemplate = useCallback(
    (widgetType: string, layout: GridLayoutData) => {
      if (!canManage || !page?.id) {
        console.warn("Cannot add widget: permission denied or no page active", { canManage, pageId: page?.id });
        return;
      }
      const draft = buildWidgetDraft(widgetType);
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const tempWidget: ProjectWidget = {
        id: tempId,
        page_id: page.id,
        widget_type: widgetType,
        title: draft.title,
        sort_order: serverWidgets.length + draftWidgets.length,
        layout: {
          ...draft.layout,
          grid: layout,
          col_span: layout.w,
          row_span: layout.h,
          width: layout.w,
          height: layout.h,
        },
        config: draft.config,
        binding: draft.binding,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_temporary: true,
      };
      setDraftWidgets((prev) => [...prev, tempWidget]);
    },
    [canManage, page?.id, serverWidgets.length, draftWidgets.length],
  );

  function handleDeleteWidget(widgetId: string) {
    if (!canManage) return;
    const isDraft = draftWidgets.some((w) => w.id === widgetId);
    if (isDraft) {
      setDraftWidgets((prev) => prev.filter((w) => w.id !== widgetId));
    } else {
      deleteMut.mutate(widgetId);
    }
  }

  function handleCloseModal() {
    setModalOpen(false);
    setEditingWidget(null);
    setDroppedWidgetType(null);
    setDroppedLayout(null);
  }

  function handleCommand(request: WidgetCommandRequest) {
    if (!canSend) return;
    const now = Date.now();
    const existing = widgetStates.get(request.widgetId);
    if (existing?.lastCommandAt && now - existing.lastCommandAt < 300) return;

    const previousTimeout = pendingTimeouts.current.get(request.widgetId);
    if (previousTimeout) window.clearTimeout(previousTimeout);

    const counter = (commandCounters.current.get(request.widgetId) ?? 0) + 1;
    commandCounters.current.set(request.widgetId, counter);

    updateWidgetState(request.widgetId, {
      pending: true,
      optimisticValue: request.expectedValue,
      commandExpectedValue: request.expectedValue,
      commandId: counter,
      lastCommandAt: now,
      error: null,
    });

    const timeoutId = window.setTimeout(() => {
      pendingTimeouts.current.delete(request.widgetId);
      if (commandCounters.current.get(request.widgetId) === counter) {
        updateWidgetState(request.widgetId, {
          pending: false,
          optimisticValue: undefined,
          commandExpectedValue: undefined,
          error: t("projects:editor.device_no_response", "Thiết bị không phản hồi hoặc lệnh bị quá hạn."),
        });
        window.setTimeout(() => {
          if (commandCounters.current.get(request.widgetId) === counter) {
            updateWidgetState(request.widgetId, { error: null });
          }
        }, 5_000);
      }
    }, 5_000);
    pendingTimeouts.current.set(request.widgetId, timeoutId);

    commandMut.mutate(request, {
      onError: (err) => {
        if (commandCounters.current.get(request.widgetId) !== counter) return;
        const activeTimeout = pendingTimeouts.current.get(request.widgetId);
        if (activeTimeout) window.clearTimeout(activeTimeout);
        pendingTimeouts.current.delete(request.widgetId);
        updateWidgetState(request.widgetId, {
          optimisticValue: undefined,
          pending: false,
          commandExpectedValue: undefined,
          error: errorMessage(err),
        });
        toast.error(err);
        window.setTimeout(() => {
          if (commandCounters.current.get(request.widgetId) === counter) {
            updateWidgetState(request.widgetId, { error: null });
          }
        }, 4_000);
      },
    });
  }

  return (
    <>
      {!overrideProjectId && (
        <PageHeader
          title={project?.name ?? t("projects:title", "Dự án")}
          subtitle={project?.description ?? t("projects:subtitle", "Kéo thả widget từ thư viện để thiết kế dashboard")}
          crumbs={[
            { label: "client", to: "/client/dashboard" },
            { label: "projects", to: "/client/projects" },
            { label: project?.name ?? "project" },
          ]}
        />
      )}

      {!canManage && <ReadOnlyNotice />}

      {projectQ.isLoading ? (
        <div className="text-sm text-slate-500">{t("common:actions.loading", "Đang tải...")}</div>
      ) : projectQ.isError || !project ? (
        <Card>
          <CardBody>
            <p className="text-sm text-rose-600">{t("projects:error_load", "Không thể tải dự án.")}</p>
            <Link className="btn-secondary mt-4" to="/client/projects">{t("projects:back_to_projects", "Quay lại danh sách dự án")}</Link>
          </CardBody>
        </Card>
      ) : (
        <>
          {!page && canManage ? (
            <Card><CardBody className="space-y-3">
              <p className="text-sm text-slate-500">{t("projects:editor.no_canvas_page", "This project has no canvas page yet. Create one to add widgets.")}</p>
              <button className="btn-primary" disabled={createPageMut.isPending} onClick={() => {
                if (canManage) createPageMut.mutate();
              }}>{createPageMut.isPending ? t("common:actions.loading") : t("projects:editor.create_canvas_page", "Create canvas")}</button>
              {createPageMut.isError && <p className="text-sm text-rose-600" role="alert">{errorMessage(createPageMut.error)}</p>}
            </CardBody></Card>
          ) : (
          <DashboardGrid
            widgets={widgets}
            readOnly={!canManage}
            projectName={project.name}
            onSaveLayout={handleSaveLayout}
            onDropTemplate={handleDropTemplate}
            onCancel={handleCancel}
            renderWidget={(widget, isEditing) => (
              <WidgetCard
                key={widget.id}
                widget={widget}
                devices={devicesQ.data ?? []}
                latestState={latestState}
                projectName={project.name}
                projectId={projectId}
                readOnly={!canManage}
                canSend={canSend}
                isEditing={isEditing}
                runtimeState={widgetStates.get(widget.id)}
                onUpdateState={updateWidgetState}
                onCommand={handleCommand}
                onEdit={() => openEdit(widget)}
                onDelete={() => handleDeleteWidget(widget.id)}
              />
            )}
          />
          )}
        </>
      )}

      {page && canManage && (
        <WidgetModal
          open={modalOpen}
          onClose={handleCloseModal}
          onSaveSuccess={(savedWidgetId) => {
            setDraftWidgets((prev) => prev.filter((w) => w.id !== savedWidgetId && w.id !== editingWidget?.id));
          }}
          pageId={page.id}
          widget={editingWidget}
          initialWidgetType={droppedWidgetType}
          initialLayout={droppedLayout}
          devices={devicesQ.data ?? []}
          projectId={projectId}
          latestState={latestState}
        />
      )}
      {addWidgetMut.isError && (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-400">
          {errorMessage(addWidgetMut.error)}
        </div>
      )}
      {commandMut.isError && <p className="mt-4 text-sm text-rose-600">{errorMessage(commandMut.error)}</p>}
    </>
  );
}

function WidgetCard({
  widget,
  devices,
  latestState,
  projectName,
  projectId,
  readOnly,
  canSend,
  isEditing,
  runtimeState,
  onUpdateState,
  onCommand,
  onEdit,
  onDelete,
}: {
  widget: ProjectWidget;
  devices: Device[];
  latestState: Record<string, Record<string, unknown>>;
  projectName: string;
  projectId: string;
  readOnly: boolean;
  canSend: boolean;
  isEditing: boolean;
  runtimeState: WidgetRuntimeState | undefined;
  onUpdateState: (widgetId: string, update: Partial<WidgetRuntimeState>) => void;
  onCommand: (request: WidgetCommandRequest) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const definition = resolveWidgetDefinition(widget.widget_type);
  const binding = widget.binding ?? {};
  const device = devices.find((d) => d.id === binding.device_id || d.device_uid === binding.device_uid);
  const deviceState = latestForDevice(latestState, device);
  const visualState = getVisualState(device, deviceState, runtimeState?.error);
  const Renderer = definition.renderer;

  useEffect(() => {
    const field = stateFieldForBinding(binding);
    const expectedValue = runtimeState?.commandExpectedValue;
    if (expectedValue !== undefined && valuesMatch(deviceState[field], expectedValue)) {
      onUpdateState(widget.id, { pending: false, optimisticValue: undefined, commandExpectedValue: undefined, error: null });
    } else if (runtimeState?.error && expectedValue !== undefined && valuesMatch(deviceState[field], expectedValue)) {
      onUpdateState(widget.id, { error: null });
    }
  }, [binding, deviceState, onUpdateState, runtimeState?.commandExpectedValue, runtimeState?.error, runtimeState?.pending, widget.id]);

  return (
    <Card className="min-h-0">
      <WidgetChrome
        widget={widget}
        definition={definition}
        device={device}
        visualState={visualState}
        readOnly={readOnly || isEditing}
        isEditing={isEditing}
        actionsEnabled={!readOnly}
        onEdit={onEdit}
        onDelete={onDelete}
      >
        <Renderer
          widget={widget}
          definition={definition}
          device={device}
          latestState={deviceState}
          visualState={visualState}
          runtimeState={runtimeState}
          projectName={projectName}
          readOnly={!canSend || isEditing}
          onCommand={(request) => {
            // Suppress commands during layout editing to prevent accidental device control
            if (!canSend || isEditing) return;
            if (binding.binding_type === "virtual") {
              onCommand({
                ...request,
                params: {
                  ...request.params,
                  project_id: projectId,
                  datastream_id: binding.datastream_id,
                  widget_id: widget.id,
                },
              });
              return;
            }
            onCommand(request);
          }}
        />
      </WidgetChrome>
    </Card>
  );
}

function WidgetModal({
  open,
  onClose,
  onSaveSuccess,
  pageId,
  widget,
  initialWidgetType,
  initialLayout,
  devices,
  projectId,
  latestState,
}: {
  open: boolean;
  onClose: () => void;
  onSaveSuccess?: (widgetId: string) => void;
  pageId: string;
  widget: ProjectWidget | null;
  initialWidgetType?: string | null;
  initialLayout?: GridLayoutData | null;
  devices: Device[];
  projectId: string;
  latestState: Record<string, Record<string, unknown>>;
}) {
  const qc = useQueryClient();
  const { t } = useTranslation(["projects", "common"]);
  const toast = useToast();
  const [draft, setDraft] = useState<WidgetDraft>(() => buildWidgetDraft(initialWidgetType ?? widget?.widget_type ?? "project_info_card", widget));
  const [activeTab, setActiveTab] = useState<WidgetConfigTabKey>("data");
  const [search, setSearch] = usePersistedState(`aifom_projecteditor_search_${projectId}`, "", "session");
  const [errors, setErrors] = useState<string[]>([]);
  const definition = resolveWidgetDefinition(draft.widget_type);
  const deviceId = typeof draft.binding.device_id === "string" ? draft.binding.device_id : "";
  const bindingType = bindingTypeFor(draft.binding);
  const selectedDevice = devices.find((device) => device.id === deviceId || device.device_uid === draft.binding.device_uid);

  const datastreamsQ = useQuery({
    queryKey: ["client-datastreams", projectId],
    queryFn: () => listDatastreams({ project_id: projectId }),
    enabled: open && !!projectId && definition.bindingMode !== "static" && bindingType === "virtual",
  });

  const capabilitiesQ = useQuery({
    queryKey: ["client-device-capabilities", deviceId],
    queryFn: () => listClientDeviceCapabilities(deviceId),
    enabled: open && !!deviceId && definition.bindingMode !== "static" && bindingType === "physical",
  });

  const rawDatastreamOptions = datastreamsQ.data?.items ?? [];

  const visibleFields = useMemo(() => getVisibleWidgetEditorFields(definition, draft), [definition, draft]);
  const designFields = useMemo(() => designFieldsForDraft(visibleFields), [visibleFields]);
  const dataFields = useMemo(() => dataFieldsForDraft(visibleFields), [visibleFields]);
  const layoutFields = useMemo(() => designFields.filter((field) => field.section === "Layout"), [designFields]);
  const labelFields = useMemo(() => designFields.filter((field) => field.section === "Labels"), [designFields]);
  const contentFields = useMemo(() => designFields.filter((field) => field.section === "Content"), [designFields]);

  const selectedChannels = useMemo(() => {
    const bound = Array.isArray(draft.binding.channels) ? draft.binding.channels : [];
    if (draft.widget_type === "multi_telemetry_chart" && bound.length === 0) {
      return ["ch_v1", "ch_v2"];
    }
    return bound;
  }, [draft.binding.channels, draft.widget_type]);

  const dynamicColorFields = useMemo(() => {
    if (draft.widget_type !== "multi_telemetry_chart") return [];
    return selectedChannels.map((chan) => {
      const match = chan.match(/^(?:ch_)?v(\d+)$/i);
      let label = chan;
      if (match) {
        const pinNum = parseInt(match[1], 10);
        const ds = rawDatastreamOptions.find((d) => d.pin === pinNum);
        if (ds) label = ds.name;
      }
      return {
        key: `color_${chan}`,
         label: t("projects:editor.color_for", "Màu cho {{label}}", { label }),
        kind: "color" as const,
        scope: "config" as const,
        section: "Appearance" as const,
      };
    });
  }, [draft.widget_type, selectedChannels, rawDatastreamOptions, t]);

  const appearanceFields = useMemo(() => {
    const base = designFields.filter((field) => field.section === "Appearance");
    return [...base, ...dynamicColorFields];
  }, [designFields, dynamicColorFields]);
  const datastreamOptions = useMemo(() => {
    const widgetType = draft.widget_type;
    return rawDatastreamOptions.filter((ds) => {
      // 1. Digital control widgets (Switch, Button)
      if (widgetType === "switch" || widgetType === "toggle_switch" || widgetType === "button") {
        return ds.data_type === "boolean" && (ds.direction === "command" || ds.direction === "bidirectional");
      }
      // 2. Numeric display widgets (Chart, Gauge, Value Card)
      if (widgetType === "chart" || widgetType === "gauge" || widgetType === "number_card") {
        return (ds.data_type === "integer" || ds.data_type === "double") && (ds.direction === "telemetry" || ds.direction === "bidirectional");
      }
      // 3. Status card logic
      if (widgetType === "boolean_status_card") {
        return ds.data_type === "boolean" && (ds.direction === "telemetry" || ds.direction === "bidirectional");
      }
      return true;
    });
  }, [rawDatastreamOptions, draft.widget_type]);
  const selectedDatastream = rawDatastreamOptions.find((ds) => ds.id === draft.binding.datastream_id) ?? null;
  const filteredDevices = useMemo(() => {
    if (bindingType === "virtual" && selectedDatastream && selectedDatastream.supported_model_ids && selectedDatastream.supported_model_ids.length > 0) {
      return devices.filter((device) => {
        return device.device_model_id && selectedDatastream.supported_model_ids.includes(device.device_model_id);
      });
    }
    return devices;
  }, [devices, bindingType, selectedDatastream]);
  const capabilityOptions = useMemo(
    () => filterCapabilitiesForWidget({ definition, capabilities: capabilitiesQ.data ?? [] }),
    [capabilitiesQ.data, definition],
  );
  const selectedCapability = capabilityOptions.find((capability) => capability.capability_key === draft.binding.capability_key) ?? null;
  const availableTypes = useMemo(() => listWidgetDefinitions(search), [search]);

  const buildInitialDraft = useCallback(() => {
    const next = buildWidgetDraft(initialWidgetType ?? widget?.widget_type ?? "project_info_card", widget);
    if (!widget && initialLayout) {
      return {
        ...next,
        layout: {
          ...next.layout,
          grid: initialLayout,
          col_span: initialLayout.w,
          row_span: initialLayout.h,
          width: initialLayout.w,
          height: initialLayout.h,
        },
      };
    }
    return next;
  }, [initialLayout, initialWidgetType, widget]);

  useEffect(() => {
    if (!open) return;
    setDraft(buildInitialDraft());
    setActiveTab("data");
    setSearch("");
    setErrors([]);
  }, [buildInitialDraft, open]);

  useEffect(() => {
    if (!open || bindingType !== "physical" || !selectedDevice || capabilityOptions.length === 0) return;
    const capability = selectedCapability ?? capabilityOptions[0];
    if (draft.binding.capability_id === capability.id) return;
    setDraft((prev) => ({ ...prev, binding: buildCapabilityBinding(prev, selectedDevice, capability) }));
  }, [bindingType, capabilityOptions, draft.binding.capability_id, open, selectedCapability, selectedDevice]);

  function updateDraftField(scope: "config" | "layout" | "binding", key: string, value: unknown) {
    setDraft((prev) => ({
      ...prev,
      [scope]: {
        ...prev[scope],
        [key]: value,
      },
    }));
  }

  function selectType(widgetType: string) {
    const next = buildWidgetDraft(widgetType);
    setDraft((prev) => ({
      ...next,
      title: prev.title || next.title,
      sort_order: prev.sort_order,
      binding: { ...prev.binding },
      layout: { ...next.layout, ...prev.layout },
    }));
    setErrors([]);
  }

  function selectDevice(nextDeviceId: string) {
    const device = devices.find((item) => item.id === nextDeviceId);
    setDraft((prev) => ({
      ...prev,
      binding: {
        device_id: nextDeviceId,
        device_uid: device?.device_uid,
        ...(bindingTypeFor(prev.binding) === "virtual" ? {
          binding_type: "virtual" as const,
          datastream_id: prev.binding.datastream_id,
          command: "virtual_write",
          channel: prev.binding.channel,
          state_key: prev.binding.state_key,
          telemetry_field: prev.binding.telemetry_field,
          feedback_key: prev.binding.feedback_key,
          params: prev.binding.params,
        } : {}),
      },
    }));
  }

  function selectBindingType(nextType: "physical" | "virtual") {
    setDraft((prev) => ({
      ...prev,
      binding: nextType === "virtual"
        ? { device_id: prev.binding.device_id, device_uid: prev.binding.device_uid, binding_type: "virtual" }
        : { device_id: prev.binding.device_id, device_uid: prev.binding.device_uid, binding_type: "physical" },
    }));
    setErrors([]);
  }

  function selectCapability(capabilityKey: string) {
    const capability = capabilityOptions.find((item) => item.capability_key === capabilityKey) ?? null;
    setDraft((prev) => ({ ...prev, binding: buildCapabilityBinding(prev, selectedDevice, capability) }));
  }

  function selectDatastream(datastreamId: string) {
    const ds = datastreamOptions.find((item) => item.id === datastreamId) ?? null;
    if (!ds) {
      setDraft((prev) => ({
        ...prev,
        binding: {
          device_id: prev.binding.device_id,
          device_uid: prev.binding.device_uid,
        },
      }));
      return;
    }
    const pinStr = `v${ds.pin}`;
    setDraft((prev) => {
      const nextConfig = { ...prev.config };
      if (ds.min_value !== null && ds.min_value !== undefined) {
        nextConfig.min = ds.min_value;
      }
      if (ds.max_value !== null && ds.max_value !== undefined) {
        nextConfig.max = ds.max_value;
      }
      if (ds.unit) {
        nextConfig.unit = ds.unit;
      }
      if (prev.widget_type === "segmented_control" || prev.widget_type === "dropdown_command_selector") {
        if (ds.data_type === "boolean") {
          nextConfig.optionsCsv = "OFF:false,ON:true";
        } else if (ds.data_type === "integer" || ds.data_type === "double") {
          nextConfig.optionsCsv = "OFF:0,ON:1";
        } else {
          nextConfig.optionsCsv = "OFF:off,ON:on";
        }
      }
      return {
        ...prev,
        binding: {
          device_id: prev.binding.device_id,
          device_uid: prev.binding.device_uid,
          binding_type: "virtual" as const,
          datastream_id: ds.id,
          command: "virtual_write",
          channel: pinStr,
          state_key: `ch_${pinStr}`,
          telemetry_field: `ch_${pinStr}`,
          feedback_key: `ch_${pinStr}`,
          params: { channel: pinStr, value: null, state: null },
        },
        config: nextConfig,
      };
    });
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const rawBinding = selectedDevice
      ? { ...draft.binding, device_id: selectedDevice.id, device_uid: selectedDevice.device_uid }
      : { ...draft.binding };
    const finalBinding = Object.fromEntries(
      Object.entries(rawBinding).filter(([, value]) => value !== undefined && value !== null && value !== ""),
    );
    const finalDraft = { ...draft, binding: finalBinding };
    const validationErrors = validateWidgetDraft(finalDraft, selectedDatastream);
    setErrors(validationErrors);
    if (validationErrors.length > 0) return;
    saveMut.mutate(finalDraft);
  }

  const saveMut = useMutation({
    mutationFn: (finalDraft: WidgetDraft) => {
      const payload = {
        widget_type: finalDraft.widget_type,
        title: finalDraft.title,
        sort_order: finalDraft.sort_order,
        layout: finalDraft.layout,
        config: finalDraft.config,
        binding: finalDraft.binding,
      };
      return widget && !widget.is_temporary
        ? updateClientProjectWidget(widget.id, payload)
        : createClientProjectWidget(pageId, payload);
    },
    onSuccess: () => {
      if (widget) {
        onSaveSuccess?.(widget.id);
      }
      onClose();
      qc.invalidateQueries({ queryKey: ["client-project-detail", projectId] });
      toast.success(t(widget ? "projects:editor.widget_updated" : "projects:editor.widget_added", widget ? "Widget updated." : "Widget added."));
    },
  });

  const previewWidget = useMemo(() => buildPreviewWidget(draft, definition), [definition, draft]);
  const previewState = useMemo(() => latestForDevice(latestState, selectedDevice), [latestState, selectedDevice]);
  const previewStyle = useMemo(() => previewFrameStyle(draft.layout), [draft.layout]);
  const previewVisualState = getVisualState(selectedDevice, previewState);
  const PreviewRenderer = definition.renderer;
  const saveErrorMessage = saveMut.error instanceof ApiError
    ? errorMessage(saveMut.error, t)
    : t("projects:editor.save_failed", "We could not save this widget. Please review the configuration and try again.");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("projects:editor.configure_widget", "Cấu hình widget")}
      size="lg"
      headerContent={(
        <Tabs
          tabs={[
            { key: "data", label: t("projects:editor.tab_data", "Dữ liệu") },
            { key: "design", label: t("projects:editor.tab_design", "Thiết kế") },
            { key: "widget", label: t("projects:editor.tab_widget", "Widget") },
          ]}
          active={activeTab}
          onChange={(key) => setActiveTab(key as WidgetConfigTabKey)}
        />
      )}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>{t("common:actions.cancel", "Cancel")}</button>
          <button className="btn-primary" disabled={saveMut.isPending} onClick={() => submit()}>
            {t("common:actions.save", "Save")}
          </button>
        </>
      }
    >
      <form className="space-y-5" onSubmit={submit}>
        {activeTab === "data" ? (
          <>
            {definition.binding.requiresDevice && (
              <div className="space-y-4">
                {definition.bindingMode !== "static" && (
                  <div className="flex items-center gap-4 border-b border-slate-100 pb-4 dark:border-border-subtle">
                    <span className="label-xs uppercase tracking-[0.1em] text-slate-500">{t("projects:editor.binding_mode", "Chế độ liên kết")}</span>
                    <div className="flex rounded-lg border border-slate-200 p-0.5 dark:border-border-subtle bg-slate-50/50 dark:bg-slate-800/30" role="group">
                      <button type="button" className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", bindingType === "virtual" ? "bg-surface-elevated text-primary shadow-sm dark:bg-surface-muted dark:text-primary" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-text-muted dark:hover:bg-surface-elevated dark:hover:text-slate-100")} onClick={() => selectBindingType("virtual")}>{t("projects:editor.virtual_pin", "Virtual Pin (chân ảo)")}</button>
                      <button type="button" className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", bindingType === "physical" ? "bg-surface-elevated text-primary shadow-sm dark:bg-surface-muted dark:text-primary" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-text-muted dark:hover:text-slate-100")} onClick={() => selectBindingType("physical")}>{t("projects:editor.physical", "Vật lý")}</button>
                    </div>
                  </div>
                )}
                
                <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                  <label>
                    <span className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:editor.assigned_device", "Thiết bị được gán")}</span>
                    <select className="input w-full" value={deviceId} onChange={(event) => selectDevice(event.target.value)}>
                      <option value="">{t("projects:editor.select_tenant_device", "Chọn thiết bị trong tenant")}</option>
                      {filteredDevices.map((device) => (
                        <option key={device.id} value={device.id}>{device.name} ({device.device_uid})</option>
                      ))}
                    </select>
                  </label>

                   {bindingType === "physical" && definition.bindingMode !== "static" && (
                     <>
                       <label>
                         <span className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:editor.gpio_pin_function", "GPIO / Chức năng")}</span>
                         <select aria-label={t("projects:editor.gpio_pin_function", "GPIO Pin / Function")} title={t("projects:editor.gpio_pin_function", "GPIO Pin / Function")} className="input w-full" value={String(draft.binding.capability_key ?? "")} onChange={(event) => selectCapability(event.target.value)}>
                         <option value="">{capabilitiesQ.isLoading ? t("projects:editor.loading_capabilities", "Đang tải khả năng thiết bị...") : capabilityOptions.length === 0 ? t("projects:editor.no_compatible_capability", "Không có khả năng tương thích") : t("projects:editor.select_capability", "Chọn khả năng thiết bị")}</option>
                           {capabilityOptions.map((capability) => <option key={capability.id} value={capability.capability_key}>{capability.label} ({capability.capability_type})</option>)}
                         </select>
                          {selectedCapability && <span className="mt-1 block text-xs text-slate-500">{t("projects:editor.hardware_binding_note", "Liên kết phần cứng. Không lưu kênh dữ liệu.")}</span>}
                       </label>
                       {selectedCapability && (
                         <label className="md:col-span-2">
                            <span className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:editor.command_preview", "Xem trước lệnh")}</span>
                           <input
                             className="input w-full font-mono text-xs bg-slate-50 text-slate-500 cursor-not-allowed"
                             value={`${selectedCapability.command_name}(gpio_${selectedCapability.gpio_pin ?? "?"}, value)`}
                             readOnly
                             disabled
                           />
                         </label>
                       )}
                     </>
                   )}
                  {bindingType === "virtual" && definition.bindingMode !== "static" && (
                    definition.id === "multi_telemetry_chart" ? (
                      <div className="space-y-2">
                         <span className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:editor.datastreams_multi", "Kênh dữ liệu (Chọn nhiều)")}</span>
                        <div className="max-h-40 overflow-y-auto border border-slate-200 dark:border-border-subtle rounded-xl p-3 bg-slate-50 dark:bg-app space-y-2">
                          {datastreamOptions.map((ds) => {
                            const isChecked = Array.isArray(draft.binding.datastream_ids) && draft.binding.datastream_ids.includes(ds.id);
                            return (
                              <label key={ds.id} className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    const currentIds = Array.isArray(draft.binding.datastream_ids) ? draft.binding.datastream_ids : [];
                                    const currentChannels = Array.isArray(draft.binding.channels) ? draft.binding.channels : [];
                                    
                                    let nextIds: string[];
                                    let nextChannels: string[];
                                    
                                    const pinStr = `v${ds.pin}`;
                                    const chan = `ch_${pinStr}`;
                                    
                                    if (e.target.checked) {
                                      nextIds = [...currentIds, ds.id];
                                      nextChannels = [...currentChannels, chan];
                                    } else {
                                      nextIds = currentIds.filter(id => id !== ds.id);
                                      nextChannels = currentChannels.filter(c => c !== chan);
                                    }
                                    
                                    setDraft((prev) => ({
                                      ...prev,
                                      binding: {
                                        ...prev.binding,
                                        binding_type: "virtual",
                                        datastream_ids: nextIds,
                                        channels: nextChannels,
                                      }
                                    }));
                                  }}
                                  className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                                />
                                <span className="text-slate-700 dark:text-text-primary">
                                  {ds.name} <span className="text-xs text-slate-400 dark:text-text-muted">(V{ds.pin} · {ds.data_type})</span>
                                </span>
                              </label>
                            );
                          })}
                          {datastreamOptions.length === 0 && (
                            <p className="text-xs text-slate-400">{t("projects:editor.no_datastream_template", "Không có datastream template nào.")}</p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <label>
                           <span className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:editor.datastream", "Kênh dữ liệu")}</span>
                          <select
                            className="input w-full"
                            value={String(draft.binding.datastream_id ?? "")}
                            onChange={(event) => selectDatastream(event.target.value)}
                          >
                            <option value="">
                              {datastreamsQ.isLoading
                                 ? t("projects:editor.loading_datastreams", "Đang tải kênh dữ liệu…")
                                 : datastreamOptions.length === 0
                                   ? t("projects:editor.no_datastreams_note", "Chưa có kênh dữ liệu – hãy tạo tại trang Kênh dữ liệu")
                                   : t("projects:editor.select_datastream_first", "Chọn mẫu kênh dữ liệu trước")}
                            </option>
                            {datastreamOptions.map((ds) => (
                              <option key={ds.id} value={ds.id}>
                                {ds.name} (V{ds.pin})
                              </option>
                            ))}
                          </select>
                          {selectedDatastream && (
                            <span className="mt-1 block text-xs text-slate-500">
                              {t("projects:editor.channel_label", "Kênh:")} <code className="font-mono text-[10px]">ch_v{selectedDatastream.pin}</code>
                              {" · "}{t("projects:editor.type_label", "Kiểu:")} <span className="font-medium">{selectedDatastream.data_type}</span>
                            </span>
                          )}
                        </label>
                        {selectedDatastream && (draft.widget_type === "segmented_control" || draft.widget_type === "dropdown_command_selector") && (
                          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-4 dark:border-border-subtle dark:bg-slate-800/30 space-y-3 md:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 block">
                              {t("projects:editor.button_mode_config", "Cấu hình nút bấm / Chế độ")} ({selectedDatastream.data_type})
                            </span>
                            {selectedDatastream.data_type === "boolean" ? (
                              <div className="grid grid-cols-2 gap-3">
                                <label>
                                  <span className="label-xs text-slate-400 block mb-1">{t("projects:editor.label_false", "Nhãn cho FALSE (0 / OFF)")}</span>
                                  <input
                                    type="text"
                                    className="input w-full bg-white dark:bg-app"
                                    value={(() => {
                                      const opts = parseOptionsCsv(String(draft.config.optionsCsv ?? ""));
                                      const found = opts.find(o => String(o.value) === "false" || String(o.value) === "0");
                                      return found ? found.label : (opts[0]?.label ?? "OFF");
                                    })()}
                                    onChange={(e) => {
                                      const opts = parseOptionsCsv(String(draft.config.optionsCsv ?? ""));
                                      const other = opts.find(o => String(o.value) === "true" || String(o.value) === "1")?.label ?? "ON";
                                      updateDraftField("config", "optionsCsv", `${e.target.value}:false,${other}:true`);
                                    }}
                                  />
                                </label>
                                <label>
                                  <span className="label-xs text-slate-400 block mb-1">{t("projects:editor.label_true", "Nhãn cho TRUE (1 / ON)")}</span>
                                  <input
                                    type="text"
                                    className="input w-full bg-white dark:bg-app"
                                    value={(() => {
                                      const opts = parseOptionsCsv(String(draft.config.optionsCsv ?? ""));
                                      const found = opts.find(o => String(o.value) === "true" || String(o.value) === "1");
                                      return found ? found.label : (opts[1]?.label ?? "ON");
                                    })()}
                                    onChange={(e) => {
                                      const opts = parseOptionsCsv(String(draft.config.optionsCsv ?? ""));
                                      const other = opts.find(o => String(o.value) === "false" || String(o.value) === "0")?.label ?? "OFF";
                                      updateDraftField("config", "optionsCsv", `${other}:false,${e.target.value}:true`);
                                    }}
                                  />
                                </label>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                                  {(() => {
                                    const opts = parseOptionsCsv(String(draft.config.optionsCsv ?? ""));
                                    return opts.map((opt, idx) => (
                                      <div key={idx} className="flex items-center gap-2">
                                        <input
                                          type="text"
                                          placeholder={t("projects:editor.placeholder_display_name", "Tên hiển thị (ví dụ: Tự động)")}
                                          className="input flex-1 bg-white dark:bg-app text-xs"
                                          value={opt.label}
                                          onChange={(e) => {
                                            const next = [...opts];
                                            next[idx] = { ...next[idx], label: e.target.value };
                                            updateDraftField("config", "optionsCsv", next.map(o => `${o.label}:${o.value}`).join(","));
                                          }}
                                        />
                                        <input
                                          type={selectedDatastream.data_type === "integer" || selectedDatastream.data_type === "double" ? "number" : "text"}
                                          placeholder={t("projects:editor.placeholder_send_value", "Giá trị gửi đi (ví dụ: 2)")}
                                          className="input w-28 bg-white dark:bg-app text-xs"
                                          value={String(opt.value)}
                                          onChange={(e) => {
                                            const next = [...opts];
                                            next[idx] = { ...next[idx], value: e.target.value };
                                            updateDraftField("config", "optionsCsv", next.map(o => `${o.label}:${o.value}`).join(","));
                                          }}
                                        />
                                        <button
                                          type="button"
                                          className="btn-icon text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 p-1.5 rounded-lg transition"
                                          onClick={() => {
                                            const next = opts.filter((_, i) => i !== idx);
                                            updateDraftField("config", "optionsCsv", next.map(o => `${o.label}:${o.value}`).join(","));
                                          }}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      </div>
                                    ));
                                  })()}
                                </div>
                                <button
                                  type="button"
                                  className="btn-secondary w-full text-xs py-1.5 flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 bg-white dark:bg-surface dark:border-border-subtle"
                                  onClick={() => {
                                    const opts = parseOptionsCsv(String(draft.config.optionsCsv ?? ""));
                                    const nextVal = selectedDatastream.data_type === "integer" || selectedDatastream.data_type === "double"
                                      ? String(opts.length)
                                      : `val_${opts.length}`;
                                     const next = [...opts, { label: t("projects:editor.mode_number", "Chế độ {{number}}", { number: opts.length + 1 }), value: nextVal }];
                                    updateDraftField("config", "optionsCsv", next.map(o => `${o.label}:${o.value}`).join(","));
                                  }}
                                >
                                  {t("projects:editor.add_option", "+ Thêm tùy chọn")}
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        {selectedDatastream && ["numeric_input", "slider_control", "stepper_control", "knob_dial_control"].includes(draft.widget_type) && (
                          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-4 dark:border-border-subtle dark:bg-slate-800/30 space-y-3 md:col-span-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500 block">
                               {t("projects:editor.limit_config", "Cấu hình giới hạn")} ({selectedDatastream.data_type})
                            </span>
                            <div className="grid grid-cols-3 gap-3">
                              <label>
                                <span className="label-xs text-slate-400 block mb-1">{t("projects:editor.min_limit", "Tối thiểu")}</span>
                                <input
                                  type="number"
                                  className="input w-full bg-white dark:bg-app text-xs"
                                  value={typeof draft.config.min === "number" ? draft.config.min : ""}
                                  placeholder={String(selectedDatastream.min_value ?? 0)}
                                  onChange={(e) => updateDraftField("config", "min", e.target.value === "" ? null : Number(e.target.value))}
                                />
                              </label>
                              <label>
                                <span className="label-xs text-slate-400 block mb-1">{t("projects:editor.max_limit", "Tối đa")}</span>
                                <input
                                  type="number"
                                  className="input w-full bg-white dark:bg-app text-xs"
                                  value={typeof draft.config.max === "number" ? draft.config.max : ""}
                                  placeholder={String(selectedDatastream.max_value ?? 100)}
                                  onChange={(e) => updateDraftField("config", "max", e.target.value === "" ? null : Number(e.target.value))}
                                />
                              </label>
                              <label>
                                <span className="label-xs text-slate-400 block mb-1">{t("projects:editor.step_limit", "Bước tăng")}</span>
                                <input
                                  type="number"
                                  className="input w-full bg-white dark:bg-app text-xs"
                                  value={typeof draft.config.step === "number" ? draft.config.step : ""}
                                  placeholder="1"
                                  onChange={(e) => updateDraftField("config", "step", e.target.value === "" ? null : Number(e.target.value))}
                                />
                              </label>
                            </div>
                            <span className="text-[10px] text-slate-400 block">
                              {t("projects:editor.default_datastream_min", "Mặc định theo cấu hình Datastream: Min:")} {selectedDatastream.min_value ?? 0} · Max: {selectedDatastream.max_value ?? 100}
                            </span>
                          </div>
                        )}
                      </>
                    )
                  )}
                </div>
              </div>
            )}

            {dataFields.length > 0 && (
              <WidgetFieldSections fields={dataFields} draft={draft} onFieldChange={updateDraftField} definition={definition} />
            )}
          </>
        ) : activeTab === "design" ? (
          <>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border-subtle dark:bg-app">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t("projects:editor.section_title", "Tiêu đề")}</p>
              <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
                <label>
                  <span className="label-xs mb-1">{t("projects:editor.title_label", "Tiêu đề")}</span>
                  <input className="input" value={draft.title} onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))} />
                </label>
                <label>
                  <span className="label-xs mb-1">{t("projects:editor.sort_order_label", "Thứ tự sắp xếp")}</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={draft.sort_order ?? 0}
                    onChange={(event) => setDraft((prev) => ({ ...prev, sort_order: Number(event.target.value) }))}
                  />
                </label>
              </div>
            </div>

            {layoutFields.length > 0 && (
              <WidgetFieldSections fields={layoutFields} draft={draft} onFieldChange={updateDraftField} definition={definition} />
            )}
            {appearanceFields.length > 0 && (
              <WidgetFieldSections fields={appearanceFields} draft={draft} onFieldChange={updateDraftField} definition={definition} />
            )}
            {labelFields.length > 0 && (
              <WidgetFieldSections fields={labelFields} draft={draft} onFieldChange={updateDraftField} definition={definition} />
            )}
            {contentFields.length > 0 && (
              <WidgetFieldSections fields={contentFields} draft={draft} onFieldChange={updateDraftField} definition={definition} />
            )}

            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border-subtle dark:bg-app">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t("projects:editor.preview", "Xem trước")}</p>
                <p className="text-[11px] text-slate-500 dark:text-text-muted">{t("projects:editor.preview_updates_live", "Cập nhật trực tiếp theo thiết kế")}</p>
              </div>
              <div className="mt-4 overflow-x-auto">
                <div className="mx-auto" style={previewStyle}>
                  <Card className="min-h-0 overflow-hidden">
                    <WidgetChrome
                      widget={previewWidget}
                      definition={definition}
                      device={selectedDevice}
                      visualState={previewVisualState}
                      readOnly
                      actionsEnabled={false}
                      onEdit={() => undefined}
                      onDelete={() => undefined}
                    >
                      <PreviewRenderer
                        widget={previewWidget}
                        definition={definition}
                        device={selectedDevice}
                        latestState={previewState}
                        visualState={previewVisualState}
                        readOnly
                        onCommand={() => undefined}
                      />
                    </WidgetChrome>
                  </Card>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-border-subtle dark:bg-app">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{t("projects:editor.search_widget", "Tìm widget")}</p>
              <div className="mt-3">
                <WidgetTypeSelector
                  definition={definition}
                  search={search}
                  onSearchChange={setSearch}
                  availableTypes={availableTypes}
                  onSelectType={selectType}
                />
              </div>
            </div>
          </>
        )}


        {errors.length > 0 && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            {errors.map((item) => <p key={item}>{item}</p>)}
          </div>
        )}
        {saveMut.isError && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
            {saveErrorMessage}
          </div>
        )}
      </form>
    </Modal>
  );
}
