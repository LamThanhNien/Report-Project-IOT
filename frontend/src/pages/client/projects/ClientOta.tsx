import { useState, useMemo, lazy, Suspense, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { usePersistedState } from "../../../hooks/usePersistedState";
import { useLocation } from "react-router-dom";
import { useProjectScope } from "../../../hooks/useProjectScope";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Rocket, RefreshCw, Package, Search, Code, FileCode, Binary, AlertCircle, CheckCircle2, ShieldCheck, Archive, ArchiveRestore, Trash2, MoreVertical } from "lucide-react";
import { useAuth } from "../../../contexts/AuthContext";
import {
  listClientOtaJobs,
  listClientFirmware,
  uploadClientFirmware,
  uploadClientFirmwareFromSource,
  signClientFirmware,
  createClientOtaJob,
  listClientDevices,
  listClientDeviceModels,
  archiveClientFirmware,
  unarchiveClientFirmware,
  deleteClientFirmware,
  archiveClientOtaJob,
  unarchiveClientOtaJob,
} from "../../../services/clientApi";
import { deviceGroupApi, type DeviceGroup } from "../../../services/deviceGroupApi";
import { DataTable } from "../../../components/ui/DataTable";
import { StatusBadge } from "../../../components/ui/StatusBadge";
import { PageHeader } from "../../../components/ui/PageHeader";
import { Modal } from "../../../components/ui/Modal";
import { FirmwareVersionBadge } from "../../../components/ui/FirmwareVersionBadge";
import { Tabs } from "../../../components/ui/Tabs";
import { TenantLoadingState } from "../../../components/ui/TenantUi";
import { ReadOnlyNotice } from "../../../components/permissions/PermissionGate";
import { useFeature } from "../../../contexts/FeatureContext";
import { FeatureGate } from "./FeatureGate";
import { canManageFirmware, canManageOta, canViewFirmware, canViewOta } from "../../../lib/permissions";
import { otaTone } from "../../../lib/status";
import { formatRelative, formatBytes, formatDateTime, shortHash } from "../../../lib/formatters";
import { apiBaseUrl } from "../../../services/apiClient";
import type { Column } from "../../../components/ui/DataTable";
import type { Device, OtaJob, Firmware, DeviceModel } from "../../../types";

const MonacoEditor = lazy(() => import("@monaco-editor/react"));

type Tab = "firmware" | "jobs" | "history";
type ClientOtaLocationState = {
  deviceUid?: string;
  groupId?: string;
  firmwareId?: string;
  tab?: Tab;
  create?: boolean;
  upload?: boolean;
};

const OTA_HISTORY_STATUSES = new Set(["success", "completed", "failed", "cancelled", "rolled_back"]);

function OtaJobActionMenu({
  job,
  canManage,
  onArchive,
  onUnarchive,
}: {
  job: OtaJob;
  canManage: boolean;
  onArchive: () => void;
  onUnarchive: () => void;
}) {
  const { t } = useTranslation(["ota", "common"]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  if (!canManage) return null;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={btnRef}
        className="btn-ghost h-8 w-8 p-0 flex items-center justify-center"
        title={t("common:col.actions", "Thao tác")}
        onClick={(e) => {
          e.stopPropagation();
          if (!open && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
          }
          setOpen((v) => !v);
        }}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="fixed z-[60] w-48 py-1 bg-white dark:bg-surface border border-slate-200 dark:border-border-subtle rounded-lg shadow-lg"
          style={{ top: pos.top, right: pos.right }}
          onClick={(e) => e.stopPropagation()}
        >
          {job.archived_at ? (
            <button
              className="w-full text-left px-3 py-2 text-xs text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 flex items-center gap-2"
              onClick={() => {
                setOpen(false);
                onUnarchive();
              }}
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
              {t("devices:ota_actions.restore", "Khôi phục")}
            </button>
          ) : (
            <button
              className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-text-secondary hover:bg-slate-50 dark:hover:bg-surface-elevated flex items-center gap-2"
              onClick={() => {
                setOpen(false);
                onArchive();
              }}
            >
              <Archive className="h-3.5 w-3.5" />
              {t("devices:ota_actions.archive", "Lưu trữ")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FirmwareActionMenu({
  firmware: f,
  canUploadFirmware,
  canCreateOta,
  hasBinary,
  isGlobal,
  onViewSource,
  onSign,
  onCreateOta,
  onArchive,
  onUnarchive,
  onDelete,
  signPending,
}: {
  firmware: Firmware;
  canUploadFirmware: boolean;
  canCreateOta: boolean;
  hasBinary: boolean;
  isGlobal: boolean;
  onViewSource?: () => void;
  onSign?: () => void;
  onCreateOta?: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDelete: () => void;
  signPending: boolean;
}) {
  const { t } = useTranslation(["ota", "common"]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        ref={btnRef}
        className="btn-ghost h-8 w-8 p-0 flex items-center justify-center"
        title={t("common:col.actions", "Thao tác")}
        onClick={(e) => {
          e.stopPropagation();
          if (!open && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
          }
          setOpen((v) => !v);
        }}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="fixed z-[60] w-48 py-1 bg-white dark:bg-surface border border-slate-200 dark:border-border-subtle rounded-lg shadow-lg"
          style={{ top: pos.top, right: pos.right }}
          onClick={(e) => e.stopPropagation()}
        >
          {f.source_code && onViewSource && (
            <button
              className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-text-secondary hover:bg-slate-50 dark:hover:bg-surface-elevated flex items-center gap-2"
              onClick={() => {
                setOpen(false);
                onViewSource();
              }}
            >
              <FileCode className="h-3.5 w-3.5 text-slate-400" />
              {t("devices:ota_actions.view_source", "Xem source code")}
            </button>
          )}
          
          {hasBinary && (
            <a
              href={`${apiBaseUrl}/api/v1/client/firmware/${f.id}/download`}
              target="_blank"
              rel="noreferrer"
              className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-text-secondary hover:bg-slate-50 dark:hover:bg-surface-elevated flex items-center gap-2"
              onClick={() => setOpen(false)}
            >
              <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              {t("devices:ota_actions.download_binary", "Tải xuống binary")}
            </a>
          )}

          {!f.signature && onSign && (
            <button
              className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-text-secondary hover:bg-slate-50 dark:hover:bg-surface-elevated flex items-center gap-2"
              disabled={signPending}
              onClick={() => {
                setOpen(false);
                onSign();
              }}
            >
              <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
              {t("devices:ota_actions.sign", "Ký xác thực")}
            </button>
          )}

          {canCreateOta && hasBinary && onCreateOta && (
            <button
              className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-text-secondary hover:bg-slate-50 dark:hover:bg-surface-elevated flex items-center gap-2"
              onClick={() => {
                setOpen(false);
                onCreateOta();
              }}
            >
              <Rocket className="h-3.5 w-3.5 text-sky-500" />
              {t("devices:ota_actions.create_ota", "Tạo OTA")}
            </button>
          )}

          {!isGlobal && canUploadFirmware && (
            <>
              <div className="border-t border-slate-100 dark:border-border-subtle my-1" />
              {f.archived_at ? (
                <button
                  className="w-full text-left px-3 py-2 text-xs text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 flex items-center gap-2"
                  onClick={() => {
                    setOpen(false);
                    onUnarchive();
                  }}
                >
                  <ArchiveRestore className="h-3.5 w-3.5" />
                  {t("devices:ota_actions.restore", "Khôi phục")}
                </button>
              ) : (
                <button
                  className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-text-secondary hover:bg-slate-50 dark:hover:bg-surface-elevated flex items-center gap-2"
                  onClick={() => {
                    setOpen(false);
                    onArchive();
                  }}
                >
                  <Archive className="h-3.5 w-3.5" />
                  {t("devices:ota_actions.archive", "Lưu trữ")}
                </button>
              )}
              <button
                className="w-full text-left px-3 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center gap-2"
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t("common:actions.delete_permanently", "Xóa vĩnh viễn")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ClientOta({ scopedProjectId }: { scopedProjectId?: string } = {}) {
  const { t } = useTranslation(["ota", "devices", "common"]);
  const { isWorkspace, projectId } = useProjectScope();
  const effectiveProjectId = scopedProjectId || projectId;
  const { hasFeature, featuresReady } = useFeature();
  const { user } = useAuth();
  const canSeeFirmware = canViewFirmware(user);
  const canSeeOta = canViewOta(user);
  const canUploadFirmware = canManageFirmware(user);
  const canCreateOta = canManageOta(user);
  const qc = useQueryClient();
  const location = useLocation();
  const routeState = (location.state as ClientOtaLocationState | null) ?? {};
  const initialDeviceUid = routeState.deviceUid ?? "";
  const initialGroupId = routeState.groupId ?? "";
  const [tab, setTab] = useState<Tab>(() => {
    if (routeState.tab) return routeState.tab;
    const saved = localStorage.getItem("client-ota-tab") as Tab | null;
    if (saved === "firmware" && canSeeFirmware) return "firmware";
    if ((saved === "jobs" || saved === "history") && canSeeOta) return saved;
    return canSeeFirmware ? "firmware" : "jobs";
  });
  const [uploadOpen, setUploadOpen] = useState(() => !!routeState.upload && canUploadFirmware);
  const [createOpen, setCreateOpen] = useState(() => canCreateOta && (!!initialDeviceUid || !!initialGroupId || !!routeState.create));
  const [search, setSearch] = usePersistedState(`aifom_clientota_search_${projectId}`, "", "session");
  const [viewSourceFw, setViewSourceFw] = useState<Firmware | null>(null);
  const [selectedFirmwareId, setSelectedFirmwareId] = useState(routeState.firmwareId ?? "");
  const [fwFilter, setFwFilter] = usePersistedState<"active" | "archived" | "all">(`aifom_clientota_fwfilter_${projectId}`, "active", "session");
  const [jobsFilter, setJobsFilter] = usePersistedState<"active" | "archived" | "all">(`aifom_clientota_jobsfilter_${projectId}`, "active", "session");
  const [historyFilter, setHistoryFilter] = usePersistedState<"active" | "archived" | "all">(`aifom_clientota_historyfilter_${projectId}`, "active", "session");

  useEffect(() => {
    if (tab === "firmware" && !canSeeFirmware) setTab("jobs");
    if ((tab === "jobs" || tab === "history") && !canSeeOta) setTab("firmware");
    localStorage.setItem("client-ota-tab", tab);
  }, [canSeeFirmware, canSeeOta, tab]);

  const { data: jobs, isLoading: jobsLoading, error: jobsError, refetch: refetchJobs } = useQuery({
    queryKey: ["client-ota-jobs", effectiveProjectId],
    queryFn: () => listClientOtaJobs(effectiveProjectId || undefined),
    enabled: canSeeOta,
    refetchInterval: (query) => {
      const data = query.state.data as OtaJob[] | undefined;
      const hasActive = (data ?? []).some(
        (job) => !OTA_HISTORY_STATUSES.has(job.status.toLowerCase())
      );
      return hasActive ? 3000 : 15_000;
    },
  });

  const { data: firmware, isLoading: fwLoading, error: fwError, refetch: refetchFw, isFetching: fwFetching } = useQuery({
    queryKey: ["client-firmware"], // firmware is tenant-wide
    queryFn: () => listClientFirmware(),
    enabled: canSeeFirmware && (tab === "firmware" || createOpen),
  });

  const { data: devices = [] } = useQuery({
    queryKey: ["client-devices", effectiveProjectId],
    queryFn: () => listClientDevices(effectiveProjectId || undefined),
    enabled: canCreateOta,
  });

  const signFirmwareMutation = useMutation({
    mutationFn: (firmwareId: string) => signClientFirmware(firmwareId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-firmware"] }),
  });

  const archiveFwMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "archive" | "unarchive" }) =>
      action === "archive" ? archiveClientFirmware(id) : unarchiveClientFirmware(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-firmware"] }),
    onError: (error: Error) => alert(`Lỗi: ${error.message}`),
  });

  const deleteFwMutation = useMutation({
    mutationFn: (id: string) => deleteClientFirmware(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-firmware"] }),
    onError: (error: Error) => alert(`Không thể xóa firmware: ${error.message}`),
  });

  const archiveJobMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "archive" | "unarchive" }) =>
      action === "archive" ? archiveClientOtaJob(id) : unarchiveClientOtaJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client-ota-jobs"] }),
    onError: (error: Error) => alert(`Lỗi: ${error.message}`),
  });

  const { data: deviceGroups } = useQuery({
    queryKey: ["client-device-groups-for-ota", effectiveProjectId],
    queryFn: () => deviceGroupApi.listDeviceGroups(effectiveProjectId ? { status: "active", limit: 200, project_id: effectiveProjectId || undefined } : { status: "active", limit: 200 }),
    enabled: canCreateOta,
  });

  const filteredFw = useMemo(() => {
    let list = firmware ?? [];
    if (fwFilter === "active") list = list.filter(f => !f.archived_at);
    if (fwFilter === "archived") list = list.filter(f => !!f.archived_at);
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter((f) =>
      `${f.version} ${f.target_device_type} ${f.checksum_sha256 ?? ""}`.toLowerCase().includes(q),
    );
  }, [firmware, search, fwFilter]);

  const activeOtaJobs = useMemo(() => {
    let list = (jobs ?? []).filter((job) => !OTA_HISTORY_STATUSES.has(job.status.toLowerCase()));
    if (jobsFilter === "active") list = list.filter(j => !j.archived_at);
    if (jobsFilter === "archived") list = list.filter(j => !!j.archived_at);
    return list;
  }, [jobs, jobsFilter]);

  const otaHistory = useMemo(() => {
    let list = (jobs ?? []).filter((job) => OTA_HISTORY_STATUSES.has(job.status.toLowerCase()));
    if (historyFilter === "active") list = list.filter(j => !j.archived_at);
    if (historyFilter === "archived") list = list.filter(j => !!j.archived_at);
    return list;
  }, [jobs, historyFilter]);

  const isJobTimedOut = (j: OtaJob) => {
    const isTerminal = ["success", "completed", "failed", "cancelled", "rolled_back"].includes(j.status.toLowerCase());
    if (isTerminal) return false;
    const elapsed = Date.now() - new Date(j.requested_at).getTime();
    return elapsed > 180_000; // 3 minutes
  };

  const jobColumns: Column<OtaJob>[] = [
    {
      key: "device_uid",
      header: t("ota:col.device", "Thiết bị"),
      sortable: true,
      render: (j) => <span className="font-mono text-xs">{j.device_uid}</span>,
      sortValue: (j) => j.device_uid,
    },
    {
      key: "firmware_version",
      header: t("ota:col.firmware", "Firmware"),
      render: (j) => <FirmwareVersionBadge version={j.firmware_version} />,
    },
    {
      key: "status",
      header: t("ota:col.status", "Trạng thái"),
      sortable: true,
      render: (j) => {
        const timedOut = isJobTimedOut(j);
        const statusText = timedOut ? "timeout" : j.status;
        return <StatusBadge tone={otaTone(statusText)} label={statusText} />;
      },
      sortValue: (j) => j.status,
    },
    {
      key: "progress",
      header: t("ota:col.progress", "Tiến trình"),
      render: (j) => {
        const timedOut = isJobTimedOut(j);
        const isPending = !timedOut && (j.status === "pending" || j.status === "sent");
        const isFailed = j.status === "failed" || timedOut;
        const isSuccess = j.status === "success" || j.status === "completed";
        const percent = timedOut ? 0 : (j.progress ?? 0);
        
        let barColor = "bg-primary";
        if (isFailed) barColor = "bg-rose-500";
        else if (isSuccess) barColor = "bg-emerald-500";
        else if (isPending) barColor = "bg-slate-300";
        
        return (
          <div className="flex items-center gap-2 min-w-[120px]">
            <div className="w-full bg-slate-100 dark:bg-surface-elevated rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${barColor}`}
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className={`text-[10px] tabular-nums font-medium ${timedOut ? "text-rose-500 font-semibold" : "text-slate-500"}`}>
              {timedOut ? t("ota:status.timed_out", "Hết hạn") : `${percent}%`}
            </span>
          </div>
        );
      },
    },
    {
      key: "requested_at",
      header: t("ota:col.requested_at", "Yêu cầu lúc"),
      sortable: true,
      render: (j) => <span className="text-xs text-slate-500">{formatRelative(j.requested_at)}</span>,
      sortValue: (j) => j.requested_at,
    },
    {
      key: "completed_at",
      header: t("ota:col.completed_at", "Hoàn thành"),
      render: (j) => (
        <span className="text-xs text-slate-500">
          {j.completed_at ? formatRelative(j.completed_at) : "—"}
        </span>
      ),
    },
    {
      key: "error_message",
      header: t("ota:col.error", "Lỗi"),
      render: (j) => {
        const timedOut = isJobTimedOut(j);
        const errMsg = timedOut ? t("ota:status.error_timed_out", "Thiết bị không phản hồi (Yêu cầu hết hạn)") : (j.error_message ?? j.error_code);
        return errMsg ? (
          <span className="text-xs text-rose-500 truncate max-w-[200px] block" title={errMsg}>
            {errMsg}
          </span>
        ) : null;
      },
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (j) => {
        const canManage = canManageOta(user);
        if (!canManage) return null;
        
        return (
          <div className="inline-flex items-center gap-1">
            {j.archived_at ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(t("ota:confirm.restore_job", "Bạn có chắc muốn khôi phục OTA job này?"))) {
                    archiveJobMutation.mutate({ id: j.id, action: "unarchive" });
                  }
                }}
                className="btn-ghost h-8 px-2 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/30"
                title={t("ota:actions.restore", "Khôi phục")}
                disabled={archiveJobMutation.isPending}
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(t("ota:confirm.archive_job", "Bạn có chắc muốn lưu trữ OTA job này?"))) {
                    archiveJobMutation.mutate({ id: j.id, action: "archive" });
                  }
                }}
                className="btn-ghost h-8 px-2 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                title={t("ota:actions.archive", "Lưu trữ")}
                disabled={archiveJobMutation.isPending}
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const fwColumns: Column<Firmware>[] = [
    {
      key: "version",
      header: t("ota:col.version", "Version"),
      sortable: true,
      sortValue: (f) => f.version,
      render: (f) => (
        <div className="flex items-center gap-2">
          <FirmwareVersionBadge version={f.version} />
          {f.source_type === "ino_source" && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  title={t("ota:status.source_not_compiled", "Source code chưa được biên dịch — không thể dùng cho OTA")}>
              <Code className="h-2.5 w-2.5" /> {t("ota:status.tag_source", "Nguồn")}
            </span>
          )}
          {f.source_type === "ino_compiled" && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  title={t("ota:status.source_compiled", "Được biên dịch từ source code .ino")}>
              <CheckCircle2 className="h-2.5 w-2.5" /> {t("ota:status.tag_compiled", "Đã biên dịch")}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "signature",
      header: t("ota:col.signature", "Xác thực"),
      render: (f) => f.signature ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600" title={f.signing_key_id ?? ""}>
          <ShieldCheck className="h-3.5 w-3.5" /> {t("devices:ota_status.signed", "Đã ký")}
        </span>
      ) : (
        <span className="text-xs text-amber-600">{t("devices:ota_status.unsigned", "Chưa ký")}</span>
      ),
    },
    {
      key: "target",
      header: t("ota:col.target", "Target"),
      sortable: true,
      sortValue: (f) => f.target_device_type,
      render: (f) => (
        <span className="chip bg-slate-100 text-slate-700 dark:bg-surface-elevated dark:text-text-secondary">
          {f.target_device_type}
        </span>
      ),
    },
    {
      key: "size",
      header: t("ota:col.size", "Kích thước"),
      align: "right",
      render: (f) =>
        f.file_size ? (
          <span className="text-xs tabular-nums">{formatBytes(f.file_size)}</span>
        ) : (
          <span className="text-xs text-slate-400 italic">{t("ota:status.source_only", "source only")}</span>
        ),
    },
    {
      key: "sha",
      header: t("ota:col.sha256", "SHA-256"),
      render: (f) => (
        <span className="font-mono text-xs text-slate-500" title={f.checksum_sha256 ?? ""}>
          {shortHash(f.checksum_sha256, 12)}
        </span>
      ),
    },
    {
      key: "created",
      header: t("ota:col.uploaded", "Tải lên"),
      sortable: true,
      sortValue: (f) => new Date(f.created_at).getTime(),
      render: (f) => <span className="text-xs text-slate-500">{formatDateTime(f.created_at)}</span>,
    },
    {
      key: "actions",
      header: t("ota:col.actions", "THAO TÁC"),
      align: "center",
      width: "70px",
      render: (f) => {
        const hasBinary = !!f.object_key && f.source_type !== "ino_source";
        const isGlobal = !f.uploaded_by_tenant_id;
        
        return (
          <FirmwareActionMenu
            firmware={f}
            canUploadFirmware={canUploadFirmware}
            canCreateOta={canCreateOta}
            hasBinary={hasBinary}
            isGlobal={isGlobal}
            onViewSource={() => setViewSourceFw(f)}
            onSign={() => signFirmwareMutation.mutate(f.id)}
            onCreateOta={() => { setSelectedFirmwareId(f.id); setCreateOpen(true); }}
            onArchive={() => archiveFwMutation.mutate({ id: f.id, action: "archive" })}
            onUnarchive={() => archiveFwMutation.mutate({ id: f.id, action: "unarchive" })}
            onDelete={() => {
              if (confirm(t("ota:confirm.delete_firmware", "Bạn có chắc chắn muốn xóa vĩnh viễn firmware này? Hành động này không thể hoàn tác và chỉ có thể thực hiện nếu firmware chưa từng được dùng trong OTA Job."))) {
                deleteFwMutation.mutate(f.id);
              }
            }}
            signPending={signFirmwareMutation.isPending}
          />
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        crumbs={isWorkspace ? [{ label: "Workspace", to: `/client/workspace/${effectiveProjectId}/home` }, { label: t("ota:page_title", "OTA / Firmware") }] : [{ label: "Tenant", to: "/client/dashboard" }, { label: t("ota:page_title", "OTA / Firmware") }]}
        title={t("ota:page_title", "OTA / Firmware")}
        subtitle={t("ota:page_subtitle", "Quản lý các phiên bản firmware, chiến dịch OTA và lịch sử cập nhật firmware cho các thiết bị ESP32.")}
        actions={
          <div className="flex items-center gap-2">
            {tab === "firmware" && canSeeFirmware && (
              <>
                <button onClick={() => refetchFw()} disabled={fwFetching} className="btn-secondary">
                  <RefreshCw className={fwFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
                  {t("ota:actions.refresh", "Làm mới")}
                </button>
                {canUploadFirmware && (
                  <button onClick={() => setUploadOpen(true)} className="btn-secondary">
                    <Upload className="h-3.5 w-3.5" /> {t("ota:actions.upload_firmware", "Tải lên firmware")}
                  </button>
                )}
              </>
            )}
            {canCreateOta && (
              <button onClick={() => setCreateOpen(true)} className="btn-primary">
                <Rocket className="h-3.5 w-3.5" /> {t("ota:actions.create_ota", "Tạo OTA")}
              </button>
            )}
          </div>
        }
      />

      {(!canUploadFirmware || !canCreateOta) && <ReadOnlyNotice />}

      {signFirmwareMutation.error && (
        <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
          {signFirmwareMutation.error.message}
        </div>
      )}

      <Tabs
        className="mb-4"
        active={tab}
        onChange={(key) => setTab(key as Tab)}
        tabs={[
          ...(canSeeFirmware
            ? [{ key: "firmware", label: <span className="inline-flex items-center gap-1.5"><Package className="h-3.5 w-3.5" />{t("ota:tabs.firmware_library", "Thư viện Firmware")}</span> }]
            : []),
          ...(canSeeOta ? [{ key: "jobs", label: t("ota:tabs.ota_jobs", "OTA Jobs") }] : []),
          ...(canSeeOta ? [{ key: "history", label: t("ota:tabs.ota_history", "Lịch sử OTA") }] : []),
        ]}
      />

      {tab === "jobs" && (
        <DataTable
          data={activeOtaJobs}
          columns={jobColumns}
          loading={jobsLoading}
          error={jobsError ? String(jobsError) : null}
          onRetry={refetchJobs}
          rowKey={(j) => j.id}
          emptyTitle={t("ota:empty.no_active_jobs_title", "Chưa có OTA job nào")}
          emptyDescription={t("ota:empty.no_active_jobs_desc", "Nhấn 'Tạo OTA' để khởi tạo chiến dịch cập nhật firmware cho thiết bị.")}
          toolbar={
            <div className="flex items-center gap-2">
              <select
                value={jobsFilter}
                onChange={(e) => setJobsFilter(e.target.value as any)}
                className="input h-8 text-xs py-0 pl-2 pr-6 bg-white dark:bg-surface-elevated text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/50 hover:border-primary-400 focus:border-primary-500 focus:ring-primary-500/20"
              >
                <option value="active">{t("ota:filters.active_jobs", "Active Jobs")}</option>
                <option value="archived">{t("ota:filters.archived_jobs", "Archived Jobs")}</option>
                <option value="all">{t("ota:filters.all_jobs", "All Jobs")}</option>
              </select>
            </div>
          }
        />
      )}

      {tab === "history" && (
        <DataTable
          data={otaHistory}
          columns={jobColumns}
          loading={jobsLoading}
          error={jobsError ? String(jobsError) : null}
          onRetry={refetchJobs}
          rowKey={(j) => j.id}
          emptyTitle={t("ota:empty.no_history_title", "Chưa có lịch sử OTA")}
          emptyDescription={t("ota:empty.no_history_desc", "Lịch sử cập nhật firmware sẽ hiển thị ở đây sau khi các OTA job được tạo.")}
          toolbar={
            <div className="flex items-center gap-2">
              <select
                value={historyFilter}
                onChange={(e) => setHistoryFilter(e.target.value as any)}
                className="input h-8 text-xs py-0 pl-2 pr-6 bg-white dark:bg-surface-elevated text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/50 hover:border-primary-400 focus:border-primary-500 focus:ring-primary-500/20"
              >
                <option value="active">{t("ota:filters.active_history", "Active History")}</option>
                <option value="archived">{t("ota:filters.archived_history", "Archived History")}</option>
                <option value="all">{t("ota:filters.all_history", "All History")}</option>
              </select>
            </div>
          }
        />
      )}

      {tab === "firmware" && (
        <DataTable
          data={filteredFw}
          columns={fwColumns}
          loading={fwLoading}
          error={fwError ? String(fwError) : null}
          onRetry={refetchFw}
          rowKey={(f) => f.id}
          emptyTitle={t("ota:empty.no_firmware_title", "Chưa có firmware nào")}
          emptyDescription={t("ota:empty.no_firmware_desc", "Tải lên file .bin đầu tiên để bắt đầu phát hành OTA.")}
          toolbar={
            <div className="flex items-center gap-2 flex-1">
              <select
                value={fwFilter}
                onChange={(e) => setFwFilter(e.target.value as any)}
                className="input h-8 text-xs py-0 pl-2 pr-6 bg-white dark:bg-surface-elevated text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700/50 hover:border-primary-400 focus:border-primary-500 focus:ring-primary-500/20"
              >
                <option value="active">{t("ota:filters.active_firmware", "Active Firmware")}</option>
                <option value="archived">{t("ota:filters.archived_firmware", "Archived Firmware")}</option>
                <option value="all">{t("ota:filters.all_firmware", "All Firmware")}</option>
              </select>
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("ota:filters.search_placeholder", "Tìm theo version, hash…")}
                  className="input pl-8 h-8 text-xs"
                />
              </div>
            </div>
          }
        />
      )}

      {canUploadFirmware && (
      <FirmwareUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => {
          setUploadOpen(false);
          qc.invalidateQueries({ queryKey: ["client-firmware"] });
        }}
      />
      )}

      {viewSourceFw && (
        <SourceViewerModal
          firmware={viewSourceFw}
          onClose={() => setViewSourceFw(null)}
        />
      )}

      {canCreateOta && (
      <CreateOtaModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        devices={devices ?? []}
        groups={deviceGroups?.items ?? []}
        firmware={firmware ?? []}
        initialDeviceUid={initialDeviceUid}
        initialGroupId={initialGroupId}
        initialFirmwareId={selectedFirmwareId}
        onSuccess={() => {
          setCreateOpen(false);
          setSelectedFirmwareId("");
          qc.invalidateQueries({ queryKey: ["client-ota-jobs"] });
          setTab("jobs");
        }}
      />
      )}
    </>
  );
}

// ── Upload firmware modal ─────────────────────────────────────────────────────

function FirmwareUploadModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation(["ota", "common"]);
  const [mode, setMode] = useState<"binary" | "source">("binary");
  const [version, setVersion] = useState("");
  const [target, setTarget] = useState("");
  const [boardFqbn, setBoardFqbn] = useState("esp32:esp32:esp32");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sourceCode, setSourceCode] = useState(
    "// Viết mã nguồn Arduino .ino ở đây...\nvoid setup() {\n  // Khởi tạo thiết bị\n}\n\nvoid loop() {\n  // Lặp lại\n}"
  );
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setMode("binary");
    setVersion("");
    setTarget("");
    setBoardFqbn("esp32:esp32:esp32");
    setNotes("");
    setFile(null);
    setSourceCode(
      "// Viết mã nguồn Arduino .ino ở đây...\nvoid setup() {\n  // Khởi tạo thiết bị\n}\n\nvoid loop() {\n  // Lặp lại\n}"
    );
    setError(null);
  }

  const [models, setModels] = useState<DeviceModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listClientDeviceModels()
      .then((data) => {
        if (!cancelled) setModels(data);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const binaryMut = useMutation({
    mutationFn: () => {
      if (!file) throw new Error(t("ota:upload_modal.err_bin_file_required", "Select a compiled firmware .bin file"));
      if (!file.name.toLowerCase().endsWith(".bin")) {
        throw new Error(t("ota:upload_modal.err_bin_extension_only", "Only precompiled .bin firmware files are supported"));
      }
      if (file.size === 0) {
        throw new Error(t("ota:upload_modal.err_bin_empty", "Firmware file cannot be empty"));
      }
      return uploadClientFirmware({ version, targetDeviceType: target, releaseNotes: notes || undefined, file });
    },
    onSuccess: () => { reset(); onSuccess(); },
    onError: (e: Error) => setError(e.message),
  });

  const sourceMut = useMutation({
    mutationFn: () => {
      if (!sourceCode.trim()) throw new Error(t("ota:upload_modal.err_source_required", "Mã nguồn Arduino không được để trống"));
      return uploadClientFirmwareFromSource({
        version,
        targetDeviceType: target,
        boardFqbn,
        sourceCode,
        releaseNotes: notes || undefined,
      });
    },
    onSuccess: () => { reset(); onSuccess(); },
    onError: (e: Error) => setError(e.message),
  });

  function handleSubmit() {
    setError(null);
    if (!version.trim()) { setError(t("ota:upload_modal.err_version_required", "Vui lòng nhập version")); return; }
    if (!target.trim()) { setError(t("ota:upload_modal.err_target_required", "Vui lòng chọn hardware model")); return; }
    
    if (mode === "binary") {
      if (!file) { setError(t("ota:upload_modal.err_bin_file_required", "Select a compiled firmware .bin file")); return; }
      if (!file.name.toLowerCase().endsWith(".bin")) {
        setError(t("ota:upload_modal.err_bin_extension_only", "Only precompiled .bin firmware files are supported"));
        return;
      }
      if (file.size === 0) { setError(t("ota:upload_modal.err_bin_empty", "Firmware file cannot be empty")); return; }
      binaryMut.mutate();
    } else {
      if (!boardFqbn.trim()) { setError(t("ota:upload_modal.err_fqbn_required", "Vui lòng nhập Board FQBN")); return; }
      if (!sourceCode.trim()) { setError(t("ota:upload_modal.err_source_required", "Vui lòng viết hoặc tải lên mã nguồn .ino")); return; }
      sourceMut.mutate();
    }
  }

  const handleSourceFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setSourceCode(event.target.result as string);
        }
      };
      reader.readAsText(file);
    }
  };

  const isPending = binaryMut.isPending || sourceMut.isPending;
  const canSubmit =
    !isPending &&
    !!version &&
    !!target &&
    (mode === "binary" ? !!file : !!boardFqbn && !!sourceCode);

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title={t("ota:upload_modal.title", "Tải lên hoặc biên dịch firmware mới")}
      size="xl"
      footer={
        <>
          <button onClick={() => { reset(); onClose(); }} className="btn-secondary">{t("ota:actions.cancel", "Huỷ")}</button>
          <button onClick={handleSubmit} disabled={!canSubmit} className="btn-primary">
            {isPending ? (
              <span className="flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                {sourceMut.isPending ? t("ota:actions.compiling_and_creating", "Đang biên dịch & tạo OTA...") : t("ota:actions.uploading", "Đang tải lên...")}
              </span>
            ) : mode === "binary" ? t("ota:actions.upload", "Tải lên") : t("ota:actions.compile_and_upload", "Biên dịch & Tải lên")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Mode selection tabs inside the modal */}
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-surface-elevated">
          <button
            type="button"
            onClick={() => { setMode("binary"); setError(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              mode === "binary"
                ? "bg-white text-primary shadow-sm dark:bg-surface-muted dark:text-primary"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Binary className="h-3.5 w-3.5" />
              {t("ota:upload_modal.mode_binary", "Tải lên Binary (.bin)")}
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setMode("source"); setError(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
              mode === "source"
                ? "bg-white text-primary shadow-sm dark:bg-surface-muted dark:text-primary"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Code className="h-3.5 w-3.5" />
              {t("ota:upload_modal.mode_source", "Biên dịch từ Source Code (.ino)")}
            </span>
          </button>
        </div>

        {/* Common metadata fields */}
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="label-xs">{t("ota:upload_modal.label_version", "Version *")}</span>
            <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.2.0" className="input mt-1" />
          </label>
          <label className="block">
            <span className="label-xs">{t("ota:upload_modal.label_hardware_model", "Hardware model *")}</span>
            <select 
              value={target} 
              onChange={(e) => setTarget(e.target.value)} 
              className="input mt-1"
              disabled={loadingModels}
            >
              <option value="">{t("ota:upload_modal.select_hardware_model", "-- Chọn Hardware model --")}</option>
              {models.map((m) => (
                <option key={m.id} value={m.key}>
                  {m.name} {m.platform ? `(${m.platform.name})` : ""}
                </option>
              ))}
            </select>
          </label>
          {mode === "source" ? (
            <label className="block">
              <span className="label-xs">{t("ota:upload_modal.label_board_fqbn", "Board FQBN *")}</span>
              <input value={boardFqbn} onChange={(e) => setBoardFqbn(e.target.value)} placeholder="esp32:esp32:esp32" className="input mt-1" />
            </label>
          ) : (
            <div />
          )}
        </div>

        {/* Release notes */}
        <label className="block">
          <span className="label-xs">{t("ota:upload_modal.label_release_notes", "Ghi chú phiên bản")}</span>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="input mt-1 h-auto py-1.5" />
        </label>

        {/* Binary mode upload file field */}
        {mode === "binary" && (
          <label className="block">
            <span className="label-xs">{t("ota:upload_modal.label_binary_file", "File binary *")}</span>
            <input
              type="file"
              accept=".bin"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block mt-1 text-sm text-slate-700 dark:text-text-secondary file:mr-3 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-900 file:shadow-sm hover:file:border-slate-300 hover:file:bg-slate-50 dark:file:border-slate-700 dark:file:bg-app dark:file:text-slate-100 dark:hover:file:border-slate-500 dark:hover:file:bg-surface"
            />
            {file && (
              <div className="text-[11px] text-slate-500 mt-1">{file.name} · {formatBytes(file.size)}</div>
            )}
          </label>
        )}

        {/* Source mode editor */}
        {mode === "source" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="label-xs">{t("ota:upload_modal.label_arduino_source", "Mã nguồn Arduino (.ino) *")}</span>
              <label className="text-xs text-primary hover:underline cursor-pointer flex items-center gap-1">
                <Upload className="h-3 w-3" /> {t("ota:upload_modal.upload_ino_file", "Tải lên tệp .ino")}
                <input
                  type="file"
                  accept=".ino"
                  onChange={handleSourceFileChange}
                  className="hidden"
                />
              </label>
            </div>
            
            <Suspense fallback={
              <div className="h-64 flex items-center justify-center bg-surface-elevated border border-border-subtle text-text-muted text-sm rounded-lg dark:bg-app">
                {t("ota:upload_modal.loading_editor", "Đang tải trình soạn thảo…")}
              </div>
            }>
              <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-border-subtle">
                <MonacoEditor
                  height="260px"
                  language="cpp"
                  theme="vs-dark"
                  value={sourceCode}
                  onChange={(val) => setSourceCode(val ?? "")}
                  options={{
                    fontSize: 13,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    lineNumbers: "on",
                    automaticLayout: true,
                  }}
                />
              </div>
            </Suspense>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="h-3.5 w-3.5 text-rose-500 mt-0.5 flex-shrink-0" />
            <pre className="text-xs text-rose-600 dark:text-rose-400 whitespace-pre-wrap break-all max-h-40 overflow-y-auto font-mono flex-1">{error}</pre>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Source code viewer modal ──────────────────────────────────────────────────

function SourceViewerModal({ firmware, onClose }: { firmware: Firmware; onClose: () => void }) {
  const { t } = useTranslation(["ota", "common"]);
  return (
    <Modal open onClose={onClose} title={t("ota:source_viewer.title", "Source code — {{version}}", { version: firmware.version })} size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          <span>{t("ota:source_viewer.target", "Target:")} <strong className="text-slate-700 dark:text-text-secondary">{firmware.target_device_type}</strong></span>
          <span>·</span>
          <span>{t("ota:source_viewer.type", "Loại:")} <strong className={firmware.source_type === "ino_compiled" ? "text-emerald-600" : "text-amber-600"}>
            {firmware.source_type === "ino_compiled" ? t("ota:source_viewer.compiled", "Đã biên dịch") : t("ota:source_viewer.not_compiled", "Chưa biên dịch")}
          </strong></span>
        </div>
        <Suspense fallback={
          <div className="h-96 flex items-center justify-center bg-surface-elevated border border-border-subtle text-text-muted text-sm rounded-lg dark:bg-app">
            {t("ota:source_viewer.loading", "Đang tải…")}
          </div>
        }>
          <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-border-subtle">
            <MonacoEditor
              height="420px"
              language="cpp"
              theme="vs-dark"
              value={firmware.source_code ?? ""}
              options={{
                readOnly: true,
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                lineNumbers: "on",
                automaticLayout: true,
              }}
            />
          </div>
        </Suspense>
      </div>
    </Modal>
  );
}

// ── Create OTA modal ──────────────────────────────────────────────────────────

function CreateOtaModal({
  open,
  onClose,
  onSuccess,
  devices,
  groups,
  firmware,
  initialDeviceUid = "",
  initialGroupId = "",
  initialFirmwareId = "",
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  devices: Device[];
  groups: DeviceGroup[];
  firmware: Firmware[];
  initialDeviceUid?: string;
  initialGroupId?: string;
  initialFirmwareId?: string;
}) {
  const { t } = useTranslation(["ota", "common"]);
  const [targetType, setTargetType] = useState<"device" | "group">(initialGroupId ? "group" : "device");
  const [deviceUid, setDeviceUid] = useState(initialDeviceUid);
  const [groupId, setGroupId] = useState(initialGroupId);
  const [firmwareId, setFirmwareId] = useState(initialFirmwareId);
  const [selectedHardwareModel, setSelectedHardwareModel] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [models, setModels] = useState<DeviceModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listClientDeviceModels()
      .then((data) => {
        if (!cancelled) setModels(data);
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Sync state when modal reopens with new initial values
  useEffect(() => {
    if (open) {
      setTargetType(initialGroupId ? "group" : "device");
      setDeviceUid(initialGroupId ? "" : initialDeviceUid);
      setGroupId(initialGroupId);
      setFirmwareId(initialFirmwareId);
      
      // Auto-select hardware model if initial device or firmware is provided
      if (initialDeviceUid) {
        const d = devices.find(x => x.device_uid === initialDeviceUid);
        if (d?.hardware_model) setSelectedHardwareModel(d.hardware_model);
      } else if (initialFirmwareId) {
        const f = firmware.find(x => x.id === initialFirmwareId);
        if (f?.target_device_type) setSelectedHardwareModel(f.target_device_type);
      } else {
        setSelectedHardwareModel("");
      }
      
      setError(null);
    }
  }, [open, initialDeviceUid, initialGroupId, initialFirmwareId, devices, firmware]);

  const mut = useMutation({
    mutationFn: () => {
      if (targetType === "device" && !deviceUid) throw new Error(t("ota:create_modal.err_device_required", "Select a device"));
      if (targetType === "group" && !groupId) throw new Error(t("ota:create_modal.err_group_required", "Select a device group"));
      if (!firmwareId) throw new Error(t("ota:create_modal.err_firmware_required", "Select a firmware version"));
      return createClientOtaJob(targetType === "device" ? deviceUid : null, firmwareId, targetType === "group" ? groupId : null);
    },
    onSuccess: () => {
      setDeviceUid(initialDeviceUid); setGroupId(""); setFirmwareId(""); setError(null);
      onSuccess();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("ota:create_modal.title", "Tạo chiến dịch OTA")}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">{t("ota:actions.cancel", "Huỷ")}</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !firmwareId || (targetType === "device" ? !deviceUid : !groupId)}
            className="btn-primary"
          >
            {mut.isPending ? t("ota:actions.creating", "Đang tạo…") : t("ota:actions.create_ota", "Tạo OTA")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-surface-elevated">
          <button
            type="button"
            onClick={() => { setTargetType("device"); setGroupId(""); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
              targetType === "device"
                ? "bg-white text-primary shadow-sm dark:bg-surface-muted dark:text-primary"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            {t("ota:create_modal.target_device", "Thiết bị")}
          </button>
          <button
            type="button"
            onClick={() => { setTargetType("group"); setDeviceUid(""); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
              targetType === "group"
                ? "bg-white text-primary shadow-sm dark:bg-surface-muted dark:text-primary"
                : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            {t("ota:create_modal.target_group", "Nhóm")}
          </button>
        </div>

        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{t("ota:create_modal.label_hardware_model", "Hardware model")}</span>
          <select
            className="input mt-1"
            value={selectedHardwareModel}
            onChange={(e) => {
              setSelectedHardwareModel(e.target.value);
              setDeviceUid("");
              setFirmwareId("");
            }}
            disabled={loadingModels}
          >
            <option value="">{t("ota:create_modal.all_hardware_models", "— Tất cả —")}</option>
            {models.map((m) => (
              <option key={m.id} value={m.key}>
                {m.name} {m.platform ? `(${m.platform.name})` : ""}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-slate-400 mt-1">
            {t("ota:create_modal.hardware_model_hint", "Chọn Hardware model để lọc danh sách thiết bị và firmware tương thích.")}
          </p>
        </label>

        {targetType === "device" ? (
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{t("ota:create_modal.label_device", "Thiết bị *")}</span>
            <select
              className="input mt-1"
              value={deviceUid}
              onChange={(e) => {
                setDeviceUid(e.target.value);
                // Auto-select hardware model if the chosen device has one
                const selected = devices.find(d => d.device_uid === e.target.value);
                if (selected?.hardware_model && !selectedHardwareModel) {
                  setSelectedHardwareModel(selected.hardware_model);
                }
              }}
            >
              <option value="">{t("ota:create_modal.select_device", "Chọn thiết bị")}</option>
              {devices
                .filter(d => !selectedHardwareModel || d.hardware_model?.toLowerCase() === selectedHardwareModel.toLowerCase())
                .map((d) => (
                <option key={d.id} value={d.device_uid}>
                  {d.name} ({d.device_uid}) {d.hardware_model ? `[${d.hardware_model}]` : ""}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{t("ota:create_modal.label_device_group", "Nhóm thiết bị *")}</span>
            <select
              className="input mt-1"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">{t("ota:create_modal.select_device_group", "Chọn nhóm thiết bị")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.device_count})
                </option>
              ))}
            </select>
            {groups.length === 0 && (
              <p className="text-xs text-slate-400 mt-1">
                {t("ota:create_modal.no_active_groups", "Không có nhóm thiết bị nào đang hoạt động.")}
              </p>
            )}
          </label>
        )}
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">{t("ota:create_modal.label_firmware_version", "Phiên bản firmware *")}</span>
          <select
            className="input mt-1"
            value={firmwareId}
            onChange={(e) => setFirmwareId(e.target.value)}
          >
            <option value="">{t("ota:create_modal.select_firmware", "— Chọn firmware —")}</option>
            {firmware
              .filter(f => !selectedHardwareModel || f.target_device_type.toLowerCase() === selectedHardwareModel.toLowerCase())
              .map((f) => (
              <option key={f.id} value={f.id}>
                {f.version} · {f.target_device_type}
              </option>
            ))}
          </select>
          {firmware.length === 0 && (
            <p className="text-xs text-slate-400 mt-1">
              {t("ota:create_modal.no_firmware_available", "Chưa có firmware. Hãy tải lên firmware trước.")}
            </p>
          )}
        </label>
        <div className="text-xs text-slate-500 bg-slate-50 dark:bg-surface-elevated rounded p-3">
          {t("ota:create_modal.ota_notice", "Sau khi tạo, lệnh OTA sẽ được gửi đến thiết bị qua MQTT. Thiết bị sẽ tải firmware và báo cáo tiến trình về hệ thống.")}
        </div>
        {error && <div className="text-xs text-rose-600">{error}</div>}
      </div>
    </Modal>
  );
}

