import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  RefreshCw,
  Rocket,
  Power,
  Wrench,
  ArrowLeft,
  Activity,
  Cpu,
  Code2,
  AlertOctagon,
  History,
  Settings as SettingsIcon,
  ShieldCheck,
  Signal,
  Clock,
  Package,
} from "lucide-react";
import {
  getDeviceStatus,
  getDeviceTelemetry,
  rebootAdminDevice,
  setAdminDeviceMaintenance,
} from "../../services/deviceApi";
import { listAlerts } from "../../services/alertApi";
import { listOtaJobs, createOtaJob } from "../../services/otaApi";
import { listFirmware } from "../../services/firmwareApi";
import { AdminMetric, AdminReadOnlyNote } from "./adminPresentation";
import { ErrorState } from "../../components/ui/ErrorState";
import { PageHeader } from "../../components/ui/PageHeader";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Tabs } from "../../components/ui/Tabs";
import { EmptyState } from "../../components/ui/EmptyState";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { FirmwareVersionBadge } from "../../components/ui/FirmwareVersionBadge";
import { TelemetryChart } from "../../components/charts/TelemetryChart";
import { Modal } from "../../components/ui/Modal";
import { deviceTone, otaTone, severityTone } from "../../lib/status";
import { formatDateTime, formatRelative } from "../../lib/formatters";

type TabKey = "overview" | "telemetry" | "ota" | "events" | "config";

export function DeviceDetail() {
  const { deviceUid = "" } = useParams<{ deviceUid: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("overview");
  const canReadCustomerData = true;

  const statusQ = useQuery({
    queryKey: ["device-status", deviceUid],
    queryFn: () => getDeviceStatus(deviceUid),
    refetchInterval: 10_000,
    enabled: !!deviceUid,
    placeholderData: (previous) => previous,
  });
  const tenantId = statusQ.data?.tenant?.id;

  const alertsQ = useQuery({
    queryKey: ["admin-device-alerts", tenantId, deviceUid],
    queryFn: () => listAlerts({ tenant_id: tenantId, device_uid: deviceUid }),
    refetchInterval: 20_000,
    enabled: !!deviceUid && !!tenantId && canReadCustomerData,
    placeholderData: (previous) => previous,
  });

  const telemetryQ = useQuery({
    queryKey: ["device-telemetry", deviceUid],
    queryFn: () => getDeviceTelemetry(deviceUid, 200),
    refetchInterval: 10_000,
    enabled: !!deviceUid && canReadCustomerData,
  });

  const otaQ = useQuery({
    queryKey: ["device-ota", tenantId, deviceUid],
    queryFn: () => listOtaJobs(deviceUid, 100, tenantId),
    refetchInterval: 10_000,
    enabled: !!deviceUid && !!tenantId && canReadCustomerData,
  });

  const firmwareQ = useQuery({
    queryKey: ["firmware"],
    queryFn: () => listFirmware(),
  });

  const status = statusQ.data;
  const canCommandDevice = status?.tenant === null;
  const canExecuteOta = canCommandDevice;

  const [otaOpen, setOtaOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [commandMessage, setCommandMessage] = useState<string | null>(null);

  const commandMutation = useMutation({
    mutationFn: (operation: "reboot" | "maintenance-enable" | "maintenance-disable") => {
      setCommandMessage(null);
      if (operation === "reboot") return rebootAdminDevice(deviceUid);
      return setAdminDeviceMaintenance(deviceUid, operation === "maintenance-enable");
    },
    onSuccess: (command) => {
      setCommandMessage(`Lệnh ${command.command_type} đã gửi · ${command.status} · ${command.id.slice(0, 8)}`);
      qc.invalidateQueries({ queryKey: ["device-status", deviceUid] });
    },
    onError: (error: Error) => setCommandMessage(error.message),
  });

  function copyUid() {
    navigator.clipboard.writeText(deviceUid);
  }

  const tabs = [
    { key: "overview" as const, label: <span className="inline-flex items-center gap-1.5"><Cpu className="h-3.5 w-3.5" /> Tổng quan</span> },
    { key: "telemetry" as const, label: <span className="inline-flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Telemetry</span> },
    { key: "ota" as const, label: <span className="inline-flex items-center gap-1.5"><History className="h-3.5 w-3.5" /> OTA</span> },
    { key: "events" as const, label: <span className="inline-flex items-center gap-1.5"><AlertOctagon className="h-3.5 w-3.5" /> Sự kiện</span> },
    { key: "config" as const, label: <span className="inline-flex items-center gap-1.5"><SettingsIcon className="h-3.5 w-3.5" /> Cấu hình</span> },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-5">
      <PageHeader
        crumbs={[{ label: "Thiết bị", to: "/console/devices" }, { label: status?.name ?? deviceUid }]}
        title={
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600"><Cpu className="h-5 w-5" /></span>
            <span>{status?.name ?? deviceUid}</span>
            {status && <StatusBadge tone={deviceTone(status.status)} label={status.status} />}
          </div>
        }
        subtitle={
          <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
            {deviceUid}
            <button onClick={copyUid} className="btn-ghost h-6 w-6 p-0" title="Sao chép">
              <Copy className="h-3 w-3" />
            </button>
          </div>
        }
        actions={
          <>
            <button onClick={() => navigate(-1)} className="btn-ghost">
              <ArrowLeft className="h-3.5 w-3.5" /> Quay lại
            </button>
            <button onClick={() => statusQ.refetch()} className="btn-secondary">
              <RefreshCw className="h-3.5 w-3.5" /> Làm mới
            </button>
            {canExecuteOta && <button onClick={() => setOtaOpen(true)} className="btn-primary">
              <Rocket className="h-3.5 w-3.5" /> OTA
            </button>}
          </>
        }
      />

      {statusQ.isError && <ErrorState message={statusQ.error.message} onRetry={() => statusQ.refetch()} />}
      {status?.tenant && <AdminReadOnlyNote>Chỉ đọc · Thiết bị thuộc {status.tenant.name}. Quyền vận hành thiết bị thuộc tenant.</AdminReadOnlyNote>}
      <div className="grid gap-4 sm:grid-cols-3"><AdminMetric label="Firmware" value={status?.firmware_version ?? "—"} hint="Phiên bản thiết bị báo cáo" icon={<Package className="h-5 w-5" />} loading={statusQ.isLoading} index={3} /><AdminMetric label="RSSI" value={status?.rssi == null ? "—" : status.rssi + " dBm"} hint="Cường độ tín hiệu gần nhất" icon={<Signal className="h-5 w-5" />} loading={statusQ.isLoading} index={1} /><AdminMetric label="Uptime" value={status?.uptime_ms == null ? "—" : formatUptime(status.uptime_ms)} hint="Thời gian thiết bị hoạt động" icon={<Clock className="h-5 w-5" />} loading={statusQ.isLoading} /></div>

      <Tabs tabs={tabs} active={tab} onChange={(k) => setTab(k as TabKey)} className="mb-5" />

      {tab === "overview" && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
          <Card className="xl:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Cpu className="h-4 w-4 text-brand-500" />Thông tin</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              <Row label="Device UID" value={<span className="font-mono text-xs">{deviceUid}</span>} />
              <Row label="Tên" value={status?.name ?? "—"} />
              <Row
                label="Firmware"
                value={<FirmwareVersionBadge version={status?.firmware_version} />}
              />
              <Row
                label="Trạng thái"
                value={status ? <StatusBadge tone={deviceTone(status.status)} label={status.status} /> : "—"}
              />
              <Row
                label="Last seen"
                value={
                  <span title={formatDateTime(status?.last_seen_at)}>
                    {formatRelative(status?.last_seen_at)}
                  </span>
                }
              />
              <Row
                label="Uptime"
                value={status?.uptime_ms == null ? "—" : formatUptime(status.uptime_ms)}
              />
              <Row
                label="RSSI"
                value={status?.rssi == null ? "—" : `${status.rssi} dBm`}
              />

              <div className="pt-3 border-t border-slate-200 dark:border-border-subtle flex flex-wrap gap-2">
                {canCommandDevice && <button
                  disabled={commandMutation.isPending}
                  onClick={() => window.confirm(`Khởi động lại ${deviceUid}?`) && commandMutation.mutate("reboot")}
                  className="btn-secondary text-xs h-8"
                >
                  <Power className="h-3.5 w-3.5" /> Khởi động lại
                </button>}
                {canCommandDevice && <button
                  disabled={commandMutation.isPending}
                  onClick={() => commandMutation.mutate(status?.status === "maintenance" ? "maintenance-disable" : "maintenance-enable")}
                  className="btn-secondary text-xs h-8"
                >
                  <Wrench className="h-3.5 w-3.5" /> {status?.status === "maintenance" ? "Tắt bảo trì" : "Bảo trì"}
                </button>}
                {canReadCustomerData && <button onClick={() => setDebugOpen(true)} className="btn-ghost text-xs h-8">
                  <Code2 className="h-3.5 w-3.5" /> Raw JSON
                </button>}
                {!canCommandDevice && <span className="text-xs text-slate-500">Chỉ đọc · Admin không điều khiển thiết bị tenant</span>}
              </div>
              {commandMessage && (
                <div role="status" className="text-xs text-slate-500 break-words">{commandMessage}</div>
              )}
              <div className="flex gap-3 text-xs">
                <Link className="text-brand-500 hover:underline" to="/console/admin/commands">Lịch sử lệnh</Link>
                <Link className="text-brand-500 hover:underline" to="/console/admin/audit-logs">Nhật ký audit</Link>
              </div>
            </CardBody>
          </Card>

          <Card className="xl:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-500" />Chủ sở hữu</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              {status?.tenant ? (
                <>
                  <Row label="Khách hàng" value={status.tenant.name} />
                  {status.tenant.slug && <Row label="Slug" value={<span className="font-mono text-xs">{status.tenant.slug}</span>} />}
                </>
              ) : (
                <div className="text-xs text-slate-400 italic">Chưa gán tenant</div>
              )}
            </CardBody>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Telemetry gần đây</CardTitle>
            </CardHeader>
            <CardBody>
              {telemetryQ.data && telemetryQ.data.length > 0 ? (
                <TelemetryChart data={telemetryQ.data.slice(0, 80)} height={260} />
              ) : (
                <div className="py-10 text-center text-sm text-slate-500">
                  Chưa nhận telemetry từ thiết bị này
                </div>
              )}
            </CardBody>
          </Card>

          <Card className="xl:col-span-4">
            <CardHeader className="flex items-center justify-between">
              <CardTitle>OTA gần đây</CardTitle>
              <span className="text-xs text-slate-500">{otaQ.data?.length ?? 0} jobs</span>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-xs text-slate-500 uppercase tracking-wider bg-slate-50 dark:bg-surface/40">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Job ID</th>
                    <th className="text-left px-4 py-2 font-medium">Firmware</th>
                    <th className="text-left px-4 py-2 font-medium">Trạng thái</th>
                    <th className="text-left px-4 py-2 font-medium">Bắt đầu</th>
                    <th className="text-left px-4 py-2 font-medium">Hoàn tất</th>
                  </tr>
                </thead>
                <tbody>
                  {(otaQ.data ?? []).slice(0, 8).map((j) => (
                    <tr key={j.id} className="border-t border-slate-100 dark:border-border-subtle">
                      <td className="px-4 py-2 font-mono text-xs text-slate-500">{j.id.slice(0, 8)}…</td>
                      <td className="px-4 py-2"><FirmwareVersionBadge version={j.firmware_version} /></td>
                      <td className="px-4 py-2"><StatusBadge tone={otaTone(j.status)} label={j.status} /></td>
                      <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(j.started_at)}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(j.completed_at)}</td>
                    </tr>
                  ))}
                  {(otaQ.data ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-8 text-sm text-slate-500">
                        Chưa có OTA cho thiết bị này
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === "telemetry" && (
        <Card>
          <CardHeader>
            <CardTitle>Telemetry — 200 mẫu mới nhất</CardTitle>
          </CardHeader>
          <CardBody>
            {telemetryQ.data && telemetryQ.data.length > 0 ? (
              <>
                <TelemetryChart data={telemetryQ.data} height={320} />
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-xs text-slate-500 uppercase tracking-wider">
                      <tr>
                        <th className="text-left px-2 py-2 font-medium">Thời gian</th>
                        <th className="text-left px-2 py-2 font-medium">Metric</th>
                        <th className="text-right px-2 py-2 font-medium">Giá trị</th>
                        <th className="text-left px-2 py-2 font-medium">Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {telemetryQ.data.slice(0, 20).map((t) => (
                        <tr key={t.id} className="border-t border-slate-100 dark:border-border-subtle">
                          <td className="px-2 py-1.5 text-xs">{formatDateTime(t.timestamp)}</td>
                          <td className="px-2 py-1.5 font-mono text-xs">{t.metric_name}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{t.metric_value.toFixed(3)}</td>
                          <td className="px-2 py-1.5 text-xs text-slate-500">{t.unit ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="py-10 text-center text-sm text-slate-500">Không có telemetry</div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "ota" && (
        <Card>
          <CardHeader>
            <CardTitle>Lịch sử OTA</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase tracking-wider bg-slate-50 dark:bg-surface/40">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Job</th>
                  <th className="text-left px-4 py-2 font-medium">Firmware</th>
                  <th className="text-left px-4 py-2 font-medium">Trạng thái</th>
                  <th className="text-left px-4 py-2 font-medium">Bắt đầu</th>
                  <th className="text-left px-4 py-2 font-medium">Hoàn tất</th>
                  <th className="text-left px-4 py-2 font-medium">Lỗi</th>
                </tr>
              </thead>
              <tbody>
                {(otaQ.data ?? []).map((j) => (
                  <tr key={j.id} className="border-t border-slate-100 dark:border-border-subtle">
                    <td className="px-4 py-2 font-mono text-xs">{j.id.slice(0, 8)}…</td>
                    <td className="px-4 py-2"><FirmwareVersionBadge version={j.firmware_version} /></td>
                    <td className="px-4 py-2"><StatusBadge tone={otaTone(j.status)} label={j.status} /></td>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(j.started_at)}</td>
                    <td className="px-4 py-2 text-xs text-slate-500">{formatDateTime(j.completed_at)}</td>
                    <td className="px-4 py-2 text-xs text-rose-600 dark:text-rose-400">
                      {j.error_message ?? j.error_code ?? "—"}
                    </td>
                  </tr>
                ))}
                {(otaQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-sm text-slate-500">
                      Chưa có OTA cho thiết bị này
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "events" && (
        <Card>
          <CardHeader>
            <CardTitle>Cảnh báo thiết bị</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="mt-5 border-t border-slate-200 pt-4 dark:border-border-subtle">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">Cảnh báo liên quan</div>
              {(alertsQ.data ?? []).length === 0 ? (
                <div className="text-sm text-slate-500">Chưa có cảnh báo persistent cho thiết bị này</div>
              ) : (
                <div className="space-y-2">
                  {(alertsQ.data ?? []).slice(0, 10).map((alert) => (
                    <Link key={alert.id} to="/console/alerts" className="flex items-center justify-between rounded border border-slate-200 p-2 text-sm hover:border-brand-500 dark:border-border-subtle">
                      <span>{alert.title}</span>
                      <StatusBadge tone={severityTone(alert.severity)} label={`${alert.severity} · ${alert.status}`} />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {tab === "config" && (
        <Card>
          <CardHeader>
            <CardTitle>Cấu hình thiết bị</CardTitle>
          </CardHeader>
          <CardBody>
            <EmptyState
              icon={<SettingsIcon className="h-5 w-5" />}
              title="Chức năng đang phát triển"
              description="Cấu hình thiết bị (sample rate, MQTT topics, OTA channel) sẽ được mở rộng trong phiên bản tiếp theo."
            />
          </CardBody>
        </Card>
      )}

      <OtaLaunchModal
        open={otaOpen}
        deviceUid={deviceUid}
        currentVersion={status?.firmware_version ?? null}
        firmwares={firmwareQ.data ?? []}
        onClose={() => setOtaOpen(false)}
        onSuccess={() => {
          setOtaOpen(false);
          qc.invalidateQueries({ queryKey: ["device-ota", tenantId, deviceUid] });
        }}
      />

      <Modal open={debugOpen} onClose={() => setDebugOpen(false)} title="Raw debug info" size="lg">
        <pre className="text-xs bg-surface-elevated border border-border-subtle text-text-primary rounded p-4 overflow-x-auto dark:bg-app dark:text-text-primary">
          {JSON.stringify({ status: status, telemetry_sample: telemetryQ.data?.slice(0, 5) }, null, 2)}
        </pre>
      </Modal>
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-right">
        <div className="text-sm text-slate-800 dark:text-text-primary">{value}</div>
        {hint && <div className="text-[10px] text-slate-400 italic">{hint}</div>}
      </div>
    </div>
  );
}

function formatUptime(uptimeMs: number): string {
  const totalMinutes = Math.floor(uptimeMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  return days > 0 ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

function OtaLaunchModal({
  open,
  deviceUid,
  currentVersion,
  firmwares,
  onClose,
  onSuccess,
}: {
  open: boolean;
  deviceUid: string;
  currentVersion: string | null;
  firmwares: { id: string; version: string; target_device_type: string }[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => createOtaJob(deviceUid, selected),
    onSuccess: () => onSuccess(),
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Khởi tạo OTA cho ${deviceUid}`}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Huỷ</button>
          <button
            onClick={() => {
              setError(null);
              mut.mutate();
            }}
            disabled={!selected || mut.isPending}
            className="btn-primary"
          >
            {mut.isPending ? "Đang gửi…" : "Tạo OTA job"}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="text-sm">
          <div className="text-xs text-slate-500 mb-1">Firmware hiện tại</div>
          <FirmwareVersionBadge version={currentVersion} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Chọn firmware
          </label>
          <select
            className="input mt-1"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">— chọn firmware —</option>
            {firmwares.map((f) => (
              <option key={f.id} value={f.id}>
                {f.version} · {f.target_device_type}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="text-xs text-rose-600">{error}</div>}
        <div className="text-xs text-slate-500">
          OTA sẽ được publish qua MQTT tới topic{" "}
          <code className="font-mono">devices/{deviceUid}/ota</code>.
        </div>
      </div>
    </Modal>
  );
}
