import { usePagination } from "../../../hooks/usePagination";
import { PaginationBar } from "../../../components/ui/PaginationBar";
import { useState, useCallback, useRef, useEffect } from 'react';
import { usePersistedState } from '../../../hooks/usePersistedState';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { provisioningApi, ProvisioningSession, ClaimCodeCreateData } from '../../../services/provisioningApi';
import { DataTable, type Column } from '../../../components/ui/DataTable';
import { Modal } from '../../../components/ui/Modal';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { statusToTone, statusLabel } from '../../../lib/statusHelper';
import { Copy, Eye, Plus, QrCode, Search, XCircle, CheckCircle, Clock, Shield, LayoutGrid, List, ArrowRight, Calendar, MoreVertical } from 'lucide-react';
import { MetricCard } from '../../../components/ui/MetricCard';
import { PageHeader } from '../../../components/ui/PageHeader';
import { ClientSectionNav, DEVICES_SECTION_NAV } from '../../../components/layout/ClientSectionNav';
import { ReadOnlyNotice } from '../../../components/permissions/PermissionGate';
import { useAuth } from '../../../contexts/AuthContext';
import { canManageDevices } from '../../../lib/permissions';
import { cn } from '../../../lib/cn';
import { Card, CardBody, CardHeader, CardTitle } from '../../../components/ui/Card';

/* ─────────────────────────── helpers ─────────────────────────── */

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

function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('vi-VN');
}

/* ─────────────────── status icon helper ─────────────────── */

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return <Clock className="h-4 w-4 text-blue-500" />;
    case 'claimed':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'expired':
      return <XCircle className="h-4 w-4 text-yellow-500" />;
    case 'revoked':
      return <Shield className="h-4 w-4 text-red-500" />;
    default:
      return null;
  }
}

// ─── Actions Dropdown Menu ───────────────────────────────────────────────────

interface ProvisioningActionsProps {
  session: ProvisioningSession;
  canManage: boolean;
  onView: () => void;
  onShowQr: () => void;
  onRevoke: () => void;
  onCopy: () => void;
  copied: boolean;
}

function ProvisioningActionsMenu({
  session,
  canManage,
  onView,
  onShowQr,
  onRevoke,
  onCopy,
  copied,
}: ProvisioningActionsProps) {
  const { t } = useTranslation(["devices", "common"]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        className="btn-ghost h-7 w-7 p-0"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={t("common:col.actions", "Thao tác")}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-border-subtle dark:bg-surface"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-text-secondary dark:hover:bg-surface-elevated"
            onClick={() => {
              setOpen(false);
              onView();
            }}
          >
            <Eye className="h-3.5 w-3.5" />
            {t("devices:provisioning.view_detail", "Xem chi tiết")}
          </button>
          {session.claim_code && (
            <>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-text-secondary dark:hover:bg-surface-elevated"
                onClick={() => {
                  setOpen(false);
                  onShowQr();
                }}
              >
                <QrCode className="h-3.5 w-3.5" />
                {t("devices:provisioning.show_qr", "Hiển thị QR")}
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 dark:text-text-secondary dark:hover:bg-surface-elevated"
                onClick={() => {
                  setOpen(false);
                  onCopy();
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? t("common:actions.copied", "Đã sao chép!") : t("devices:provisioning.copy_code", "Sao chép mã")}
              </button>
            </>
          )}
          {canManage && session.status === 'pending' && (
            <>
              <div className="my-1 border-t border-slate-100 dark:border-border-subtle" />
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/30"
                onClick={() => {
                  setOpen(false);
                  onRevoke();
                }}
              >
                <XCircle className="h-3.5 w-3.5" />
                {t("devices:provisioning.revoke_code", "Thu hồi mã")}
              </button>
            </>
          )}
        </div>
      )}
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

// ─── Grid Card Component ─────────────────────────────────────────────────────

interface ProvisioningCardProps {
  session: ProvisioningSession;
  logoColor: string;
  canManage: boolean;
  onView: () => void;
  onShowQr: () => void;
  onRevoke: () => void;
  onCopy: () => void;
  copied: boolean;
}

function ProvisioningCard({
  session,
  logoColor,
  canManage,
  onView,
  onShowQr,
  onRevoke,
  onCopy,
  copied,
}: ProvisioningCardProps) {
  const { t } = useTranslation(["devices", "common"]);
  const statusTone = statusToTone(session.status);
  const statusText = statusLabel(session.status);
  const statusColor =
    statusTone === 'success' ? 'text-emerald-600 dark:text-emerald-400 font-medium' :
    statusTone === 'danger' ? 'text-rose-600 dark:text-rose-400 font-medium' :
    statusTone === 'warning' ? 'text-amber-600 dark:text-amber-400 font-medium' :
    'text-slate-500 dark:text-text-muted font-medium';
  const statusDot =
    statusTone === 'success' ? 'bg-emerald-500' :
    statusTone === 'danger' ? 'bg-rose-500' :
    statusTone === 'warning' ? 'bg-amber-500' :
    'bg-slate-400 dark:bg-text-muted';

  return (
    <Card className="group relative overflow-hidden flex h-full flex-col border border-slate-200/80 bg-white shadow-sm transition-all duration-150 hover:border-slate-400 hover:bg-slate-50/40 dark:border-border-subtle dark:bg-surface dark:hover:border-slate-700 dark:hover:bg-surface-elevated/40">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm",
            logoColor,
          )}
        >
          PR
        </div>

        <div className="min-w-0 flex-1">
          <CardTitle className="truncate text-base font-mono">
            {session.claim_code ? session.claim_code.substring(0, 8) : t("devices:provisioning.col_claim_code", "Mã claim")}
          </CardTitle>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            <span className={cn("h-1.5 w-1.5 rounded-full", statusDot)} />
            <span className={statusColor}>{statusText}</span>
          </div>
        </div>

        <ProvisioningActionsMenu
          session={session}
          canManage={canManage}
          onView={onView}
          onShowQr={onShowQr}
          onRevoke={onRevoke}
          onCopy={onCopy}
          copied={copied}
        />
      </CardHeader>
      <CardBody>
        <p className="min-h-[2.5rem] text-xs text-slate-500 dark:text-text-muted font-mono break-all leading-normal">
          {session.claim_code || t("devices:provisioning.no_code", "Không có mã")}
        </p>

        {/* Labeled detail properties */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 py-2.5 my-3 border-y border-slate-100 dark:border-border-subtle text-xs text-slate-600 dark:text-text-secondary">
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("common:status.label", "Trạng thái")}</span>
            <span className={cn("inline-flex items-center gap-1.5 font-medium", statusColor)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", statusDot)} />
              {statusText}
            </span>
          </div>
          <div>
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("devices:provisioning.col_expires", "Hết hạn")}</span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-text-primary">
              <Clock className="h-3.5 w-3.5" />
              {formatDate(session.expires_at)}
            </span>
          </div>
          <div className="col-span-2">
            <span className="text-slate-400 dark:text-text-disabled block uppercase tracking-[0.05em] text-[10px]">{t("devices:provisioning.col_created", "Tạo lúc")}</span>
            <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-text-primary">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(session.created_at)}
            </span>
          </div>
        </div>

        <button
          className="btn-primary mt-4 w-full"
          onClick={onView}
        >
          {t("devices:provisioning.view_details_arrow", "Xem chi tiết →")}
        </button>
      </CardBody>
    </Card>
  );
}

// ─── List Row Component ──────────────────────────────────────────────────────

function ProvisioningListRow({
  session,
  logoColor,
  canManage,
  onView,
  onShowQr,
  onRevoke,
  onCopy,
  copied,
}: ProvisioningCardProps) {
  const { t } = useTranslation(["devices", "common"]);
  const statusTone = statusToTone(session.status);
  const statusText = statusLabel(session.status);
  const statusColor =
    statusTone === 'success' ? 'text-emerald-600 dark:text-emerald-400 font-medium' :
    statusTone === 'danger' ? 'text-rose-600 dark:text-rose-400 font-medium' :
    statusTone === 'warning' ? 'text-amber-600 dark:text-amber-400 font-medium' :
    'text-slate-500 dark:text-text-muted font-medium';
  const statusDot =
    statusTone === 'success' ? 'bg-emerald-500' :
    statusTone === 'danger' ? 'bg-rose-500' :
    statusTone === 'warning' ? 'bg-amber-500' :
    'bg-slate-400 dark:bg-text-muted';

  return (
    <div className="group relative flex flex-col md:flex-row md:items-center gap-3 md:gap-4 border-b border-slate-100 dark:border-border-subtle px-4 py-3 hover:bg-slate-50/60 dark:hover:bg-surface-elevated/50 transition-colors">
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-sm mx-auto md:mx-0",
          logoColor,
        )}
      >
        PR
      </div>

      {/* Claim code */}
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary font-mono">
          {session.claim_code ? `${session.claim_code.substring(0, 16)}…` : '—'}
        </span>
        <span className="block truncate text-[11px] text-slate-400">{t("devices:provisioning.claim_code_label", "Mã cấp phát thiết bị")}</span>
      </div>

      {/* Status */}
      <div className="w-full md:w-32 flex items-center gap-1.5 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("common:status.label_colon", "Trạng thái:")}</span>
        <span className={cn("h-1.5 w-1.5 rounded-full", statusDot)} />
        <span className={statusColor}>{statusText}</span>
      </div>

      {/* Expires */}
      <div className="w-full md:w-44 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:provisioning.expires_colon", "Hết hạn:")}</span>
        <span className="font-medium text-slate-700 dark:text-text-primary">{formatDate(session.expires_at)}</span>
      </div>

      {/* Created */}
      <div className="w-full md:w-44 text-xs">
        <span className="md:hidden text-slate-400 text-[10px] uppercase mr-1">{t("devices:provisioning.created_colon", "Tạo lúc:")}</span>
        <span className="font-medium text-slate-600 dark:text-text-muted">{formatDate(session.created_at)}</span>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center justify-end gap-1 w-full md:w-24 border-t md:border-t-0 pt-2 md:pt-0">
        <button
          className="btn-primary flex items-center gap-1 px-2.5 py-1.5 text-xs"
          onClick={onView}
        >
          {t("common:view_details_short", "Chi tiết")}
          <ArrowRight className="h-3 w-3" />
        </button>
        <ProvisioningActionsMenu
          session={session}
          canManage={canManage}
          onView={onView}
          onShowQr={onShowQr}
          onRevoke={onRevoke}
          onCopy={onCopy}
          copied={copied}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════ MAIN PAGE ═══════════════════════════ */

export default function ClientProvisioning() {
  const { t } = useTranslation(["devices", "common"]);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = canManageDevices(user);
  const [showCreate, setShowCreate] = useState(false);
  const [showClaim, setShowClaim] = useState(false);
  const [detailSession, setDetailSession] = useState<ProvisioningSession | null>(null);
  const [qrSession, setQrSession] = useState<ProvisioningSession | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [viewMode, setViewMode] = usePersistedState<"grid" | "list">("aifom_clientprovisioning_view", 'grid', "local");

  const { data, isLoading } = useQuery({
    queryKey: ['provisioning-sessions'],
    queryFn: () => provisioningApi.listSessions(),
  });

  const createMutation = useMutation({
    mutationFn: (data: ClaimCodeCreateData) => provisioningApi.createClaimCode(data),
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: ['provisioning-sessions'] });
      setShowCreate(false);
      // Show detail modal immediately after creation
      setDetailSession(newSession);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => provisioningApi.revokeClaim(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['provisioning-sessions'] });
      setDetailSession(null);
    },
  });

  const handleCopy = useCallback(async (text: string, id: string) => {
    await copyToClipboard(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const allSessions = data?.items || [];
  const sessions = filterStatus ? allSessions.filter(s => s.status === filterStatus) : allSessions;
  const PAGE_SIZE = 12;
  const { page, setPage, totalPages, pagedItems: pagedSessions } = usePagination(sessions, PAGE_SIZE, [filterStatus]);

  const columns: Column<ProvisioningSession>[] = [
    {
      key: 'claim_code',
      header: t("devices:provisioning.col_claim_code", "Mã claim"),
      render: (s) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm max-w-[180px] truncate" title={s.claim_code ?? ''}>
            {s.claim_code ? `${s.claim_code.substring(0, 16)}…` : '-'}
          </span>
          {s.claim_code && (
            <button
              onClick={(e) => { e.stopPropagation(); handleCopy(s.claim_code!, s.id); }}
              className="btn-ghost h-7 w-7 p-0"
              title={t("devices:provisioning.copy_code", "Sao chép mã")}
            >
              {copiedId === s.id ? (
                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: t("common:status.label", "Trạng thái"),
      render: (s) => <StatusBadge tone={statusToTone(s.status)} label={statusLabel(s.status)} />,
    },
    {
      key: 'expires_at',
      header: t("devices:provisioning.col_expires", "Hết hạn"),
      render: (s) => <span className="text-sm">{formatDate(s.expires_at)}</span>,
    },
    {
      key: 'claimed_at',
      header: t("devices:provisioning.col_claimed", "Claim lúc"),
      render: (s) => <span className="text-sm">{formatDate(s.claimed_at)}</span>,
    },
    {
      key: 'created_at',
      header: t("devices:provisioning.col_created", "Tạo lúc"),
      render: (s) => <span className="text-sm">{formatDate(s.created_at)}</span>,
    },
    {
      key: 'actions',
      header: t("common:col.actions", "Thao tác"),
      render: (s) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost h-8 w-8 p-0 text-slate-500"
            title={t("devices:provisioning.view_detail", "Xem chi tiết")}
            onClick={(e) => { e.stopPropagation(); setDetailSession(s); }}
          >
            <Eye className="h-4 w-4" />
          </button>
          {s.claim_code && (
            <button
              type="button"
              className="btn-ghost h-8 w-8 p-0 text-slate-500"
              title={t("devices:provisioning.show_qr", "Hiển thị QR")}
              onClick={(e) => { e.stopPropagation(); setQrSession(s); }}
            >
              <QrCode className="h-4 w-4" />
            </button>
          )}
          {canManage && s.status === 'pending' && (
            <button
              type="button"
              className="btn-ghost h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
              title={t("devices:provisioning.revoke_code", "Thu hồi mã")}
              onClick={(e) => { e.stopPropagation(); revokeMutation.mutate(s.id); }}
            >
              <XCircle className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-4">
      <PageHeader
        title={t("devices:provisioning.title", "Cấp phát thiết bị")}
        subtitle=""
      />

      <ClientSectionNav 
        items={DEVICES_SECTION_NAV} 
        actions={
          canManage ? (
            <div className="flex items-center gap-2">
              <button onClick={() => setShowClaim(true)} className="btn-secondary flex items-center gap-1.5 text-xs h-8 px-3">
                <Shield className="h-3.5 w-3.5" />
                {t("devices:provisioning.claim_device", "Claim thiết bị")}
              </button>
              <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5 text-xs h-8 px-3">
                <Plus className="h-3.5 w-3.5" />
                {t("devices:provisioning.create_claim_code", "Tạo mã claim")}
              </button>
            </div>
          ) : undefined
        }
      />

      {!canManage && <div className="mb-6"><ReadOnlyNotice /></div>}

      {/* ── Toolbar (Search, Filter, ViewMode Toggle) ─────────────────────────── */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end border-b border-slate-200/80 dark:border-border-subtle pb-4 pt-1">
        <div className="flex items-center gap-2">
          <div className="scrollbar-hide flex items-center gap-1 overflow-x-auto">
            {[
              { key: "", label: t("common:actions.all", "Tất cả") },
              { key: "pending", label: t("devices:status.pending", "Đang chờ") },
              { key: "claimed", label: t("devices:status.claimed", "Đã claim") },
              { key: "expired", label: t("devices:status.expired", "Hết hạn") },
              { key: "revoked", label: t("devices:status.revoked", "Đã thu hồi") },
            ].map((f) => (
              <button
                key={f.key}
                className={cn(
                  "chip whitespace-nowrap transition-colors",
                  filterStatus === f.key
                    ? "bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-surface-elevated dark:text-text-muted dark:hover:bg-surface-muted",
                )}
                onClick={() => setFilterStatus(f.key)}
              >
                {f.label} ({f.key === "" ? allSessions.length : allSessions.filter((s) => s.status === f.key).length})
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-border p-0.5 bg-surface-elevated">
            <button
              aria-label={t("devices:provisioning.list_view", "Dạng danh sách")}
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
              aria-label={t("devices:provisioning.grid_view", "Dạng lưới")}
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
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : allSessions.length === 0 ? (
        <div className="card py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.05]">
            <Shield className="h-6 w-6 text-slate-400" />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-slate-800 dark:text-text-primary">
            {t("devices:provisioning.no_sessions_title", "Chưa có phiên cấp phát nào")}
          </h3>
          <p className="mt-2 text-xs text-slate-500 dark:text-text-muted max-w-sm mx-auto">
            {t("devices:provisioning.no_sessions_desc", "Tạo mã claim đầu tiên để cấp phát thiết bị cho tenant này.")}
          </p>
          {canManage && (
            <div className="mt-6 flex gap-2 justify-center">
              <button onClick={() => setShowClaim(true)} className="btn-secondary flex items-center gap-1.5 text-xs h-8 px-3">
                <Shield className="h-3.5 w-3.5" /> {t("devices:provisioning.claim_device", "Claim thiết bị")}
              </button>
              <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-1.5 text-xs h-8 px-3">
                <Plus className="h-3.5 w-3.5" /> {t("devices:provisioning.create_claim_code", "Tạo mã claim")}
              </button>
            </div>
          )}
        </div>
      ) : sessions.length === 0 ? (
        <div className="card py-12 text-center">
          <p className="text-sm text-slate-500">
            {t("devices:provisioning.no_filtered_sessions", "Không có phiên cấp phát nào khớp với bộ lọc.")}
          </p>
          <button
            className="btn-ghost mt-2 text-sm"
            onClick={() => setFilterStatus("")}
          >
            {t("common:actions.clear_filter", "Xóa bộ lọc")}
          </button>
        </div>
      ) : viewMode === "list" ? (
        <Card className="p-0 overflow-hidden flex flex-col flex-1">
          <div className="overflow-x-auto">
            <div className="flex flex-col md:min-w-[960px]">
              {/* Table column headings */}
              <div className="hidden md:flex items-center gap-4 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-text-secondary bg-slate-100/75 dark:bg-surface-elevated/70 border-b border-slate-200 dark:border-border-subtle shrink-0">
                <div className="w-10 text-center">{t("common:col.logo", "Logo")}</div>
                <div className="flex-1">{t("devices:provisioning.col_claim_code", "Mã claim")}</div>
                <div className="w-32">{t("common:status.label", "Trạng thái")}</div>
                <div className="w-44">{t("devices:provisioning.col_expires", "Hết hạn")}</div>
                <div className="w-44">{t("devices:provisioning.col_created", "Tạo lúc")}</div>
                <div className="w-24 text-right">{t("common:col.actions", "Thao tác")}</div>
              </div>

              {pagedSessions.map((s) => (
                <ProvisioningListRow
                  key={s.id}
                  session={s}
                  logoColor={getLogoColor(s.id)}
                  canManage={canManage}
                  onView={() => setDetailSession(s)}
                  onShowQr={() => setQrSession(s)}
                  onRevoke={() => revokeMutation.mutate(s.id)}
                  onCopy={() => handleCopy(s.claim_code || "", s.id)}
                  copied={copiedId === s.id}
                />
              ))}
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pagedSessions.map((s) => (
            <ProvisioningCard
              key={s.id}
              session={s}
              logoColor={getLogoColor(s.id)}
              canManage={canManage}
              onView={() => setDetailSession(s)}
              onShowQr={() => setQrSession(s)}
              onRevoke={() => revokeMutation.mutate(s.id)}
              onCopy={() => handleCopy(s.claim_code || "", s.id)}
              copied={copiedId === s.id}
            />
          ))}
        </div>
      )}
      {sessions.length > 0 && <PaginationBar page={page} totalPages={totalPages} totalItems={sessions.length} pageSize={PAGE_SIZE} onPrev={() => setPage(page - 1)} onNext={() => setPage(page + 1)} /> }

      {/* Create Claim Code Modal */}
      <CreateClaimModal
        open={showCreate}
        onClose={() => { setShowCreate(false); createMutation.reset(); }}
        onSubmit={(data) => createMutation.mutate(data)}
        isLoading={createMutation.isPending}
        error={createMutation.error?.message}
      />

      {/* Claim Device Modal */}
      <ClaimDeviceModal
        open={showClaim}
        onClose={() => setShowClaim(false)}
      />

      {/* Detail Modal */}
      {detailSession && (
        <ClaimDetailModal
          session={detailSession}
          onClose={() => setDetailSession(null)}
          onShowQr={() => { setQrSession(detailSession); setDetailSession(null); }}
          onRevoke={(id) => revokeMutation.mutate(id)}
          canManage={canManage}
          onCopy={handleCopy}
          copiedId={copiedId}
          isRevoking={revokeMutation.isPending}
        />
      )}

      {/* QR Modal */}
      {qrSession && (
        <QRModal
          session={qrSession}
          onClose={() => setQrSession(null)}
          onCopy={handleCopy}
          copiedId={copiedId}
        />
      )}
    </div>
  );
}

/* ═══════════════════ CREATE CLAIM MODAL ═══════════════════════ */

function CreateClaimModal({ open, onClose, onSubmit, isLoading, error }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ClaimCodeCreateData) => void;
  isLoading: boolean;
  error?: string | null;
}) {
  const { t } = useTranslation(["devices", "common"]);
  const [deviceId, setDeviceId] = useState('');
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [localError, setLocalError] = useState('');

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    const trimmedId = deviceId.trim();
    if (trimmedId && !UUID_RE.test(trimmedId)) {
      setLocalError(t("devices:provisioning.err_invalid_uuid", "ID thiết bị phải là UUID hợp lệ (ví dụ: 550e8400-e29b-41d4-a716-446655440000)"));
      return;
    }
    if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 720) {
      setLocalError(t("devices:provisioning.err_invalid_hours", "Thời hạn phải là số nguyên từ 1 đến 720 giờ."));
      return;
    }
    onSubmit({
      device_id: trimmedId || undefined,
      expires_in_hours: expiresInHours,
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={t("devices:provisioning.create_modal_title", "Tạo mã claim")}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t("devices:provisioning.field_device_id", "ID thiết bị (tùy chọn)")}</label>
          <input
            type="text"
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="input w-full"
            placeholder={t("devices:provisioning.device_id_placeholder", "UUID thiết bị (để trống nếu chưa có)")}  />
          <p className="mt-1 text-xs text-slate-500 dark:text-text-muted">
            {t("devices:provisioning.uuid_hint", "Định dạng UUID. Để trống nếu muốn tạo mã claim trước khi gán thiết bị.")}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("devices:provisioning.field_expires_hours", "Thời hạn (giờ)")}</label>
          <input
            type="number"
            value={expiresInHours}
            onChange={(e) => setExpiresInHours(Number(e.target.value))}
            min={1}
            max={720}
            className="input w-full"
          />
          <p className="mt-1 text-xs text-slate-500 dark:text-text-muted">{t("devices:provisioning.expires_hint", "Tối thiểu 1 giờ, tối đa 720 giờ (30 ngày).")}</p>
        </div>
        {(localError || error) && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
            <p className="text-sm text-rose-800 dark:text-rose-300">{localError || error}</p>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-4">
          <button type="button" onClick={onClose} className="btn-secondary">{t("common:actions.cancel", "Hủy")}</button>
          <button type="submit" disabled={isLoading} className="btn-primary">
            {isLoading ? t("devices:provisioning.creating", "Đang tạo...") : t("devices:provisioning.create_code_btn", "Tạo mã")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ═══════════════════ CLAIM DEVICE MODAL ═══════════════════════ */

function ClaimDeviceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation(["devices", "common"]);
  const queryClient = useQueryClient();
  const [claimCode, setClaimCode] = useState('');
  const [result, setResult] = useState<ProvisioningSession | null>(null);
  const [error, setError] = useState('');

  const claimMutation = useMutation({
    mutationFn: (code: string) => provisioningApi.claimDevice(code),
    onSuccess: (data) => {
      setResult(data);
      setError('');
      queryClient.invalidateQueries({ queryKey: ['provisioning-sessions'] });
    },
    onError: (err: Error) => {
      // Extract the meaningful message from the API error
      const msg = err.message.replace(/^\d+\s*/, ''); // Strip status code prefix
      setError(msg);
      setResult(null);
    },
  });

  const handleClose = () => {
    setClaimCode('');
    setResult(null);
    setError('');
    claimMutation.reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title={t("devices:provisioning.claim_modal_title", "Claim thiết bị")}>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">{t("devices:provisioning.col_claim_code", "Mã claim")}</label>
          <input
            type="text"
            value={claimCode}
            onChange={(e) => setClaimCode(e.target.value)}
            className="input w-full font-mono"
            placeholder={t("devices:provisioning.claim_code_placeholder", "Nhập mã claim...")}
          />
        </div>
        <button
          onClick={() => claimMutation.mutate(claimCode)}
          disabled={claimMutation.isPending || !claimCode.trim()}
          className="btn-primary w-full"
        >
          {claimMutation.isPending ? t("devices:provisioning.claiming", "Đang claim...") : t("devices:provisioning.claim_device", "Claim thiết bị")}
        </button>

        {result && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 rounded-lg space-y-2">
            <p className="font-medium text-green-800 dark:text-green-300">{t("devices:provisioning.claim_success", "Claim thành công!")}</p>
            <p className="text-sm text-green-600 dark:text-green-400">
              {t("devices:provisioning.claim_success_desc", "Thiết bị đã được gán vào tenant của bạn.")}
            </p>
            {result.device_name && (
              <p className="text-sm text-green-600">{t("devices:provisioning.device_label", "Thiết bị:")} {result.device_name}</p>
            )}
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-lg space-y-1">
            <p className="font-medium text-red-800 dark:text-red-300">{t("devices:provisioning.claim_failed", "Claim thất bại")}</p>
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ═══════════════════ DETAIL MODAL ═══════════════════════════ */

function ClaimDetailModal({ session, onClose, onShowQr, onRevoke, onCopy, copiedId, isRevoking, canManage }: {
  session: ProvisioningSession;
  onClose: () => void;
  onShowQr: () => void;
  onRevoke: (id: string) => void;
  onCopy: (text: string, id: string) => Promise<void>;
  copiedId: string | null;
  isRevoking: boolean;
  canManage: boolean;
}) {
  const { t } = useTranslation(["devices", "common"]);
  const rows = [
    { label: t("devices:provisioning.col_claim_code", "Mã claim"), value: session.claim_code ?? '-', copyable: !!session.claim_code },
    { label: t("devices:provisioning.col_status", "Trạng thái"), value: statusLabel(session.status), badge: true },
    { label: t("devices:provisioning.col_device", "Thiết bị"), value: session.device_name || session.device_id || '-' },
    { label: t("devices:provisioning.col_expires_at", "Hết hạn"), value: formatDate(session.expires_at) },
    { label: t("devices:provisioning.col_claimed_at", "Claim lúc"), value: formatDate(session.claimed_at) },
    { label: t("devices:provisioning.col_created_at", "Tạo lúc"), value: formatDate(session.created_at) },
  ];

  return (
    <Modal open={true} onClose={onClose} title={t("devices:provisioning.detail_modal_title", "Chi tiết mã claim")} size="lg">
      <div className="space-y-4">
        {/* Status banner */}
        <div className={`flex items-center gap-3 p-4 rounded-lg ${
          session.status === 'pending' ? 'bg-blue-50 dark:bg-blue-900/20' :
          session.status === 'claimed' ? 'bg-green-50 dark:bg-green-900/20' :
          session.status === 'expired' ? 'bg-yellow-50 dark:bg-yellow-900/20' :
          'bg-red-50 dark:bg-red-900/20'
        }`}>
          <StatusIcon status={session.status} />
          <div>
            <p className="font-medium text-slate-800 dark:text-text-secondary">
              {statusLabel(session.status)}
            </p>
            <p className="text-xs text-slate-500 dark:text-text-muted">
              {session.status === 'pending' && t("devices:provisioning.status_hint_pending", "Mã này có thể được sử dụng để claim thiết bị.")}
              {session.status === 'claimed' && t("devices:provisioning.status_hint_claimed", "Mã này đã được sử dụng.")}
              {session.status === 'expired' && t("devices:provisioning.status_hint_expired", "Mã này đã hết hạn sử dụng.")}
              {session.status === 'revoked' && t("devices:provisioning.status_hint_revoked", "Mã này đã bị thu hồi.")}
            </p>
          </div>
        </div>

        {/* Info rows */}
        <div className="divide-y divide-slate-100 dark:divide-border-subtle">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between py-3">
              <span className="text-sm text-slate-500 dark:text-text-muted">{row.label}</span>
              <div className="flex items-center gap-2">
                {row.badge ? (
                  <StatusBadge tone={statusToTone(session.status)} label={row.value} />
                ) : (
                  <span className="text-sm font-mono text-slate-800 dark:text-text-secondary max-w-[300px] truncate" title={row.value}>
                    {row.value}
                  </span>
                )}
                {row.copyable && (
                  <button
                    onClick={() => onCopy(session.claim_code!, `detail-${session.id}`)}
                    className="btn-ghost h-8 w-8 p-0"
                    title={t("devices:provisioning.copy_btn", "Sao chép")}
                  >
                    {copiedId === `detail-${session.id}` ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-4 border-t border-slate-200 dark:border-border-subtle">
          {session.claim_code && (
            <button
              onClick={onShowQr}
              className="btn-secondary text-violet-600 dark:text-violet-300"
            >
              <QrCode className="h-4 w-4" />
              {t("devices:provisioning.show_qr_btn", "Hiển thị QR")}
            </button>
          )}
          {canManage && session.status === 'pending' && (
            <button
              onClick={() => onRevoke(session.id)}
              disabled={isRevoking}
              className="btn-secondary text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"
            >
              <XCircle className="h-4 w-4" />
              {isRevoking ? t("devices:provisioning.revoking", "Đang thu hồi...") : t("devices:provisioning.revoke_code", "Thu hồi mã")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/* ═══════════════════ QR MODAL ═══════════════════════════════ */

function QRModal({ session, onClose, onCopy, copiedId }: {
  session: ProvisioningSession;
  onClose: () => void;
  onCopy: (text: string, id: string) => Promise<void>;
  copiedId: string | null;
}) {
  const { t } = useTranslation(["devices", "common"]);
  const qrPayload = JSON.stringify({
    type: 'aifom_claim',
    claim_code: session.claim_code,
  });

  return (
    <Modal open={true} onClose={onClose} title={t("devices:provisioning.qr_modal_title", "QR Code — Mã cấp phát")} size="lg">
      <div className="flex flex-col items-center gap-6">
        {/* QR Code */}
        <div className="p-6 bg-white rounded-xl shadow-sm">
          <QRCodeSVG
            value={qrPayload}
            size={256}
            level="M"
            includeMargin={true}
          />
        </div>

        {/* Info */}
        <div className="w-full space-y-3">
          <div className="text-center">
            <p className="text-sm text-slate-500 dark:text-text-muted">
              {t("devices:provisioning.qr_hint", "Quét QR code này để lấy mã claim cấp phát thiết bị.")}
            </p>
          </div>

          {/* Claim code display */}
          <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-surface-elevated rounded-lg">
            <span className="text-xs text-slate-500 dark:text-text-muted shrink-0">{t("devices:provisioning.code_label", "Mã:")}</span>
            <code className="flex-1 text-sm font-mono text-slate-800 dark:text-text-secondary break-all">
              {session.claim_code}
            </code>
            <button
              onClick={() => onCopy(session.claim_code!, `qr-${session.id}`)}
              className="btn-ghost h-8 w-8 shrink-0 p-0"
              title={t("devices:provisioning.copy_code", "Sao chép mã")}
            >
              {copiedId === `qr-${session.id}` ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Payload preview */}
          <details className="group">
            <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 dark:hover:text-slate-300">
              {t("devices:provisioning.show_payload", "Xem payload QR")}
            </summary>
            <pre className="mt-2 p-3 bg-slate-100 dark:bg-surface-elevated rounded-lg text-xs font-mono text-slate-600 dark:text-text-muted overflow-x-auto">
              {JSON.stringify(JSON.parse(qrPayload), null, 2)}
            </pre>
          </details>

          {/* Status info */}
          <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
            <StatusIcon status={session.status} />
            <span>{statusLabel(session.status)}</span>
            {session.expires_at && (
              <span>· {t("devices:provisioning.expires_label", "Hết hạn:")} {formatDate(session.expires_at)}</span>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
