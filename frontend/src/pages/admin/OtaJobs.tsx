import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CheckCircle2, Pause, Play, Plus, RefreshCw, RotateCcw, Search, Rocket, X } from "lucide-react";
import { getOtaCampaign, listOtaCampaigns, listOtaJobs, transitionOtaCampaign } from "../../services/otaApi";
import { PageHeader } from "../../components/ui/PageHeader";
import { AdminSectionNav, ADMIN_FIRMWARE_SECTION_NAV } from "../../components/layout/AdminSectionNav";
import { DataTable, type Column } from "../../components/ui/DataTable";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { FirmwareVersionBadge } from "../../components/ui/FirmwareVersionBadge";
import { MetricCard } from "../../components/ui/MetricCard";
import { TenantCell } from "../../components/ui/TenantCell";
import { otaTone } from "../../lib/status";
import { formatDateTime, formatRelative } from "../../lib/formatters";
import type { OtaCampaign, OtaJob } from "../../types";

const ACTIVE_STATUSES = ["pending", "sent", "started", "accepted", "downloading", "flashing", "applying", "rebooting", "verifying"];

interface OtaJobsProps {
  readOnly?: boolean;
  queryKey?: string[];
  queryFn?: () => Promise<OtaJob[]>;
  showSectionNav?: boolean;
}

export function OtaJobs({
  readOnly = true,
  queryKey = ["ota-jobs"],
  queryFn = () => listOtaJobs(),
  showSectionNav = true,
}: OtaJobsProps = {}) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(() => searchParams.get("campaign"));

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey,
    queryFn,
    refetchInterval: 10_000,
  });

  const jobs = data ?? [];
  const campaignsQuery = useQuery({
    queryKey: ["ota-campaigns"],
    queryFn: () => listOtaCampaigns(),
    enabled: !readOnly,
    refetchInterval: 10_000,
  });
  const selectedCampaignQuery = useQuery({
    queryKey: ["ota-campaign", selectedCampaignId],
    queryFn: () => getOtaCampaign(selectedCampaignId!),
    enabled: Boolean(selectedCampaignId),
    refetchInterval: 5_000,
  });
  const campaignAction = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "cancel" | "retry-failed" }) =>
      transitionOtaCampaign(id, action),
    onSuccess: (campaign) => {
      queryClient.setQueryData(["ota-campaign", campaign.id], campaign);
      queryClient.invalidateQueries({ queryKey: ["ota-campaigns"] });
      queryClient.invalidateQueries({ queryKey });
    },
  });
  const active = jobs.filter((j) => ACTIVE_STATUSES.includes(j.status)).length;
  const succeeded = jobs.filter((j) => ["success", "completed"].includes(j.status)).length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const rate = succeeded + failed > 0 ? (succeeded / (succeeded + failed)) * 100 : null;

  const statuses = useMemo(() => {
    const s = new Set<string>();
    jobs.forEach((j) => s.add(j.status));
    return Array.from(s).sort();
  }, [jobs]);

  const filtered = useMemo(() => {
    return jobs.filter((j) => {
      if (statusFilter !== "all" && j.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${j.device_uid} ${j.firmware_version} ${j.tenant?.name ?? ""} ${j.tenant?.slug ?? ""}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [jobs, statusFilter, search]);

  const columns: Column<OtaJob>[] = [
    {
      key: "id",
      header: "Job",
      render: (j) => <span className="font-mono text-xs text-slate-500">{j.id.slice(0, 8)}…</span>,
    },
    {
      key: "device",
      header: "Thiết bị",
      sortable: true,
      sortValue: (j) => j.device_uid,
      render: (j) =>
        readOnly ? (
          <span className="font-mono text-xs">{j.device_uid}</span>
        ) : (
          <Link to={`/console/devices/${j.device_uid}`} className="font-mono text-xs hover:text-brand-600">
            {j.device_uid}
          </Link>
        ),
    },
    {
      key: "firmware",
      header: "Firmware",
      sortable: true,
      sortValue: (j) => j.firmware_version,
      render: (j) => <FirmwareVersionBadge version={j.firmware_version} />,
    },
    {
      key: "tenant",
      header: "Khách hàng",
      sortable: true,
      sortValue: (j) => j.tenant?.name ?? "",
      render: (j) => <TenantCell tenant={j.tenant} compact />,
    },
    {
      key: "status",
      header: "Trạng thái",
      sortable: true,
      sortValue: (j) => j.status,
      render: (j) => <StatusBadge tone={otaTone(j.status)} label={j.status} />,
    },
    {
      key: "requested",
      header: "Yêu cầu",
      sortable: true,
      sortValue: (j) => new Date(j.requested_at).getTime(),
      render: (j) => (
        <span title={formatDateTime(j.requested_at)} className="text-xs text-slate-500">
          {formatRelative(j.requested_at)}
        </span>
      ),
    },
    {
      key: "error",
      header: "Lỗi",
      render: (j) => (
        <span className="text-xs text-rose-600 dark:text-rose-400 truncate max-w-[20ch] inline-block" title={j.error_message ?? j.error_code ?? ""}>
          {j.error_message ?? j.error_code ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      <PageHeader
        title="OTA Campaigns"
        subtitle="Quản lý phát hành firmware qua MQTT"
        actions={
          <>
            <button onClick={() => refetch()} disabled={isFetching} className="btn-secondary">
              <RefreshCw className={isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Làm mới
            </button>
            {!readOnly && <button onClick={() => navigate("/console/ota/new")} className="btn-primary">
              <Plus className="h-3.5 w-3.5" /> Tạo campaign
            </button>}
          </>
        }
      />

      {showSectionNav && <AdminSectionNav items={ADMIN_FIRMWARE_SECTION_NAV} />}

      {!readOnly && (
        <CampaignPanel
          campaigns={campaignsQuery.data ?? []}
          loading={campaignsQuery.isLoading}
          selected={selectedCampaignQuery.data ?? null}
          selectedId={selectedCampaignId}
          onSelect={(id) => {
            setSelectedCampaignId(id);
            const next = new URLSearchParams(searchParams);
            id ? next.set("campaign", id) : next.delete("campaign");
            setSearchParams(next, { replace: true });
          }}
          onAction={(action) => selectedCampaignId && campaignAction.mutate({ id: selectedCampaignId, action })}
          actionPending={campaignAction.isPending}
          actionError={campaignAction.error instanceof Error ? campaignAction.error.message : null}
        />
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Tổng OTA jobs" value={error ? "—" : jobs.length} loading={isLoading} icon={<Rocket className="h-4 w-4" />} tone="info" />
        <MetricCard label="Đang chạy" value={error ? "—" : active} icon={<Activity className="h-4 w-4" />} loading={isLoading} tone="warning" />
        <MetricCard label="Thành công" value={error ? "—" : succeeded} icon={<CheckCircle2 className="h-4 w-4" />} loading={isLoading} tone="success" />
        <MetricCard
          label="Tỉ lệ thành công"
          loading={isLoading}
          value={!error && rate !== null ? `${rate.toFixed(0)}%` : "—"}
          tone={rate !== null && rate < 80 ? "warning" : "success"}
          hint={`${failed} thất bại`}
        />
      </div>

      <DataTable
        data={filtered}
        columns={columns}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        rowKey={(j) => j.id}
        emptyTitle="Chưa có OTA job nào"
        emptyDescription={readOnly ? "Các OTA job do tenant thực hiện sẽ xuất hiện tại đây." : "Bắt đầu một campaign bằng cách tải lên firmware và chọn thiết bị mục tiêu."}
        className="flex-1"
        toolbar={
          <>
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo device, version…"
                className="input pl-9"
              />
            </div>
            <select
              className="input h-9 w-auto"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Tất cả trạng thái</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </>
        }
      />
    </div>
  );
}

function CampaignPanel({
  campaigns,
  loading,
  selected,
  selectedId,
  onSelect,
  onAction,
  actionPending,
  actionError,
}: {
  campaigns: OtaCampaign[];
  loading: boolean;
  selected: OtaCampaign | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAction: (action: "pause" | "resume" | "cancel" | "retry-failed") => void;
  actionPending: boolean;
  actionError: string | null;
}) {
  const progress = selected?.total_targets
    ? Math.round(((selected.success_count + selected.failed_count + selected.skipped_count) / selected.total_targets) * 100)
    : 0;

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white dark:border-border dark:bg-surface">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-border">
        <div>
          <h2 className="text-sm font-semibold">Chiến dịch OTA</h2>
          <p className="text-xs text-slate-500">Theo dõi rollout, ngưỡng lỗi và retry từ server.</p>
        </div>
        <span className="text-xs text-slate-500">{campaigns.length} chiến dịch</span>
      </div>
      <div className="grid min-h-[180px] lg:grid-cols-[minmax(280px,0.8fr)_1.2fr]">
        <div className="max-h-72 overflow-auto border-b border-slate-200 p-2 dark:border-border lg:border-b-0 lg:border-r">
          {loading && <div className="p-3 text-xs text-slate-500">Đang tải…</div>}
          {!loading && campaigns.length === 0 && <div className="p-3 text-xs text-slate-500">Chưa có chiến dịch.</div>}
          {campaigns.map((campaign) => (
            <button
              key={campaign.id}
              type="button"
              onClick={() => onSelect(campaign.id)}
              className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-surface-elevated ${selectedId === campaign.id ? "bg-slate-100 dark:bg-surface-elevated" : ""}`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{campaign.name}</span>
                <span className="block text-xs text-slate-500">v{campaign.firmware_version} · {campaign.total_targets} thiết bị</span>
              </span>
              <StatusBadge tone={otaTone(campaign.status)} label={campaign.status} />
            </button>
          ))}
        </div>
        <div className="p-4">
          {!selected && <div className="flex h-full items-center justify-center text-sm text-slate-500">Chọn một chiến dịch để xem tiến độ.</div>}
          {selected && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{selected.name}</div>
                  <div className="text-xs text-slate-500">Phase {selected.current_phase + 1}/{selected.rollout_percentages.length} · {selected.rollout_strategy}</div>
                </div>
                <button className="btn-ghost h-8 px-2" onClick={() => onSelect(null)} aria-label="Đóng chi tiết"><X className="h-4 w-4" /></button>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-xs"><span>Tiến độ</span><span>{progress}%</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-app"><div className="h-full bg-brand-500" style={{ width: `${progress}%` }} /></div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-6">
                {[["Chờ", selected.pending_count], ["Đang chạy", selected.running_count], ["Thành công", selected.success_count], ["Lỗi", selected.failed_count], ["Bỏ qua", selected.skipped_count], ["Tỷ lệ lỗi", `${selected.failure_rate.toFixed(1)}%`]].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg bg-slate-50 p-2 dark:bg-surface-elevated"><div className="font-semibold">{value}</div><div className="text-slate-500">{label}</div></div>
                ))}
              </div>
              {selected.last_error && <div className="text-xs text-rose-600">{selected.last_error}</div>}
              {actionError && <div className="text-xs text-rose-600">{actionError}</div>}
              <div className="flex flex-wrap gap-2">
                {selected.status === "running" && <button disabled={actionPending} className="btn-secondary" onClick={() => onAction("pause")}><Pause className="h-3.5 w-3.5" /> Tạm dừng</button>}
                {selected.status === "paused" && <button disabled={actionPending} className="btn-primary" onClick={() => onAction("resume")}><Play className="h-3.5 w-3.5" /> Tiếp tục</button>}
                {selected.failed_count > 0 && <button disabled={actionPending} className="btn-secondary" onClick={() => onAction("retry-failed")}><RotateCcw className="h-3.5 w-3.5" /> Retry lỗi</button>}
                {!["completed", "cancelled"].includes(selected.status) && <button disabled={actionPending} className="btn-secondary text-rose-600" onClick={() => onAction("cancel")}><X className="h-3.5 w-3.5" /> Huỷ</button>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
