import { useEffect, useMemo, useState, type FormEvent } from "react";
import { usePersistedState } from "../../../hooks/usePersistedState";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useProjectScope } from "../../../hooks/useProjectScope";
import {
  CheckCircle,
  Clock,
  Copy,
  Edit3,
  FileCode2,
  History,
  Plus,
  Search,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  commandCenterApi,
  type CommandDispatch,
  type CommandDispatchData,
  type CommandTemplate,
  type CommandTemplateUpdateData,
} from "../../../services/commandCenterApi";
import { listClientDevices } from "../../../services/clientApi";
import { deviceGroupApi, type DeviceGroup } from "../../../services/deviceGroupApi";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { DataTable, type Column } from "../../../components/ui/DataTable";
import { MetricCard } from "../../../components/ui/MetricCard";
import { Modal } from "../../../components/ui/Modal";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { ReadOnlyNotice } from "../../../components/permissions/PermissionGate";
import { useAuth } from "../../../contexts/AuthContext";
import { cn } from "../../../lib/cn";
import {
  canManageCommandTemplates,
  canSendCommands,
  canViewCommands,
  canViewCommandTemplates,
} from "../../../lib/permissions";
import { formatRelative } from "../../../lib/formatters";
import { statusLabel, statusToTone } from "../../../lib/statusHelper";
import type { Device } from "../../../types";

type TabKey = "templates" | "send" | "history";
type TemplateFilter = "all" | "custom" | "system" | "recent";
type CommandCenterLocationState = {
  tab?: TabKey;
  targetType?: "device" | "group";
  groupId?: string;
  deviceId?: string;
};

const COMMAND_TYPES = [
  { value: "set_output", label: "Set Output" },
  { value: "toggle_output", label: "Toggle Output" },
  { value: "request_status", label: "Request Status" },
  { value: "request_telemetry", label: "Request Telemetry" },
  { value: "reboot", label: "Reboot" },
  { value: "custom", label: "Custom" },
];

function getCommandTypes(t?: (key: string, fallback: string) => string) {
  return [
    { value: "set_output", label: t ? t("devices:cmd.type_set_output", "Đặt ngõ ra (Set Output)") : "Set Output" },
    { value: "toggle_output", label: t ? t("devices:cmd.type_toggle_output", "Đảo ngõ ra (Toggle Output)") : "Toggle Output" },
    { value: "request_status", label: t ? t("devices:cmd.type_request_status", "Yêu cầu trạng thái (Request Status)") : "Request Status" },
    { value: "request_telemetry", label: t ? t("devices:cmd.type_request_telemetry", "Yêu cầu Telemetry (Request Telemetry)") : "Request Telemetry" },
    { value: "reboot", label: t ? t("devices:cmd.type_reboot", "Khởi động lại (Reboot)") : "Reboot" },
    { value: "custom", label: t ? t("devices:cmd.type_custom", "Tùy chỉnh (Custom)") : "Custom" },
  ];
}

const COMMAND_PAYLOAD_TEMPLATES: Record<string, Record<string, unknown>> = {
  set_output: {
    pin: 2,
    state: true,
    duration_ms: 0,
  },
  toggle_output: {
    pin: 2,
    duration_ms: 0,
  },
  request_status: {
    include: ["status", "firmware", "uptime", "network"],
  },
  request_telemetry: {
    metrics: ["temperature", "humidity", "rssi"],
    once: true,
  },
  reboot: {
    delay_ms: 1000,
    reason: "manual_reboot",
  },
  custom: {},
};

function getCommandDescriptions(t?: (key: string, fallback: string) => string): Record<string, string> {
  return {
    set_output: t ? t("devices:cmd.desc_set_output", "Set GPIO/output state on selected device.") : "Set GPIO/output state on selected device.",
    toggle_output: t ? t("devices:cmd.desc_toggle_output", "Toggle GPIO/output state on selected device.") : "Toggle GPIO/output state on selected device.",
    request_status: t ? t("devices:cmd.desc_request_status", "Request device to send current status.") : "Request device to send current status.",
    request_telemetry: t ? t("devices:cmd.desc_request_telemetry", "Request device to send telemetry immediately.") : "Request device to send telemetry immediately.",
    reboot: t ? t("devices:cmd.desc_reboot", "Request device to reboot after optional delay.") : "Request device to reboot after optional delay.",
    custom: t ? t("devices:cmd.desc_custom", "Send custom payload according to firmware schema.") : "Send custom payload according to firmware schema.",
  };
}

function getTemplateFilters(t?: (key: string, fallback: string) => string): { key: TemplateFilter; label: string }[] {
  return [
    { key: "all", label: t ? t("common:all", "All") : "All" },
    { key: "custom", label: t ? t("devices:cmd.filter_tenant", "Tenant") : "Tenant" },
    { key: "system", label: t ? t("common:system", "System") : "System" },
    { key: "recent", label: t ? t("common:filter.recent", "Recently Updated") : "Recently Updated" },
  ];
}

function prettyJson(value: Record<string, unknown>): string {
  return JSON.stringify(value, null, 2);
}

function templateForCommand(commandType: string): string {
  return prettyJson(COMMAND_PAYLOAD_TEMPLATES[commandType] ?? {});
}

function isEmptyPayload(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  try {
    const parsed = JSON.parse(trimmed);
    return Boolean(parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length === 0);
  } catch {
    return false;
  }
}

function shouldAutoApplyTemplate(payload: string, previousAutoTemplate: string): boolean {
  return isEmptyPayload(payload) || payload.trim() === previousAutoTemplate.trim();
}

function parsePayload(value: string): { payload: Record<string, unknown> | null; error: string | null } {
  if (!value.trim()) return { payload: {}, error: null };
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { payload: null, error: "Payload phải là một JSON object." };
    }
    return { payload: parsed as Record<string, unknown>, error: null };
  } catch (error) {
    return {
      payload: null,
      error: error instanceof Error ? `JSON không hợp lệ: ${error.message}` : "JSON không hợp lệ.",
    };
  }
}

function formatDate(value: string | null | undefined, locale = "vi-VN"): string {
  return value ? new Date(value).toLocaleString(locale) : "-";
}

function errorMessage(error: unknown): string | null {
  return error instanceof Error ? error.message : error ? "Không thể xử lý yêu cầu." : null;
}

function compactDate(value: string | null | undefined, locale = "vi-VN"): string {
  return value ? new Date(value).toLocaleString(locale) : "-";
}

function deviceOptionLabel(t: any, device: Device, locale = "vi-VN"): string {
  const details = [
    statusLabel(device.status),
    device.firmware_version ? t("devices:cmd.fw_prefix", "FW ") + device.firmware_version : null,
    device.mac_address || device.device_uid,
    device.last_seen_at ? t("devices:cmd.last_seen", "last seen {{time}}", { time: compactDate(device.last_seen_at, locale) }) : null,
  ].filter(Boolean);
  return `${device.name || device.device_uid}${details.length ? ` - ${details.join(" · ")}` : ""}`;
}

function groupOptionLabel(t: any, group: DeviceGroup): string {
  const details = [
    t("devices:cmd.device_count", "{{count}} thiết bị", { count: group.device_count ?? 0 }),
    statusLabel(group.status),
    group.description,
  ].filter(Boolean);
  return `${group.name}${details.length ? ` - ${details.join(" · ")}` : ""}`;
}

function searchTargetText(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

export default function ClientCommandCenter({ scopedProjectId }: { scopedProjectId?: string } = {}) {
  const { t, i18n } = useTranslation(["devices", "common"]);
  const dateLocale = i18n.language === "en" ? "en-US" : "vi-VN";
  const { isWorkspace, projectId } = useProjectScope();
  const effectiveProjectId = scopedProjectId || projectId;
  const { user } = useAuth();
  const location = useLocation();
  const routeState = (location.state as CommandCenterLocationState | null) ?? {};
  const canViewTemplates = canViewCommandTemplates(user);
  const canManageTemplates = canManageCommandTemplates(user);
  const canViewHistory = canViewCommands(user);
  const canSend = canSendCommands(user);
  const commandTemplatesQueryKey = useMemo(
    () => ["command-templates", user?.tenant_id ?? "no-tenant", user?.id ?? "anonymous"],
    [user?.tenant_id, user?.id],
  );
  const commandHistorySummaryQueryKey = useMemo(
    () => ["command-history-summary", user?.tenant_id ?? "no-tenant", user?.id ?? "anonymous"],
    [user?.tenant_id, user?.id],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get("tab") as TabKey | null;

  const [useTemplatePayload, setUseTemplatePayload] = useState<{
    command_type: string;
    payload: Record<string, unknown>;
  } | null>(null);

  const templatesQuery = useQuery({
    queryKey: [...commandTemplatesQueryKey, effectiveProjectId],
    queryFn: () => commandCenterApi.listTemplates(effectiveProjectId || undefined),
    enabled: !!user?.tenant_id && canViewTemplates,
  });

  const historyQuery = useQuery({
    queryKey: [...commandHistorySummaryQueryKey, effectiveProjectId],
    queryFn: () => commandCenterApi.listHistory({ project_id: effectiveProjectId || undefined }),
    enabled: !!user?.tenant_id && canViewHistory,
  });

  const templates = templatesQuery.data ?? [];
  const history = historyQuery.data?.items ?? [];
  const completed = history.filter((dispatch) => dispatch.status === "completed").length;

  const tabs: { key: TabKey; label: string; icon: typeof FileCode2 }[] = useMemo(
    () => [
      ...(canViewTemplates ? [{ key: "templates" as const, label: t("devices:cmd.tab_templates", "Templates"), icon: FileCode2 }] : []),
      ...(canSend ? [{ key: "send" as const, label: t("devices:cmd.tab_send", "Send Command"), icon: Send }] : []),
      ...(canViewHistory ? [{ key: "history" as const, label: t("devices:cmd.tab_history", "Command History"), icon: History }] : []),
    ],
    [canViewTemplates, canSend, canViewHistory, t],
  );

  const activeTab: TabKey = useMemo(() => {
    if (urlTab && tabs.some((t) => t.key === urlTab)) return urlTab;
    if (routeState.tab === "send" && canSend) return "send";
    if (tabs.length > 0) return tabs[0].key;
    return "templates";
  }, [urlTab, tabs, routeState.tab, canSend]);

  const setActiveTab = (tab: TabKey) => {
    setSearchParams(
      (prev) => {
        prev.set("tab", tab);
        return prev;
      },
      { replace: true },
    );
  };

  const handleUseTemplate = (template: CommandTemplate) => {
    if (!canSend) return;
    setUseTemplatePayload({
      command_type: template.command_type,
      payload: template.payload_template,
    });
    setActiveTab("send");
  };

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      <PageHeader
        crumbs={isWorkspace ? [{ label: "Workspace", to: `/client/workspace/${effectiveProjectId}/home` }, { label: t("devices:cmd.page_title", "Trung tâm Lệnh") }] : [{ label: "Tenant", to: "/client/dashboard" }, { label: t("devices:cmd.page_title", "Trung tâm Lệnh") }]}
        title={t("devices:cmd.page_title", "Trung tâm Lệnh")}
        subtitle={t("devices:cmd.page_subtitle", "Manage command templates, send commands to devices or device groups, and track command execution status.")}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label={t("devices:cmd.metric_templates", "Mẫu lệnh")} value={templates.length} icon={<FileCode2 className="h-4 w-4" />} loading={templatesQuery.isLoading} />
        <MetricCard label={t("devices:cmd.metric_recent", "Lệnh gần đây")} value={history.length} icon={<Clock className="h-4 w-4" />} loading={historyQuery.isLoading} />
        <MetricCard label={t("devices:cmd.metric_completed", "Hoàn thành")} value={completed} icon={<CheckCircle className="h-4 w-4" />} tone="success" loading={historyQuery.isLoading} />
      </div>

      {(!canManageTemplates || !canSend) && <ReadOnlyNotice />}

      <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1 dark:border-border-subtle dark:bg-app">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                activeTab === tab.key
                  ? "bg-surface-elevated text-primary shadow-sm dark:bg-surface-muted dark:text-primary"
                  : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-text-muted dark:hover:bg-surface-elevated dark:hover:text-slate-100",
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "templates" && (
        <TemplatesTab
          templates={templates}
          loading={templatesQuery.isLoading}
          error={errorMessage(templatesQuery.error)}
          queryKey={commandTemplatesQueryKey}
          onUseTemplate={handleUseTemplate}
          canManageTemplates={canManageTemplates}
          canSend={canSend}
        />
      )}
      {activeTab === "send" && (
        <SendCommandTab
          useTemplatePayload={useTemplatePayload}
          onClearUseTemplate={() => setUseTemplatePayload(null)}
          canSend={canSend}
          initialTarget={
            routeState.targetType
              ? {
                  targetType: routeState.targetType,
                  targetId: routeState.targetType === "group" ? routeState.groupId ?? "" : routeState.deviceId ?? "",
                }
              : undefined
          }
          scopedProjectId={effectiveProjectId || undefined}
          dateLocale={dateLocale}
        />
      )}
      {activeTab === "history" && <HistoryTab dateLocale={dateLocale} />}
    </div>
  );
}

function TemplatesTab({
  templates,
  loading,
  error,
  queryKey,
  onUseTemplate,
  canManageTemplates,
  canSend,
}: {
  templates: CommandTemplate[];
  loading: boolean;
  error: string | null;
  queryKey: readonly unknown[];
  onUseTemplate: (template: CommandTemplate) => void;
  canManageTemplates: boolean;
  canSend: boolean;
}) {
  const { t } = useTranslation(["devices", "common"]);
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editTemplate, setEditTemplate] = useState<CommandTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommandTemplate | null>(null);
  const [search, setSearch] = usePersistedState("aifom_clientcommandcenter_search", "", "session");
  const [filter, setFilter] = useState<TemplateFilter>("all");

  const createMutation = useMutation({
    mutationFn: commandCenterApi.createTemplate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setShowCreate(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CommandTemplateUpdateData }) =>
      commandCenterApi.updateTemplate(id, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setEditTemplate(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: commandCenterApi.deleteTemplate,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setDeleteTarget(null);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: (template: CommandTemplate) =>
      commandCenterApi.createTemplate({
        name: `${template.name} ${t("devices:cmd.copied_suffix", "(Sao chép)")}`,
        description: template.description ?? undefined,
        command_type: template.command_type,
        payload_template: template.payload_template,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const filteredTemplates = useMemo(() => {
    let result = templates;

    if (filter === "custom") {
      result = result.filter((template) => !template.is_system);
    } else if (filter === "system") {
      result = result.filter((template) => template.is_system);
    } else if (filter === "recent") {
      const oneDayAgo = Date.now() - 86400 * 1000;
      result = result.filter((template) => {
        const date = template.updated_at || template.created_at;
        return date ? new Date(date).getTime() > oneDayAgo : false;
      });
    }

    const query = search.trim().toLowerCase();
    if (query) {
      result = result.filter((template) =>
        [
          template.name,
          template.description ?? "",
          template.command_type,
          template.is_system ? "he thong system" : "tenant custom",
        ]
          .join(" ")
          .toLowerCase()
          .includes(query),
      );
    }

    return result;
  }, [filter, search, templates]);

  if (error) {
    return <div className="card p-5 text-sm text-rose-600 dark:text-rose-300">{error}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 dark:border-border-subtle pb-4 pt-1">
        <TemplateSearchAndFilters
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={setFilter}
        />
        {canManageTemplates && (
          <button onClick={() => setShowCreate(true)} className="btn-primary shrink-0">
            <Plus className="h-4 w-4" />
            {t("devices:cmd.create_template", "Tạo mẫu lệnh")}
          </button>
        )}
      </div>

      {loading ? (
        <div className="card p-8 text-center text-sm text-slate-500 dark:text-text-muted">{t("devices:cmd.loading_templates", "Đang tải mẫu lệnh...")}</div>
      ) : templates.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-sm font-medium text-slate-900 dark:text-text-primary">{t("devices:cmd.no_templates", "Chưa có mẫu lệnh")}</div>
          <div className="mt-1 text-sm text-slate-500 dark:text-text-muted">{t("devices:cmd.no_templates_desc", "Tạo mẫu đầu tiên để tái sử dụng payload khi gửi lệnh.")}</div>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-sm text-slate-500">{t("devices:cmd.no_match", "Không có mẫu lệnh nào khớp với tìm kiếm hoặc bộ lọc.")}</p>
          <button
            className="btn-ghost mt-2 text-sm"
            onClick={() => {
              setSearch("");
              setFilter("all");
            }}
          >
            {t("devices:cmd.clear_filters", "Xóa bộ lọc")}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredTemplates.map((template) => {
            const updatedAt = template.updated_at || template.created_at;
            const payloadPreview = prettyJson(template.payload_template);

            return (
              <Card key={template.id} className="group relative overflow-hidden flex flex-col border border-slate-200/80 bg-white shadow-sm transition-all duration-150 hover:border-slate-400 hover:bg-slate-50/40 dark:border-border-subtle dark:bg-surface dark:hover:border-slate-700 dark:hover:bg-surface-elevated/40">
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="truncate text-base transition-colors duration-150 group-hover:text-brand-600 dark:group-hover:text-brand-400">{template.name}</CardTitle>
                      <span
                        className={cn(
                          "chip shrink-0",
                          template.is_system
                            ? "bg-surface-elevated text-primary dark:bg-surface-muted dark:text-primary"
                            : "bg-slate-100 text-slate-600 dark:bg-surface-elevated dark:text-text-muted",
                        )}
                      >
                        {template.is_system ? t("devices:cmd.type_system", "Hệ thống") : t("devices:cmd.type_tenant", "Tenant")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {t("devices:cmd.updated_at", "Cập nhật ")}{updatedAt ? formatRelative(updatedAt) : "-"}
                    </p>
                  </div>
                  {canManageTemplates && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setEditTemplate(template)}
                        className="btn-secondary h-8 w-8 p-0"
                        title={t("common:actions.edit", "Sửa")}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateMutation.mutate(template)}
                        disabled={duplicateMutation.isPending}
                        className="btn-secondary h-8 w-8 p-0"
                        title={t("common:actions.duplicate", "Nhân bản")}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      {!template.is_system && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(template)}
                          className="btn-secondary h-8 w-8 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                          title={t("common:actions.delete", "Xóa")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardBody>
                  <p className="min-h-[2.5rem] text-sm text-slate-600 dark:text-text-muted">
                    {template.description || t("devices:cmd.no_description", "Không có mô tả")}
                  </p>

                  <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <FileCode2 className="h-3.5 w-3.5" />
                      {template.command_type}
                    </span>
                    <span>{Object.keys(template.payload_template ?? {}).length}{t("devices:cmd.payload_fields", " trường payload")}</span>
                  </div>

                  <div className="mt-4 rounded-md bg-slate-50 p-3 dark:bg-surface/60">
                    <pre className="line-clamp-3 text-xs font-mono leading-relaxed text-slate-600 dark:text-text-muted">
                      {payloadPreview.slice(0, 160)}
                      {payloadPreview.length > 160 ? "..." : ""}
                    </pre>
                  </div>

                  {canSend && (
                    <button type="button" onClick={() => onUseTemplate(template)} className="btn-primary mt-4 w-full">
                      <Send className="h-4 w-4" />
                      {t("devices:cmd.use_template", "Dùng mẫu")}
                    </button>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {canManageTemplates && showCreate && (
        <CommandTemplateDetailModal
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onSubmit={(data) => createMutation.mutate({ ...data, description: data.description ?? undefined })}
          isLoading={createMutation.isPending}
          error={errorMessage(createMutation.error)}
        />
      )}

      {canManageTemplates && editTemplate && (
        <CommandTemplateDetailModal
          open={!!editTemplate}
          onClose={() => setEditTemplate(null)}
          template={editTemplate}
          onSubmit={(data) =>
            updateMutation.mutate({ id: editTemplate.id, data })
          }
          isLoading={updateMutation.isPending}
          error={errorMessage(updateMutation.error)}
        />
      )}

      {canManageTemplates && deleteTarget && (
        <DeleteConfirmModal
          open={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          templateName={deleteTarget.name}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          isLoading={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

function TemplateSearchAndFilters({
  search,
  onSearchChange,
  filter,
  onFilterChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  filter: TemplateFilter;
  onFilterChange: (filter: TemplateFilter) => void;
}) {
  const { t } = useTranslation(["devices", "common"]);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative max-w-sm flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9 pr-8"
          placeholder={t("devices:cmd.search_template", "Tìm mẫu lệnh...")}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        {search && (
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            onClick={() => onSearchChange("")}
            aria-label={t("common:actions.clear_search", "Xóa tìm kiếm")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="scrollbar-hide flex items-center gap-1 overflow-x-auto">
        {getTemplateFilters(t).map((item) => (
          <button
            key={item.key}
            className={cn(
              "chip whitespace-nowrap transition-colors",
              filter === item.key
                ? "bg-surface-elevated text-primary dark:bg-surface-muted dark:text-primary"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-surface-elevated dark:text-text-muted dark:hover:bg-surface-muted",
            )}
            onClick={() => onFilterChange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CommandTemplateDetailModal({
  open,
  onClose,
  template,
  onSubmit,
  isLoading,
  error,
}: {
  open: boolean;
  onClose: () => void;
  template?: CommandTemplate;
  onSubmit: (data: { name: string; description?: string | null; command_type: string; payload_template?: Record<string, unknown> }) => void;
  isLoading: boolean;
  error: string | null;
}) {
  const { t } = useTranslation(["devices", "common"]);
  const isEdit = !!template;
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [commandType, setCommandType] = useState(template?.command_type ?? "set_output");
  const [payload, setPayload] = useState(() => prettyJson(template?.payload_template ?? COMMAND_PAYLOAD_TEMPLATES["set_output"]));
  const [localError, setLocalError] = useState("");

  const handleCommandTypeChange = (type: string) => {
    setCommandType(type);
    if (!isEdit) {
      setPayload(templateForCommand(type));
    }
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(payload);
      setPayload(JSON.stringify(parsed, null, 2));
      setLocalError("");
    } catch {
      setLocalError(t("devices:cmd.err_json_format", "Không thể format JSON do cú pháp không hợp lệ. Vui lòng sửa lỗi trước."));
    }
  };

  const handleResetPayload = () => {
    setPayload(templateForCommand(commandType));
    setLocalError("");
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError("");

    if (!name.trim()) {
      setLocalError(t("devices:cmd.err_template_name_empty", "Tên mẫu lệnh không được để trống."));
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(payload);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setLocalError(t("devices:cmd.err_payload_must_be_object", "Payload phải là một JSON object, không phải mảng hay giá trị đơn."));
        return;
      }
    } catch (e) {
      setLocalError(e instanceof Error ? t("devices:cmd.err_invalid_json_with_msg", "JSON không hợp lệ: {{msg}}", { msg: e.message }) : t("devices:cmd.err_invalid_json", "JSON không hợp lệ."));
      return;
    }

    const trimmedDescription = description.trim();
    onSubmit({
      name: name.trim(),
      description: trimmedDescription || (isEdit ? null : undefined),
      command_type: commandType,
      payload_template: parsed,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? t("devices:cmd.modal_edit_title", "Chỉnh sửa mẫu lệnh") : t("devices:cmd.modal_create_title", "Tạo mẫu lệnh mới")} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">{t("devices:cmd.form_name", "Tên mẫu lệnh *")}</label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            className="input w-full"
            placeholder={t("devices:cmd.form_name_placeholder", "VD: Khởi động lại thiết bị")}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">{t("devices:cmd.form_desc", "Mô tả")}</label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="input min-h-16 w-full"
            rows={2}
            placeholder={t("devices:cmd.form_desc_placeholder", "Mô tả ngắn về mẫu lệnh này...")}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">{t("devices:cmd.form_command_type", "Loại lệnh")}</label>
          <select
            value={commandType}
            onChange={(event) => handleCommandTypeChange(event.target.value)}
            className="input w-full"
          >
            {getCommandTypes(t).map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500 dark:text-text-muted">
            {getCommandDescriptions(t)[commandType] ?? t("devices:cmd.select_type_hint", "Chọn loại lệnh phù hợp với mục đích sử dụng.")}
          </p>
        </div>

        <div>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <label className="block text-sm font-medium">Payload (JSON)</label>
            <div className="flex items-center gap-1">
              <button type="button" onClick={handleFormatJson} className="btn-secondary h-7 px-2 text-xs" title="Format JSON">
                Format JSON
              </button>
              <button type="button" onClick={handleResetPayload} className="btn-secondary h-7 px-2 text-xs" title={t("devices:cmd.form_reset_title", "Đặt lại payload mặc định")}>
                Reset
              </button>
            </div>
          </div>
          <textarea
            value={payload}
            onChange={(event) => {
              setPayload(event.target.value);
              setLocalError("");
            }}
            className="input min-h-32 w-full font-mono text-sm"
            rows={8}
            placeholder='{"key": "value"}'
          />
        </div>

        {(localError || error) && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            {localError || error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t("common:actions.cancel", "Hủy")}
          </button>
          <button type="submit" disabled={isLoading || !name.trim()} className="btn-primary">
            {isLoading ? t("common:actions.processing", "Đang xử lý...") : isEdit ? t("common:actions.save_changes", "Lưu thay đổi") : t("common:actions.create", "Tạo mẫu")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteConfirmModal({
  open,
  onClose,
  templateName,
  onConfirm,
  isLoading,
}: {
  open: boolean;
  onClose: () => void;
  templateName: string;
  onConfirm: () => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation(["devices", "common"]);
  return (
    <Modal open={open} onClose={onClose} title={t("devices:cmd.modal_delete_title", "Xác nhận xóa")}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-text-secondary">
          {t("devices:cmd.modal_delete_desc", "Bạn có chắc chắn muốn xóa mẫu lệnh")} <strong>"{templateName}"</strong>{t("devices:cmd.modal_delete_desc_suffix", "? Hành động này không thể hoàn tác.")}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t("common:actions.cancel", "Hủy")}
          </button>
          <button type="button" onClick={onConfirm} disabled={isLoading} className="btn-danger">
            {isLoading ? t("common:actions.deleting", "Đang xóa...") : t("common:actions.delete", "Xóa")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SendCommandTab({
  useTemplatePayload,
  onClearUseTemplate,
  canSend,
  initialTarget,
  scopedProjectId,
  dateLocale = "vi-VN",
}: {
  useTemplatePayload: { command_type: string; payload: Record<string, unknown> } | null;
  onClearUseTemplate: () => void;
  canSend: boolean;
  initialTarget?: { targetType: "device" | "group"; targetId: string };
  scopedProjectId?: string;
  dateLocale?: string;
}) {
  const { t } = useTranslation(["devices", "common"]);
  const [commandType, setCommandType] = useState(useTemplatePayload?.command_type ?? "set_output");
  const [targetType, setTargetType] = useState<"device" | "group">(initialTarget?.targetType ?? "device");
  const [selectedTargetId, setSelectedTargetId] = useState(initialTarget?.targetId ?? "");
  const [targetSearch, setTargetSearch] = useState("");
  const [payload, setPayload] = useState(() =>
    useTemplatePayload ? prettyJson(useTemplatePayload.payload) : templateForCommand("set_output"),
  );
  const [lastAutoTemplate, setLastAutoTemplate] = useState(
    () => (useTemplatePayload ? prettyJson(useTemplatePayload.payload) : templateForCommand("set_output")),
  );
  const [result, setResult] = useState<CommandDispatch | null>(null);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!useTemplatePayload) return;
    const formattedPayload = prettyJson(useTemplatePayload.payload);
    setCommandType(useTemplatePayload.command_type);
    setPayload(formattedPayload);
    setLastAutoTemplate(formattedPayload);
  }, [useTemplatePayload]);

  useEffect(() => {
    if (!initialTarget?.targetId) return;
    setTargetType(initialTarget.targetType);
    setSelectedTargetId(initialTarget.targetId);
    setTargetSearch("");
    setResult(null);
    setLocalError("");
  }, [initialTarget?.targetId, initialTarget?.targetType]);

  const devicesQuery = useQuery({
    queryKey: ["command-center-devices", scopedProjectId],
    queryFn: () => listClientDevices(scopedProjectId),
    enabled: targetType === "device",
  });

  const groupsQuery = useQuery({
    queryKey: ["command-center-device-groups", scopedProjectId],
    queryFn: () => deviceGroupApi.listDeviceGroups(scopedProjectId ? { limit: 200, project_id: scopedProjectId } : { limit: 200 }),
    enabled: targetType === "group",
  });

  const devices = devicesQuery.data ?? [];
  const groups = groupsQuery.data?.items ?? [];
  const normalizedSearch = searchTargetText(targetSearch.trim());
  const filteredDevices = useMemo(
    () =>
      normalizedSearch
        ? devices.filter((device) => searchTargetText(deviceOptionLabel(t, device, dateLocale)).includes(normalizedSearch))
        : devices,
    [devices, normalizedSearch, dateLocale],
  );
  const filteredGroups = useMemo(
    () =>
      normalizedSearch
        ? groups.filter((group) => searchTargetText(groupOptionLabel(t, group)).includes(normalizedSearch))
        : groups,
    [groups, normalizedSearch],
  );
  const selectedDevice = devices.find((device) => device.id === selectedTargetId);
  const selectedGroup = groups.find((group) => group.id === selectedTargetId);
  const targetQuery = targetType === "device" ? devicesQuery : groupsQuery;
  const hasTargets = targetType === "device" ? devices.length > 0 : groups.length > 0;
  const targetOptions = targetType === "device" ? filteredDevices : filteredGroups;
  const payloadValidation = useMemo(() => parsePayload(payload), [payload]);
  const currentTemplate = useMemo(() => templateForCommand(commandType), [commandType]);
  const payloadWasManuallyEdited = !shouldAutoApplyTemplate(payload, lastAutoTemplate);

  const dispatchMutation = useMutation({
    mutationFn: (data: CommandDispatchData) => commandCenterApi.dispatch(data),
    onSuccess: (data) => {
      setResult(data);
      setLocalError("");
    },
  });

  const handleSend = () => {
    setLocalError("");
    if (!canSend) {
      setLocalError(t("devices:cmd.err_no_permission", "Bạn không có quyền thực hiện thao tác này."));
      return;
    }
    if (!selectedTargetId) {
      setLocalError(targetType === "device" ? t("devices:cmd.err_select_device", "Vui lòng chọn thiết bị.") : t("devices:cmd.err_select_group", "Vui lòng chọn nhóm thiết bị."));
      return;
    }
    if (payloadValidation.error || !payloadValidation.payload) {
      setLocalError(payloadValidation.error ?? t("devices:cmd.err_invalid_json", "Payload JSON không hợp lệ."));
      return;
    }
    dispatchMutation.mutate({
      command_type: commandType,
      payload: payloadValidation.payload,
      target_type: targetType,
      ...(targetType === "device" ? { target_device_id: selectedTargetId } : { target_group_id: selectedTargetId }),
    });
  };

  const applyCurrentTemplate = () => {
    const nextTemplate = templateForCommand(commandType);
    setPayload(nextTemplate);
    setLastAutoTemplate(nextTemplate);
    setLocalError("");
  };

  const handleCommandTypeChange = (nextCommandType: string) => {
    const nextTemplate = templateForCommand(nextCommandType);
    setCommandType(nextCommandType);
    setResult(null);
    setLocalError("");
    if (shouldAutoApplyTemplate(payload, lastAutoTemplate)) {
      setPayload(nextTemplate);
    }
    setLastAutoTemplate(nextTemplate);
  };

  return (
    <div className="card p-5 space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">{t("devices:cmd.form_command_type", "Loại lệnh")}</label>
          <select value={commandType} onChange={(event) => handleCommandTypeChange(event.target.value)} className="input w-full">
            {getCommandTypes(t).map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-500 dark:text-text-muted">
            {getCommandDescriptions(t)[commandType] ?? t("devices:cmd.send_target_hint", "Gửi lệnh tới target đã chọn.")}
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">{t("devices:cmd.form_target", "Đối tượng")}</label>
          <select
            value={targetType}
            onChange={(event) => {
              setTargetType(event.target.value as "device" | "group");
              setSelectedTargetId("");
              setTargetSearch("");
              setResult(null);
              setLocalError("");
            }}
            className="input w-full"
          >
            <option value="device">{t("devices:cmd.target_device", "Thiết bị")}</option>
            <option value="group">{t("devices:cmd.target_group", "Nhóm thiết bị")}</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium">
            {targetType === "device" ? t("devices:cmd.target_select_device", "Chọn thiết bị") : t("devices:cmd.target_select_group", "Chọn nhóm thiết bị")}
          </label>
          <p className="mb-2 text-xs text-slate-500 dark:text-text-muted">
            {targetType === "device"
              ? t("devices:cmd.target_device_hint", "Tìm theo tên, trạng thái, firmware, MAC hoặc device UID.")
              : t("devices:cmd.target_group_hint", "Tìm theo tên nhóm, mô tả hoặc trạng thái.")}
          </p>
        </div>

        <input
          type="text"
          value={targetSearch}
          onChange={(event) => {
            setTargetSearch(event.target.value);
            setSelectedTargetId("");
            setResult(null);
            setLocalError("");
          }}
          className="input w-full"
          placeholder={targetType === "device" ? t("devices:cmd.search_device", "Tìm thiết bị...") : t("devices:cmd.search_group", "Tìm nhóm thiết bị...")}
        />

        {targetQuery.isLoading && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 dark:border-border-subtle dark:bg-surface/60 dark:text-text-muted">
            {targetType === "device" ? t("devices:cmd.loading_device", "Đang tải thiết bị...") : t("devices:cmd.loading_group", "Đang tải nhóm thiết bị...")}
          </div>
        )}

        {targetQuery.error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            {targetType === "device" ? t("devices:cmd.err_load_device", "Không thể tải danh sách thiết bị.") : t("devices:cmd.err_load_group", "Không thể tải danh sách nhóm thiết bị.")}
          </div>
        )}

        {!targetQuery.isLoading && !targetQuery.error && !hasTargets && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-border-subtle dark:bg-surface/60 dark:text-text-secondary">
            {targetType === "device"
              ? t("devices:cmd.no_devices", "Chưa có thiết bị nào. Vui lòng cung cấp thiết bị trước.")
              : t("devices:cmd.no_groups", "Chưa có nhóm thiết bị nào. Vui lòng tạo nhóm trước.")}
          </div>
        )}

        {!targetQuery.isLoading && !targetQuery.error && hasTargets && (
          <select
            value={selectedTargetId}
            onChange={(event) => {
              setSelectedTargetId(event.target.value);
              setResult(null);
              setLocalError("");
            }}
            className="input w-full"
          >
            <option value="">{targetType === "device" ? t("devices:cmd.select_one_device", "Chọn một thiết bị") : t("devices:cmd.select_one_group", "Chọn một nhóm thiết bị")}</option>
            {targetOptions.map((target) => (
              <option key={target.id} value={target.id}>
                {targetType === "device" ? deviceOptionLabel(t, target as Device, dateLocale) : groupOptionLabel(t, target as DeviceGroup)}
              </option>
            ))}
          </select>
        )}

        {!targetQuery.isLoading && !targetQuery.error && hasTargets && targetOptions.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 dark:border-border-subtle dark:bg-surface/60 dark:text-text-secondary">
            {t("devices:cmd.no_match", "Không tìm thấy kết quả phù hợp.")}
          </div>
        )}

        {selectedDevice && targetType === "device" && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm dark:border-border-subtle dark:bg-app">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900 dark:text-text-primary">{selectedDevice.name || selectedDevice.device_uid}</span>
              <StatusBadge tone={statusToTone(selectedDevice.status)} label={statusLabel(selectedDevice.status)} />
              {selectedDevice.firmware_version && <span className="text-xs text-slate-500">{t("devices:cmd.fw_prefix", "FW ")}{selectedDevice.firmware_version}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-text-muted">
              <span>{t("devices:cmd.uid_prefix", "UID: ")}{selectedDevice.device_uid}</span>
              {selectedDevice.mac_address && <span>{t("devices:cmd.mac_prefix", "MAC: ")}{selectedDevice.mac_address}</span>}
              <span>Last seen: {compactDate(selectedDevice.last_seen_at, dateLocale)}</span>
            </div>
          </div>
        )}

        {selectedGroup && targetType === "group" && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm dark:border-border-subtle dark:bg-app">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900 dark:text-text-primary">{selectedGroup.name}</span>
              <StatusBadge tone={statusToTone(selectedGroup.status)} label={statusLabel(selectedGroup.status)} />
              <span className="text-xs text-slate-500">{t("devices:cmd.device_count", "{{count}} thiết bị", { count: selectedGroup.device_count ?? 0 })}</span>
            </div>
            {selectedGroup.description && (
              <p className="mt-2 text-xs text-slate-500 dark:text-text-muted">{selectedGroup.description}</p>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <label className="block text-sm font-medium">Payload (JSON)</label>
          <button type="button" onClick={applyCurrentTemplate} className="btn-secondary h-8 px-3 text-xs">
            {t("devices:cmd.form_reset", "Đặt lại về mẫu")}
          </button>
        </div>
        {payloadWasManuallyEdited && (
          <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
            {t("devices:cmd.warn_payload_edited", "Payload đã được chỉnh thủ công. Đổi loại lệnh sẽ không tự ghi đè; dùng Đặt lại về mẫu để áp dụng mẫu hiện tại.")}
          </p>
        )}
        <textarea
          value={payload}
          onChange={(event) => {
            setPayload(event.target.value);
            setLocalError("");
          }}
          className={cn(
            "input min-h-28 w-full font-mono text-sm",
            payloadValidation.error && "border-rose-300 focus:border-rose-500 focus:ring-rose-500",
          )}
          rows={6}
        />
        {payloadValidation.error ? (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{payloadValidation.error}</p>
        ) : (
          <p className="mt-2 text-xs text-slate-500 dark:text-text-muted">
            {t("devices:cmd.current_template", "Mẫu hiện tại: ")}<code>{currentTemplate === "{}" ? "{}" : commandType}</code>
          </p>
        )}
      </div>
      <div className="flex justify-end">
        <button onClick={handleSend} disabled={!canSend || dispatchMutation.isPending || !selectedTargetId || !!payloadValidation.error} className="btn-primary">
          <Send className="h-4 w-4" />
          {dispatchMutation.isPending ? t("devices:cmd.sending", "Đang gửi...") : t("devices:cmd.send", "Gửi lệnh")}
        </button>
      </div>

      {result && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          {t("devices:cmd.sent_status", "Lệnh đã được gửi. Trạng thái: ")}{statusLabel(result.status)}. ID: <span className="font-mono">{result.id}</span>
        </div>
      )}
      {(localError || dispatchMutation.error) && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {localError || errorMessage(dispatchMutation.error)}
        </div>
      )}
    </div>
  );
}

function HistoryTab({ dateLocale = "vi-VN" }: { dateLocale?: string }) {
  const { t } = useTranslation(["devices", "common"]);
  const [filterStatus, setFilterStatus] = useState("");

  const historyQuery = useQuery({
    queryKey: ["command-history", filterStatus],
    queryFn: () => commandCenterApi.listHistory({ status: filterStatus || undefined }),
  });

  const dispatches = historyQuery.data?.items || [];
  const columns = useMemo<Column<CommandDispatch>[]>(
    () => [
      { key: "command_type", header: t("devices:cmd.col_type", "Loại lệnh"), sortable: true, sortValue: (dispatch) => dispatch.command_type, render: (dispatch) => dispatch.command_type },
      {
        key: "target_type",
        header: t("devices:cmd.col_target", "Đối tượng"),
        render: (dispatch) => <span className="capitalize">{statusLabel(dispatch.target_type)}</span>,
      },
      {
        key: "status",
        header: t("devices:cmd.col_status", "Trạng thái"),
        render: (dispatch) => <StatusBadge tone={statusToTone(dispatch.status)} label={statusLabel(dispatch.status)} />,
      },
      { key: "retry_count", header: t("devices:cmd.col_retries", "Số lần thử"), align: "right", sortable: true, sortValue: (dispatch) => dispatch.retry_count, render: (dispatch) => dispatch.retry_count },
      {
        key: "created_at",
        header: t("devices:cmd.col_time", "Thời gian"),
        sortable: true,
        sortValue: (dispatch) => dispatch.created_at,
        render: (dispatch) => <span className="text-sm text-slate-500">{formatDate(dispatch.created_at, dateLocale)}</span>,
      },
    ],
    [t, dateLocale],
  );

  return (
    <DataTable
      data={dispatches}
      columns={columns}
      loading={historyQuery.isLoading}
      error={errorMessage(historyQuery.error)}
      onRetry={() => historyQuery.refetch()}
      rowKey={(dispatch) => dispatch.id}
      emptyTitle={t("devices:cmd.history_empty_title", "Chưa có lịch sử lệnh")}
      emptyDescription={t("devices:cmd.history_empty_desc", "Các lệnh đã gửi tới thiết bị hoặc nhóm thiết bị sẽ xuất hiện tại đây.")}
      toolbar={
        <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} className="input w-48">
          <option value="">{t("devices:cmd.history_all_status", "Tất cả trạng thái")}</option>
          <option value="pending">{t("devices:cmd.status_pending", "Đang chờ")}</option>
          <option value="sent">{t("devices:cmd.status_sent", "Đã gửi")}</option>
          <option value="completed">{t("devices:cmd.status_completed", "Hoàn thành")}</option>
          <option value="failed">{t("devices:cmd.status_failed", "Thất bại")}</option>
          <option value="timeout">{t("devices:cmd.status_timeout", "Hết thời gian")}</option>
        </select>
      }
    />
  );
}
