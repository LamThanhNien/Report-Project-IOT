import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { Device, DeviceCapability, ProjectWidget } from "../../types";

export type WidgetCategory =
  | "control"
  | "display"
  | "chart"
  | "status"
  | "utility";

export type WidgetBindingMode = "command" | "telemetry" | "commandTelemetry" | "static";
export type WidgetFieldScope = "config" | "layout" | "binding";
export type WidgetFieldKind =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "color"
  | "boolean"
  | "range";

export interface WidgetDraft {
  widget_type: string;
  title: string;
  sort_order?: number;
  layout: Record<string, unknown>;
  config: Record<string, unknown>;
  binding: Record<string, unknown>;
}

export interface WidgetEditorFieldOption {
  label: string;
  value: string;
  /** Optional i18next key. The label remains the English/fallback value. */
  labelKey?: string;
}

export interface WidgetEditorField {
  key: string;
  label: string;
  /** Optional i18next key. Defaults to projects:editor.ui.field.<key>. */
  labelKey?: string;
  kind: WidgetFieldKind;
  scope: WidgetFieldScope;
  section: string;
  description?: string;
  /** Optional i18next key. Defaults to projects:editor.ui.field_desc.<key>. */
  descriptionKey?: string;
  placeholder?: string;
  /** Optional i18next key for input placeholders. */
  placeholderKey?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: WidgetEditorFieldOption[];
  visible?: (draft: WidgetDraft) => boolean;
}

export interface WidgetRuntimeState {
  optimisticValue?: unknown;
  pending: boolean;
  lastCommandAt: number;
  commandExpectedValue?: unknown;
  error: string | null;
  previousValue?: unknown;
  commandId?: number;
}

export interface WidgetVisualState {
  status: "idle" | "online" | "offline" | "stale" | "error";
  message: string | null;
}

export interface WidgetCommandRequest {
  deviceId: string;
  command: string;
  params: Record<string, unknown>;
  widgetId: string;
  expectedValue?: unknown;
  previousValue?: unknown;
}

export interface WidgetRenderProps {
  widget: ProjectWidget;
  definition: WidgetDefinition;
  device?: Device;
  latestState: Record<string, unknown>;
  visualState: WidgetVisualState;
  runtimeState?: WidgetRuntimeState;
  projectName?: string;
  readOnly?: boolean;
  onCommand: (request: WidgetCommandRequest) => void;
}

export interface WidgetBindingCapabilities {
  requiresDevice?: boolean;
  requiresCapability?: boolean;
  requiresTelemetryField?: boolean;
  supportsManualTelemetry?: boolean;
  supportsGpioOverride?: boolean;
  allowOfflineCommand?: boolean;
  capabilityTypes?: string[];
}

export interface WidgetDatastreamCompatibility {
  dataTypes?: string[];
  directions?: string[];
  virtualOnly?: boolean;
}

export interface WidgetDefinition {
  id: string;
  legacyIds?: string[];
  label: string;
  category: WidgetCategory;
  icon: LucideIcon;
  description: string;
  bindingMode: WidgetBindingMode;
  defaultSize: { colSpan: number; rowSpan: number };
  defaultConfig: Record<string, unknown>;
  configSchema: Record<string, unknown>;
  validationRules: string[];
  editorFields: WidgetEditorField[];
  renderer: ComponentType<WidgetRenderProps>;
  binding: WidgetBindingCapabilities;
  datastream?: WidgetDatastreamCompatibility;
  hidden?: boolean;
}

export interface WidgetCapabilityContext {
  definition: WidgetDefinition;
  capabilities: DeviceCapability[];
}
