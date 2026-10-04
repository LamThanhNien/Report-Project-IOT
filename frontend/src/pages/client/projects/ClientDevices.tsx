import { ActionDropdown } from "../../../components/ui/ActionDropdown";
import { usePagination } from "../../../hooks/usePagination";
import { PaginationBar } from "../../../components/ui/PaginationBar";
import { useState, useMemo, useRef, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { usePersistedState } from "../../../hooks/usePersistedState";
import {
  Search,
  Plus,
  Rocket,
  Trash2,
  Cpu,
  Wifi,
  WifiOff,
  RefreshCw,
  Eye,
  MoreVertical,
  GitBranch,
  Clock,
  LayoutGrid,
  List,
  Copy,
  ArrowRight,
  X,
  Pencil,
  FolderOpen,
} from "lucide-react";
import {
  listClientDevices,
  listClientOtaJobs,
  listClientProjects,
  unassignClientDevice,
  updateClientDevice,
} from "../../../services/clientApi";
import { deviceGroupApi, type DeviceGroup } from "../../../services/deviceGroupApi";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { DeviceEditModal, type DeviceEditPayload } from "../../../components/devices/DeviceEditModal";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import { PageHeader } from "../../../components/ui/PageHeader";
import { ClientSectionNav, DEVICES_SECTION_NAV } from "../../../components/layout/ClientSectionNav";
import { TenantLoadingState } from "../../../components/ui/TenantUi";
import { useFeature } from "../../../contexts/FeatureContext";
import { useAuth } from "../../../contexts/AuthContext";
import { FeatureGate } from "./FeatureGate";
import { ReadOnlyNotice } from "../../../components/permissions/PermissionGate";
import { canManageDevices, canManageOta } from "../../../lib/permissions";
import { formatRelative } from "../../../lib/formatters";
import { cn } from "../../../lib/cn";
import { useDeviceStatusStream } from "../../../hooks/useDeviceStatusStream";
import type { Device } from "../../../types";

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

type DeviceFilter = "all" | "online" | "offline" | "needs_update" | "in_ota" | "has_alert";

function latestFirmwareVersion(devices: Device[]): string | null {
  if (devices.length === 0) return null;
  const versions = devices
    .map((d) => d.firmware_version)
    .filter((v): v is string => !!v);
  if (versions.length === 0) return null;
  return versions.sort().reverse()[0] ?? null;
}

// ─── Status Resolver ─────────────────────────────────────────────────────────

function getDeviceStatus(device: Device, t?: (key: string, fallback: string) => string): { label: string; textColor: string; dotColor: string } {
  const labelMap: Record<string, string> = {
    online: "Online",
    offline: "Offline",
    provisioning: "Provisioning",
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

// ─── Dropdown Actions Menu ───────────────────────────────────────────────────

interface DeviceActionsMenuProps {
  device: Device;
  canManage: boolean;
  canOta: boolean;
  onOta: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenProject: () => void;
}

export function DeviceActionsMenu({
  device,
  canManage,
  canOta,
  onOta,
  onEdit,
  onDelete,
  onOpenProject,
}: DeviceActionsMenuProps) {
  const navigate = useNavigate();
  const { t } = useTranslation(["devices", "common"]);

  return (
    <ActionDropdown
      triggerSize="sm"
      triggerAriaLabel={t("devices:actions_for", "Thao tác cho {{name}}", { name: device.name })}
      menuWidth="w-44"
      items={[
        {
          id: "view",
          icon: <Eye className="h-3.5 w-3.5 text-slate-400" />,
          label: t("common:actions.view_details", "Xem chi tiết"),
          onClick: () => navigate(`/client/devices/${device.device_uid}`),
        },
        device.project_id && onOpenProject
          ? {
              id: "open_project",
              icon: <FolderOpen className="h-3.5 w-3.5 text-brand-500" />,
              label: t("devices:open_project", "Mở dự án"),
              onClick: onOpenProject,
            }
          : null,
        canManage && device.status !== "deleted"
          ? {
              id: "edit",
              icon: <Pencil className="h-3.5 w-3.5 text-slate-400" />,
              label: t("devices:edit_info", "Sửa thông tin"),
              onClick: onEdit,
            }
          : null,
        canOta
          ? {
              id: "ota",
              icon: <Rocket className="h-3.5 w-3.5 text-sky-500" />,
              label: t("devices:create_ota", "Tạo OTA"),
              onClick: onOta,
            }
          : null,
        {
          id: "copy_uid",
          icon: <Copy className="h-3.5 w-3.5 text-slate-400" />,
          label: t("devices:copy_uid", "Sao chép UID"),
          onClick: () => navigator.clipboard.writeText(device.device_uid),
        },
        canManage && device.status !== "deleted"
          ? {
              variant: "separator",
            }
          : null,
        canManage && device.status !== "deleted"
          ? {
              id: "delete",
              danger: true,
              icon: <Trash2 className="h-3.5 w-3.5 text-rose-500" />,
              label: t("devices:delete_device", "Xóa thiết bị"),
              onClick: onDelete,
            }
          : null,
      ]}
    />
  );
}

// ─── Device Group Badges ─────────────────────────────────────────────────────

function DeviceGroupBadges({ deviceId, emptyFallback = null }: { deviceId: string; emptyFallback?: ReactNode }) {
  const groupsQuery = useQuery({
    queryKey: ["device-groups-for-device", deviceId],
    queryFn: async () => {
      try {
        const data = await deviceGroupApi.listDeviceGroupsForDevice(deviceId);
        try {
          localStorage.setItem(`cache:device-groups:${deviceId}`, JSON.stringify(data));
        } catch (e) {}
        return data;
      } catch (e) {
        return { items: [], total: 0 };
      }
    },
    initialData: () => {
      try {
        const cached = localStorage.getItem(`cache:device-groups:${deviceId}`);
        if (cached) {
          return JSON.parse(cached);
        }
      } catch (e) {}
      return undefined;
    },
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
    enabled: !!deviceId,
  });

  const groups: DeviceGroup[] = groupsQuery.data?.items ?? [];
  if (groups.length === 0) return <>{emptyFallback}</>;

  const visible = groups.slice(0, 2);
  const remaining = groups.length - visible.length;

  return (
    <div className="flex items-center gap-1">
      {visible.map((group) => (
        <span
          key={group.id}
          className="inline-flex max-w-[100px] items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[9px] font-medium text-slate-600 dark:border-border-subtle dark:bg-surface-elevated dark:text-text-secondary"
          title={group.name}
        >
          <span className="truncate">{group.name}</span>
        </span>
      ))}
      {remaining > 0 && (
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500 dark:bg-surface-elevated dark:text-text-muted">
          +{remaining}
        </span>
      )}
    </div>
  );
}

// ─── Project Tag ─────────────────────────────────────────────────────────────

function ProjectTag({ name, onOpen }: { name: string; onOpen: () => void }) {
  const { t } = useTranslation(["devices", "common"]);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      title={t("devices:open_project_title", 'Mở dự án {{name}}', { name })}
      className="inline-flex max-w-[160px] items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-medium text-brand-700 transition-colors hover:bg-brand-100 dark:bg-brand-500/10 dark:text-brand-300 dark:hover:bg-brand-500/20"
    >
      <FolderOpen className="h-3 w-3 shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  );
}

// ─── Filter Pills Component ──────────────────────────────────────────────────

interface FilterProps {
  search: string;
  onSearchChange: (val: string) => void;
  filter: DeviceFilter;
  onFilterChange: (val: DeviceFilter) => void;
  viewMode: "grid" | "list";
  onViewModeChange: (val: "grid" | "list") => void;
  stats: { total: number; online: number; offline: number; needsUpdate: number; inOta: number };
}

function DeviceSearchAndFilters({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  viewMode,
  onViewModeChange,
  stats,
}: FilterProps) {
  const { t } = useTranslation(["devices", "common"]);
  const FILTER_OPTIONS: { key: DeviceFilter; label: string }[] = [
    { key: "all", label: `${t("devices:filter_all", "Tất cả")} (${stats.total})` },
    { key: "online", label: `${t("devices:filter_online", "Online")} (${stats.online})` },
    { key: "offline", label: `${t("devices:filter_offline", "Offline")} (${stats.offline})` },
    { key: "needs_update", label: `${t("devices:filter_needs_update", "Cần cập nhật")} (${stats.needsUpdate})` },
    { key: "in_ota", label: `${t("devices:filter_in_ota", "Đang OTA")} (${stats.inOta})` },
  ];

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
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.key}
              className={cn(
                "chip whitespace-nowrap transition-colors",
                filter === f.key
                  ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-surface-elevated dark:text-text-muted dark:hover:bg-surface-muted",
              )}
              onClick={() => onFilterChange(f.key)}
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

interface DeviceCardProps {
  device: Device;
  logoColor: string;
  initials: string;
  canManage: boolean;
  canOta: boolean;
  projectName: string | null;
  onOta: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenProject: () => void;
}

function DeviceCard({ device, logoColor, initials, canManage, canOta, projectName, onOta, onEdit, onDelete, onOpenProject }: DeviceCardProps) {
  const { t } = useTranslation(["devices", "common"]);
  const status = getDeviceStatus(device, t);
  const detailPath = `/client/devices/${device.device_uid}`;

  return (
    <Card className="group relative overflow-hidden flex h-full flex-col border border-slate-200/80 bg-white shadow-sm transition-all duration-150 hover:border-slate-400 hover:bg-slate-50/40 dark:border-border-subtle dark:bg-surface dark:hover:border-slate-700 dark:hover:bg-surface-elevated/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        {/* Logo block */}
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm",
            logoColor,
          )}
        >
          {initials}
        </div>

        {/* Name + Status */}
        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base">{device.name}</CardTitle>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            <span className={cn("h-1.5 w-1.5 rounded-full", status.dotColor)} />
            <span className={status.textColor}>{status.label}</span>
          </div>
        </div>

        <DeviceActionsMenu
          device={device}
          canManage={canManage}
          canOta={canOta}
          onOta={onOta}
          onEdit={onEdit}
          onDelete={onDelete}
          onOpenProject={onOpenProject}
        />
      </CardHeader>
      <CardBody className="flex flex-1 flex-col">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 py-2.5 mb-3 border-y border-slate-100 dark:border-border-subtle text-xs text-slate-600 dark:text-text-secondary">
          <div className="min-w-0">
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("devices:col_project", "Dự án")}</span>
            {projectName ? (
              <ProjectTag name={projectName} onOpen={onOpenProject} />
            ) : (
              <span className="font-medium text-slate-400 dark:text-text-disabled">{t("devices:unassigned_project", "Chưa gán dự án")}</span>
            )}
          </div>
          <div className="min-w-0">
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("devices:col_group", "Nhóm")}</span>
            <div className="mt-0.5">
              <DeviceGroupBadges
                deviceId={device.id}
                emptyFallback={<span className="font-medium text-slate-400 dark:text-text-disabled">{t("devices:no_group", "Chưa có nhóm")}</span>}
              />
            </div>
          </div>
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
              {device.firmware_version || t("common:none", "Chưa có")}
            </span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("devices:col_last_seen", "Lần cuối online")}</span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-text-primary">
              <Clock className="h-3.5 w-3.5" />
              {device.last_seen_at ? formatRelative(device.last_seen_at) : t("common:none", "Chưa có")}
            </span>
          </div>
        </div>

        <Link
          className="btn-primary mt-auto w-full"
          to={detailPath}
        >
          {t("devices:view_details_arrow", "Xem chi tiết →")}
        </Link>
      </CardBody>
    </Card>
  );
}

// ─── List Row Component ──────────────────────────────────────────────────────

interface DeviceListRowProps {
  device: Device;
  logoColor: string;
  initials: string;
  canManage: boolean;
  canOta: boolean;
  projectName: string | null;
  onOta: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenProject: () => void;
}

function DeviceListRow({ device, logoColor, initials, canManage, canOta, projectName, onOta, onEdit, onDelete, onOpenProject }: DeviceListRowProps) {
  const { t } = useTranslation(["devices", "common"]);
  const status = getDeviceStatus(device, t);
  const detailPath = `/client/devices/${device.device_uid}`;

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
        <div className="mt-0.5">
          <span className="truncate text-[11px] font-mono text-slate-400">UID: {device.device_uid}</span>
        </div>
      </div>

      <div className="w-full md:w-40 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:col_project_colon", "Dự án:")}</span>
        {projectName ? (
          <ProjectTag name={projectName} onOpen={onOpenProject} />
        ) : (
          <span className="text-slate-400 dark:text-text-disabled">{t("devices:unassigned_project", "Chưa gán dự án")}</span>
        )}
      </div>

      <div className="w-full md:w-40 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:col_group_colon", "Nhóm:")}</span>
        <DeviceGroupBadges
          deviceId={device.id}
          emptyFallback={<span className="text-slate-400 dark:text-text-disabled">{t("devices:no_group", "Chưa có nhóm")}</span>}
        />
      </div>

      <div className="w-full md:w-32 md:shrink-0 flex items-center gap-1.5 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:col_status_colon", "Trạng thái:")}</span>
        <span className={cn("h-1.5 w-1.5 rounded-full", status.dotColor)} />
        <span className={status.textColor}>{status.label}</span>
      </div>

      <div className="w-full md:w-32 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:col_hardware_colon", "Phần cứng:")}</span>
        <span className="font-medium text-slate-700 dark:text-text-primary">{device.hardware_model || "ESP32"}</span>
      </div>

      {/* Firmware */}
      <div className="w-full md:w-28 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:col_firmware_colon", "Firmware:")}</span>
        <span className="font-medium text-slate-700 dark:text-text-primary">{device.firmware_version || t("common:none", "Chưa có")}</span>
      </div>

      <div className="w-full md:w-32 md:shrink-0 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:col_last_seen_colon", "Lần cuối online:")}</span>
        <span className="font-medium text-slate-600 dark:text-text-muted">{device.last_seen_at ? formatRelative(device.last_seen_at) : t("common:none", "Chưa có")}</span>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center justify-end gap-1 w-full md:w-24 border-t md:border-t-0 pt-2 md:pt-0">
        <Link
          className="btn-primary flex items-center gap-1 px-2.5 py-1.5 text-xs"
          to={detailPath}
        >
          {t("common:actions.details", "Chi tiết")}
          <ArrowRight className="h-3 w-3" />
        </Link>
        <DeviceActionsMenu
          device={device}
          canManage={canManage}
          canOta={canOta}
          onOta={onOta}
          onEdit={onEdit}
          onDelete={onDelete}
          onOpenProject={onOpenProject}
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

export function ClientDevices() {
  const { t } = useTranslation(["devices", "common"]);
  const { hasFeature, featuresReady } = useFeature();
  const { user } = useAuth();
  const canManage = canManageDevices(user);
  const canCreateOta = hasFeature("ota_update") && canManageOta(user);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { projectId: workspaceId } = useParams<{ projectId: string }>();

  useDeviceStatusStream();
  const [search, setSearch] = usePersistedState<string>(`aifom_client_devices_search_${workspaceId}`, "", "session");
  const [filter, setFilter] = usePersistedState<DeviceFilter>(`aifom_client_devices_filter_${workspaceId}`, "all", "session");
  const [viewMode, setViewMode] = usePersistedState<"grid" | "list">(`aifom_client_devices_view_${workspaceId}`, "grid", "local");
  const [deleteTarget, setDeleteTarget] = useState<Device | null>(null);
  const [editTarget, setEditTarget] = useState<Device | null>(null);

  const devicesQ = useQuery({
    queryKey: ["client-devices"],
    queryFn: () => listClientDevices(),
    refetchInterval: 15_000,
  });

  const otaQ = useQuery({
    queryKey: ["client-ota-jobs"],
    queryFn: () => listClientOtaJobs(),
    enabled: hasFeature("ota_update") && canCreateOta,
    refetchInterval: 30_000,
  });

  const projectsQ = useQuery({
    queryKey: ["client-projects"],
    queryFn: () => listClientProjects(),
  });

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of projectsQ.data ?? []) map.set(p.id, p.name);
    return map;
  }, [projectsQ.data]);

  const projectNameForDevice = (device: Device): string | null =>
    device.project_id ? projectNameById.get(device.project_id) ?? null : null;

  const openDeviceProject = (device: Device) => {
    if (device.project_id) navigate(`/client/workspace/${device.project_id}/home`);
  };

  const unassignMut = useMutation({
    mutationFn: (deviceUid: string) => unassignClientDevice(deviceUid),
    onSuccess: () => {
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["client-devices"] });
    },
  });

  const updateDeviceMut = useMutation({
    mutationFn: ({ deviceUid, data }: { deviceUid: string; data: DeviceEditPayload }) =>
      updateClientDevice(deviceUid, data),
    onSuccess: (_device, variables) => {
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ["client-devices"] });
      qc.invalidateQueries({ queryKey: ["client-device-detail", variables.deviceUid] });
    },
  });

  const data = devicesQ.data ?? [];
  const otaJobs = otaQ.data ?? [];

  const latestFw = useMemo(() => latestFirmwareVersion(data), [data]);

  const otaDeviceUids = useMemo(() => {
    const activeStatuses = ["pending", "sent", "started", "accepted", "downloading", "flashing", "applying", "rebooting", "verifying"];
    return new Set(
      otaJobs.filter((j) => activeStatuses.includes(j.status)).map((j) => j.device_uid),
    );
  }, [otaJobs]);

  const stats = useMemo(() => {
    const total = data.length;
    const online = data.filter((d) => d.status === "online").length;
    const offline = data.filter((d) => d.status === "offline").length;
    const needsUpdate = latestFw
      ? data.filter((d) => d.firmware_version && d.firmware_version !== latestFw).length
      : 0;
    const inOta = data.filter((d) => otaDeviceUids.has(d.device_uid)).length;
    return { total, online, offline, needsUpdate, inOta };
  }, [data, latestFw, otaDeviceUids]);

  const filtered = useMemo(() => {
    let result = data;

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.device_uid.toLowerCase().includes(q) ||
          (d.hardware_model && d.hardware_model.toLowerCase().includes(q)),
      );
    }

    switch (filter) {
      case "online":
        result = result.filter((d) => d.status === "online");
        break;
      case "offline":
        result = result.filter((d) => d.status === "offline");
        break;
      case "needs_update":
        result = result.filter(
          (d) => latestFw && d.firmware_version && d.firmware_version !== latestFw,
        );
        break;
      case "in_ota":
        result = result.filter((d) => otaDeviceUids.has(d.device_uid));
        break;
    }

    return result;
  }, [data, search, filter, latestFw, otaDeviceUids]);

  const PAGE_SIZE = 12;
  const { page, setPage, totalPages, pagedItems: pagedDevices } = usePagination(filtered, PAGE_SIZE, [search, filter]);

  if (!featuresReady) {
    return <TenantLoadingState label={t("common:loading", "Đang tải...")} />;
  }

  if (!hasFeature("device_management")) {
    return <FeatureGate featureName="device_management" />;
  }

  return (
    <>
      <div className="flex flex-col flex-1 min-h-full space-y-4">
        {/* ── Page Header ────────────────────────────────────────────────────────── */}
        <PageHeader
          title={t("devices:title", "Thiết bị")}
          description=""
        />
        <ClientSectionNav
          items={DEVICES_SECTION_NAV}
          actions={
            canManage ? (
              <div className="flex items-center gap-2">
                <button
                  className="btn-primary flex items-center gap-1.5 text-xs h-8 px-3"
                  onClick={() => navigate("/client/devices/onboard")}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t("devices:add_device", "Thêm thiết bị")}
                </button>
              </div>
            ) : undefined
          }
        />

        {!canManage && <ReadOnlyNotice />}

        {/* ── Toolbar (Search, Filter, ViewMode Toggle) ─────────────────────────── */}
        <DeviceSearchAndFilters
          search={search}
          onSearchChange={setSearch}
          filter={filter}
          onFilterChange={setFilter}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          stats={stats}
        />

        {/* ── Content Area ──────────────────────────────────────────────────────── */}
        {devicesQ.isError ? (
          <div className="card py-12 text-center">
            <p className="text-sm text-slate-500">
              {t("devices:failed_to_load_list", "Không tải được danh sách thiết bị. Vui lòng thử lại.")}
            </p>
            <button
              className="btn-ghost mt-2 text-sm"
              onClick={() => devicesQ.refetch()}
            >
              {t("common:actions.retry", "Thử lại")}
            </button>
          </div>
        ) : devicesQ.isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : data.length === 0 ? (
          <div className="card py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.05]">
              <Cpu className="h-6 w-6 text-slate-400" />
            </div>
            <h3 className="mt-4 text-sm font-semibold text-slate-800 dark:text-text-primary">
              {t("devices:no_devices_yet", "Bạn chưa có thiết bị nào")}
            </h3>
            <p className="mt-2 text-xs text-slate-500 dark:text-text-muted max-w-sm mx-auto">
              {t("devices:no_devices_desc", "Thêm thiết bị đầu tiên để bắt đầu gửi telemetry, điều khiển GPIO và cập nhật firmware OTA.")}
            </p>
            {canManage && (
              <div className="mt-6">
                <button
                  onClick={() => navigate("/client/devices/onboard")}
                  className="btn-primary flex items-center gap-2 mx-auto"
                >
                  <Plus className="h-3.5 w-3.5" /> {t("devices:add_device", "Thêm thiết bị")}
                </button>
              </div>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card py-12 text-center">
            <p className="text-sm text-slate-500">
              {t("devices:no_matching_devices", "Không có thiết bị nào khớp với tìm kiếm hoặc bộ lọc.")}
            </p>
            <button
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
              <div className="flex flex-col md:min-w-[1400px]">
                <div className="hidden md:flex items-center gap-4 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-text-secondary bg-slate-100/75 dark:bg-surface-elevated/70 border-b border-slate-200 dark:border-border-subtle shrink-0">
                  <div className="w-10 text-center">{t("devices:table_logo", "Logo")}</div>
                  <div className="flex-1">{t("devices:table_name_uid", "Tên thiết bị / UID")}</div>
                  <div className="w-40">{t("devices:table_project", "Dự án")}</div>
                  <div className="w-40">{t("devices:table_group", "Nhóm")}</div>
                  <div className="w-32">{t("devices:table_status", "Trạng thái")}</div>
                  <div className="w-32">{t("devices:table_hardware", "Phần cứng")}</div>
                  <div className="w-28">{t("devices:table_firmware", "Firmware")}</div>
                  <div className="w-32">{t("devices:table_last_seen", "Lần cuối online")}</div>
                  <div className="w-24 text-right">{t("devices:table_actions", "Thao tác")}</div>
                </div>

                {pagedDevices.map((device) => (
                  <DeviceListRow
                    key={device.id}
                    device={device}
                    logoColor={getLogoColor(device.id)}
                    initials={getInitials(device.name)}
                    canManage={canManage}
                    canOta={canCreateOta}
                    projectName={projectNameForDevice(device)}
                    onOta={() => navigate("/client/ota", { state: { deviceUid: device.device_uid } })}
                    onEdit={() => setEditTarget(device)}
                    onDelete={() => setDeleteTarget(device)}
                    onOpenProject={() => openDeviceProject(device)}
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
                logoColor={getLogoColor(device.id)}
                initials={getInitials(device.name)}
                canManage={canManage}
                canOta={canCreateOta}
                projectName={projectNameForDevice(device)}
                onOta={() => navigate("/client/ota", { state: { deviceUid: device.device_uid } })}
                onEdit={() => setEditTarget(device)}
                onDelete={() => setDeleteTarget(device)}
                onOpenProject={() => openDeviceProject(device)}
              />
            ))}
          </div>
        )}
        {filtered.length > 0 && <PaginationBar page={page} totalPages={totalPages} totalItems={filtered.length} pageSize={PAGE_SIZE} onPrev={() => setPage(page - 1)} onNext={() => setPage(page + 1)} className="mt-auto shrink-0" />}
      </div>

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

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("devices:delete_modal_title", "Xóa thiết bị")}
        description={
          deleteTarget && (
            <div className="space-y-2">
              <p>
                {t("devices:delete_modal_confirm_text", "Bạn có chắc muốn xóa thiết bị")}{" "}
                <span className="font-semibold text-slate-800 dark:text-text-secondary">
                  {deleteTarget.name}
                </span>{" "}
                (<span className="font-mono text-xs">{deleteTarget.device_uid}</span>)?
              </p>
              <p className="text-amber-600 dark:text-amber-400">
                {t("devices:delete_modal_warning", "Thiết bị sẽ không còn hiển thị trong danh sách. Dữ liệu telemetry không bị xóa.")}
              </p>
              {unassignMut.isError && (
                <p className="text-rose-600">{String(unassignMut.error)}</p>
              )}
            </div>
          )
        }
        confirmLabel={unassignMut.isPending ? t("common:processing", "Đang xử lý…") : t("devices:confirm_delete", "Xác nhận xóa")}
        destructive
        loading={unassignMut.isPending}
        onConfirm={() => deleteTarget && canManage && unassignMut.mutate(deleteTarget.device_uid)}
        onCancel={() => {
          if (!unassignMut.isPending) setDeleteTarget(null);
        }}
      />
    </>
  );
}
