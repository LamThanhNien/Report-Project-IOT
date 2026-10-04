import { ActionDropdown } from "../../../components/ui/ActionDropdown";
import { usePagination } from "../../../hooks/usePagination";
import { PaginationBar } from "../../../components/ui/PaginationBar";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePersistedState } from "../../../hooks/usePersistedState";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useProjectScope } from "../../../hooks/useProjectScope";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  Bot,
  Clock3,
  Copy,
  Edit3,
  Eye,
  Filter,
  LayoutGrid,
  List,
  MoreVertical,
  PlayCircle,
  Plus,
  Power,
  Search,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ErrorState } from "../../../components/ui/ErrorState";
import { PageHeader } from "../../../components/ui/PageHeader";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { ReadOnlyNotice } from "../../../components/permissions/PermissionGate";
import { useAuth } from "../../../contexts/AuthContext";
import { canManageAutomation } from "../../../lib/permissions";
import { cn } from "../../../lib/cn";
import { formatRelative } from "../../../lib/formatters";
import { deviceGroupApi } from "../../../services/deviceGroupApi";
import { ruleEngineApi, type AutomationRule } from "../../../services/ruleEngineApi";
import { getAutomationFieldLabel } from "../../../features/automation/automationFields";

type RuleFilter = "all" | "enabled" | "disabled" | "recent";

const FILTERS: { key: RuleFilter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "enabled", label: "Đang bật" },
  { key: "disabled", label: "Đang tắt" },
  { key: "recent", label: "Kích hoạt gần đây" },
];

function eventLabel(value: AutomationRule["trigger_type"], t: (key: string, fallback: string) => string): string {
  const labels: Record<AutomationRule["trigger_type"], string> = {
    device_event: t("automation:trigger_device_event", "Su kien lenh thiet bi"),
    telemetry: t("automation:trigger_telemetry", "Thiết bị gửi dữ liệu"),
    device_status: t("automation:trigger_device_status", "Trạng thái thiết bị thay đổi"),
    ota: t("automation:trigger_ota", "Sự kiện OTA/Firmware"),
    model_inference: t("automation:trigger_model_inference", "Kết quả Model/AI"),
    schedule: t("automation:trigger_schedule", "Lịch chạy"),
  };
  return labels[value] ?? value;
}

function targetLabel(rule: AutomationRule, groupNames: Map<string, string>, t: (key: string, fallback: string) => string): string {
  const scope = rule.target_scope;
  if (scope.scope_type === "all_devices") return t("automation:target_all_devices", "Tất cả thiết bị");
  if (scope.scope_type === "device") return t("automation:target_device", "Thiết bị đã chọn");
  if (scope.scope_type === "group") return scope.group_id ? `${t("automation:target_group_prefix", "Nhóm:")} ${groupNames.get(scope.group_id) ?? scope.group_id}` : t("automation:target_group_selected", "Nhóm đã chọn");
  if (scope.scope_type === "device_type") return `${t("automation:target_device_type_prefix", "Loại thiết bị:")} ${scope.device_type || "-"}`;
  return t("automation:target_custom", "Đối tượng tùy chỉnh");
}

function getOperatorLabels(t: (key: string, fallback: string) => string): Record<string, string> {
  return {
    ">": t("automation:op_gt", "lớn hơn"),
    ">=": t("automation:op_gte", "lớn hơn hoặc bằng"),
    "<": t("automation:op_lt", "nhỏ hơn"),
    "<=": t("automation:op_lte", "nhỏ hơn hoặc bằng"),
    "==": t("automation:op_eq", "bằng"),
    "!=": t("automation:op_neq", "khác"),
    contains: t("automation:op_contains", "chứa"),
    not_contains: t("automation:op_not_contains", "không chứa"),
    starts_with: t("automation:op_starts_with", "bắt đầu bằng"),
    ends_with: t("automation:op_ends_with", "kết thúc bằng"),
    is_true: t("automation:op_is_true", "là đúng"),
    is_false: t("automation:op_is_false", "là sai"),
    in: t("automation:op_in", "thuộc"),
    not_in: t("automation:op_not_in", "không thuộc"),
    exists: t("automation:op_exists", "tồn tại"),
    not_exists: t("automation:op_not_exists", "không tồn tại"),
  };
}

function conditionLabel(rule: AutomationRule, t: (key: string, fallback: string) => string): string {
  if (rule.conditions.length === 0) return t("automation:no_conditions", "Chưa cấu hình điều kiện");
  const joiner = rule.condition_logic === "and" ? t("automation:and", " và ") : t("automation:or", " hoặc ");
  const operatorLabels = getOperatorLabels(t);
  return rule.conditions
    .map((condition) => {
      const fieldName = getAutomationFieldLabel(condition.field, t);
      const operator = operatorLabels[condition.operator] ?? condition.operator;
      if (condition.operator === "exists" || condition.operator === "not_exists") {
        return `${fieldName} ${operator}`;
      }
      const value = Array.isArray(condition.value) ? condition.value.join(", ") : String(condition.value ?? "");
      return `${fieldName} ${operator} ${value}`;
    })
    .join(joiner);
}

function actionLabel(rule: AutomationRule, t: (key: string, fallback: string) => string): string {
  if (rule.actions.length === 0) return t("automation:no_actions", "Chưa cấu hình hành động");
  return rule.actions
    .map((action) => {
      if (action.type === "create_alert") return `${t("automation:action_create_alert", "Tạo cảnh báo ")}${String(action.config.severity ?? rule.severity)}`;
      if (action.type === "send_command") return `${t("automation:action_send_command", "Gửi lệnh thiết bị: ")}${String(action.config.command ?? t("automation:custom", "tùy chỉnh"))}`;
      if (action.type === "mqtt_publish") return t("automation:action_mqtt_publish", "Gửi thông điệp MQTT");
      if (action.type === "create_audit_event") return t("automation:action_audit_event", "Ghi nhật ký hệ thống");
      if (action.type === "call_webhook") return t("automation:action_webhook", "Gọi webhook");
      return action.type;
    })
    .join(", ");
}

function severityLabel(value: AutomationRule["severity"], t: (key: string, fallback: string) => string): string {
  const labels: Record<AutomationRule["severity"], string> = {
    info: t("automation:severity_info", "Thông tin"),
    warning: t("automation:severity_warning", "Cảnh báo"),
    critical: t("automation:severity_critical", "Nghiêm trọng"),
  };
  return labels[value] ?? value;
}

function severityTone(value: AutomationRule["severity"]) {
  if (value === "critical") return "danger";
  if (value === "warning") return "warning";
  return "info";
}

const LOGO_COLORS = [
  "bg-orange-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-teal-500",
  "bg-indigo-500",
];

function getLogoColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return LOGO_COLORS[hash % LOGO_COLORS.length];
}

function isRecent(rule: AutomationRule): boolean {
  if (!rule.last_triggered_at) return false;
  return Date.now() - new Date(rule.last_triggered_at).getTime() < 24 * 60 * 60 * 1000;
}

function ruleSearchText(rule: AutomationRule, groupNames: Map<string, string>, t: (key: string, fallback: string) => string): string {
  return [
    rule.name,
    rule.description,
    eventLabel(rule.trigger_type, t),
    targetLabel(rule, groupNames, t),
    conditionLabel(rule, t),
    actionLabel(rule, t),
    rule.severity,
    rule.enabled ? "enabled dang bat" : "disabled dang tat",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function AutomationActionsMenu({
  rule,
  canManage,
  duplicatePending,
  deletePending,
  togglePending,
  onDuplicate,
  onDelete,
  onToggle,
}: {
  rule: AutomationRule;
  canManage: boolean;
  duplicatePending: boolean;
  deletePending: boolean;
  togglePending: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation(["automation", "common"]);
  const { resolveLink } = useProjectScope();

  return (
    <ActionDropdown
      triggerSize="md"
      triggerAriaLabel={t("automation:menu_aria", "Mở menu quy tắc")}
      menuWidth="w-44"
      items={[
        {
          id: "view",
          to: resolveLink(`/automation/${rule.id}`),
          icon: <Eye className="h-4 w-4" />,
          label: t("common:actions.view_details", "Xem chi tiết"),
        },
        canManage
          ? {
              id: "edit",
              to: resolveLink(`/automation/${rule.id}/edit`),
              icon: <Edit3 className="h-4 w-4" />,
              label: t("common:actions.edit", "Sửa"),
            }
          : null,
        canManage
          ? {
              id: "duplicate",
              disabled: duplicatePending,
              icon: <Copy className="h-4 w-4" />,
              label: t("automation:duplicate", "Nhân bản"),
              onClick: onDuplicate,
            }
          : null,
        canManage
          ? {
              id: "toggle",
              disabled: togglePending,
              icon: <Power className="h-4 w-4" />,
              label: rule.enabled ? t("automation:disable_rule", "Tắt quy tắc") : t("automation:enable_rule", "Bật quy tắc"),
              onClick: onToggle,
            }
          : null,
        canManage
          ? {
              variant: "separator",
            }
          : null,
        canManage
          ? {
              id: "delete",
              disabled: deletePending,
              danger: true,
              icon: <Trash2 className="h-4 w-4" />,
              label: t("common:actions.delete", "Xóa"),
              onClick: onDelete,
            }
          : null,
      ]}
    />
  );
}

function AutomationRuleCard({
  rule,
  groupNames,
  canManage,
  duplicatePending,
  deletePending,
  togglePending,
  onDuplicate,
  onDelete,
  onToggle,
}: {
  rule: AutomationRule;
  groupNames: Map<string, string>;
  canManage: boolean;
  duplicatePending: boolean;
  deletePending: boolean;
  togglePending: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation(["automation", "common"]);
  const { resolveLink } = useProjectScope();
  return (
    <Card className="group relative overflow-hidden flex min-h-[300px] flex-col border border-slate-200/80 bg-white shadow-sm transition-all duration-150 hover:border-slate-400 hover:bg-slate-50/40 dark:border-border-subtle dark:bg-surface dark:hover:border-slate-700 dark:hover:bg-surface-elevated/40">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CardTitle className="truncate text-base">{rule.name}</CardTitle>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400 dark:text-text-muted">
            {t("automation:updated_at", "Cập nhật {{time}}", { time: formatRelative(rule.updated_at) })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <StatusBadge tone={rule.enabled ? "success" : "neutral"} label={rule.enabled ? t("automation:status_enabled", "Đang bật") : t("automation:status_disabled", "Đang tắt")} />
          <StatusBadge tone={severityTone(rule.severity)} label={severityLabel(rule.severity, t)} />
          <AutomationActionsMenu
            rule={rule}
            canManage={canManage}
            duplicatePending={duplicatePending}
            deletePending={deletePending}
            togglePending={togglePending}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            onToggle={onToggle}
          />
        </div>
      </CardHeader>
      <CardBody className="flex flex-1 flex-col">
        <div>
          <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px] mb-0.5">{t("automation:label_description", "Mô tả")}</span>
          <p className="min-h-[2.5rem] text-sm text-slate-600 dark:text-text-muted">
            {rule.description || t("automation:no_description", "Không có mô tả")}
          </p>
        </div>

        <div className="mt-4 space-y-2 text-xs text-slate-500 dark:text-text-muted">
          <div className="flex items-start gap-2">
            <Workflow className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-1">
              <span className="font-medium text-slate-400 dark:text-text-disabled">{t("automation:label_triggered_by", "Kích hoạt bởi: ")}</span>
              {eventLabel(rule.trigger_type, t)}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-1">
              <span className="font-medium text-slate-400 dark:text-text-disabled">{t("automation:label_target", "Đối tượng: ")}</span>
              {targetLabel(rule, groupNames, t)}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <Filter className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-1">
              <span className="font-medium text-slate-400 dark:text-text-disabled">{t("automation:label_condition", "Điều kiện: ")}</span>
              {conditionLabel(rule, t)}
            </span>
          </div>
          <div className="flex items-start gap-2">
            <PlayCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="line-clamp-1">
              <span className="font-medium text-slate-400 dark:text-text-disabled">{t("automation:label_action", "Hành động: ")}</span>
              {actionLabel(rule, t)}
            </span>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-500 dark:text-text-muted">
          <Clock3 className="h-3.5 w-3.5" />
          <span>
            <span className="font-medium text-slate-400 dark:text-text-disabled">{t("automation:label_last_triggered", "Kích hoạt gần nhất: ")}</span>
            {rule.last_triggered_at ? formatRelative(rule.last_triggered_at) : "-"}
          </span>
        </div>

        <Link className="btn-primary mt-4 w-full" to={resolveLink(`/automation/${rule.id}`)}>
          {t("automation:view_rule", "Xem quy tắc")}
        </Link>
      </CardBody>
    </Card>
  );
}

function AutomationListRow({
  rule,
  groupNames,
  logoColor,
  canManage,
  duplicatePending,
  deletePending,
  togglePending,
  onDuplicate,
  onDelete,
  onToggle,
}: {
  rule: AutomationRule;
  groupNames: Map<string, string>;
  logoColor: string;
  canManage: boolean;
  duplicatePending: boolean;
  deletePending: boolean;
  togglePending: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation(["automation", "common"]);
  const { resolveLink } = useProjectScope();
  return (
    <div className="group relative flex flex-col md:flex-row md:items-center gap-3 md:gap-4 border-b border-slate-100 dark:border-border-subtle px-4 py-3 hover:bg-slate-50/60 dark:hover:bg-surface-elevated/50 transition-colors">
      {/* Logo */}
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm mx-auto md:mx-0",
          logoColor,
        )}
      >
        <Bot className="h-5 w-5" />
      </div>

      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary">{rule.name}</span>
        <span className="block truncate text-[11px] text-slate-400">{t("automation:updated_at", "Cập nhật {{time}}", { time: formatRelative(rule.updated_at) })}</span>
      </div>

      <div className="w-full md:w-28 md:shrink-0 flex items-center gap-1.5 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("automation:col_status", "Trạng thái:")}</span>
        <StatusBadge tone={rule.enabled ? "success" : "neutral"} label={rule.enabled ? t("automation:status_enabled", "Đang bật") : t("automation:status_disabled", "Đang tắt")} />
      </div>

      <div className="w-full md:w-28 md:shrink-0 flex items-center gap-1.5 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("automation:col_severity", "Mức độ:")}</span>
        <StatusBadge tone={severityTone(rule.severity)} label={severityLabel(rule.severity, t)} />
      </div>

      <div className="w-full md:w-44 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("automation:col_triggered_by", "Kích hoạt bởi:")}</span>
        <span className="font-medium text-slate-700 dark:text-text-primary line-clamp-1">{eventLabel(rule.trigger_type, t)}</span>
      </div>

      <div className="w-full md:w-40 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("automation:col_target", "Đối tượng:")}</span>
        <span className="font-medium text-slate-600 dark:text-text-muted line-clamp-1">{targetLabel(rule, groupNames, t)}</span>
      </div>

      <div className="w-full md:w-32 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("automation:col_last_triggered", "Kích hoạt gần nhất:")}</span>
        <span className="font-medium text-slate-600 dark:text-text-muted">
          {rule.last_triggered_at ? formatRelative(rule.last_triggered_at) : "-"}
        </span>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center justify-end gap-1 w-full md:w-24 border-t md:border-t-0 pt-2 md:pt-0">
        <Link
          className="btn-primary flex items-center gap-1 px-2.5 py-1.5 text-xs"
          to={resolveLink(`/automation/${rule.id}`)}
        >
          {t("common:actions.details", "Chi tiết")}
          <ArrowRight className="h-3 w-3" />
        </Link>
        <AutomationActionsMenu
          rule={rule}
          canManage={canManage}
          duplicatePending={duplicatePending}
          deletePending={deletePending}
          togglePending={togglePending}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          onToggle={onToggle}
        />
      </div>
    </div>
  );
}

export function ClientAutomation({ scopedProjectId }: { scopedProjectId?: string } = {}) {
  const { t } = useTranslation(["automation", "common"]);
  const { isWorkspace, projectId, resolveLink } = useProjectScope();
  const effectiveProjectId = scopedProjectId || projectId;
  const { user } = useAuth();
  const canManage = canManageAutomation(user);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = usePersistedState("aifom_clientautomation_search", "", "session");
  const [filter, setFilter] = useState<RuleFilter>("all");
  const [viewMode, setViewMode] = usePersistedState<"grid" | "list">("aifom_clientautomation_view", "grid", "local");

  const filters: { key: RuleFilter; label: string }[] = [
    { key: "all", label: t("common:all", "Tất cả") },
    { key: "enabled", label: t("automation:filter_enabled", "Đang bật") },
    { key: "disabled", label: t("automation:filter_disabled", "Đang tắt") },
    { key: "recent", label: t("automation:filter_recent", "Kích hoạt gần đây") },
  ];

  const rulesQuery = useQuery({ 
    queryKey: ["client-automation-rules", effectiveProjectId], 
    queryFn: () => ruleEngineApi.listRules(effectiveProjectId || undefined) 
  });
  const groupsQuery = useQuery({
    queryKey: ["automation-device-groups", effectiveProjectId],
    queryFn: () => deviceGroupApi.listDeviceGroups(effectiveProjectId ? { limit: 200, project_id: effectiveProjectId || undefined } : { limit: 200 }),
  });

  const rules = rulesQuery.data ?? [];
  const groupNames = useMemo(
    () => new Map((groupsQuery.data?.items ?? []).map((group) => [group.id, group.name])),
    [groupsQuery.data?.items],
  );

  async function invalidateAutomation() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["client-automation-rules"] }),
      qc.invalidateQueries({ queryKey: ["client-automation-stats"] }),
    ]);
  }

  const toggleMut = useMutation({
    mutationFn: (rule: AutomationRule) =>
      rule.enabled ? ruleEngineApi.disableRule(rule.id) : ruleEngineApi.enableRule(rule.id),
    onSuccess: invalidateAutomation,
  });
  const duplicateMut = useMutation({
    mutationFn: (rule: AutomationRule) => ruleEngineApi.duplicateRule(rule.id),
    onSuccess: invalidateAutomation,
  });
  const deleteMut = useMutation({
    mutationFn: (rule: AutomationRule) => ruleEngineApi.deleteRule(rule.id),
    onSuccess: invalidateAutomation,
  });

  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rules.filter((rule) => {
      if (filter === "enabled" && !rule.enabled) return false;
      if (filter === "disabled" && rule.enabled) return false;
      if (filter === "recent" && !isRecent(rule)) return false;
      return q ? ruleSearchText(rule, groupNames, t).includes(q) : true;
    });
  }, [filter, groupNames, rules, search, t]);

  const PAGE_SIZE = 12;
  const { page, setPage, totalPages, pagedItems: pagedRules } = usePagination(filteredRules, PAGE_SIZE, [search, filter]);

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      <PageHeader
        crumbs={isWorkspace ? [{ label: "Workspace", to: `/client/workspace/${effectiveProjectId}/home` }, { label: "Automation" }] : undefined}
        title={t("automation:page_title", "Tự động hóa")}
        subtitle={t("automation:page_subtitle", "Tạo quy tắc không cần code để phản ứng với dữ liệu thiết bị, trạng thái và sự kiện hệ thống.")}
        actions={
          canManage ? (
            <button type="button" className="btn-primary" onClick={() => navigate(resolveLink("/automation/new"))}>
              <Plus className="h-4 w-4" />
              {t("automation:create_rule", "Tạo quy tắc")}
            </button>
          ) : undefined
        }
      />

      {!canManage && <ReadOnlyNotice />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 dark:border-border-subtle pb-4 pt-1">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9 pr-8"
            placeholder={t("automation:search_placeholder", "Tìm quy tắc...")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              onClick={() => setSearch("")}
              aria-label={t("common:actions.clear_search", "Xóa tìm kiếm")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="scrollbar-hide flex items-center gap-1 overflow-x-auto">
            {filters.map((item) => (
              <button
                key={item.key}
                type="button"
                className={cn(
                  "chip whitespace-nowrap transition-colors",
                  filter === item.key
                    ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-surface-elevated dark:text-text-muted dark:hover:bg-surface-muted",
                )}
                onClick={() => setFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-border p-0.5 bg-surface-elevated">
            <button
              type="button"
              aria-label={t("common:view_list", "Dạng danh sách")}
              onClick={() => setViewMode("list")}
              className={cn(
                "flex h-7 w-8 items-center justify-center transition-all duration-200 rounded-md",
                viewMode === "list"
                  ? "bg-surface text-text-primary shadow-sm font-semibold"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={t("common:view_grid", "Dạng lưới")}
              onClick={() => setViewMode("grid")}
              className={cn(
                "flex h-7 w-8 items-center justify-center transition-all duration-200 rounded-md",
                viewMode === "grid"
                  ? "bg-surface text-text-primary shadow-sm font-semibold"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {rulesQuery.isError ? (
        <ErrorState
          message={t("automation:error_message", "API Automation đang trả lỗi. Vui lòng kiểm tra backend hoặc thử tải lại sau khi dịch vụ ổn định.")}
          onRetry={() => rulesQuery.refetch()}
        />
      ) : rulesQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="card h-[300px] animate-pulse p-5">
              <div className="h-4 w-36 rounded bg-slate-200 dark:bg-surface-muted" />
              <div className="mt-3 h-3 w-28 rounded bg-slate-100 dark:bg-surface-elevated" />
              <div className="mt-8 h-3 w-full rounded bg-slate-100 dark:bg-surface-elevated" />
              <div className="mt-3 h-3 w-4/5 rounded bg-slate-100 dark:bg-surface-elevated" />
              <div className="mt-auto h-9 w-full rounded bg-slate-100 dark:bg-surface-elevated" />
            </div>
          ))}
        </div>
      ) : rules.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Bot className="h-6 w-6" />}
            title={t("automation:empty_title", "Chưa có quy tắc tự động hóa")}
            description={t("automation:empty_desc", "Tạo quy tắc đầu tiên để tự động phản ứng với dữ liệu thiết bị mà không cần viết code hoặc JSON.")}
            action={
              canManage ? (
                <button type="button" className="btn-primary" onClick={() => navigate(resolveLink("/automation/new"))}>
                  <Plus className="h-4 w-4" />
                  {t("automation:create_rule", "Tạo quy tắc")}
                </button>
              ) : undefined
            }
          />
        </div>
      ) : filteredRules.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-sm text-slate-500 dark:text-text-muted">
            {t("automation:no_matching_rules", "Không có quy tắc nào khớp với tìm kiếm hoặc bộ lọc.")}
          </p>
          <button
            type="button"
            className="btn-ghost mt-2 text-sm"
            onClick={() => {
              setSearch("");
              setFilter("all");
            }}
          >
            {t("common:actions.clear_filter", "Xóa bộ lọc")}
          </button>
        </div>
      ) : viewMode === "list" ? (
        <Card className="p-0 overflow-hidden flex flex-col flex-1">
          <div className="overflow-x-auto">
            <div className="flex flex-col md:min-w-[1300px]">
              <div className="hidden md:flex items-center gap-4 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-text-secondary bg-slate-100/75 dark:bg-surface-elevated/70 border-b border-slate-200 dark:border-border-subtle shrink-0">
                <div className="w-10 text-center">{t("automation:table_logo", "Logo")}</div>
                <div className="flex-1">{t("automation:table_name_updated", "Tên quy tắc / Cập nhật")}</div>
                <div className="w-28">{t("automation:table_status", "Trạng thái")}</div>
                <div className="w-28">{t("automation:table_severity", "Mức độ")}</div>
                <div className="w-44">{t("automation:table_triggered_by", "Kích hoạt bởi")}</div>
                <div className="w-40">{t("automation:table_target", "Đối tượng")}</div>
                <div className="w-32">{t("automation:table_last_triggered", "Kích hoạt gần nhất")}</div>
                <div className="w-24 text-right">{t("automation:table_actions", "Thao tác")}</div>
              </div>

              {pagedRules.map((rule) => (
                <AutomationListRow
                  key={rule.id}
                  rule={rule}
                  groupNames={groupNames}
                  logoColor={getLogoColor(rule.id)}
                  canManage={canManage}
                  duplicatePending={duplicateMut.isPending}
                  deletePending={deleteMut.isPending}
                  togglePending={toggleMut.isPending}
                  onDuplicate={() => duplicateMut.mutate(rule)}
                  onDelete={() => {
                    if (window.confirm(t("automation:confirm_delete_rule", 'Xóa quy tắc "{{name}}"?', { name: rule.name }))) deleteMut.mutate(rule);
                  }}
                  onToggle={() => toggleMut.mutate(rule)}
                />
              ))}
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pagedRules.map((rule) => (
            <AutomationRuleCard
              key={rule.id}
              rule={rule}
              groupNames={groupNames}
              canManage={canManage}
              duplicatePending={duplicateMut.isPending}
              deletePending={deleteMut.isPending}
              togglePending={toggleMut.isPending}
              onDuplicate={() => duplicateMut.mutate(rule)}
              onDelete={() => {
                if (window.confirm(t("automation:confirm_delete_rule", 'Xóa quy tắc "{{name}}"?', { name: rule.name }))) deleteMut.mutate(rule);
              }}
              onToggle={() => toggleMut.mutate(rule)}
            />
          ))}
        </div>
      )}
      {filteredRules.length > 0 && <PaginationBar page={page} totalPages={totalPages} totalItems={filteredRules.length} pageSize={PAGE_SIZE} onPrev={() => setPage(page - 1)} onNext={() => setPage(page + 1)} className="mt-auto shrink-0" />}
    </div>
  );
}

export default ClientAutomation;
