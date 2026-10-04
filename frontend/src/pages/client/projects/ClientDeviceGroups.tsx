import { useEffect, useMemo, useState, useRef, type CSSProperties } from "react";
import { usePersistedState } from "../../../hooks/usePersistedState";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Edit,
  Eye,
  Layers3,
  Link2,
  Plus,
  Search,
  Trash2,
  Unlink,
  Users,
  Radio,
  Rocket,
  Activity,
  MoreVertical,
  LayoutGrid,
  List,
  X,
  Clock,
  Cpu,
  ArrowRight,
} from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "../../../components/ui/Card";
import {
  deviceGroupApi,
  type DeviceGroup,
  type DeviceGroupCreateData,
  type DeviceGroupMember,
  type DeviceGroupUpdateData,
} from "../../../services/deviceGroupApi";
import { listClientDevices } from "../../../services/clientApi";
import { ApiError } from "../../../services/apiClient";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { DataTable, type Column } from "../../../components/ui/DataTable";
import { MetricCard } from "../../../components/ui/MetricCard";
import { Modal } from "../../../components/ui/Modal";
import { PageHeader } from "../../../components/ui/PageHeader";
import { ClientSectionNav, DEVICES_SECTION_NAV } from "../../../components/layout/ClientSectionNav";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { TenantBanner } from "../../../components/ui/TenantUi";
import { ReadOnlyNotice } from "../../../components/permissions/PermissionGate";
import { useAuth } from "../../../contexts/AuthContext";
import { canManageDeviceGroups, canManageOta, canSendCommands } from "../../../lib/permissions";
import { formatRelative } from "../../../lib/formatters";
import { cn } from "../../../lib/cn";
import { statusLabel, statusToTone } from "../../../lib/statusHelper";
import type { Device } from "../../../types";

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

type Banner = { type: "success" | "error"; message: string } | null;
type DeviceGroupFormPayload = {
  name: string;
  description?: string;
  status?: string;
  tags?: string[];
};

function errorMessage(error: unknown, t?: (key: string, fallback: string) => string): string {
  if (error instanceof ApiError) {
    if (error.status === 405) return t ? t("devices:groups.err_405", "Máy chủ chưa đăng ký phương thức DELETE cho API xóa nhóm thiết bị.") : "Máy chủ chưa đăng ký phương thức DELETE cho API xóa nhóm thiết bị.";
    if (error.status === 403) return t ? t("devices:groups.err_403", "Bạn không có quyền xóa nhóm thiết bị này.") : "Bạn không có quyền xóa nhóm thiết bị này.";
    if (error.status === 404) return t ? t("devices:groups.err_404", "Nhóm thiết bị không tồn tại hoặc không thuộc tenant của bạn.") : "Nhóm thiết bị không tồn tại hoặc không thuộc tenant của bạn.";
    if (error.status === 409) return t ? t("devices:groups.err_409", "Không thể xóa nhóm thiết bị do dữ liệu đang bị ràng buộc.") : "Không thể xóa nhóm thiết bị do dữ liệu đang bị ràng buộc.";
    if (error.status === 422) return t ? t("devices:groups.err_422", "Mã nhóm thiết bị không hợp lệ.") : "Mã nhóm thiết bị không hợp lệ.";
    const detail = (error.body as { detail?: unknown } | null)?.detail;
    if (Array.isArray(detail)) {
      return detail
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "msg" in item && typeof item.msg === "string") {
            return item.msg;
          }
          return null;
        })
        .filter((item): item is string => item !== null)
        .join("; ");
    }
    if (typeof detail === "string" && detail.trim().length > 0) {
      return detail;
    }
    return error.message;
  }
  return error instanceof Error ? error.message : (t ? t("common:unknown_error", "Không thể xử lý yêu cầu.") : "Không thể xử lý yêu cầu.");
}

function formatDate(value: string): string {
  return value ? formatRelative(value) : "-";
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function deviceSearchText(device: Device): string {
  return normalizeSearch(
    [device.name, device.device_uid, device.mac_address, device.status, device.hardware_model]
      .filter(Boolean)
      .join(" "),
  );
}

const STABLE_EMPTY_ARRAY: any[] = [];

function memberSearchText(member: DeviceGroupMember): string {
  return normalizeSearch([member.device_name, member.device_uid, member.device_status].filter(Boolean).join(" "));
}

interface DeviceGroupActionsMenuProps {
  group: DeviceGroup;
  canManage: boolean;
  canSendCommand: boolean;
  canCreateOta: boolean;
  onViewDetails: () => void;
  onSendCommand: () => void;
  onCreateOta: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deletePending: boolean;
  openRowId: string | null;
  setOpenRowId: (id: string | null) => void;
}

function DeviceGroupActionsMenu({
  group,
  canManage,
  canSendCommand,
  canCreateOta,
  onViewDetails,
  onSendCommand,
  onCreateOta,
  onEdit,
  onDelete,
  deletePending,
  openRowId,
  setOpenRowId,
}: DeviceGroupActionsMenuProps) {
  const { t } = useTranslation(["devices", "common"]);
  const isOpen = openRowId === group.id;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    function updateMenuPosition() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuWidth = 180;
      setMenuStyle({
        position: "fixed",
        top: rect.bottom + 6,
        left: Math.max(8, rect.right - menuWidth),
        width: menuWidth,
      });
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpenRowId(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenRowId(null);
      }
    }

    updateMenuPosition();
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, group.id, setOpenRowId]);

  function runAction(action: () => void) {
    action();
    setOpenRowId(null);
  }

  return (
    <div className="relative inline-block text-left">
      <button
        ref={buttonRef}
        type="button"
        className="btn-ghost h-8 w-8 p-0"
        title={t("devices:groups.open_actions", "Open device group actions")}
        aria-label={t("devices:groups.open_actions", "Open device group actions")}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpenRowId(isOpen ? null : group.id);
        }}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {isOpen && menuStyle && createPortal(
        <div
          ref={menuRef}
          style={menuStyle}
          role="menu"
          className="z-50 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg dark:border-border-subtle dark:bg-surface"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-text-secondary dark:hover:bg-surface-elevated"
            onClick={() => runAction(onViewDetails)}
          >
            <Eye className="h-3.5 w-3.5" />
            {t("devices:groups.view_details", "Xem chi tiết")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-text-secondary dark:hover:bg-surface-elevated"
            disabled={!canSendCommand || (group.device_count ?? 0) === 0}
            title={(group.device_count ?? 0) > 0 ? t("devices:groups.send_cmd_hint", "Gửi lệnh tới nhóm") : t("devices:groups.send_cmd_empty_hint", "Không thể gửi lệnh tới nhóm trống")}
            onClick={() => runAction(onSendCommand)}
          >
            <Radio className="h-3.5 w-3.5" />
            {t("devices:groups.send_command", "Gửi lệnh")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-text-secondary dark:hover:bg-surface-elevated"
            disabled={!canCreateOta || (group.device_count ?? 0) === 0}
            title={(group.device_count ?? 0) > 0 ? t("devices:groups.create_ota_hint", "Tạo OTA cho nhóm") : t("devices:groups.create_ota_empty_hint", "Không thể tạo OTA cho nhóm trống")}
            onClick={() => runAction(onCreateOta)}
          >
            <Rocket className="h-3.5 w-3.5" />
            {t("devices:groups.create_ota", "Tạo OTA")}
          </button>
          {canManage && (
            <>
              <div className="my-1 border-t border-slate-100 dark:border-border-subtle" />
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-text-secondary dark:hover:bg-surface-elevated"
                onClick={() => runAction(onEdit)}
              >
                <Edit className="h-3.5 w-3.5" />
                {t("common:actions.edit", "Chỉnh sửa")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                disabled={deletePending}
                onClick={() => runAction(onDelete)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("devices:groups.delete_group", "Xóa nhóm")}
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

interface GroupCardProps {
  group: DeviceGroup;
  logoColor: string;
  initials: string;
  canManage: boolean;
  canSendCommand: boolean;
  canCreateOta: boolean;
  onViewDetails: () => void;
  onSendCommand: () => void;
  onCreateOta: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deletePending: boolean;
  openRowId: string | null;
  setOpenRowId: (id: string | null) => void;
}

function DeviceGroupCard({
  group,
  logoColor,
  initials,
  canManage,
  canSendCommand,
  canCreateOta,
  onViewDetails,
  onSendCommand,
  onCreateOta,
  onEdit,
  onDelete,
  deletePending,
  openRowId,
  setOpenRowId,
}: GroupCardProps) {
  const { t } = useTranslation(["devices", "common"]);
  const isArchived = group.status === "archived";
  const statusColor = isArchived
    ? "text-slate-500 dark:text-text-muted font-medium"
    : "text-emerald-600 dark:text-emerald-400 font-medium";
  const statusDot = isArchived ? "bg-slate-400 dark:bg-text-muted" : "bg-emerald-500";
  const statusLabel = isArchived ? t("devices:groups.status_archived", "Lưu trữ") : t("devices:groups.status_active", "Hoạt động");

  return (
    <Card className="group hover:border-brand-300 transition-colors">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm",
            logoColor,
          )}
        >
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base">{group.name}</CardTitle>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            <span className={cn("h-1.5 w-1.5 rounded-full", statusDot)} />
            <span className={statusColor}>{statusLabel}</span>
          </div>
        </div>

        <DeviceGroupActionsMenu
          group={group}
          canManage={canManage}
          canSendCommand={canSendCommand}
          canCreateOta={canCreateOta}
          onViewDetails={onViewDetails}
          onSendCommand={onSendCommand}
          onCreateOta={onCreateOta}
          onEdit={onEdit}
          onDelete={onDelete}
          deletePending={deletePending}
          openRowId={openRowId}
          setOpenRowId={setOpenRowId}
        />
      </CardHeader>
      <CardBody>
        <p className="min-h-[2.5rem] text-sm text-slate-600 dark:text-text-muted line-clamp-2">
          {group.description || t("devices:groups.no_description", "Không có mô tả")}
        </p>

        {/* Labeled detail properties */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 py-2.5 my-3 border-y border-slate-100 dark:border-border-subtle text-xs text-slate-600 dark:text-text-secondary">
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("common:status.label", "Trạng thái")}</span>
            <span className={cn("inline-flex items-center gap-1.5 font-medium", statusColor)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", statusDot)} />
              {statusLabel}
            </span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("devices:groups.col_device_count", "Số thiết bị")}</span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-text-primary">
              <Cpu className="h-3.5 w-3.5" />
              {group.device_count || 0} {t("devices:groups.device_unit", "thiết bị")}
            </span>
          </div>
          <div className="col-span-2">
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("devices:groups.last_updated", "Cập nhật lần cuối")}</span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-text-primary">
              <Clock className="h-3.5 w-3.5" />
              {formatDate(group.updated_at)}
            </span>
          </div>
        </div>

        <button
          className="btn-primary mt-4 w-full"
          onClick={onViewDetails}
        >
          {t("devices:groups.view_details_arrow", "Xem chi tiết →")}
        </button>
      </CardBody>
    </Card>
  );
}

function DeviceGroupListRow({
  group,
  logoColor,
  initials,
  canManage,
  canSendCommand,
  canCreateOta,
  onViewDetails,
  onSendCommand,
  onCreateOta,
  onEdit,
  onDelete,
  deletePending,
  openRowId,
  setOpenRowId,
}: GroupCardProps) {
  const { t } = useTranslation(["devices", "common"]);
  const isArchived = group.status === "archived";
  const statusColor = isArchived
    ? "text-slate-500 dark:text-text-muted font-medium"
    : "text-emerald-600 dark:text-emerald-400 font-medium";
  const statusDot = isArchived ? "bg-slate-400 dark:bg-text-muted" : "bg-emerald-500";
  const statusLabel = isArchived ? t("devices:groups.status_archived", "Lưu trữ") : t("devices:groups.status_active", "Hoạt động");

  return (
    <div className="card group flex flex-col md:flex-row md:items-center gap-3 md:gap-4 px-4 py-3 transition-colors hover:border-brand-300">
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm mx-auto md:mx-0",
          logoColor,
        )}
      >
        {initials}
      </div>

      {/* Name and description */}
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary">{group.name}</span>
        <span className="block truncate text-[11px] text-slate-400">{group.description || t("devices:groups.no_description", "Không có mô tả")}</span>
      </div>

      {/* Status */}
      <div className="w-full md:w-32 flex items-center gap-1.5 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("common:status.label_colon", "Trạng thái:")}</span>
        <span className={cn("h-1.5 w-1.5 rounded-full", statusDot)} />
        <span className={statusColor}>{statusLabel}</span>
      </div>

      {/* Device count */}
      <div className="w-full md:w-28 flex items-center gap-1 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:title_colon", "Thiết bị:")}</span>
        <Cpu className="hidden md:inline h-3.5 w-3.5 text-slate-400" />
        <span className="font-medium text-slate-700 dark:text-text-primary">{group.device_count || 0} {t("devices:groups.device_unit", "thiết bị")}</span>
      </div>

      {/* Updated */}
      <div className="w-full md:w-36 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("common:col.updated_colon", "Cập nhật:")}</span>
        <span className="font-medium text-slate-600 dark:text-text-muted">{formatDate(group.updated_at)}</span>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center justify-end gap-1 w-full md:w-24 border-t md:border-t-0 pt-2 md:pt-0">
        <button
          className="btn-primary flex items-center gap-1 px-2.5 py-1.5 text-xs"
          onClick={onViewDetails}
        >
          {t("common:view_details_short", "Chi tiết")}
          <ArrowRight className="h-3 w-3" />
        </button>
        <DeviceGroupActionsMenu
          group={group}
          canManage={canManage}
          canSendCommand={canSendCommand}
          canCreateOta={canCreateOta}
          onViewDetails={onViewDetails}
          onSendCommand={onSendCommand}
          onCreateOta={onCreateOta}
          onEdit={onEdit}
          onDelete={onDelete}
          deletePending={deletePending}
          openRowId={openRowId}
          setOpenRowId={setOpenRowId}
        />
      </div>
    </div>
  );
}

export default function ClientDeviceGroups() {
  const { t } = useTranslation(["devices", "common"]);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = canManageDeviceGroups(user);
  const canSendCommand = canSendCommands(user);
  const canCreateOta = canManageOta(user);
  const [banner, setBanner] = useState<Banner>(null);
  const [search, setSearch] = usePersistedState("aifom_clientdevicegroups_search", "", "session");
  const [statusFilter, setStatusFilter] = usePersistedState("aifom_clientdevicegroups_statusfilter", "", "session");
  const [showForm, setShowForm] = useState(false);
  const [editingGroup, setEditingGroup] = useState<DeviceGroup | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<DeviceGroup | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeviceGroup | null>(null);
  const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);
  const [viewMode, setViewMode] = usePersistedState<"grid" | "list">("aifom_clientdevicegroups_view", "grid", "local");

  const groupsQuery = useQuery({
    queryKey: ["device-groups"],
    queryFn: () => deviceGroupApi.listDeviceGroups(),
  });

  const allGroups = groupsQuery.data?.items ?? [];
  const groups = useMemo(() => {
    let result = allGroups;
    if (statusFilter) {
      result = result.filter(g => g.status === statusFilter);
    }
    if (search) {
      const q = normalizeSearch(search.trim());
      if (q) {
        result = result.filter(g => normalizeSearch(g.name).includes(q) || (g.description && normalizeSearch(g.description).includes(q)));
      }
    }
    return result;
  }, [allGroups, statusFilter, search]);

  function invalidateGroups() {
    return queryClient.invalidateQueries({ queryKey: ["device-groups"] });
  }

  function sendCommand(group: DeviceGroup) {
    if ((group.device_count ?? 0) === 0 || !canSendCommand) return;
    navigate("/client/commands", {
      state: { tab: "send", targetType: "group", groupId: group.id },
    });
  }

  function createOta(group: DeviceGroup) {
    if ((group.device_count ?? 0) === 0 || !canCreateOta) return;
    navigate("/client/ota", {
      state: { tab: "jobs", create: true, groupId: group.id },
    });
  }

  function viewMonitoring(group: DeviceGroup) {
    navigate(`/client/telemetry?group_id=${encodeURIComponent(group.id)}`);
  }

  const createMutation = useMutation({
    mutationFn: (data: DeviceGroupCreateData) => deviceGroupApi.createDeviceGroup(data),
    onSuccess: async () => {
      setBanner({ type: "success", message: t("devices:groups.create_success", "Đã tạo nhóm thiết bị.") });
      setShowForm(false);
      await invalidateGroups();
    },
    onError: (error) => setBanner({ type: "error", message: errorMessage(error) }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: DeviceGroupUpdateData }) =>
      deviceGroupApi.updateDeviceGroup(id, data),
    onSuccess: async (updated) => {
      setBanner({ type: "success", message: t("devices:groups.update_success", "Đã cập nhật nhóm thiết bị.") });
      setEditingGroup(null);
      setSelectedGroup((current) => (current?.id === updated.id ? updated : current));
      await invalidateGroups();
    },
    onError: (error) => setBanner({ type: "error", message: errorMessage(error) }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deviceGroupApi.deleteDeviceGroup(id),
    onSuccess: async () => {
      const deletedId = deleteTarget?.id;
      setBanner({ type: "success", message: t("devices:groups.delete_success", "Đã xóa nhóm thiết bị.") });
      setDeleteTarget(null);
      setSelectedGroup((current) => (current?.id === deletedId ? null : current));
      queryClient.removeQueries({ queryKey: ["group-devices", deletedId] });
      await invalidateGroups();
    },
    onError: (error) => setBanner({ type: "error", message: errorMessage(error) }),
  });

  const columns: Column<DeviceGroup>[] = [
    {
      key: "name",
      header: t("devices:groups.col_group_name", "Tên nhóm"),
      sortable: true,
      sortValue: (group) => group.name,
      render: (group) => (
        <button
          type="button"
          onClick={() => setSelectedGroup(group)}
          className="font-medium text-slate-900 hover:text-brand-700 dark:text-text-primary dark:hover:text-brand-300"
        >
          {group.name}
        </button>
      ),
    },
    {
      key: "description",
      header: t("devices:groups.col_description", "Mô tả"),
      render: (group) => (
        <span className="line-clamp-2 text-slate-500 dark:text-text-muted">
          {group.description || t("devices:groups.no_description", "Không có mô tả")}
        </span>
      ),
    },
    {
      key: "device_count",
      header: t("devices:groups.col_devices", "Thiết bị"),
      sortable: true,
      align: "right",
      sortValue: (group) => group.device_count,
      render: (group) => <span className="font-medium tabular-nums">{group.device_count}</span>,
    },
    {
      key: "status",
      header: t("common:status.label", "Trạng thái"),
      render: (group) => <StatusBadge tone={statusToTone(group.status)} label={statusLabel(group.status)} />,
    },
    {
      key: "updated_at",
      header: t("common:col.updated", "Cập nhật"),
      sortable: true,
      sortValue: (group) => group.updated_at,
      render: (group) => <span className="text-xs text-slate-500">{formatDate(group.updated_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (group) => (
        <DeviceGroupActionsMenu
          group={group}
          canManage={canManage}
          canSendCommand={canSendCommand}
          canCreateOta={canCreateOta}
          onViewDetails={() => setSelectedGroup(group)}
          onSendCommand={() => sendCommand(group)}
          onCreateOta={() => createOta(group)}
          onEdit={() => setEditingGroup(group)}
          onDelete={() => setDeleteTarget(group)}
          deletePending={deleteMutation.isPending}
          openRowId={openMenuRowId}
          setOpenRowId={setOpenMenuRowId}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("devices:groups.title", "Nhóm thiết bị")}
        subtitle=""
      />

      <ClientSectionNav 
        items={DEVICES_SECTION_NAV} 
        actions={
          canManage ? (
            <button
              className="btn-primary flex items-center gap-1.5 text-xs h-8 px-3"
              onClick={() => setShowForm(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("devices:groups.create_group", "Tạo nhóm")}
            </button>
          ) : undefined
        }
      />

      {!canManage && <div className="mb-6"><ReadOnlyNotice /></div>}

      {banner && (
        <div className="mb-6">
          <TenantBanner tone={banner.type === "success" ? "success" : "error"}>
            {banner.message}
          </TenantBanner>
        </div>
      )}

      {/* ── Toolbar (Search, Filter, ViewMode Toggle) ─────────────────────────── */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9 pr-8"
            placeholder={t("devices:groups.search_placeholder", "Tìm theo tên nhóm...")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
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
            {[
              { key: "", label: t("common:actions.all", "Tất cả") },
              { key: "active", label: t("devices:status.active", "Hoạt động") },
              { key: "archived", label: t("devices:status.archived", "Lưu trữ") },
            ].map((f) => (
              <button
                key={f.key}
                className={cn(
                  "chip whitespace-nowrap transition-colors",
                  statusFilter === f.key
                    ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-surface-elevated dark:text-text-muted dark:hover:bg-surface-muted",
                )}
                onClick={() => setStatusFilter(f.key)}
              >
                {f.label} ({f.key === "" ? allGroups.length : allGroups.filter((g) => g.status === f.key).length})
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-border p-0.5 bg-surface-elevated">
            <button
              aria-label={t("devices:groups.list_view", "Dạng danh sách")}
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
              aria-label={t("devices:groups.grid_view", "Dạng lưới")}
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

      {/* ── Content Area ──────────────────────────────────────────────────────── */}
      {groupsQuery.isError ? (
        <div className="card py-12 text-center">
          <p className="text-sm text-slate-500">
            {t("devices:groups.error_load", "Không tải được danh sách nhóm thiết bị. Vui lòng thử lại.")}
          </p>
          <button
            className="btn-ghost mt-2 text-sm"
            onClick={() => groupsQuery.refetch()}
          >
            {t("common:actions.retry", "Thử lại")}
          </button>
        </div>
      ) : groupsQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : allGroups.length === 0 ? (
        <div className="card py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.05]">
            <Users className="h-6 w-6 text-slate-400" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-slate-800 dark:text-text-primary">
            {t("devices:groups.no_groups_title", "Chưa có nhóm thiết bị nào")}
          </h3>
          <p className="mt-2 text-xs text-slate-500 dark:text-text-muted max-w-sm mx-auto">
            {t("devices:groups.no_groups_desc", "Tạo nhóm đầu tiên để tổ chức thiết bị theo khu vực, mục đích hoặc dự án.")}
          </p>
          {canManage && (
            <div className="mt-6">
              <button
                onClick={() => setShowForm(true)}
                className="btn-primary flex items-center gap-2 mx-auto"
              >
                <Plus className="h-3.5 w-3.5" /> {t("devices:groups.create_group", "Tạo nhóm")}
              </button>
            </div>
          )}
        </div>
      ) : groups.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-sm text-slate-500">
            {t("devices:groups.no_filtered_groups", "Không có nhóm thiết bị nào khớp với tìm kiếm hoặc bộ lọc.")}
          </p>
          <button
            className="btn-ghost mt-2 text-sm"
            onClick={() => {
              setSearch("");
              setStatusFilter("");
            }}
          >
            {t("common:actions.clear_filter", "Xóa bộ lọc")}
          </button>
        </div>
      ) : viewMode === "list" ? (
        <div className="flex flex-col gap-2">
          {/* Table column headings */}
          <div className="hidden md:flex items-center gap-4 px-4 py-2 text-xs font-bold text-slate-400 dark:text-text-muted border-b border-slate-100 dark:border-border-subtle mb-1">
            <div className="w-10 text-center">{t("common:col.logo", "Logo")}</div>
            <div className="flex-1">{t("devices:groups.col_name", "Tên nhóm / Mô tả")}</div>
            <div className="w-32">{t("common:status.label", "Trạng thái")}</div>
            <div className="w-28">{t("devices:groups.col_device_count", "Số thiết bị")}</div>
            <div className="w-36">{t("common:col.updated", "Cập nhật")}</div>
            <div className="w-24 text-right">{t("common:col.actions", "Thao tác")}</div>
          </div>

          {groups.map((group) => (
            <DeviceGroupListRow
              key={group.id}
              group={group}
              logoColor={getLogoColor(group.id)}
              initials={getInitials(group.name)}
              canManage={canManage}
              canSendCommand={canSendCommand}
              canCreateOta={canCreateOta}
              onViewDetails={() => setSelectedGroup(group)}
              onSendCommand={() => sendCommand(group)}
              onCreateOta={() => createOta(group)}
              onEdit={() => setEditingGroup(group)}
              onDelete={() => setDeleteTarget(group)}
              deletePending={deleteMutation.isPending}
              openRowId={openMenuRowId}
              setOpenRowId={setOpenMenuRowId}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <DeviceGroupCard
              key={group.id}
              group={group}
              logoColor={getLogoColor(group.id)}
              initials={getInitials(group.name)}
              canManage={canManage}
              canSendCommand={canSendCommand}
              canCreateOta={canCreateOta}
              onViewDetails={() => setSelectedGroup(group)}
              onSendCommand={() => sendCommand(group)}
              onCreateOta={() => createOta(group)}
              onEdit={() => setEditingGroup(group)}
              onDelete={() => setDeleteTarget(group)}
              deletePending={deleteMutation.isPending}
              openRowId={openMenuRowId}
              setOpenRowId={setOpenMenuRowId}
            />
          ))}
        </div>
      )}

      <DeviceGroupFormModal
        open={showForm || !!editingGroup}
        group={editingGroup}
        loading={createMutation.isPending || updateMutation.isPending}
        onClose={() => {
          setShowForm(false);
          setEditingGroup(null);
        }}
        onSubmit={(payload) => {
          setBanner(null);
          if (editingGroup) {
            updateMutation.mutate({ id: editingGroup.id, data: payload });
          } else {
            createMutation.mutate({ ...payload, group_type: "manual" });
          }
        }}
      />

      {selectedGroup && (
        <GroupDetailModal
          group={selectedGroup}
          onClose={() => setSelectedGroup(null)}
          onEdit={() => setEditingGroup(selectedGroup)}
          onDelete={() => setDeleteTarget(selectedGroup)}
          canManage={canManage}
          canSendCommand={canSendCommand}
          canCreateOta={canCreateOta}
          onSendCommand={sendCommand}
          onCreateOta={createOta}
          onViewMonitoring={viewMonitoring}
          onError={(message) => setBanner({ type: "error", message })}
          onSuccess={(message) => setBanner({ type: "success", message })}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t("devices:groups.delete_title", "Xóa nhóm thiết bị?")}
        description={
          deleteTarget
            ? t("devices:groups.delete_desc", "Bạn có chắc muốn xóa nhóm này không? Thiết bị trong nhóm sẽ không bị xóa, chỉ bị gỡ khỏi nhóm.")
            : undefined
        }
        confirmLabel={t("devices:groups.delete_confirm", "Xóa nhóm")}
        cancelLabel={t("common:actions.cancel", "Huỷ")}
        destructive
        loading={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget && canManage) {
            setBanner(null);
            deleteMutation.mutate(deleteTarget.id);
          }
        }}
      />
    </div>
  );
}

function DeviceGroupFormModal({
  open,
  group,
  loading,
  onClose,
  onSubmit,
}: {
  open: boolean;
  group: DeviceGroup | null;
  loading: boolean;
  onClose: () => void;
  onSubmit: (payload: DeviceGroupFormPayload) => void;
}) {
  const { t } = useTranslation(["devices", "common"]);
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [status, setStatus] = useState(group?.status ?? "active");
  const [tags, setTags] = useState((group?.tags ?? []).join(", "));

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? "");
    setDescription(group?.description ?? "");
    setStatus(group?.status ?? "active");
    setTags((group?.tags ?? []).join(", "));
  }, [group, open]);

  const trimmedName = name.trim();
  const validation = trimmedName.length === 0 ? t("devices:groups.name_required", "Tên nhóm là bắt buộc.") : null;

  return (
    <Modal open={open} onClose={onClose} title={group ? t("devices:groups.edit_title", "Sửa nhóm thiết bị") : t("devices:groups.create_title", "Tạo nhóm thiết bị")} size="md">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (validation) return;
          onSubmit({
            name: trimmedName,
            description: description.trim() || undefined,
            ...(group ? { status } : {}),
            tags: tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          });
        }}
      >
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-text-secondary mb-1">{t("devices:groups.field_name", "Tên nhóm")}</label>
          <input
            className="input w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={255}
            disabled={loading}
            autoFocus
          />
          {validation && <p className="mt-1 text-xs text-rose-600">{validation}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-text-secondary mb-1">{t("devices:groups.field_description", "Mô tả")}</label>
          <textarea
            className="input min-h-24 w-full resize-y"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={loading}
          />
        </div>
        {group && (
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-text-secondary mb-1">{t("common:status.label", "Trạng thái")}</label>
            <select className="input w-full" value={status} onChange={(event) => setStatus(event.target.value)} disabled={loading}>
              <option value="active">{t("devices:status.active", "Đang hoạt động")}</option>
              <option value="archived">{t("devices:status.archived_long", "Đã lưu trữ")}</option>
            </select>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-text-secondary mb-1">{t("devices:groups.field_tags", "Tags")}</label>
          <input
            className="input w-full"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            disabled={loading}
            placeholder="iot, lab, production"
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-text-muted">{t("devices:groups.tags_hint", "Phân tách bằng dấu phẩy.")}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4 dark:border-border-subtle">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
            {t("common:actions.cancel", "Hủy")}
          </button>
          <button type="submit" className="btn-primary" disabled={loading || !!validation}>
            {loading ? t("common:actions.saving", "Đang lưu...") : group ? t("common:actions.save", "Lưu") : t("devices:groups.create_group", "Tạo nhóm")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function GroupDetailModal({
  group,
  onClose,
  onEdit,
  onDelete,
  canManage,
  canSendCommand,
  canCreateOta,
  onSendCommand,
  onCreateOta,
  onViewMonitoring,
  onError,
  onSuccess,
}: {
  group: DeviceGroup;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canManage: boolean;
  canSendCommand: boolean;
  canCreateOta: boolean;
  onSendCommand: (group: DeviceGroup) => void;
  onCreateOta: (group: DeviceGroup) => void;
  onViewMonitoring: (group: DeviceGroup) => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const { t } = useTranslation(["devices", "common"]);
  const queryClient = useQueryClient();
  const [removeTarget, setRemoveTarget] = useState<DeviceGroupMember | null>(null);
  const [bulkRemoveOpen, setBulkRemoveOpen] = useState(false);
  const [deviceSearch, setDeviceSearch] = useState("");
  const [deviceStatusFilter, setDeviceStatusFilter] = usePersistedState("aifom_clientdevicegroups_devicestatusfilter", "", "session");
  const [memberSearch, setMemberSearch] = useState("");
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  const membersQuery = useQuery({
    queryKey: ["group-devices", group.id],
    queryFn: () => deviceGroupApi.listGroupDevices(group.id),
  });

  const devicesQuery = useQuery({
    queryKey: ["client-devices"],
    queryFn: () => listClientDevices(),
  });

  const members = membersQuery.data?.items ?? STABLE_EMPTY_ARRAY;
  const devices = devicesQuery.data ?? STABLE_EMPTY_ARRAY;
  const memberIds = useMemo(() => new Set(members.map((member) => member.device_id)), [members]);
  const selectedMemberIdSet = useMemo(() => new Set(selectedMemberIds), [selectedMemberIds]);
  const selectedDeviceIdSet = useMemo(() => new Set(selectedDeviceIds), [selectedDeviceIds]);
  const availableDevices = useMemo(() => devices.filter((device) => !memberIds.has(device.id)), [devices, memberIds]);
  const filteredAvailableDevices = useMemo(() => {
    const q = normalizeSearch(deviceSearch.trim());
    return availableDevices.filter((device) => {
      if (deviceStatusFilter && device.status !== deviceStatusFilter) return false;
      return q ? deviceSearchText(device).includes(q) : true;
    });
  }, [availableDevices, deviceSearch, deviceStatusFilter]);
  const filteredMembers = useMemo(() => {
    const q = normalizeSearch(memberSearch.trim());
    return q ? members.filter((member) => memberSearchText(member).includes(q)) : members;
  }, [members, memberSearch]);
  const offlineCount = members.filter((member) => member.device_status === "offline").length;

  function invalidateMembership() {
    queryClient.invalidateQueries({ queryKey: ["group-devices", group.id] });
    queryClient.invalidateQueries({ queryKey: ["device-groups"] });
  }

  const addMutation = useMutation({
    mutationFn: (deviceIds: string[]) => deviceGroupApi.addMembers(group.id, deviceIds),
    onSuccess: (result) => {
      setSelectedDeviceIds([]);
      onSuccess(result.added > 0 ? t("devices:groups.added_n", "Đã thêm {{count}} thiết bị vào nhóm.", { count: result.added }) : t("devices:groups.no_added", "Không có thiết bị mới cần thêm."));
      invalidateMembership();
    },
    onError: (error) => onError(errorMessage(error, t)),
  });

  const removeMutation = useMutation({
    mutationFn: (deviceIds: string[]) => deviceGroupApi.removeMembers(group.id, deviceIds),
    onSuccess: (result) => {
      setRemoveTarget(null);
      setBulkRemoveOpen(false);
      setSelectedMemberIds([]);
      onSuccess(result.removed > 0 ? t("devices:groups.removed_n", "Đã gỡ {{count}} thiết bị khỏi nhóm.", { count: result.removed }) : t("devices:groups.no_removed", "Không có membership nào cần gỡ."));
      invalidateMembership();
    },
    onError: (error) => onError(errorMessage(error, t)),
  });

  useEffect(() => {
    setSelectedDeviceIds((current) => current.filter((id) => availableDevices.some((device) => device.id === id)));
  }, [availableDevices]);

  useEffect(() => {
    setSelectedMemberIds((current) => current.filter((id) => members.some((member) => member.device_id === id)));
  }, [members]);

  const memberColumns: Column<DeviceGroupMember>[] = [
    {
      key: "select",
      header: "",
      width: "44px",
      render: (member) =>
        canManage ? (
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-emerald-600"
            aria-label={t("devices:groups.select_member", "Chọn {{name}}", { name: member.device_name || member.device_uid })}
            checked={selectedMemberIdSet.has(member.device_id)}
            onChange={(event) => {
              setSelectedMemberIds((current) =>
                event.target.checked
                  ? Array.from(new Set([...current, member.device_id]))
                  : current.filter((id) => id !== member.device_id),
              );
            }}
          />
        ) : null,
    },
    {
      key: "device_name",
      header: t("devices:col_device", "Thiết bị"),
      render: (member) => (
        <div>
          <div className="font-medium text-slate-900 dark:text-text-primary">{member.device_name || member.device_uid}</div>
          <div className="text-xs text-slate-500">{member.device_uid}</div>
        </div>
      ),
    },
    {
      key: "device_status",
      header: t("common:status.label", "Trạng thái"),
      render: (member) => <StatusBadge tone={statusToTone(member.device_status)} label={statusLabel(member.device_status)} />,
    },
    {
      key: "added_at",
      header: t("devices:groups.added_at", "Ngày thêm"),
      render: (member) => <span className="text-xs text-slate-500">{formatDate(member.added_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (member) => (
        canManage ? (
          <button className="btn-ghost h-8 w-8 p-0 text-rose-600" title={t("devices:groups.remove_from_group", "Gỡ khỏi nhóm")} aria-label={t("devices:groups.remove_from_group", "Gỡ khỏi nhóm")} onClick={() => setRemoveTarget(member)}>
            <Unlink className="h-4 w-4" />
          </button>
        ) : null
      ),
    },
  ];

  return (
    <>
      <Modal open onClose={onClose} title={group.name} size="xl">
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div>
              <div className="section-label">{t("common:status.label", "Trạng thái")}</div>
              <div className="mt-1"><StatusBadge tone={statusToTone(group.status)} label={statusLabel(group.status)} /></div>
            </div>
            <div>
              <div className="section-label">{t("devices:groups.field_type", "Loại")}</div>
              <div className="mt-1 text-sm font-medium capitalize">{statusLabel(group.group_type)}</div>
            </div>
            <div>
              <div className="section-label">{t("devices:title", "Thiết bị")}</div>
              <div className="mt-1 text-sm font-medium tabular-nums">{membersQuery.data?.total ?? group.device_count}</div>
            </div>
            <div>
              <div className="section-label">{t("common:col.updated", "Cập nhật")}</div>
              <div className="mt-1 text-sm font-medium">{formatDate(group.updated_at)}</div>
            </div>
          </div>

          <div>
            <div className="section-label mb-1">{t("devices:groups.field_description", "Mô tả")}</div>
            <p className="text-sm text-slate-600 dark:text-text-muted">{group.description || t("devices:groups.no_description", "Không có mô tả.")}</p>
          </div>

          {group.tags.length > 0 && (
            <div>
              <div className="section-label mb-2">Tags</div>
              <div className="flex flex-wrap gap-1.5">
                {group.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-surface-elevated dark:text-text-secondary">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 p-3 dark:border-border-subtle">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="section-label">{t("devices:groups.quick_actions", "Tác vụ nhanh")}</div>
                {offlineCount > 0 && (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    {t("devices:groups.offline_notice", "Nhóm có {{count}} thiết bị offline; lệnh hoặc OTA có thể chờ thiết bị kết nối lại.", { count: offlineCount })}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  title={t("devices:groups.view_monitoring", "Xem telemetry cho nhóm")}
                  onClick={() => onViewMonitoring(group)}
                >
                  <Activity className="h-4 w-4" />
                  Telemetry
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!canSendCommand || members.length === 0}
                  title={members.length === 0 ? t("devices:groups.cannot_send_empty", "Không thể gửi lệnh tới nhóm trống") : t("devices:groups.send_command_title", "Gửi lệnh tới nhóm")}
                  onClick={() => onSendCommand(group)}
                >
                  <Radio className="h-4 w-4" />
                  {t("devices:groups.send_command", "Gửi lệnh")}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!canCreateOta || members.length === 0}
                  title={members.length === 0 ? t("devices:groups.cannot_ota_empty", "Không thể tạo OTA cho nhóm trống") : t("devices:groups.create_ota_title", "Tạo OTA cho nhóm")}
                  onClick={() => onCreateOta(group)}
                >
                  <Rocket className="h-4 w-4" />
                  {t("devices:groups.create_ota", "Tạo OTA")}
                </button>
              </div>
            </div>
          </div>

          {canManage && (
            <div className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-border-subtle">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <label className="block text-sm font-medium text-slate-700 dark:text-text-secondary mb-1">{t("devices:add_device", "Thêm thiết bị")}</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      className="input w-full pl-9"
                      value={deviceSearch}
                      onChange={(event) => setDeviceSearch(event.target.value)}
                      placeholder={t("devices:search_uid_mac", "Tìm theo tên, UID hoặc MAC")}
                      disabled={devicesQuery.isLoading || addMutation.isPending}
                    />
                  </div>
                </div>
                <select
                  className="input w-40"
                  value={deviceStatusFilter}
                  onChange={(event) => setDeviceStatusFilter(event.target.value)}
                  disabled={devicesQuery.isLoading || addMutation.isPending}
                >
                  <option value="">{t("devices:groups.all_status", "Tất cả trạng thái")}</option>
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                  <option value="provisioning">Provisioning</option>
                </select>
                <button
                  className="btn-primary"
                  disabled={selectedDeviceIds.length === 0 || addMutation.isPending}
                  onClick={() => addMutation.mutate(selectedDeviceIds)}
                >
                  <Plus className="h-4 w-4" />
                  {addMutation.isPending ? t("common:actions.adding", "Đang thêm...") : `${t("common:actions.add", "Thêm")} ${selectedDeviceIds.length || ""}`}
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border border-slate-200 dark:border-border-subtle">
                {filteredAvailableDevices.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-slate-500 dark:text-text-muted">
                    {availableDevices.length === 0 ? t("devices:groups.all_assigned", "Tất cả thiết bị tenant đã nằm trong nhóm hoặc chưa có thiết bị.") : t("devices:groups.no_match", "Không tìm thấy thiết bị phù hợp.")}
                  </div>
                ) : (
                  filteredAvailableDevices.map((device) => (
                    <label key={device.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0 hover:bg-slate-50 dark:border-border-subtle dark:hover:bg-surface-elevated/70">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                        checked={selectedDeviceIdSet.has(device.id)}
                        onChange={(event) => {
                          setSelectedDeviceIds((current) =>
                            event.target.checked
                              ? Array.from(new Set([...current, device.id]))
                              : current.filter((id) => id !== device.id),
                          );
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-900 dark:text-text-primary">
                          {device.name || device.device_uid}
                        </div>
                        <div className="truncate text-xs text-slate-500">
                          {device.device_uid}{device.mac_address ? ` · ${device.mac_address}` : ""}
                        </div>
                      </div>
                      <StatusBadge tone={statusToTone(device.status)} label={statusLabel(device.status)} />
                    </label>
                  ))
                )}
              </div>
              <div className="text-xs text-slate-500 dark:text-text-muted">
                {t("devices:groups.selected_count", "Đã chọn {{count}} thiết bị. Thiết bị đã ở trong nhóm được ẩn để tránh thêm trùng.", { count: selectedDeviceIds.length })}
              </div>
            </div>
          )}

          {devicesQuery.error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {errorMessage(devicesQuery.error)}
            </div>
          )}

          <DataTable
            data={filteredMembers}
            columns={memberColumns}
            loading={membersQuery.isLoading}
            error={membersQuery.error ? errorMessage(membersQuery.error) : null}
            onRetry={() => membersQuery.refetch()}
            rowKey={(member) => member.member_id}
            emptyTitle={t("devices:groups.empty_title", "Nhóm chưa có thiết bị")}
            emptyDescription={t("devices:groups.empty_desc", "Chọn thiết bị thuộc tenant để thêm vào nhóm này.")}
            initialPageSize={5}
            toolbar={
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1 max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    className="input w-full pl-9"
                    value={memberSearch}
                    onChange={(event) => setMemberSearch(event.target.value)}
                    placeholder={t("devices:groups.search_in_group", "Tìm thiết bị trong nhóm")}
                  />
                </div>
                {canManage && selectedMemberIds.length > 0 && (
                  <button className="btn-danger" onClick={() => setBulkRemoveOpen(true)}>
                    <Unlink className="h-4 w-4" />
                    {t("devices:groups.remove_n_devices", "Gỡ {{count}} thiết bị", { count: selectedMemberIds.length })}
                  </button>
                )}
              </div>
            }
          />

          {canManage && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4 dark:border-border-subtle">
            <button className="btn-secondary" onClick={onEdit}>
              <Edit className="h-4 w-4" />
              {t("devices:groups.edit_info", "Sửa thông tin")}
            </button>
            <button className="btn-danger" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              {t("devices:groups.delete_confirm", "Xóa nhóm")}
            </button>
          </div>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!removeTarget}
        title={t("devices:groups.remove_device_title", "Gỡ thiết bị khỏi nhóm?")}
        description={
          removeTarget
            ? t("devices:groups.remove_device_desc", 'Thiết bị "{{name}}" sẽ chỉ bị gỡ khỏi nhóm này.', { name: removeTarget.device_name || removeTarget.device_uid })
            : undefined
        }
        confirmLabel={t("devices:groups.remove_device_confirm", "Gỡ thiết bị")}
        cancelLabel={t("common:actions.cancel", "Huỷ")}
        destructive
        loading={removeMutation.isPending}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget && canManage) removeMutation.mutate([removeTarget.device_id]);
        }}
      />

      <ConfirmDialog
        open={bulkRemoveOpen}
        title={t("devices:groups.bulk_remove_title", "Gỡ nhiều thiết bị khỏi nhóm?")}
        description={t("devices:groups.bulk_remove_desc", "{{count}} thiết bị sẽ chỉ bị gỡ khỏi nhóm này. Thiết bị và dữ liệu của chúng không bị xóa.", { count: selectedMemberIds.length })}
        confirmLabel={t("devices:groups.bulk_remove_confirm", "Gỡ khỏi nhóm")}
        cancelLabel={t("common:actions.cancel", "Huỷ")}
        destructive
        loading={removeMutation.isPending}
        onCancel={() => setBulkRemoveOpen(false)}
        onConfirm={() => {
          if (canManage && selectedMemberIds.length > 0) removeMutation.mutate(selectedMemberIds);
        }}
      />
    </>
  );
}
