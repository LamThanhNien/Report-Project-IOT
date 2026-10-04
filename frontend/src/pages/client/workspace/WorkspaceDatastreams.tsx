import { useAuth } from "../../../contexts/AuthContext";
import { canManageProjects } from "../../../lib/permissions";
import { ReadOnlyNotice } from "../../../components/permissions/PermissionGate";
import { ActionDropdown } from "../../../components/ui/ActionDropdown";
import { usePagination } from "../../../hooks/usePagination";
import { PaginationBar } from "../../../components/ui/PaginationBar";
import { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { usePersistedState } from "../../../hooks/usePersistedState";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  GitBranch,
  X,
  Info,
  Hash,
  Activity,
  Type,
  LayoutGrid,
  List,
  MoreVertical,
  Copy,
  ArrowRight,
  Zap,
  ChevronRight,
} from "lucide-react";
import {
  listDatastreams,
  createDatastream,
  updateDatastream,
  deleteDatastream,
  allPinOptions,
  pinLabel,
  type DatastreamCreatePayload,
  type DatastreamUpdatePayload,
} from "../../../services/datastreamApi";
import { listClientDeviceModels } from "../../../services/clientApi";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Modal } from "../../../components/ui/Modal";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import type { Datastream, DatastreamDataType } from "../../../types";
import { cn } from "../../../lib/cn";

// ─── Constants & Color Helpers ───────────────────────────────────────────────

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

function getDataTypeOptions(t?: (key: string, fallback: string) => string): { label: string; value: DatastreamDataType }[] {
  return [
    { label: t ? t("projects:datastreams.type_integer", "Integer (Số nguyên)") : "Integer", value: "integer" },
    { label: t ? t("projects:datastreams.type_double", "Double (Số thực)") : "Double", value: "double" },
    { label: t ? t("projects:datastreams.type_string", "String (Chuỗi)") : "String", value: "string" },
    { label: t ? t("projects:datastreams.type_boolean", "Boolean (Logic / Bật tắt)") : "Boolean", value: "boolean" },
  ];
}

const UNIT_OPTIONS = [
  "°C", "°F", "%", "V", "mV", "A", "mA", "W", "kWh",
  "ppm", "lux", "hPa", "m/s", "rpm", "pH", "none",
];

const EMPTY_FORM: DatastreamCreatePayload = {
  project_id: "",
  name: "",
  alias: "",
  pin: 0,
  data_type: "double",
  direction: "bidirectional",
  unit: null,
  min_value: null,
  max_value: null,
  default_value: null,
  description: null,
  is_custom: true,
  status: "active",
  supported_model_ids: [],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getDatastreamStatus(ds: Datastream, t?: (key: string, fallback: string) => string): { label: string; textColor: string; dotColor: string } {
  const toneMap: Record<string, { label: string; textColor: string; dotColor: string }> = {
    integer: {
      label: t ? t("projects:datastreams.label_integer", "Integer") : "Integer",
      textColor: "text-sky-600 dark:text-sky-400 font-medium",
      dotColor: "bg-sky-500",
    },
    double: {
      label: t ? t("projects:datastreams.label_double", "Double") : "Double",
      textColor: "text-violet-600 dark:text-violet-400 font-medium",
      dotColor: "bg-violet-500",
    },
    string: {
      label: t ? t("projects:datastreams.label_string", "String") : "String",
      textColor: "text-amber-600 dark:text-amber-400 font-medium",
      dotColor: "bg-amber-500",
    },
    boolean: {
      label: t ? t("projects:datastreams.label_boolean", "Boolean") : "Boolean",
      textColor: "text-emerald-600 dark:text-emerald-400 font-medium",
      dotColor: "bg-emerald-500",
    },
  };
  return toneMap[ds.data_type] ?? {
    label: ds.data_type,
    textColor: "text-slate-500 dark:text-text-muted font-medium",
    dotColor: "bg-slate-400 dark:bg-text-muted",
  };
}

function getDirectionLabel(direction: string, t?: (key: string, fallback: string) => string): string {
  const map: Record<string, string> = {
    telemetry: t ? t("projects:datastreams.dir_telemetry", "Telemetry (Read-only)") : "Telemetry (Read-only)",
    command: t ? t("projects:datastreams.dir_command", "Command (Write-only)") : "Command (Write-only)",
    bidirectional: t ? t("projects:datastreams.dir_bidirectional", "Bidirectional") : "Bidirectional",
  };
  return map[direction] ?? direction;
}

// ─── Dropdown Actions Menu ───────────────────────────────────────────────────

interface DatastreamActionsProps {
  ds: Datastream;
  onEdit: () => void;
  onDelete: () => void;
}

export function DatastreamActionsMenu({ ds, onEdit, onDelete }: DatastreamActionsProps) {
  const { user } = useAuth();
  const canManage = canManageProjects(user);
  const { t } = useTranslation(["projects", "common"]);

  return (
    <ActionDropdown
      triggerSize="sm"
      triggerAriaLabel={t("projects:datastreams.actions_for", "Thao tác cho {{name}}", { name: ds.name })}
      menuWidth="w-44"
      items={[
        canManage ? {
          id: "edit",
          icon: <Edit2 className="h-3.5 w-3.5" />,
          label: t("projects:datastreams.action_edit", "Chỉnh sửa"),
          onClick: onEdit,
        } : null,
        {
          id: "copy_alias",
          icon: <Copy className="h-3.5 w-3.5" />,
          label: t("projects:datastreams.action_copy_alias", "Sao chép Alias"),
          onClick: () => navigator.clipboard.writeText(ds.alias || ""),
        },
        canManage ? {
          variant: "separator",
        } : null,
        canManage ? {
          id: "delete",
          danger: true,
          icon: <Trash2 className="h-3.5 w-3.5" />,
          label: t("projects:datastreams.action_delete", "Xóa Datastream"),
          onClick: onDelete,
        } : null,
      ]}
    />
  );
}

// ─── Search & Filters row ────────────────────────────────────────────────────

function getFilters(t: (key: string, fallback: string) => string): { key: string; label: string }[] {
  return [
    { key: "", label: t("common:all", "Tất cả") },
    { key: "integer", label: t("projects:datastreams.label_integer", "Integer") },
    { key: "double", label: t("projects:datastreams.label_double", "Double") },
    { key: "string", label: t("projects:datastreams.label_string", "String") },
  ];
}

interface FilterProps {
  search: string;
  onSearchChange: (val: string) => void;
  filterType: string;
  onFilterTypeChange: (val: string) => void;
  viewMode: "grid" | "list";
  onViewModeChange: (val: "grid" | "list") => void;
}

function DatastreamSearchAndFilters({
  search,
  onSearchChange,
  filterType,
  onFilterTypeChange,
  viewMode,
  onViewModeChange,
}: FilterProps) {
  const { t } = useTranslation(["projects", "common"]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 dark:border-border-subtle pb-4 pt-1">
      <div className="relative max-w-sm flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9 pr-8"
          placeholder={t("projects:datastreams.search_ph", "Tìm datastream...")}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
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

      <div className="flex items-center gap-2">
        <div className="scrollbar-hide flex items-center gap-1 overflow-x-auto">
          {getFilters(t).map((f) => (
            <button
              key={f.key}
              className={cn(
                "chip whitespace-nowrap transition-colors",
                filterType === f.key
                  ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-surface-elevated dark:text-text-muted dark:hover:bg-surface-muted",
              )}
              onClick={() => onFilterTypeChange(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-border p-0.5 bg-surface-elevated">
          <button
            aria-label={t("common:view_list", "Dạng danh sách")}
            onClick={() => onViewModeChange("list")}
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
            aria-label={t("common:view_grid", "Dạng lưới")}
            onClick={() => onViewModeChange("grid")}
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
  );
}

// ─── Grid Card Component ─────────────────────────────────────────────────────

interface DatastreamCardProps {
  ds: Datastream;
  logoColor: string;
  onEdit: () => void;
  onDelete: () => void;
}

function DatastreamCard({ ds, logoColor, onEdit, onDelete }: DatastreamCardProps) {
  const { user } = useAuth();
  const canManage = canManageProjects(user);
  const { t } = useTranslation(["projects", "common"]);
  const status = getDatastreamStatus(ds, t);
  const initials = pinLabel(ds.pin);

  return (
    <Card className="group relative overflow-hidden flex h-full flex-col border border-slate-200/80 bg-white shadow-sm transition-all duration-150 hover:border-slate-400 hover:bg-slate-50/40 dark:border-border-subtle dark:bg-surface dark:hover:border-slate-700 dark:hover:bg-surface-elevated/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        {/* Logo block (uses virtual pin label e.g. V0, V1) */}
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white shadow-sm font-mono",
            logoColor,
          )}
        >
          {initials}
        </div>

        {/* Name + Status */}
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base">{ds.name}</CardTitle>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <span>Pin: {initials}</span>
          </div>
        </div>

        <DatastreamActionsMenu ds={ds} onEdit={onEdit} onDelete={onDelete} />
      </CardHeader>
      <CardBody>
        <div className="mb-2">
          <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px] mb-0.5">{t("projects:datastreams.col_description", "Mô tả")}</span>
          <p className="min-h-[2.5rem] text-sm text-slate-600 dark:text-text-muted">
            {ds.description || t("projects:datastreams.no_description", "Không có mô tả")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 py-2.5 my-3 border-y border-slate-100 dark:border-border-subtle text-xs text-slate-600 dark:text-text-secondary">
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("projects:datastreams.col_type", "Kiểu dữ liệu")}</span>
            <span className={cn("font-medium", status.textColor)}>{status.label}</span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("projects:datastreams.col_direction", "Hướng truyền")}</span>
            <span className="font-medium text-slate-700 dark:text-text-primary">{getDirectionLabel(ds.direction, t)}</span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("projects:datastreams.col_alias", "Mã định danh (Alias)")}</span>
            <span className="font-mono font-medium">{ds.alias}</span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("projects:datastreams.col_range_unit", "Giới hạn / Đơn vị")}</span>
            <span className="font-medium">
              {ds.data_type !== "string" && ds.data_type !== "boolean" && (ds.min_value !== null || ds.max_value !== null) ? (
                `${ds.min_value ?? "—"} → ${ds.max_value ?? "—"}${ds.unit ? ` (${ds.unit})` : ""}`
              ) : (
                ds.unit ? t("projects:datastreams.unit_prefix", "Đơn vị: {{unit}}", { unit: ds.unit }) : t("projects:datastreams.no_limit", "Không giới hạn")
              )}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
          {ds.default_value !== null && ds.default_value !== undefined ? (
            <span className="inline-flex items-center gap-1">
              {t("projects:datastreams.default_value_label", "Giá trị mặc định: ")}<span className="font-mono font-semibold text-slate-700 dark:text-text-primary">{ds.default_value}</span>
            </span>
          ) : (
            <span />
          )}
        </div>

        {canManage && <button
          className="btn-primary mt-4 w-full"
          onClick={onEdit}
        >
          {t("projects:datastreams.edit_btn", "Chỉnh sửa →")}
        </button>}
      </CardBody>
    </Card>
  );
}

// ─── List Row Component ──────────────────────────────────────────────────────

interface DatastreamListRowProps {
  ds: Datastream;
  logoColor: string;
  onEdit: () => void;
  onDelete: () => void;
}

function DatastreamListRow({ ds, logoColor, onEdit, onDelete }: DatastreamListRowProps) {
  const { user } = useAuth();
  const canManage = canManageProjects(user);
  const { t } = useTranslation(["projects", "common"]);
  const status = getDatastreamStatus(ds, t);
  const initials = pinLabel(ds.pin);

  return (
    <div className="group relative flex flex-col md:flex-row md:items-center gap-3 md:gap-4 border-b border-slate-100 dark:border-border-subtle px-4 py-3 hover:bg-slate-50/60 dark:hover:bg-surface-elevated/50 transition-colors">
      {/* Pin Logo */}
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold text-white shadow-sm font-mono mx-auto md:mx-0",
          logoColor,
        )}
      >
        {initials}
      </div>

      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary">{ds.name}</span>
        <span className="block truncate text-[11px] font-mono text-slate-400">Alias: {ds.alias}</span>
      </div>

      <div className="w-full md:w-32 md:shrink-0 flex items-center gap-1.5 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("projects:datastreams.col_type_short", "Kiểu:")}</span>
        <span className={cn("h-1.5 w-1.5 rounded-full", status.dotColor)} />
        <span className={status.textColor}>{status.label}</span>
      </div>

      <div className="w-full md:w-44 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("projects:datastreams.col_direction_short", "Hướng:")}</span>
        <span className="font-medium text-slate-700 dark:text-text-primary">{getDirectionLabel(ds.direction, t)}</span>
      </div>

      <div className="w-full md:w-40 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("projects:datastreams.col_range_unit_short", "Giới hạn/Đơn vị:")}</span>
        <span className="font-medium">
          {ds.data_type !== "string" && ds.data_type !== "boolean" && (ds.min_value !== null || ds.max_value !== null) ? (
            `${ds.min_value ?? "—"} → ${ds.max_value ?? "—"}${ds.unit ? ` (${ds.unit})` : ""}`
          ) : (
            ds.unit ? t("projects:datastreams.unit_prefix", "Đơn vị: {{unit}}", { unit: ds.unit }) : t("projects:datastreams.no_limit", "Không giới hạn")
          )}
        </span>
      </div>

      <div className="w-full md:w-32 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("projects:datastreams.col_default_short", "Mặc định:")}</span>
        <span className="font-mono text-slate-600 dark:text-text-muted">{ds.default_value !== null && ds.default_value !== undefined ? ds.default_value : "—"}</span>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center justify-end gap-1 w-full md:w-24 border-t md:border-t-0 pt-2 md:pt-0">
        {canManage && <button
          className="btn-primary flex items-center gap-1 px-2.5 py-1.5 text-xs"
          onClick={onEdit}
        >
          {t("common:actions.edit", "Sửa")}
          <ArrowRight className="h-3 w-3" />
        </button>}
        <DatastreamActionsMenu ds={ds} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </div>
  );
}

// ─── Skeleton Card Component ────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <Card className="animate-pulse">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="h-11 w-11 rounded-xl bg-slate-200 dark:bg-white/[0.05]" />
        <div className="flex-1 space-y-1.5">
          <div className="h-4 w-2/3 rounded bg-slate-200 dark:bg-white/[0.05]" />
          <div className="h-3.5 w-1/3 rounded bg-slate-200 dark:bg-white/[0.05]" />
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="h-4 w-full rounded bg-slate-200 dark:bg-white/[0.05]" />
        <div className="flex justify-between">
          <div className="h-3 w-1/3 rounded bg-slate-200 dark:bg-white/[0.05]" />
          <div className="h-3 w-1/4 rounded bg-slate-200 dark:bg-white/[0.05]" />
        </div>
        <div className="h-9 w-full rounded bg-slate-200 dark:bg-white/[0.05]" />
      </CardBody>
    </Card>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function WorkspaceDatastreams() {
  const { user } = useAuth();
  const canManage = canManageProjects(user);
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const { t } = useTranslation(["projects", "common"]);

  const [search, setSearch] = usePersistedState(
    `aifom_client_datastreams_search_${projectId}`,
    "",
    "session"
  );
  const [filterType, setFilterType] = usePersistedState<DatastreamDataType | "">(
    `aifom_client_datastreams_filter_${projectId}`,
    "",
    "session"
  );
  const [viewMode, setViewMode] = usePersistedState<"grid" | "list">(
    `aifom_client_datastreams_view_${projectId}`,
    "list",
    "local"
  );

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Datastream | null>(null);
  const [form, setForm] = useState<Omit<DatastreamCreatePayload, "project_id">>(EMPTY_FORM as any);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [customUnit, setCustomUnit] = useState("");
  const [useCustomUnit, setUseCustomUnit] = useState(false);
  const [pinPreset, setPinPreset] = useState<"digital" | "analog" | "integer" | "pwm" | "string" | "json">("analog");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<Datastream | null>(null);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const listQ = useQuery({
    queryKey: ["datastreams", projectId, { search, filterType }],
    queryFn: () =>
      listDatastreams({
        project_id: projectId!,
        search: search || undefined,
        data_type: (filterType as DatastreamDataType) || undefined,
        limit: 256,
      }),
  });

  const modelsQ = useQuery({
    queryKey: ["client-device-models"],
    queryFn: () => listClientDeviceModels(),
  });
  const deviceModels = modelsQ.data || [];

  const usedPins = useMemo(() => new Set(listQ.data?.used_pins ?? []), [listQ.data]);

  const pinOptions = useMemo(() => {
    const all = allPinOptions();
    if (editTarget !== null) {
      return all.map((o) => ({
        ...o,
        disabled: usedPins.has(o.value) && o.value !== editTarget.pin,
      }));
    }
    return all.map((o) => ({ ...o, disabled: usedPins.has(o.value) }));
  }, [usedPins, editTarget]);

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: createDatastream,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datastreams"] });
      closeModal();
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: DatastreamUpdatePayload }) =>
      updateDatastream(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datastreams"] });
      closeModal();
    },
  });

  const deleteMut = useMutation({
    mutationFn: deleteDatastream,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["datastreams"] });
      setDeleteTarget(null);
    },
  });

  // ── Handlers ─────────────────────────────────────────────────────────────────

  function openCreate() {
    if (!canManage) return;
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setCustomUnit("");
    setUseCustomUnit(false);
    setPinPreset("analog");
    setModalOpen(true);
  }
  function openEdit(ds: Datastream) {
    if (!canManage) return;
    setEditTarget(ds);
    let mappedDefault = ds.default_value;
    if (ds.data_type === "boolean") {
      if (mappedDefault === "1" || mappedDefault === "true") mappedDefault = "true";
      else if (mappedDefault === "0" || mappedDefault === "false") mappedDefault = "false";
      else mappedDefault = null;
    }

    setForm({
      name: ds.name,
      alias: ds.alias,
      pin: ds.pin,
      data_type: ds.data_type,
      direction: ds.direction,
      unit: ds.unit,
      min_value: ds.min_value,
      max_value: ds.max_value,
      default_value: mappedDefault,
      description: ds.description,
      is_custom: ds.is_custom,
      status: ds.status,
      supported_model_ids: ds.supported_model_ids || [],
    });
    
    let preset: any = "analog";
    if (ds.data_type === "boolean") preset = "digital";
    else if (ds.data_type === "integer") {
      if (ds.min_value === 0 && ds.max_value === 255) preset = "pwm";
      else preset = "integer";
    } else if (ds.data_type === "string") {
      if (ds.description?.toLowerCase().includes("json") || ds.name.toLowerCase().includes("json")) {
        preset = "json";
      } else {
        preset = "string";
      }
    }
    setPinPreset(preset);

    const isCustom = ds.unit ? !UNIT_OPTIONS.includes(ds.unit) : false;
    setUseCustomUnit(isCustom);
    setCustomUnit(isCustom ? (ds.unit ?? "") : "");
    setFormErrors({});
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
  }

  function setField<K extends keyof Omit<DatastreamCreatePayload, "project_id">>(
    key: K,
    value: Omit<DatastreamCreatePayload, "project_id">[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (formErrors[key]) setFormErrors((e) => ({ ...e, [key]: "" }));
  }

  function validateForm(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Tên không được để trống";
    if (
      form.data_type !== "string" &&
      form.data_type !== "boolean" &&
      form.min_value !== null &&
      form.max_value !== null &&
      form.min_value !== undefined &&
      form.max_value !== undefined &&
      form.min_value >= form.max_value
    ) {
      errs.min_value = "Min phải nhỏ hơn Max";
    }
    setFormErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit() {
    if (!canManage) return;
    if (!validateForm()) return;
    const effectiveUnit = useCustomUnit ? customUnit || null : form.unit;
    const payload = { ...form, project_id: projectId!, unit: effectiveUnit };
    if (editTarget) {
      const { pin: _pin, project_id: _pid, ...updatePayload } = payload as DatastreamCreatePayload & { pin: number };
      updateMut.mutate({ id: editTarget.id, payload: updatePayload as DatastreamUpdatePayload });
    } else {
      createMut.mutate(payload as DatastreamCreatePayload);
    }
  }

  const isSaving = createMut.isPending || updateMut.isPending;
  const saveError =
    (createMut.error as Error)?.message ||
    (updateMut.error as Error)?.message ||
    null;
  const deleteError = (deleteMut.error as Error)?.message ?? null;

  const items = listQ.data?.items ?? [];
  const usedCount = listQ.data?.used_pins.length ?? 0;

  const filteredItems = useMemo(() => {
    let result = items;
    // Filter type
    if (filterType) {
      result = result.filter((ds) => ds.data_type === filterType);
    }
    // Search query
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (ds) =>
          ds.name.toLowerCase().includes(q) ||
          (ds.alias ?? "").toLowerCase().includes(q) ||
          pinLabel(ds.pin).toLowerCase().includes(q),
      );
    }
    return result;
  }, [items, filterType, search]);

  const PAGE_SIZE = 12;
  const { page, setPage, totalPages, pagedItems: pagedDatastreams } = usePagination(filteredItems, PAGE_SIZE, [search, filterType, projectId]);

  return (
    <>
      <div className="flex flex-col flex-1 min-h-full space-y-4">
        {/* ── Page Header ────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-text-primary leading-tight">
              {t("projects:datastreams.title", "Tập dữ liệu Datastreams (Virtual Pins)")}
            </h1>
            <p className="text-sm text-slate-500 dark:text-text-muted mt-1">
              {t("projects:datastreams.page_subtitle", "V0–V255 Virtual Pin data contracts for ESP32 telemetry and commands.")}{" "}
              {t("projects:datastreams.used_count", "Used: {{count}}/256 pins.", { count: usedCount })}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {canManage && <button
              id="btn-add-datastream"
              onClick={openCreate}
              className="btn-primary"
            >
              <Plus className="h-4 w-4" />
              {t("projects:datastreams.add", "Thêm Datastream")}
            </button>}
          </div>
        </div>

        {!canManage && <ReadOnlyNotice />}

        {/* ── Toolbar (Search, Filter Type, ViewMode Toggle) ─────────────────────── */}
        <DatastreamSearchAndFilters
          search={search}
          onSearchChange={setSearch}
          filterType={filterType}
          onFilterTypeChange={(val) => setFilterType(val as DatastreamDataType | "")}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />

        {/* ── Content Area ──────────────────────────────────────────────────────── */}
        {listQ.isError ? (
          <div className="card py-12 text-center">
            <p className="text-sm text-slate-500">
              {t("projects:datastreams.error_load", "Không tải được danh sách Datastreams. Vui lòng thử lại.")}
            </p>
            <button
              className="btn-ghost mt-2 text-sm"
              onClick={() => listQ.refetch()}
            >
              {t("common:retry", "Thử lại")}
            </button>
          </div>
        ) : listQ.isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="card py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.05]">
              <GitBranch className="h-6 w-6 text-slate-400" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-slate-800 dark:text-text-primary">
              {t("projects:datastreams.empty_title", "Chưa có Datastream nào")}
            </h3>
            <p className="mt-2 text-xs text-slate-500 dark:text-text-muted max-w-sm mx-auto">
              {t("projects:datastreams.empty_hint", "Tạo Virtual Pin với kiểu dữ liệu phù hợp cho telemetry và lệnh ESP32.")}
            </p>
            <div className="mt-6">
              {canManage && <button onClick={openCreate} className="btn-primary flex items-center gap-2 mx-auto">
                <Plus className="h-4 w-4" /> {t("projects:datastreams.add", "Thêm Datastream")}
              </button>}
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="card py-12 text-center">
            <p className="text-sm text-slate-500">
              {t("projects:datastreams.no_match", "Không có datastream nào khớp với tìm kiếm hoặc bộ lọc.")}
            </p>
            <button
              className="btn-ghost mt-2 text-sm"
              onClick={() => {
                setSearch("");
                setFilterType("");
              }}
            >
              {t("common:clear_filters", "Xóa bộ lọc")}
            </button>
          </div>
        ) : viewMode === "list" ? (
          <Card className="p-0 overflow-hidden flex flex-col flex-1">
            <div className="overflow-x-auto">
              <div className="flex flex-col md:min-w-[1120px]">
                <div className="hidden md:flex items-center gap-4 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-text-secondary bg-slate-100/75 dark:bg-surface-elevated/70 border-b border-slate-200 dark:border-border-subtle shrink-0">
                  <div className="w-10 text-center">Pin</div>
                  <div className="flex-1">{t("projects:datastreams.col_name", "Tên Datastream / Alias")}</div>
                  <div className="w-32">{t("projects:datastreams.col_type", "Kiểu dữ liệu")}</div>
                  <div className="w-44">{t("projects:datastreams.col_direction", "Hướng truyền")}</div>
                  <div className="w-40">{t("projects:datastreams.col_range_unit", "Giới hạn / Đơn vị")}</div>
                  <div className="w-32">{t("projects:datastreams.col_default", "Mặc định")}</div>
                  <div className="w-24 text-right">{t("common:col.actions", "Thao tác")}</div>
                </div>

                {pagedDatastreams.map((ds) => (
                  <DatastreamListRow
                    key={ds.id}
                    ds={ds}
                    logoColor={getLogoColor(ds.id)}
                    onEdit={() => openEdit(ds)}
                    onDelete={() => setDeleteTarget(ds)}
                  />
                ))}
              </div>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pagedDatastreams.map((ds) => (
              <DatastreamCard
                key={ds.id}
                ds={ds}
                logoColor={getLogoColor(ds.id)}
                onEdit={() => openEdit(ds)}
                onDelete={() => setDeleteTarget(ds)}
              />
            ))}
          </div>
        )}
        {filteredItems.length > 0 && <PaginationBar page={page} totalPages={totalPages} totalItems={filteredItems.length} pageSize={PAGE_SIZE} onPrev={() => setPage(page - 1)} onNext={() => setPage(page + 1)} className="mt-auto shrink-0" />}
      </div>

      {/* ── Add / Edit Modal ─────────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editTarget ? t("projects:datastreams.modal_edit_title", "Chỉnh sửa template Virtual Pin: {{name}}", { name: editTarget.name }) : t("projects:datastreams.modal_add_title", "Thêm template Virtual Pin")}
        size="lg"
      >
        <div className="space-y-4">
          {/* Row 1: Name and Alias */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.form_name", "Tên")} <span className="text-red-500">*</span></label>
              <input
                id="ds-name"
                type="text"
                value={form.name}
                onChange={(e) => {
                  setField("name", e.target.value);
                  if (!form.alias) {
                    const slug = e.target.value
                      .toLowerCase()
                      .replace(/[^\w\s]/g, "")
                      .replace(/[\s_]+/g, "_")
                      .slice(0, 255);
                    setField("alias", slug);
                  }
                }}
                placeholder={t("projects:datastreams.form_name_placeholder", "VD: Nhiệt độ phòng")}
                className={cn("input w-full", formErrors.name && "border-red-400")}
              />
              {formErrors.name && <p className="text-xs text-red-500 mt-1">{formErrors.name}</p>}
            </div>
            <div>
              <label className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.form_alias", "Alias")}</label>
              <input
                id="ds-alias"
                type="text"
                value={form.alias ?? ""}
                onChange={(e) => setField("alias", e.target.value)}
                placeholder={t("projects:datastreams.form_alias_placeholder", "VD: nhiet_do_phong")}
                className="input w-full font-mono"
              />
            </div>
          </div>

          {/* Row 2: PIN and DATA TYPE */}
          <div className="grid grid-cols-2 gap-4">
            {!editTarget ? (
              <div>
                <label className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.form_virtual_pin", "Virtual Pin")} <span className="text-red-500">*</span></label>
                <select
                  id="ds-pin"
                  value={form.pin}
                  onChange={(e) => setField("pin", Number(e.target.value))}
                  className="input w-full font-mono"
                >
                  {pinOptions.map((o) => (
                    <option key={o.value} value={o.value} disabled={o.disabled}>
                      {o.label}{o.disabled ? t("projects:datastreams.pin_used", " (đã dùng)") : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.form_virtual_pin", "Virtual Pin")}</label>
                <input type="text" value={`V${editTarget.pin}`} disabled className="input w-full bg-slate-50 font-mono text-slate-500 cursor-not-allowed" />
              </div>
            )}
            
            <div>
              <label className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.form_data_type", "Data Type")}</label>
              <select 
                value={pinPreset}
                onChange={(e) => {
                  const presetKey = e.target.value as any;
                  setPinPreset(presetKey);
                  let dt: any = "boolean";
                  let dir: any = "bidirectional";
                  let minVal = null;
                  let maxVal = null;
                  let defVal = null;
                  
                  if (presetKey === "digital") {
                    dt = "boolean";
                    dir = "bidirectional";
                    defVal = "0";
                  } else if (presetKey === "analog") {
                    dt = "double";
                    dir = "telemetry";
                  } else if (presetKey === "integer") {
                    dt = "integer";
                    dir = "telemetry";
                  } else if (presetKey === "pwm") {
                    dt = "integer";
                    dir = "command";
                    minVal = 0;
                    maxVal = 255;
                    defVal = "0";
                  } else if (presetKey === "string") {
                    dt = "string";
                    dir = "telemetry";
                  } else if (presetKey === "json") {
                    dt = "string";
                    dir = "telemetry";
                    defVal = "{}";
                  }
                  
                  setForm((prev) => ({
                    ...prev,
                    data_type: dt,
                    direction: dir,
                    min_value: minVal,
                    max_value: maxVal,
                    default_value: defVal,
                  }));
                }}
                className="input w-full font-medium"
              >
                <option value="digital">{t("projects:datastreams.preset_digital", "Digital (Boolean)")}</option>
                <option value="analog">{t("projects:datastreams.preset_analog", "Analog (Double)")}</option>
                <option value="integer">{t("projects:datastreams.preset_integer", "Integer")}</option>
                <option value="pwm">{t("projects:datastreams.preset_pwm", "PWM (0-255)")}</option>
                <option value="string">{t("projects:datastreams.preset_string", "String")}</option>
                <option value="json">{t("projects:datastreams.preset_json", "JSON")}</option>
              </select>
            </div>
          </div>

          {/* Row 3: UNITS */}
          {(pinPreset === "analog" || pinPreset === "integer" || pinPreset === "pwm") && (
            <div>
              <label className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.form_units", "Units")}</label>
              <div className="flex gap-2">
                <select
                  id="ds-unit-select"
                  value={useCustomUnit ? "__custom__" : (form.unit ?? "none")}
                  onChange={(e) => {
                    if (e.target.value === "__custom__") {
                      setUseCustomUnit(true);
                      setField("unit", null);
                    } else {
                      setUseCustomUnit(false);
                      setField("unit", e.target.value === "none" ? null : e.target.value);
                    }
                  }}
                  className="input flex-1"
                >
                  <option value="none">{t("projects:datastreams.unit_none", "— Không có đơn vị —")}</option>
                  {UNIT_OPTIONS.filter((u) => u !== "none").map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                  <option value="__custom__">{t("projects:datastreams.unit_custom", "Tự nhập đơn vị khác...")}</option>
                </select>
                {useCustomUnit && (
                  <input
                    type="text"
                    value={customUnit}
                    onChange={(e) => setCustomUnit(e.target.value)}
                    placeholder={t("projects:datastreams.unit_custom_placeholder", "Nhập đơn vị...")}
                    className="input w-32"
                  />
                )}
              </div>
            </div>
          )}

          {/* Row 4: MIN, MAX, DEFAULT */}
          <div className="grid grid-cols-3 gap-4 items-start">
            {(pinPreset === "analog" || pinPreset === "integer") ? (
               <>
                 <div>
                   <label className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.form_min", "Min")}</label>
                   <input 
                     type="number" 
                     value={form.min_value ?? ""}
                     onChange={(e) => setField("min_value", e.target.value === "" ? null : Number(e.target.value))}
                     className={cn("input w-full", formErrors.min_value && "border-red-400")} 
                   />
                 </div>
                 <div>
                   <label className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.form_max", "Max")}</label>
                   <input 
                     type="number" 
                     value={form.max_value ?? ""}
                     onChange={(e) => setField("max_value", e.target.value === "" ? null : Number(e.target.value))}
                     className="input w-full" 
                   />
                 </div>
               </>
            ) : pinPreset === "pwm" ? (
               <>
                 <div>
                   <label className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.form_min", "Min")}</label>
                   <input type="number" value={0} disabled className="input w-full bg-slate-50 text-slate-400 cursor-not-allowed" />
                 </div>
                 <div>
                   <label className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.form_max", "Max")}</label>
                   <input type="number" value={255} disabled className="input w-full bg-slate-50 text-slate-400 cursor-not-allowed" />
                 </div>
               </>
            ) : (
               <div className="col-span-2"></div>
            )}
            
            <div className={pinPreset === "digital" || pinPreset === "string" || pinPreset === "json" ? "col-span-3" : "col-span-1"}>
               <label className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.form_default_value", "Default Value")}</label>
               {pinPreset === "digital" && (
                 <select 
                   value={form.default_value ?? ""} 
                   onChange={(e) => setField("default_value", e.target.value === "" ? null : e.target.value)} 
                   className="input w-full"
                 >
                    <option value="">{t("projects:datastreams.default_null", "Không cấu hình (Null)")}</option>
                    <option value="false">{t("projects:datastreams.default_false", "False (Tắt)")}</option>
                    <option value="true">{t("projects:datastreams.default_true", "True (Bật)")}</option>
                 </select>
               )}
               {(pinPreset === "analog" || pinPreset === "integer") && (
                 <input 
                   type="number" 
                   step={pinPreset === "analog" ? "any" : "1"} 
                   value={form.default_value ?? ""}
                   onChange={(e) => setField("default_value", e.target.value === "" ? null : e.target.value)}
                   className="input w-full font-mono" 
                 />
               )}
               {pinPreset === "pwm" && (
                 <div className="flex items-center gap-2 h-[42px] px-2 rounded-lg border border-slate-200 dark:border-border-subtle bg-slate-50 dark:bg-slate-800/50">
                   <input 
                     type="range" 
                     min="0" max="255"
                     value={form.default_value ?? "0"}
                     onChange={(e) => setField("default_value", e.target.value)}
                     className="flex-1"
                   />
                   <span className="w-8 text-xs font-mono text-slate-500">{form.default_value ?? "0"}</span>
                 </div>
               )}
               {pinPreset === "string" && (
                 <input 
                   type="text" 
                   value={form.default_value ?? ""}
                   onChange={(e) => setField("default_value", e.target.value || null)}
                   className="input w-full" 
                 />
               )}
               {pinPreset === "json" && (
                 <textarea 
                   rows={2}
                   value={form.default_value ?? ""}
                   onChange={(e) => setField("default_value", e.target.value || null)}
                   placeholder={t("projects:datastreams.json_placeholder", 'VD: { "status": "ok" }')}
                   className={cn("input w-full font-mono text-xs", 
                     form.default_value && (() => {
                       try { JSON.parse(form.default_value); return "border-emerald-400"; } 
                       catch { return "border-red-400 text-red-600"; }
                     })()
                   )}
                 />
               )}
               {pinPreset === "json" && form.default_value && (() => {
                 try { JSON.parse(form.default_value); return null; } 
                 catch (err: any) { return <p className="text-xs text-red-500 mt-1">{t("projects:datastreams.json_error", "JSON lỗi: {{message}}", { message: err.message })}</p>; }
               })()}
            </div>
          </div>
          
          {/* ADVANCED SETTINGS */}
          <div className="pt-2 border-t border-slate-100 dark:border-border-subtle mt-4">
            <button 
              type="button" 
              onClick={() => setShowAdvanced(!showAdvanced)} 
              className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-text-primary hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
            >
              <ChevronRight className={cn("h-4 w-4 transition-transform", showAdvanced && "rotate-90")} />
              {t("projects:datastreams.advanced_settings", "Advanced Settings")}
            </button>
            
            {showAdvanced && (
              <div className="mt-4 space-y-4 pl-5 border-l-2 border-slate-100 dark:border-border-subtle ml-2">
                 {/* Direction */}
                 <div>
                   <label className="label-xs mb-2 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.direction_label", "Direction")}</label>
                   <div className="flex gap-2">
                     {[
                       { value: "telemetry", label: t("projects:datastreams.dir_telemetry", "Chỉ đọc (Telemetry)") },
                       { value: "command", label: t("projects:datastreams.dir_command", "Chỉ ghi (Command)") },
                       { value: "bidirectional", label: t("projects:datastreams.dir_bidirectional", "Hai chiều (Bidirectional)") },
                     ].map((d) => (
                       <button
                         key={d.value}
                         type="button"
                         onClick={() => setField("direction", d.value as any)}
                         className={cn(
                           "flex-1 rounded-md border px-2.5 py-2 text-xs font-medium transition-colors",
                           form.direction === d.value
                             ? "border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-900/30 dark:text-brand-300"
                             : "border-slate-200 text-slate-600 hover:border-slate-300 dark:border-border-subtle dark:text-text-secondary hover:bg-slate-50 dark:hover:bg-slate-800/20",
                         )}
                       >
                         {d.label}
                       </button>
                     ))}
                   </div>
                 </div>

                 {/* Models */}
                 <div>
                   <label className="label-xs mb-2 block uppercase tracking-[0.1em] text-slate-500">{t("projects:datastreams.models_label", "Compatible Models")}</label>
                   {modelsQ.isLoading ? (
                     <p className="text-xs text-slate-400">{t("projects:datastreams.loading_models", "Đang tải danh sách bo mạch...")}</p>
                   ) : deviceModels.length === 0 ? (
                     <p className="text-xs text-slate-400">{t("projects:datastreams.no_models", "Không tìm thấy loại bo mạch nào.")}</p>
                   ) : (
                     <div className="grid grid-cols-2 gap-2 border border-slate-200 dark:border-border-subtle rounded-md p-3 max-h-32 overflow-y-auto">
                       {deviceModels.map((m) => {
                         const isChecked = (form.supported_model_ids || []).includes(m.id);
                         return (
                           <label key={m.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-text-secondary cursor-pointer">
                             <input
                               type="checkbox"
                               checked={isChecked}
                               onChange={(e) => {
                                 const current = form.supported_model_ids || [];
                                 const next = e.target.checked
                                   ? [...current, m.id]
                                   : current.filter((id) => id !== m.id);
                                 setField("supported_model_ids", next);
                               }}
                               className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                             />
                             <span>{m.name}</span>
                           </label>
                         );
                       })}
                     </div>
                   )}
                 </div>

                 {/* Description */}
                 <div>
                   <label className="label-xs mb-1 block uppercase tracking-[0.1em] text-slate-500">Description</label>
                   <textarea
                     id="ds-description"
                     value={form.description ?? ""}
                     onChange={(e) => setField("description", e.target.value || null)}
                     rows={2}
                     placeholder="Mô tả chức năng của kênh này..."
                     className="input w-full resize-none"
                   />
                 </div>
              </div>
            )}
          </div>

          {/* Error */}
          {saveError && (
            <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-300">
              {saveError}
            </div>
          )}

          {/* Footer buttons */}
          <div className="flex justify-end gap-3 pt-2 border-t border-slate-100 dark:border-border-subtle">
            <button
              type="button"
              onClick={closeModal}
              className="btn-secondary"
              disabled={isSaving}
            >
              {t("common:actions.cancel", "Hủy")}
            </button>
            <button
              id="btn-save-datastream"
              type="button"
              onClick={handleSubmit}
              disabled={isSaving}
              className="btn-primary flex items-center gap-2"
            >
              {isSaving ? t("common:actions.saving", "Đang lưu...") : editTarget ? t("projects:datastreams.btn_save_changes", "Lưu thay đổi") : t("projects:datastreams.btn_create", "Tạo Datastream")}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Delete Confirm ────────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={canManage && !!deleteTarget}
        title={t("projects:datastreams.delete_title", 'Xóa Datastream "{{name}}"?', { name: deleteTarget?.name })}
        description={
          deleteError
            ? deleteError
            : t("projects:datastreams.delete_desc", "Thao tác này không thể hoàn tác. Nếu Datastream đang được sử dụng bởi Widget, hệ thống sẽ từ chối xóa.")
        }
        confirmLabel={t("common:actions.delete", "Xóa")}
        destructive={true}
        loading={deleteMut.isPending}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        onCancel={() => {
          setDeleteTarget(null);
          deleteMut.reset();
        }}
      />
    </>
  );
}
