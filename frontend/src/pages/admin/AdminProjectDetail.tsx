import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Eye, PanelsTopLeft, Shield, FolderKanban, Cpu, Activity, Info } from "lucide-react";
import { getTenantProjectReadOnly } from "../../services/tenantAdminApi";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { FirmwareVersionBadge } from "../../components/ui/FirmwareVersionBadge";
import { formatDateTime, formatRelative } from "../../lib/formatters";
import { deviceTone, otaTone, severityTone } from "../../lib/status";

export function AdminProjectDetail() {
  const { tenantId = "", projectId = "" } = useParams<{ tenantId: string; projectId: string }>();
  const projectQ = useQuery({
    queryKey: ["admin-tenant-project", tenantId, projectId],
    queryFn: () => getTenantProjectReadOnly(tenantId, projectId),
    enabled: !!tenantId && !!projectId,
  });

  if (projectQ.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-2 text-sm text-slate-500 dark:text-text-muted">
        <div className="h-6 w-6 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
        <span>Đang tải thông tin project...</span>
      </div>
    );
  }

  if (projectQ.isError) return <ErrorState message={projectQ.error.message} onRetry={() => projectQ.refetch()} />;

  const project = projectQ.data;
  if (!project) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-slate-500 dark:text-text-muted">
        Không tìm thấy project
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to={`/console/admin/tenants/${tenantId}`}
          className="btn-ghost text-xs inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Quay lại Tenant
        </Link>
      </div>

      <PageHeader
        title={
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 font-bold shrink-0">
              <FolderKanban className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <span className="font-bold text-xl text-slate-900 dark:text-text-primary">{project.name}</span>
                <StatusBadge tone="info" label="Read only" />
              </div>
              <div className="text-xs text-slate-500 dark:text-text-muted mt-0.5">
                {project.tenant_name} · {project.device_summaries.length} device(s)
              </div>
            </div>
          </div>
        }
        actions={
          <div className="rounded-full bg-surface-elevated border border-border-subtle px-3.5 py-1.5 text-xs text-slate-600 dark:text-text-secondary inline-flex items-center gap-2">
            <Eye className="h-3.5 w-3.5 text-brand-500" />
            <span>Admin support view</span>
          </div>
        }
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        <Card>
          <CardHeader className="border-b border-border-subtle">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4 text-brand-500" />
              Chính sách truy cập
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 p-5 text-xs">
            <PolicyRow label="Quyền sở hữu tenant" value={project.access_policy.tenant_ownership_rule} />
            <PolicyRow label="Quyền Admin" value={project.access_policy.admin_access_rule} />
            <PolicyRow label="Chế độ Support" value={project.access_policy.support_mode_rule} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="border-b border-border-subtle">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Info className="h-4 w-4 text-brand-500" />
              Thông tin Project
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 p-5 text-xs">
            <PolicyRow label="Tenant" value={project.tenant_name} />
            <PolicyRow label="Slug" value={project.tenant_slug} />
            <PolicyRow label="Ngày tạo" value={formatRelative(project.created_at)} />
            <PolicyRow label="Cập nhật" value={formatRelative(project.updated_at)} />
            <PolicyRow label="Mô tả" value={project.description ?? "—"} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="border-b border-border-subtle">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Shield className="h-4 w-4 text-amber-500" />
              Ghi chú nền tảng
            </CardTitle>
          </CardHeader>
          <CardBody className="text-xs text-slate-600 dark:text-text-secondary space-y-3 p-5">
            <div className="rounded-xl bg-surface-elevated/60 border border-border-subtle p-3 leading-relaxed">
              Admin có thể kiểm tra trạng thái thiết bị, OTA, tổng hợp telemetry và các cảnh báo tại đây.
            </div>
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-amber-800 dark:text-amber-300 flex items-start gap-2 leading-relaxed">
              <Shield className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
              <span>
                Thao tác chỉnh sửa dữ liệu project khách hàng bị khóa có chủ đích ở giao diện này để đảm bảo toàn vẹn dữ liệu tenant.
              </span>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-5">
        {!project.device_summaries.length && <EmptyState title="Chưa có thiết bị trong project" />}
        {project.device_summaries.map((deviceSummary) => (
          <Card key={deviceSummary.device.id}>
            <CardHeader className="border-b border-border-subtle flex items-center justify-between p-5 bg-slate-50/50 dark:bg-surface-elevated/20">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 dark:text-brand-400 font-bold shrink-0">
                  <Cpu className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm font-bold text-slate-900 dark:text-text-primary">
                    {deviceSummary.device.name}
                  </CardTitle>
                  <div className="text-xs font-mono text-slate-500 dark:text-text-muted mt-0.5">
                    {deviceSummary.device.device_uid} · {deviceSummary.device.hardware_model ?? "Unknown model"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge tone={deviceTone(deviceSummary.device.status)} label={deviceSummary.device.status} />
                {deviceSummary.latest_ota_status && (
                  <StatusBadge tone={otaTone(deviceSummary.latest_ota_status)} label={deviceSummary.latest_ota_status} />
                )}
              </div>
            </CardHeader>
            <CardBody className="space-y-5 p-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <SummaryStat
                  label="Firmware"
                  value={<FirmwareVersionBadge version={deviceSummary.device.firmware_version} />}
                />
                <SummaryStat
                  label="Last seen"
                  value={formatRelative(deviceSummary.device.last_seen_at)}
                  hint={formatDateTime(deviceSummary.device.last_seen_at)}
                />
                <SummaryStat
                  label="Last telemetry"
                  value={formatRelative(deviceSummary.last_telemetry_at)}
                  hint={formatDateTime(deviceSummary.last_telemetry_at)}
                />
                <SummaryStat label="Cảnh báo gần đây" value={String(deviceSummary.recent_alert_count)} />
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="border-b border-border-subtle">
                    <CardTitle className="text-xs font-semibold flex items-center gap-2">
                      <Activity className="h-3.5 w-3.5 text-brand-500" />
                      Telemetry snapshot mới nhất
                    </CardTitle>
                  </CardHeader>
                  <CardBody className="space-y-2 p-4 text-xs">
                    {Object.keys(deviceSummary.latest_state).length === 0 ? (
                      <div className="text-slate-500 dark:text-text-muted py-4 text-center">Chưa có dữ liệu telemetry snapshot.</div>
                    ) : (
                      Object.entries(deviceSummary.latest_state).map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between gap-3 py-1 border-b border-border-subtle/50 last:border-0">
                          <span className="text-slate-500 dark:text-text-muted font-mono">{key}</span>
                          <span className="font-mono font-medium text-slate-800 dark:text-text-primary text-right">
                            {typeof value === "object" ? JSON.stringify(value) : String(value)}
                          </span>
                        </div>
                      ))
                    )}
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader className="border-b border-border-subtle">
                    <CardTitle className="text-xs font-semibold flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      Cảnh báo gần đây
                    </CardTitle>
                  </CardHeader>
                  <CardBody className="space-y-2.5 p-4">
                    {deviceSummary.recent_alerts.length === 0 ? (
                      <div className="text-xs text-slate-500 dark:text-text-muted py-4 text-center">Không có cảnh báo nào cho thiết bị này.</div>
                    ) : (
                      deviceSummary.recent_alerts.map((alert) => (
                        <div
                          key={alert.id}
                          className="rounded-xl border border-border-subtle bg-surface-elevated/40 p-3 flex items-center justify-between gap-3"
                        >
                          <div>
                            <div className="font-semibold text-xs text-slate-900 dark:text-text-primary">{alert.metric_name}</div>
                            <div className="text-[11px] text-slate-500 dark:text-text-muted mt-0.5">{formatDateTime(alert.timestamp)}</div>
                          </div>
                          <StatusBadge tone={severityTone(alert.severity)} label={alert.severity} />
                        </div>
                      ))
                    )}
                  </CardBody>
                </Card>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PolicyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center gap-4 py-0.5">
      <span className="text-slate-500 dark:text-text-muted">{label}</span>
      <span className="font-medium text-slate-800 dark:text-text-primary text-right">{value}</span>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string | null;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-surface-elevated/40 p-3">
      <div className="text-xs text-slate-500 dark:text-text-muted mb-1">{label}</div>
      <div className="text-sm font-bold text-slate-900 dark:text-text-primary">{value}</div>
      {hint && <div className="text-[10px] text-slate-400 dark:text-text-muted mt-1">{hint}</div>}
    </div>
  );
}
