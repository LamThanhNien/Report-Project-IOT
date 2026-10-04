import { ReadOnlyNotice } from "../../../components/permissions/PermissionGate";
import { ActionDropdown } from "../../../components/ui/ActionDropdown";
import { usePagination } from "../../../hooks/usePagination";
import { PaginationBar } from "../../../components/ui/PaginationBar";
import { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, Link } from "react-router-dom";
import { usePersistedState } from "../../../hooks/usePersistedState";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Eye,
  Cpu,
  GitBranch,
  Plus,
  Check,
  Link2,
  Wifi,
  WifiOff,
  Clock,
  RefreshCw,
  AlertCircle,
  Unlink,
  LayoutGrid,
  List,
  MoreVertical,
  Copy,
  ArrowRight,
  X,
  Pencil,
  Rocket,
} from "lucide-react";
import { listClientDevices, getClientProject, updateClientDevice } from "../../../services/clientApi";
import { apiPut, apiDelete } from "../../../services/apiClient";
import { deviceGroupApi } from "../../../services/deviceGroupApi";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { Modal } from "../../../components/ui/Modal";
import { DeviceEditModal, type DeviceEditPayload } from "../../../components/devices/DeviceEditModal";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { useFeature } from "../../../contexts/FeatureContext";
import { useAuth } from "../../../contexts/AuthContext";
import { canManageDevices, canManageOta } from "../../../lib/permissions";
import { formatRelative } from "../../../lib/formatters";
import type { Device } from "../../../types";
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

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function getLogoColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return LOGO_COLORS[hash % LOGO_COLORS.length];
}

// ─── Status Resolver ─────────────────────────────────────────────────────────

function getDeviceStatus(device: Device, t?: (key: string, fallback: string) => string): { label: string; textColor: string; dotColor: string } {
  const labelMap: Record<string, string> = {
    online: t ? t("devices:status_online", "Online") : "Online",
    offline: t ? t("devices:status_offline", "Offline") : "Offline",
    provisioning: t ? t("devices:status_provisioning", "Provisioning") : "Provisioning",
    maintenance: t ? t("devices:status_maintenance", "Bảo trì") : "Bảo trì",
    unknown: t ? t("devices:status_unknown", "Không rõ") : "Không rõ",
    deleted: t ? t("devices:status_deleted", "Đã xóa") : "Đã xóa",
  };
  const toneMap: Record<string, { textColor: string; dotColor: string }> = {
    online: {
      textColor: "text-emerald-600 dark:text-emerald-400 font-medium",
      dotColor: "bg-emerald-500",
    },
    offline: {
      textColor: "text-rose-600 dark:text-rose-400 font-medium",
      dotColor: "bg-rose-500",
    },
    provisioning: {
      textColor: "text-sky-600 dark:text-sky-400 font-medium",
      dotColor: "bg-sky-500",
    },
    maintenance: {
      textColor: "text-amber-600 dark:text-amber-400 font-medium",
      dotColor: "bg-amber-500",
    },
  };
  const status = (device.status || "unknown").toLowerCase();
  const label = labelMap[status] ?? device.status;
  const colors = toneMap[status] ?? {
    textColor: "text-slate-500 dark:text-text-muted font-medium",
    dotColor: "bg-slate-400 dark:bg-text-muted",
  };
  return { label, ...colors };
}

// ─── Actions Dropdown Menu ───────────────────────────────────────────────────

interface DeviceActionsMenuProps {
  device: Device;
  canManage: boolean;
  canOta: boolean;
  onUnassign: () => void;
  onView: () => void;
  onEdit: () => void;
  onOta: () => void;
}

export function DeviceActionsMenu({
  device,
  canManage,
  canOta,
  onUnassign,
  onView,
  onEdit,
  onOta,
}: DeviceActionsMenuProps) {
  const { t } = useTranslation(["devices", "common"]);

  return (
    <ActionDropdown
      triggerSize="sm"
      triggerAriaLabel={t("devices:aria_actions_for", "Thao tác cho {{name}}", { name: device.name })}
      triggerTitle={t("devices:aria_actions_for", "Thao tác cho {{name}}", { name: device.name })}
      menuWidth="w-44"
      items={[
        {
          id: "view",
          icon: <Eye className="h-3.5 w-3.5 text-slate-400" />,
          label: t("devices:action_view", "Xem chi tiết"),
          onClick: onView,
        },
        canManage && device.status !== "deleted"
          ? {
              id: "edit",
              icon: <Pencil className="h-3.5 w-3.5 text-slate-400" />,
              label: t("devices:action_edit", "Sửa thông tin"),
              onClick: onEdit,
            }
          : null,
        canOta
          ? {
              id: "ota",
              icon: <Rocket className="h-3.5 w-3.5 text-sky-500" />,
              label: t("devices:action_ota", "Tạo OTA"),
              onClick: onOta,
            }
          : null,
        {
          id: "copy_uid",
          icon: <Copy className="h-3.5 w-3.5 text-slate-400" />,
          label: t("devices:action_copy_uid", "Sao chép UID"),
          onClick: () => navigator.clipboard.writeText(device.device_uid),
        },
        canManage ? {
          variant: "separator",
        } : null,
        canManage ? {
          id: "unassign",
          danger: true,
          icon: <Unlink className="h-3.5 w-3.5" />,
          label: t("devices:action_unassign", "Gỡ khỏi dự án"),
          onClick: onUnassign,
        } : null,
      ]}
    />
  );
}

// ─── Filter Pills Component ──────────────────────────────────────────────────

function getDeviceFilters(t: (key: string, fallback: string) => string) {
  return [
    { key: "", label: t("common:all", "Tất cả") },
    { key: "online", label: t("devices:status_online", "Online") },
    { key: "offline", label: t("devices:status_offline", "Offline") },
    { key: "provisioning", label: t("devices:status_provisioning", "Provisioning") },
    { key: "maintenance", label: t("devices:status_maintenance", "Bảo trì") },
  ];
}

interface FilterProps {
  search: string;
  onSearchChange: (val: string) => void;
  statusFilter: string;
  onStatusFilterChange: (val: string) => void;
  viewMode: "grid" | "list";
  onViewModeChange: (val: "grid" | "list") => void;
}

function DeviceSearchAndFilters({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  viewMode,
  onViewModeChange,
}: FilterProps) {
  const { t } = useTranslation(["devices", "common"]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 dark:border-border-subtle pb-4 pt-1">
      <div className="relative max-w-sm flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          className="input pl-9 pr-8"
          placeholder={t("devices:search_placeholder", "Tìm thiết bị...")}
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
          {getDeviceFilters(t).map((f) => (
            <button
              key={f.key}
              className={cn(
                "chip whitespace-nowrap transition-colors",
                statusFilter === f.key
                  ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-surface-elevated dark:text-text-muted dark:hover:bg-surface-muted",
              )}
              onClick={() => onStatusFilterChange(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-border p-0.5 bg-surface-elevated">
          <button
            aria-label={t("common:view_list", "Dạng danh sách")}
            title={t("common:view_list", "Dạng danh sách")}
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
            title={t("common:view_grid", "Dạng lưới")}
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

interface DeviceCardProps {
  device: Device;
  projectId: string;
  logoColor: string;
  initials: string;
  canManage: boolean;
  canOta: boolean;
  onUnassign: () => void;
  onView: () => void;
  onEdit: () => void;
  onOta: () => void;
}

function DeviceCard({ device, projectId, logoColor, initials, canManage, canOta, onUnassign, onView, onEdit, onOta }: DeviceCardProps) {
  const { t } = useTranslation(["devices", "common"]);
  const status = getDeviceStatus(device, t);
  const detailPath = `/client/workspace/${projectId}/devices/${device.device_uid}`;

  return (
    <Card className="group relative overflow-hidden flex h-full flex-col border border-slate-200/80 bg-white shadow-sm transition-all duration-150 hover:border-slate-400 hover:bg-slate-50/40 dark:border-border-subtle dark:bg-surface dark:hover:border-slate-700 dark:hover:bg-surface-elevated/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        {/* Logo icon */}
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm",
            logoColor,
          )}
        >
          {initials}
        </div>

        {/* Name + UID */}
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base">{device.name}</CardTitle>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
            <span className="truncate font-mono">UID: {device.device_uid}</span>
          </div>
        </div>

        <DeviceActionsMenu
          device={device}
          canManage={canManage}
          canOta={canOta}
          onUnassign={onUnassign}
          onView={onView}
          onEdit={onEdit}
          onOta={onOta}
        />
      </CardHeader>
      <CardBody>
        <div className="mb-2">
          <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px] mb-0.5">{t("devices:description", "Mô tả")}</span>
          <p className="min-h-[2.5rem] text-sm text-slate-600 dark:text-text-muted">
            {device.description || t("devices:no_description", "Không có mô tả")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 py-2.5 my-3 border-y border-slate-100 dark:border-border-subtle text-xs text-slate-600 dark:text-text-secondary">
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("devices:col_status", "Trạng thái")}</span>
            <span className={cn("inline-flex items-center gap-1.5 font-medium", status.textColor)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", status.dotColor)} />
              {status.label}
            </span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("devices:col_hardware", "Phần cứng")}</span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-text-primary">
              <Cpu className="h-3.5 w-3.5" />
              {device.hardware_model || "ESP32"}
            </span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("devices:col_firmware", "Firmware")}</span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-text-primary">
              <GitBranch className="h-3.5 w-3.5" />
              {device.firmware_version || t("devices:not_available", "Chưa có")}
            </span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("devices:col_last_seen", "Lần cuối online")}</span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-text-primary">
              <Clock className="h-3.5 w-3.5" />
              {device.last_seen_at ? formatRelative(device.last_seen_at) : t("devices:not_available", "Chưa có")}
            </span>
          </div>
        </div>

        <Link
          className="btn-primary mt-4 w-full"
          to={detailPath}
        >
          {t("devices:action_view", "Xem chi tiết")} →
        </Link>
      </CardBody>
    </Card>
  );
}

// ─── List Row Component ──────────────────────────────────────────────────────

interface DeviceListRowProps {
  device: Device;
  projectId: string;
  logoColor: string;
  initials: string;
  canManage: boolean;
  canOta: boolean;
  onUnassign: () => void;
  onView: () => void;
  onEdit: () => void;
  onOta: () => void;
}

function DeviceListRow({ device, projectId, logoColor, initials, canManage, canOta, onUnassign, onView, onEdit, onOta }: DeviceListRowProps) {
  const { t } = useTranslation(["devices", "common"]);
  const status = getDeviceStatus(device, t);
  const detailPath = `/client/workspace/${projectId}/devices/${device.device_uid}`;

  return (
    <div className="group relative flex flex-col md:flex-row md:items-center gap-3 md:gap-4 border-b border-slate-100 dark:border-border-subtle px-4 py-3 hover:bg-slate-50/60 dark:hover:bg-surface-elevated/50 transition-colors">
      {/* Logo */}
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm mx-auto md:mx-0",
          logoColor,
        )}
      >
        {initials}
      </div>

      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary">{device.name}</span>
        <span className="block truncate text-[11px] font-mono text-slate-400">UID: {device.device_uid}</span>
      </div>

      <div className="w-full md:w-32 md:shrink-0 flex items-center gap-1.5 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:col_status", "Trạng thái")}:</span>
        <span className={cn("h-1.5 w-1.5 rounded-full", status.dotColor)} />
        <span className={status.textColor}>{status.label}</span>
      </div>

      <div className="w-full md:w-32 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:col_hardware", "Phần cứng")}:</span>
        <span className="font-medium text-slate-700 dark:text-text-primary">{device.hardware_model || "ESP32"}</span>
      </div>

      {/* Firmware */}
      <div className="w-full md:w-28 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">Firmware:</span>
        <span className="font-medium text-slate-700 dark:text-text-primary">{device.firmware_version || t("devices:not_available", "Chưa có")}</span>
      </div>

      <div className="w-full md:w-32 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:col_last_seen", "Lần cuối online")}:</span>
        <span className="font-medium text-slate-600 dark:text-text-muted">{device.last_seen_at ? formatRelative(device.last_seen_at) : t("devices:not_available", "Chưa có")}</span>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center justify-end gap-1 w-full md:w-24 border-t md:border-t-0 pt-2 md:pt-0">
        <Link
          className="btn-primary flex items-center gap-1 px-2.5 py-1.5 text-xs"
          to={detailPath}
        >
          {t("devices:col_detail", "Chi tiết")}
          <ArrowRight className="h-3 w-3" />
        </Link>
        <DeviceActionsMenu
          device={device}
          canManage={canManage}
          canOta={canOta}
          onUnassign={onUnassign}
          onView={onView}
          onEdit={onEdit}
          onOta={onOta}
        />
      </div>
    </div>
  );
}

// ─── Skeleton Component ──────────────────────────────────────────────────────

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

export function WorkspaceDevices() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { t } = useTranslation(["devices", "common"]);

  const { hasFeature } = useFeature();
  const { user } = useAuth();
  const canManage = canManageDevices(user);
  const canCreateOta = hasFeature("ota_update") && canManageOta(user);

  const [search, setSearch] = usePersistedState(`aifom_workspacedevices_search_${projectId}`, "", "session");
  const [statusFilter, setStatusFilter] = usePersistedState(`aifom_workspacedevices_statusfilter_${projectId}`, "", "session");
  const [viewMode, setViewMode] = usePersistedState<"grid" | "list">(`aifom_workspacedevices_view_${projectId}`, "grid", "local");

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [unassignTarget, setUnassignTarget] = useState<Device | null>(null);
  const [editTarget, setEditTarget] = useState<Device | null>(null);

  const [assignMode, setAssignMode] = useState<"individual" | "group">("individual");
  const [selectedDeviceUids, setSelectedDeviceUids] = useState<Set<string>>(new Set());
  const [selectedGroupId, setSelectedGroupId] = useState<string>("");
  const [isAssigning, setIsAssigning] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const devicesQ = useQuery({
    queryKey: ["client-devices"],
    queryFn: () => listClientDevices(),
    refetchInterval: 10_000,
  });

  const projectQ = useQuery({
    queryKey: ["client-project-detail", projectId],
    queryFn: () => (projectId ? getClientProject(projectId) : Promise.reject("No project id")),
    enabled: !!projectId,
  });

  const groupsQ = useQuery({
    queryKey: ["client-device-groups"],
    queryFn: () => deviceGroupApi.listDeviceGroups({ limit: 100 }),
    enabled: assignModalOpen,
  });

  const groupDevicesQ = useQuery({
    queryKey: ["client-device-group-members", selectedGroupId],
    queryFn: () => deviceGroupApi.listGroupDevices(selectedGroupId, { limit: 200 }),
    enabled: !!selectedGroupId && assignMode === "group",
  });

  // ── Unassign mutation ─────────────────────────────────────────────────────────

  const unassignMut = useMutation({
    mutationFn: async (deviceUid: string) => {
      if (!projectId) return;
      return apiDelete(`/api/v1/client/projects/${projectId}/devices/${deviceUid}/unassign`);
    },
    onSuccess: () => {
      setUnassignTarget(null);
      qc.invalidateQueries({ queryKey: ["client-devices"] });
      qc.invalidateQueries({ queryKey: ["client-project-detail", projectId] });
    },
  });

  // ── Update device mutation ──────────────────────────────────────────────────────

  const updateDeviceMut = useMutation({
    mutationFn: ({ deviceUid, data }: { deviceUid: string; data: DeviceEditPayload }) =>
      updateClientDevice(deviceUid, data),
    onSuccess: (_device, variables) => {
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ["client-devices"] });
      qc.invalidateQueries({ queryKey: ["client-device-detail", variables.deviceUid] });
    },
  });

  // ── Derived data ──────────────────────────────────────────────────────────────

  const allDevices = devicesQ.data ?? [];
  const projectDetail = projectQ.data;
  const projectDevices = useMemo(
    () => allDevices.filter((device) => device.project_id === projectId),
    [allDevices, projectId],
  );

  const availableToAssign = useMemo(() => {
    const existingIds = new Set(projectDevices.map((d) => d.id));
    return allDevices.filter((d) => !existingIds.has(d.id));
  }, [allDevices, projectDevices]);

  const groupDevicesToAssign = useMemo(() => {
    if (!groupDevicesQ.data?.items) return [];
    const existingUids = new Set(projectDevices.map((d) => d.device_uid));
    return groupDevicesQ.data.items.filter((d) => !existingUids.has(d.device_uid));
  }, [groupDevicesQ.data, projectDevices]);

  const filtered = useMemo(() => {
    return projectDevices.filter((d) => {
      const matchStatus = !statusFilter || d.status.toLowerCase() === statusFilter.toLowerCase();
      const q = search.toLowerCase();
      const matchSearch =
        !search ||
        d.name.toLowerCase().includes(q) ||
        d.device_uid.toLowerCase().includes(q) ||
        (d.hardware_model && d.hardware_model.toLowerCase().includes(q));
      return matchStatus && matchSearch;
    });
  }, [projectDevices, search, statusFilter]);

  const PAGE_SIZE = 12;
  const { page, setPage, totalPages, pagedItems: pagedDevices } = usePagination(filtered, PAGE_SIZE, [search, statusFilter, projectId]);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleAssign = async () => {
    if (!canManage) return;
    if (!projectId) return;
    setIsAssigning(true);
    try {
      const uids =
        assignMode === "individual"
          ? Array.from(selectedDeviceUids)
          : groupDevicesToAssign.map((d) => d.device_uid);
      if (uids.length > 0) {
        await Promise.all(
          uids.map((uid) => apiPut(`/api/v1/client/projects/${projectId}/devices/${uid}/assign`, {})),
        );
      }
      setAssignModalOpen(false);
      setSelectedDeviceUids(new Set());
      setSelectedGroupId("");
      qc.invalidateQueries({ queryKey: ["client-devices"] });
      qc.invalidateQueries({ queryKey: ["client-project-detail", projectId] });
    } catch (err) {
      console.error("Assign error", err);
    } finally {
      setIsAssigning(false);
    }
  };

  const toggleDeviceSelection = (uid: string) => {
    setSelectedDeviceUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  return (
    <>
      <div className="flex flex-col flex-1 min-h-full space-y-4">
        {/* ── Page Header ────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-text-primary leading-tight">
              {t("devices:project_device_fleet", "Project Device Fleet")}
            </h1>
            <p className="text-sm text-slate-500 dark:text-text-muted mt-1">
              {t("devices:device_fleet_subtitle", "Devices in project")} &ldquo;{projectDetail?.name ?? t("common:current", "current")}&rdquo;
            </p>
          </div>

          {canManage && <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setAssignModalOpen(true)}
              className="btn-secondary"
            >
              <Link2 className="h-4 w-4" />
              {t("devices:assign_existing", "Gán thiết bị có sẵn")}
            </button>
            <button
              onClick={() => navigate(`/client/workspace/${projectId}/devices/onboard`)}
              className="btn-primary"
            >
              <Plus className="h-4 w-4" />
              {t("devices:add_new_device", "Thêm thiết bị mới")}
            </button>
          </div>}
        </div>

        {!canManage && <ReadOnlyNotice />}

        {/* ── Toolbar (Search, Filter, ViewMode Toggle) ─────────────────────────── */}
        <DeviceSearchAndFilters
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />

        {/* ── Content Area ──────────────────────────────────────────────────────── */}
        {devicesQ.isError ? (
          <div className="card py-12 text-center">
            <p className="text-sm text-slate-500">
              {t("devices:error_load", "Không tải được danh sách thiết bị. Vui lòng thử lại.")}
            </p>
            <button
              className="btn-ghost mt-2 text-sm"
              onClick={() => devicesQ.refetch()}
            >
              {t("common:retry", "Thử lại")}
            </button>
          </div>
        ) : devicesQ.isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : projectDevices.length === 0 ? (
          <div className="card py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.05]">
              <Cpu className="h-6 w-6 text-slate-400" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-slate-800 dark:text-text-primary">
              {t("devices:empty_project_title", "Dự án này chưa có thiết bị nào")}
            </h3>
            <p className="mt-2 text-xs text-slate-500 dark:text-text-muted max-w-sm mx-auto">
              {t("devices:empty_project_hint", "Bấm \"Gán thiết bị có sẵn\" để liên kết các thiết bị đang hoạt động của bạn vào dự án này.")}
            </p>
            {canManage && <div className="mt-6 flex items-center justify-center gap-2">
              <button
                onClick={() => setAssignModalOpen(true)}
                className="btn-secondary text-xs h-8 flex items-center gap-1.5"
              >
                <Link2 className="h-3.5 w-3.5" /> {t("devices:assign_existing", "Gán thiết bị có sẵn")}
              </button>
              <button
                onClick={() => navigate(`/client/workspace/${projectId}/devices/onboard`)}
                className="btn-primary text-xs h-8 flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" /> {t("devices:add_new_device", "Thêm thiết bị mới")}
              </button>
            </div>}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card py-12 text-center">
            <p className="text-sm text-slate-500">
              {t("devices:no_match", "Không có thiết bị nào khớp với tìm kiếm hoặc bộ lọc.")}
            </p>
            <button
              className="btn-ghost mt-2 text-sm"
              onClick={() => {
                setSearch("");
                setStatusFilter("");
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
                  <div className="w-10 text-center">Logo</div>
                  <div className="flex-1">{t("devices:col_name_uid", "Tên thiết bị / UID")}</div>
                  <div className="w-32">{t("devices:col_status", "Trạng thái")}</div>
                  <div className="w-32">{t("devices:col_hardware", "Phần cứng")}</div>
                  <div className="w-28">{t("devices:col_firmware", "Firmware")}</div>
                  <div className="w-32">{t("devices:col_last_seen", "Lần cuối online")}</div>
                  <div className="w-24 text-right">{t("common:col.actions", "Thao tác")}</div>
                </div>

                {pagedDevices.map((device) => (
                  <DeviceListRow
                    key={device.id}
                    device={device}
                    projectId={projectId!}
                    logoColor={getLogoColor(device.id)}
                    initials={getInitials(device.name)}
                    canManage={canManage}
                    canOta={canCreateOta}
                    onUnassign={() => setUnassignTarget(device)}
                    onView={() => navigate(`/client/workspace/${projectId}/devices/${device.device_uid}`)}
                    onEdit={() => setEditTarget(device)}
                    onOta={() => navigate(`/client/workspace/${projectId}/ota`, { state: { deviceUid: device.device_uid } })}
                  />
                ))}
              </div>
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {pagedDevices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                projectId={projectId!}
                logoColor={getLogoColor(device.id)}
                initials={getInitials(device.name)}
                canManage={canManage}
                canOta={canCreateOta}
                onUnassign={() => setUnassignTarget(device)}
                onView={() => navigate(`/client/workspace/${projectId}/devices/${device.device_uid}`)}
                onEdit={() => setEditTarget(device)}
                onOta={() => navigate(`/client/workspace/${projectId}/ota`, { state: { deviceUid: device.device_uid } })}
              />
            ))}
          </div>
        )}
        {filtered.length > 0 && <PaginationBar page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={PAGE_SIZE} onPrev={() => setPage(page - 1)} onNext={() => setPage(page + 1)} className="mt-auto shrink-0" />}
      </div>

      {/* ── Assign Modal ───────────────────────────────────────────────────────── */}
      <Modal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title={t("devices:modal_add_devices_title", "Thêm thiết bị vào Dự án")}
        size="md"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setAssignModalOpen(false)}>
              {t("common:cancel", "Hủy")}
            </button>
            <button
              className="btn-primary flex items-center gap-1.5"
              disabled={
                isAssigning ||
                (assignMode === "individual"
                  ? selectedDeviceUids.size === 0
                  : groupDevicesToAssign.length === 0)
              }
              onClick={handleAssign}
            >
              <Check className="h-3.5 w-3.5" />
              {isAssigning
                ? t("common:assigning", "Đang gán...")
                : assignMode === "individual"
                ? t("devices:assign_n_devices", "Gán {{count}} thiết bị", { count: selectedDeviceUids.size })
                : t("devices:assign_n_from_group", "Gán {{count}} thiết bị từ nhóm", { count: groupDevicesToAssign.length })}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-4 border-b border-slate-200 dark:border-border-subtle">
            <button
              className={cn(
                "pb-2 text-sm font-medium border-b-2 transition-colors",
                assignMode === "individual"
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:text-text-muted dark:hover:text-text-primary",
              )}
              onClick={() => setAssignMode("individual")}
            >
              {t("devices:assign_by_individual", "Chọn từng thiết bị")}
            </button>
            <button
              className={cn(
                "pb-2 text-sm font-medium border-b-2 transition-colors",
                assignMode === "group"
                  ? "border-brand-600 text-brand-600"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:text-text-muted dark:hover:text-text-primary",
              )}
              onClick={() => setAssignMode("group")}
            >
              {t("devices:assign_by_group", "Chọn theo nhóm")}
            </button>
          </div>

          {assignMode === "individual" && (
            <>
              <p className="text-xs text-slate-600 dark:text-text-muted">
                {t("devices:assign_individual_desc", "Chọn các thiết bị từ danh sách khả dụng của Tenant để phân bổ trực tiếp vào dự án")}{" "}
                <span className="font-semibold text-brand-600">{projectDetail?.name}</span>:
              </p>

              {availableToAssign.length === 0 ? (
                <div className="p-4 text-center border border-dashed rounded-lg text-xs text-slate-400">
                  {t("devices:all_devices_assigned", "Tất cả các thiết bị hiện có đều đã được gán vào dự án này.")}
                </div>
              ) : (
                <div className="max-h-60 overflow-y-auto space-y-1.5 border border-slate-200 dark:border-border-subtle rounded-lg p-2">
                  {availableToAssign.map((dev) => {
                    const isSelected = selectedDeviceUids.has(dev.device_uid);
                    return (
                      <div
                        key={dev.id}
                        onClick={() => toggleDeviceSelection(dev.device_uid)}
                        className={cn(
                          "flex items-center gap-3 p-2.5 rounded-md cursor-pointer transition-colors text-xs border",
                          isSelected
                            ? "bg-brand-50 border-brand-300 dark:bg-brand-900/30 dark:border-brand-700"
                            : "bg-white border-slate-100 hover:bg-slate-50 dark:bg-surface dark:border-border-subtle",
                        )}
                      >
                        <div
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                            isSelected
                              ? "border-brand-600 bg-brand-600 text-white"
                              : "border-slate-300 bg-white dark:border-slate-600 dark:bg-surface",
                          )}
                        >
                          {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-slate-800 dark:text-text-primary truncate">
                            {dev.name}
                          </div>
                          <div className="font-mono text-[10px] text-slate-400">
                            {dev.device_uid} {dev.hardware_model ? `(${dev.hardware_model})` : ""}
                          </div>
                        </div>
                        <div className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {assignMode === "group" && (
            <>
              <p className="text-xs text-slate-600 dark:text-text-muted">
                {t("devices:assign_group_desc", "Chọn một nhóm thiết bị. Hệ thống sẽ tự động gán toàn bộ thiết bị trong nhóm đó vào dự án này.")}
              </p>

              <div className="space-y-3">
                <select
                  className="input text-sm h-9 w-full"
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                >
                  <option value="" disabled>
                    {t("devices:select_group_placeholder", "-- Chọn nhóm thiết bị --")}
                  </option>
                  {groupsQ.data?.items.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.device_count} {t("common:devices", "thiết bị")})
                    </option>
                  ))}
                </select>

                {selectedGroupId && (
                  <div className="bg-slate-50 dark:bg-surface-elevated rounded-lg p-3 border border-slate-100 dark:border-border-subtle">
                    {groupDevicesQ.isLoading ? (
                      <div className="text-xs text-slate-500">{t("devices:checking_group_devices", "Đang kiểm tra thiết bị trong nhóm...")}</div>
                    ) : groupDevicesQ.isError ? (
                      <div className="text-xs text-rose-500">{t("devices:error_load_group", "Lỗi khi tải danh sách thiết bị.")}</div>
                    ) : (
                      <div className="space-y-1">
                        <div className="text-sm font-medium text-slate-800 dark:text-text-primary">
                          {t("devices:found_n_in_group", "Tìm thấy {{count}} thiết bị trong nhóm", { count: groupDevicesQ.data?.items.length || 0 })}
                        </div>
                        <div className="text-xs text-slate-500">
                          {t("devices:available_to_assign_prefix", "Trong đó có")}{" "}
                          <span className="font-semibold text-brand-600">
                            {groupDevicesToAssign.length} {t("common:devices", "thiết bị")}
                          </span>{" "}
                          {t("devices:available_to_assign_suffix", "khả dụng để gán thêm vào dự án này (các thiết bị còn lại đã nằm trong dự án).")}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ── Edit Device Modal ──────────────────────────────────────────────────── */}
      {editTarget && (
        <DeviceEditModal
          open={true}
          device={editTarget}
          loading={updateDeviceMut.isPending}
          error={updateDeviceMut.isError ? updateDeviceMut.error.message : null}
          onClose={() => {
            if (!updateDeviceMut.isPending) {
              setEditTarget(null);
              updateDeviceMut.reset();
            }
          }}
          onSubmit={(data) =>
            updateDeviceMut.mutate({ deviceUid: editTarget.device_uid, data })
          }
        />
      )}

      {/* ── Unassign Confirm ───────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={unassignTarget !== null}
        title={t("devices:unassign_modal_title", "Gỡ thiết bị khỏi dự án")}
        description={
          unassignTarget && (
            <p>
              {t("devices:unassign_confirm_prefix", "Bạn có chắc muốn gỡ thiết bị")}{" "}
              <span className="font-semibold text-slate-800 dark:text-text-secondary">
                {unassignTarget.name}
              </span>{" "}
              {t("devices:unassign_confirm_suffix", "khỏi dự án này?")}
            </p>
          )
        }
        confirmLabel={unassignMut.isPending ? t("common:processing", "Đang xử lý...") : t("devices:confirm_unassign", "Xác nhận gỡ")}
        destructive
        loading={unassignMut.isPending}
        onConfirm={() => unassignTarget && unassignMut.mutate(unassignTarget.device_uid)}
        onCancel={() => setUnassignTarget(null)}
      />
    </>
  );
}
