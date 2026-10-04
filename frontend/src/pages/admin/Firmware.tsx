import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Download, RefreshCw, Package, Search, Rocket, ShieldCheck, Trash2, Cpu, HardDrive } from "lucide-react";
import { bulkDeleteFirmware, listFirmware, previewRetention, runRetention, signFirmware, uploadFirmware } from "../../services/firmwareApi";
import { MetricCard } from "../../components/ui/MetricCard";
import { PageHeader } from "../../components/ui/PageHeader";
import { AdminSectionNav, ADMIN_FIRMWARE_SECTION_NAV } from "../../components/layout/AdminSectionNav";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { Modal } from "../../components/ui/Modal";
import { FirmwareVersionBadge } from "../../components/ui/FirmwareVersionBadge";
import { TenantCell } from "../../components/ui/TenantCell";
import { apiBaseUrl } from "../../services/apiClient";
import { formatBytes, formatDateTime, shortHash } from "../../lib/formatters";
import type { Firmware } from "../../types";

interface FirmwareProps {
  readOnly?: boolean;
  queryKey?: string[];
  queryFn?: () => Promise<Firmware[]>;
  showSectionNav?: boolean;
}

export function Firmware({
  readOnly = true,
  queryKey = ["firmware"],
  queryFn = () => listFirmware(),
  showSectionNav = true,
}: FirmwareProps = {}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [targetFilter, setTargetFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [retentionMessage, setRetentionMessage] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn,
    refetchInterval: 30_000,
  });

  const firmwares = data ?? [];

  const targets = useMemo(() => {
    const s = new Set<string>();
    firmwares.forEach((f) => s.add(f.target_device_type));
    return Array.from(s).sort();
  }, [firmwares]);

  const filtered = useMemo(() => {
    return firmwares.filter((f) => {
      if (targetFilter !== "all" && f.target_device_type !== targetFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${f.version} ${f.target_device_type} ${f.checksum_sha256 ?? ""} ${f.tenant?.name ?? ""} ${f.tenant?.slug ?? ""}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [firmwares, targetFilter, search]);

  const signMutation = useMutation({
    mutationFn: signFirmware,
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => bulkDeleteFirmware(Array.from(selectedIds)),
    onSuccess: (result) => {
      setSelectedIds(new Set());
      setRetentionMessage(`Đã xoá ${result.deleted_ids.length} firmware; ${result.protected.length} bản được bảo vệ.`);
      qc.invalidateQueries({ queryKey });
    },
  });
  const retentionPreviewMutation = useMutation({
    mutationFn: previewRetention,
    onSuccess: (result) => setRetentionMessage(`${result.candidate_count} firmware đủ điều kiện dọn dẹp; ${result.protected.length} bản được bảo vệ.`),
  });
  const retentionRunMutation = useMutation({
    mutationFn: runRetention,
    onSuccess: (result) => {
      setRetentionMessage(`Đã dọn ${result.deleted_ids.length} firmware; ${result.protected.length} bản được bảo vệ.`);
      qc.invalidateQueries({ queryKey });
    },
  });

  const columns: Column<Firmware>[] = [
    ...(!readOnly ? [{
      key: "select",
      header: "",
      render: (f: Firmware) => (
        <input
          type="checkbox"
          checked={selectedIds.has(f.id)}
          aria-label={`Chọn firmware ${f.version}`}
          onChange={(event) => setSelectedIds((current) => {
            const next = new Set(current);
            event.target.checked ? next.add(f.id) : next.delete(f.id);
            return next;
          })}
        />
      ),
    } as Column<Firmware>] : []),
    {
      key: "version",
      header: "Version",
      sortable: true,
      sortValue: (f) => f.version,
      render: (f) => {
        return (
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 shrink-0">
              <Package className="h-4 w-4" />
            </div>
            <div>
              <FirmwareVersionBadge version={f.version} channel={f.release_channel ?? "dev"} />
              {f.file_name && (
                <div className="text-[11px] font-mono text-slate-400 dark:text-text-muted mt-0.5">{f.file_name}</div>
              )}
            </div>
          </div>
        );
      },
    },
    {
      key: "signature",
      header: "Chữ ký",
      render: (f) => f.signature ? (
        <span className="inline-flex items-center gap-1 text-xs text-emerald-600" title={f.signing_key_id ?? ""}><ShieldCheck className="h-3.5 w-3.5" /> Đã ký</span>
      ) : <span className="text-xs text-amber-600">Chưa ký</span>,
    },
    {
      key: "target",
      header: "Target",
      sortable: true,
      sortValue: (f) => f.target_device_type,
      render: (f) => (
        <span className="chip bg-slate-100 text-slate-700 dark:bg-surface-elevated dark:text-text-secondary">
          {f.target_device_type}
        </span>
      ),
    },
    {
      key: "tenant",
      header: "Khách hàng",
      sortable: true,
      sortValue: (f) => f.tenant?.name ?? "",
      render: (f) => <TenantCell tenant={f.tenant} fallback="Firmware hệ thống" compact />,
    },
    {
      key: "size",
      header: "Kích thước",
      sortable: true,
      sortValue: (f) => f.file_size ?? 0,
      align: "right",
      render: (f) => <span className="text-xs tabular-nums">{formatBytes(f.file_size)}</span>,
    },
    {
      key: "sha",
      header: "SHA-256",
      render: (f) => (
        <span className="font-mono text-xs text-slate-500" title={f.checksum_sha256 ?? ""}>
          {shortHash(f.checksum_sha256, 12)}
        </span>
      ),
    },
    {
      key: "created",
      header: "Tải lên",
      sortable: true,
      sortValue: (f) => new Date(f.created_at).getTime(),
      render: (f) => <span className="text-xs text-slate-500">{formatDateTime(f.created_at)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (f) => (
        readOnly ? null : (
        <div className="inline-flex items-center gap-1">
          <a
            href={`${apiBaseUrl}/api/v1/firmware/${f.id}/download`}
            className="btn-ghost h-8 px-2 text-xs"
            title="Tải xuống"
          >
            <Download className="h-3.5 w-3.5" />
          </a>
          {!f.signature && (
            <button
              onClick={() => signMutation.mutate(f.id)}
              disabled={signMutation.isPending}
              className="btn-secondary h-8 px-2 text-xs"
              title="Ký firmware bằng Ed25519"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Ký
            </button>
          )}
          <button
            onClick={() => navigate(`/console/ota/new?firmware=${f.id}`)}
            className="btn-primary h-8 px-2 text-xs"
          >
            <Rocket className="h-3.5 w-3.5" /> OTA
          </button>
        </div>
        )
      ),
    },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      <PageHeader
        title="Firmware"
        subtitle={`${firmwares.length} phiên bản · ${targets.length} loại thiết bị`}
        actions={
          <>
            <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary">
              <RefreshCw className={isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Làm mới
            </button>
            {!readOnly && (
              <button onClick={() => setUploadOpen(true)} className="btn-primary">
                <Upload className="h-3.5 w-3.5" /> Tải lên firmware
              </button>
            )}
          </>
        }
      />

      {showSectionNav && <AdminSectionNav items={ADMIN_FIRMWARE_SECTION_NAV} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <MetricCard
          label="Tổng firmware"
          value={error ? "—" : firmwares.length}
          icon={<Package className="h-4 w-4" />}
          loading={isLoading}
        />
        <MetricCard
          label="Target phần cứng"
          value={error ? "—" : targets.length}
          icon={<Cpu className="h-4 w-4" />}
          loading={isLoading}
        />
        <MetricCard
          label="Đã ký bảo mật"
          value={error ? "—" : firmwares.filter((f) => !!f.signature).length}
          icon={<ShieldCheck className="h-4 w-4" />}
          tone="success"
          loading={isLoading}
        />
        <MetricCard
          label="Dung lượng lưu trữ"
          value={error ? "—" : formatBytes(firmwares.reduce((sum, firmware) => sum + (firmware.file_size ?? 0), 0))}
          icon={<HardDrive className="h-4 w-4" />}
          loading={isLoading}
        />
      </div>



      {!readOnly && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-border dark:bg-surface">
          <button className="btn-secondary" disabled={retentionPreviewMutation.isPending} onClick={() => retentionPreviewMutation.mutate()}>
            Xem trước retention
          </button>
          <button
            className="btn-secondary"
            disabled={retentionRunMutation.isPending}
            onClick={() => window.confirm("Chạy retention và xoá các firmware đủ điều kiện?") && retentionRunMutation.mutate()}
          >
            <Trash2 className="h-3.5 w-3.5" /> Chạy retention
          </button>
          <button
            className="btn-secondary text-rose-600"
            disabled={selectedIds.size === 0 || deleteMutation.isPending}
            onClick={() => window.confirm(`Xoá ${selectedIds.size} firmware đã chọn? Các bản đang được sử dụng sẽ được bảo vệ.`) && deleteMutation.mutate()}
          >
            <Trash2 className="h-3.5 w-3.5" /> Xoá đã chọn ({selectedIds.size})
          </button>
          {retentionMessage && <span className="text-xs text-slate-500">{retentionMessage}</span>}
          {(signMutation.error || deleteMutation.error || retentionRunMutation.error) && (
            <span className="text-xs text-rose-600">{((signMutation.error || deleteMutation.error || retentionRunMutation.error) as Error).message}</span>
          )}
        </div>
      )}

      <DataTable
        data={filtered}
        columns={columns}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        rowKey={(f) => f.id}
        emptyTitle="Chưa có firmware nào"
        emptyDescription="Tải lên file .bin/.elf đầu tiên để bắt đầu phát hành OTA."
        toolbar={
          <>
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo version, hash…"
                className="input pl-9"
              />
            </div>
            <select
              className="input h-9 w-auto"
              value={targetFilter}
              onChange={(e) => setTargetFilter(e.target.value)}
            >
              <option value="all">Tất cả target</option>
              {targets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className="ml-auto inline-flex items-center gap-2 text-xs text-slate-500">
              <Package className="h-3.5 w-3.5" />
              {filtered.length} bản
            </div>
          </>
        }
      />

      {!readOnly && (
        <FirmwareUploadModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onSuccess={() => {
            setUploadOpen(false);
            qc.invalidateQueries({ queryKey: ["firmware"] });
          }}
        />
      )}
    </div>
  );
}

function FirmwareUploadModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [version, setVersion] = useState("");
  const [target, setTarget] = useState("esp32");
  const [notes, setNotes] = useState("");
  const [channel, setChannel] = useState<"dev" | "staging" | "stable">("dev");
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("Vui lòng chọn file firmware");
      return uploadFirmware({
        version,
        targetDeviceType: target,
        releaseNotes: notes || undefined,
        releaseChannel: channel,
        verificationRequired: channel === "stable" || verificationRequired,
        file,
      });
    },
    onSuccess: () => {
      setVersion("");
      setNotes("");
      setFile(null);
      setError(null);
      onSuccess();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tải lên firmware mới"
      size="md"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Huỷ</button>
          <button
            onClick={() => mut.mutate()}
            disabled={mut.isPending || !version || !target || !file}
            className="btn-primary"
          >
            {mut.isPending ? "Đang tải…" : "Tải lên"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Version</span>
            <input
              required
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.2.0"
              className="input mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Target</span>
            <input
              required
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="esp32"
              className="input mt-1"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Release channel
          </span>
          <select
            className="input mt-1"
            value={channel}
            onChange={(e) => setChannel(e.target.value as "dev" | "staging" | "stable")}
          >
            <option value="dev">dev</option>
            <option value="staging">staging</option>
            <option value="stable">stable</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={channel === "stable" || verificationRequired}
            disabled={channel === "stable"}
            onChange={(e) => setVerificationRequired(e.target.checked)}
          />
          Bắt buộc thiết bị xác minh chữ ký trước khi cài đặt
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Release notes</span>
          <textarea
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="input mt-1 h-auto py-2"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wider text-slate-500">File binary</span>
          <input
            required
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block mt-1 text-sm text-slate-700 dark:text-text-secondary file:mr-3 file:rounded-md file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-900 file:shadow-sm hover:file:border-slate-300 hover:file:bg-slate-50 dark:file:border-slate-700 dark:file:bg-app dark:file:text-slate-100 dark:hover:file:border-slate-500 dark:hover:file:bg-surface"
          />
          {file && (
            <div className="text-[11px] text-slate-500 mt-1">
              {file.name} · {formatBytes(file.size)}
            </div>
          )}
        </label>
        {error && <div className="text-xs text-rose-600">{error}</div>}
      </div>
    </Modal>
  );
}
