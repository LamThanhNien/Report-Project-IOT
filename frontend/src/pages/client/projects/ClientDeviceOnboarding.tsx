import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useProjectScope } from "../../../hooks/useProjectScope";
import { ArrowLeft, Check, Copy, ChevronRight, ChevronLeft, Wifi, Terminal, Link2 } from "lucide-react";
import { registerClientDevice, getDeviceMqttConfig, getClientDevice, listClientDevices, generateDeviceToken, listClientDeviceModels } from "../../../services/clientApi";
import { PageHeader } from "../../../components/ui/PageHeader";
import { Card } from "../../../components/ui/Card";
import { Spinner } from "../../../components/ui/Spinner";
import type { Device, MqttConfig, DeviceModel } from "../../../types";

type Step = 1 | 2 | 3 | 4;

function StepIndicator({ current }: { current: Step }) {
  const { t } = useTranslation(["devices", "common"]);
  const stepLabels: Record<Step, string> = {
    1: t("devices:onboarding.step1_title", "Thông tin thiết bị"),
    2: t("devices:onboarding.step2_title", "Cấu hình MQTT"),
    3: t("devices:onboarding.step3_title", "Nạp firmware"),
    4: t("devices:onboarding.step4_title", "Xác nhận kết nối"),
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-border-subtle dark:bg-surface">
      {([1, 2, 3, 4] as Step[]).map((s) => {
        const done = s < current;
        const active = s === current;
        return (
          <div key={s} className="relative flex gap-3 pb-4 last:pb-0">
            {s < 4 && (
              <div
                className={[
                  "absolute left-3 top-7 h-[calc(100%-1.75rem)] w-px",
                  done ? "bg-brand-300 dark:bg-brand-700" : "bg-slate-200 dark:bg-surface-muted",
                ].join(" ")}
              />
            )}
            <div
              className={[
                "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors",
                done
                  ? "bg-primary border-primary text-primary-foreground"
                  : active
                    ? "border-primary text-primary"
                    : "border-slate-300 dark:border-border-subtle text-slate-400 dark:text-text-muted",
              ].join(" ")}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : s}
            </div>
            <div className="min-w-0 pt-0.5">
              <div
                className={[
                  "text-sm",
                  active
                    ? "font-semibold text-slate-900 dark:text-text-primary"
                    : done
                      ? "font-medium text-slate-700 dark:text-text-secondary"
                      : "text-slate-400 dark:text-text-muted",
                ].join(" ")}
              >
                {stepLabels[s]}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {done ? t("common:status.completed", "Đã hoàn tất") : active ? t("common:status.in_progress", "Đang thực hiện") : t("common:status.not_started", "Chưa bắt đầu")}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation(["common"]);
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="btn-ghost h-7 px-2 text-xs flex items-center gap-1"
      title={t("common:actions.copy", "Sao chép")}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? t("common:actions.copied", "Đã sao chép") : t("common:actions.copy", "Sao chép")}
    </button>
  );
}

// ── Dirty-state confirmation dialog ──────────────────────────────────────────

function BackConfirmDialog({
  onStay,
  onLeave,
}: {
  onStay: () => void;
  onLeave: () => void;
}) {
  const { t } = useTranslation(["devices", "common"]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-border-subtle dark:bg-surface">
        <h3 className="text-base font-semibold text-slate-900 dark:text-text-primary mb-2">
          {t("devices:onboarding.back_confirm_title", "Xác nhận quay lại trang thiết bị")}
        </h3>
        <p className="text-sm text-slate-500 dark:text-text-muted mb-6">
          {t("devices:onboarding.back_confirm_desc", "Bạn có chắc muốn quay lại trang thiết bị? Thông tin đang nhập sẽ chưa được lưu.")}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={onStay}
          >
            {t("common:actions.stay", "Ở lại")}
          </button>
          <button
            type="button"
            className="btn-primary"
            style={{ background: "rgb(220 38 38)", borderColor: "rgb(220 38 38)" }}
            onClick={onLeave}
          >
            {t("devices:onboarding.back_to_devices", "Quay lại trang thiết bị")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Step 1: Device Info ───────────────────────────────────────────────────────

function Step1({
  name,
  uid,
  hardwareModel,
  description,
  onNameChange,
  onUidChange,
  onHardwareModelChange,
  onDescriptionChange,
  onNext,
  uidError,
  checkingUid,
}: {
  name: string;
  uid: string;
  hardwareModel: string;
  description: string;
  onNameChange: (v: string) => void;
  onUidChange: (v: string) => void;
  onHardwareModelChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onNext: () => void | Promise<void>;
  uidError?: string | null;
  checkingUid?: boolean;
}) {
  const { t } = useTranslation(["devices", "common"]);
  const [submitting, setSubmitting] = useState(false);
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

  async function submit() {
    if (!name.trim() || !uid.trim() || uidError || checkingUid || submitting) return;
    setSubmitting(true);
    try {
      await onNext();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
        <Wifi className="h-5 w-5 text-emerald-600 mt-0.5 shrink-0" />
        <p className="text-sm text-emerald-700 dark:text-emerald-300">
          {t("devices:onboarding.step1_intro", "Nhập thông tin thiết bị ESP32 của bạn. Sau bước này hệ thống sẽ cung cấp thông số MQTT để cấu hình vào firmware.")}
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="label">{t("devices:onboarding.device_name", "Tên thiết bị")}</label>
          <input
            type="text"
            className="input"
            placeholder={t("devices:onboarding.device_name_placeholder", "Ví dụ: ESP32 Phòng máy chủ")}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Device UID</label>
          <input
            type="text"
            className="input font-mono"
            placeholder={t("devices:onboarding.uid_placeholder", "Ví dụ: esp32-AABBCCDDEEFF")}
            value={uid}
            onChange={(e) => onUidChange(e.target.value)}
            aria-invalid={uidError ? "true" : undefined}
          />
          {uidError && (
            <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
              {uidError}
            </p>
          )}
          {!uidError && checkingUid && (
            <p className="mt-1 text-[11px] text-slate-500">{t("devices:onboarding.checking_uid", "Đang kiểm tra UID...")}</p>
          )}
          <p className="mt-1 text-[11px] text-slate-400">
            {t("devices:onboarding.find_mac_guide", "Tìm MAC address của ESP32 bằng lệnh:")}{" "}
            <code className="bg-slate-100 dark:bg-surface-elevated px-1 rounded">
              idf.py monitor
            </code>{" "}
            {t("devices:onboarding.format_into", "rồi format thành")}{" "}
            <code className="bg-slate-100 dark:bg-surface-elevated px-1 rounded">
              esp32-AABBCCDDEEFF
            </code>
          </p>
        </div>
        <div>
          <label className="label">{t("devices:onboarding.hardware_model_label", "Hardware model")} <span className="text-slate-400">({t("common:optional", "tùy chọn")})</span></label>
          <select
            className="input"
            value={hardwareModel}
            onChange={(e) => onHardwareModelChange(e.target.value)}
            disabled={loadingModels}
          >
            <option value="">{t("devices:onboarding.model_unspecified", "-- Không xác định (Not specified) --")}</option>
            {models.map((m) => (
              <option key={m.id} value={m.key}>
                {m.name} {m.platform ? `(${m.platform.name})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">{t("common:field.description", "Mô tả")} <span className="text-slate-400">({t("common:optional", "tùy chọn")})</span></label>
          <textarea
            className="input min-h-24 resize-y"
            placeholder={t("devices:onboarding.description_placeholder", "Ví dụ: Lắp tại rack A phòng máy chủ")}
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary flex items-center gap-1.5"
          disabled={!name.trim() || !uid.trim() || !!uidError || !!checkingUid || submitting}
          onClick={submit}
        >
          {submitting ? <Spinner className="h-4 w-4 mr-1.5 text-white" /> : null}
          {t("common:actions.continue", "Tiếp tục")}
          {!submitting && <ChevronRight className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

// ── Step 2: MQTT Config ───────────────────────────────────────────────────────

function Step2({
  uid,
  authToken,
  onNext,
  onBack,
}: {
  uid: string;
  authToken: string;
  onNext: (cfg: MqttConfig) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation(["devices", "common"]);
  const [cfg, setCfg] = useState<MqttConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      setLoading(true);
      setError(null);
      try {
        const currentDeviceUid = uid.trim();
        if (cancelled) return;
        const config = await getDeviceMqttConfig(currentDeviceUid);
        if (!cancelled) setCfg(config);
      } catch (e: unknown) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg.includes("409") ? t("devices:onboarding.uid_exists", "This device UID already exists in the system.") : msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadConfig();
    return () => {
      cancelled = true;
    };
  }, [uid]);

  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (error) return <p className="text-red-600 text-sm">{error}</p>;
  if (!cfg) return null;

  const arduinoSnippet = `#include <AifomEdge.h>

void setup() {
  Serial.begin(115200);

  // Kết nối thiết bị lên hệ thống Aifom
  AifomEdge.begin(
    "YOUR_WIFI_SSID",
    "YOUR_WIFI_PASSWORD",
    "${authToken || 'AUTH_TOKEN'}",
    "${cfg.client_id_suggestion}",
    "${cfg.broker_host}",
    ${cfg.broker_port}
  );
}

void loop() {
  AifomEdge.run();
}`;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="p-3 bg-slate-50 dark:bg-surface-elevated rounded-lg">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{t("devices:onboarding.mqtt_broker", "MQTT Broker")}</p>
          <p className="font-mono text-sm font-semibold text-slate-800 dark:text-text-primary">
            {cfg.broker_host}:{cfg.broker_port}
          </p>
        </div>
        <div className="p-3 bg-slate-50 dark:bg-surface-elevated rounded-lg">
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">{t("devices:onboarding.client_id_hint", "Client ID gợi ý")}</p>
          <p className="font-mono text-sm font-semibold text-slate-800 dark:text-text-primary truncate">
            {cfg.client_id_suggestion}
          </p>
        </div>
        {authToken && (
          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800 rounded-lg flex flex-col justify-between">
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-1 flex items-center justify-between">
              {t("devices:onboarding.auth_token", "Auth Token")}
              <CopyButton text={authToken} />
            </p>
            <p className="font-mono text-xs font-semibold text-emerald-800 dark:text-emerald-300 truncate" title={authToken}>
              {authToken}
            </p>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-xs font-medium text-slate-600 dark:text-text-muted">
            {t("devices:onboarding.sample_library", "Code mẫu sử dụng thư viện")}{" "}
            <code className="bg-slate-100 dark:bg-surface-elevated px-1 rounded font-semibold">
              AifomEdge
            </code>
          </p>
          <CopyButton text={arduinoSnippet} />
        </div>
        <pre className="text-xs bg-surface-elevated border border-border-subtle text-emerald-700 p-3 rounded-lg overflow-x-auto leading-relaxed dark:bg-app dark:text-emerald-300">
          {arduinoSnippet}
        </pre>
      </div>

      <div className="flex justify-between">
        <button type="button" className="btn-ghost flex items-center gap-1" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> {t("common:actions.back", "Quay lại")}
        </button>
        <button type="button" className="btn-primary flex items-center gap-1.5" onClick={() => onNext(cfg)}>
          {t("common:actions.next", "Tiếp theo")} <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Step 3: Flash guide ───────────────────────────────────────────────────────

function Step3({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation(["devices", "common"]);
  const commands = [
    "cd iot/firmware",
    ". $IDF_PATH/export.sh",
    "idf.py set-target esp32",
    "idf.py build",
    "idf.py -p COM5 flash   # replace COM5 with your device port",
    "idf.py -p COM5 monitor",
  ].join("\n");

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 p-4 bg-sky-50 dark:bg-sky-900/20 rounded-lg border border-sky-200 dark:border-sky-800">
        <Terminal className="h-5 w-5 text-sky-600 mt-0.5 shrink-0" />
        <div className="text-sm text-sky-700 dark:text-sky-300 space-y-1">
          <p className="font-medium">{t("devices:onboarding.espidf_required", "Yêu cầu: ESP-IDF v5.1+ đã cài đặt")}</p>
          <p>
            {t("devices:onboarding.download_espidf", "Download ESP-IDF from:")} {" "}
            <span className="font-mono text-xs">
              https://docs.espressif.com/projects/esp-idf/en/stable/esp32/get-started/
            </span>
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-slate-700 dark:text-text-secondary">
          1. {t("devices:onboarding.step3_edit_config", "Chỉnh WiFi + MQTT trong")} <code>iot/firmware/sdkconfig.defaults.local</code>
        </p>
        <p className="text-sm text-slate-500">
          ({t("devices:onboarding.step3_replace_wifi_hint", "Dùng snippet đã copy ở bước trước, thay")} <code>YourSSID</code> {t("devices:onboarding.and", "và")} <code>YourPassword</code> {t("devices:onboarding.with_actual_wifi", "thành WiFi thực của bạn")})
        </p>

        <p className="text-sm font-medium text-slate-700 dark:text-text-secondary">
          2. {t("devices:onboarding.step3_build_flash", "Build và flash firmware")}
        </p>
        <div className="relative">
          <pre className="text-xs bg-surface-elevated border border-border-subtle text-text-secondary p-3 rounded-lg overflow-x-auto leading-relaxed dark:bg-app dark:text-text-secondary">
            {commands}
          </pre>
          <div className="absolute top-2 right-2">
            <CopyButton text={commands} />
          </div>
        </div>

        <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
          <p className="text-xs text-amber-700 dark:text-amber-300">
             <strong>Windows:</strong> {t("devices:onboarding.windows_port_hint", "The COM port is usually")} <code>COM3</code>, <code>COM4</code>…
            {t("devices:onboarding.windows_device_manager", "Kiểm tra trong Device Manager → Ports (COM & LPT).")}
            <br />
            <strong>Linux/macOS:</strong> {t("devices:onboarding.linux_port_hint", "Thay bằng")} <code>/dev/ttyUSB0</code> {t("devices:onboarding.or", "hoặc")}{" "}
            <code>/dev/cu.usbserial-*</code>
          </p>
        </div>

        <p className="text-sm font-medium text-slate-700 dark:text-text-secondary">
          3. {t("devices:onboarding.step3_auto_connect", "Sau khi flash, thiết bị tự kết nối WiFi → MQTT")}
        </p>
        <p className="text-sm text-slate-500">
          {t("devices:onboarding.step3_wait_connected", "Chờ log monitor hiển thị")} <code>MQTT_EVENT_CONNECTED</code> {t("devices:onboarding.then_continue", "rồi tiếp tục bước sau.")}
        </p>
      </div>

      <div className="flex justify-between">
        <button type="button" className="btn-ghost flex items-center gap-1" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> {t("common:actions.back", "Quay lại")}
        </button>
        <button type="button" className="btn-primary flex items-center gap-1.5" onClick={onNext}>
          {t("devices:onboarding.flashed_verify", "Đã flash, kiểm tra kết nối")} <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// ── Step 4: Verify connection ─────────────────────────────────────────────────

function Step4({
  device,
  name,
  uid,
  hardwareModel,
  description,
  authTokenHash,
  projectId,
  onDeviceReady,
  onBack,
}: {
  device: Device | null;
  name: string;
  uid: string;
  hardwareModel: string;
  description: string;
  authTokenHash: string;
  projectId?: string;
  onDeviceReady: (device: Device) => void;
  onBack: () => void;
}) {
  const { t } = useTranslation(["devices", "common"]);
  const navigate = useNavigate();
  const { resolveLink } = useProjectScope();
  const [registeredDevice, setRegisteredDevice] = useState<Device | null>(
    device?.device_uid === uid.trim() ? device : null,
  );
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [status, setStatus] = useState<"waiting" | "online" | "timeout">("waiting");
  const [seconds, setSeconds] = useState(0);
  const MAX_WAIT = 120;

  useEffect(() => {
    let cancelled = false;
    async function registerForVerification() {
      const trimmedUid = uid.trim();
      const trimmedName = name.trim();
      if (registeredDevice?.device_uid === trimmedUid) {
        return;
      }
      setRegistering(true);
      setRegisterError(null);
      try {
        const created = await registerClientDevice(trimmedUid, trimmedName, {
          hardwareModel,
          description,
          authTokenHash,
          projectId,
        });
        if (cancelled) return;
        setRegisteredDevice(created);
        onDeviceReady(created);
      } catch (e: unknown) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes("409")) {
          try {
            const existing = await getClientDevice(trimmedUid);
            if (cancelled) return;
            setRegisteredDevice(existing);
            onDeviceReady(existing);
            setRegisterError(null);
            return;
          } catch (fetchError: unknown) {
            if (cancelled) return;
            setRegisterError(fetchError instanceof Error ? fetchError.message : message);
            return;
          }
        }
        setRegisterError(message);
      } finally {
        if (!cancelled) setRegistering(false);
      }
    }
    void registerForVerification();
    return () => {
      cancelled = true;
    };
  }, [description, hardwareModel, name, onDeviceReady, registeredDevice, uid, authTokenHash]);

  const check = useCallback(async () => {
    if (!registeredDevice) return;
    try {
      const d = await getClientDevice(registeredDevice.device_uid);
      if (d.status === "online") setStatus("online");
    } catch {
      // not yet registered / MQTT not connected — keep polling
    }
  }, [registeredDevice]);

  useEffect(() => {
    if (status !== "waiting" || registering || registerError || !registeredDevice) return;
    check();
    const interval = setInterval(() => {
      setSeconds((s) => {
        if (s + 3 >= MAX_WAIT) {
          setStatus("timeout");
          return s + 3;
        }
        return s + 3;
      });
      check();
    }, 3000);
    return () => clearInterval(interval);
  }, [registerError, registeredDevice, registering, status, check]);

  if (registering) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (registerError) {
    return (
      <div className="space-y-4">
        <p className="text-red-600 text-sm">{registerError}</p>
        <button type="button" className="btn-ghost flex items-center gap-1" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> {t("common:actions.back", "Quay lại")}
        </button>
      </div>
    );
  }
  if (!registeredDevice) return null;

  return (
    <div className="space-y-6">
      {status === "waiting" && (
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="w-16 h-16 rounded-full border-4 border-brand-100 dark:border-brand-900 flex items-center justify-center animate-pulse">
            <Link2 className="h-7 w-7 text-brand-500" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-text-secondary">
              {t("devices:onboarding.waiting_device", "Đang chờ thiết bị kết nối…")}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {seconds}s / {MAX_WAIT}s — {t("devices:onboarding.checking_every_3s", "kiểm tra mỗi 3 giây")}
            </p>
          </div>
          <p className="text-xs text-slate-400 text-center max-w-xs">
            {t("devices:onboarding.ensure_wifi_mqtt_hint", "Đảm bảo ESP32 đã được flash firmware, WiFi đúng, và MQTT host/port trỏ đến server này.")}
          </p>
        </div>
      )}

      {status === "online" && (
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
            <Check className="h-8 w-8 text-emerald-600" />
          </div>
          <div className="text-center">
            <p className="text-base font-semibold text-emerald-700 dark:text-emerald-400">
              {t("devices:onboarding.device_connected", "Thiết bị đã kết nối!")}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              <strong>{registeredDevice.name}</strong> ({registeredDevice.device_uid}) {t("devices:onboarding.is_online", "đang online.")}
            </p>
          </div>
          <button
            type="button"
            className="btn-primary mt-2"
            onClick={() => navigate(resolveLink(`/devices/${registeredDevice.device_uid}`))}
          >
            {t("devices:onboarding.view_device_details", "Xem chi tiết thiết bị")}
          </button>
        </div>
      )}

      {status === "timeout" && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <span className="text-2xl">⏱</span>
            </div>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {t("devices:onboarding.no_signal_after", "Chưa nhận được tín hiệu sau")} {MAX_WAIT}s
            </p>
          </div>
          <div className="p-4 bg-slate-50 dark:bg-surface-elevated rounded-lg space-y-2 text-sm text-slate-600 dark:text-text-muted">
            <p className="font-medium">{t("devices:onboarding.troubleshoot_check", "Kiểm tra:")}</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>{t("devices:onboarding.troubleshoot_wifi", "WiFi SSID/Password trong sdkconfig.defaults.local có đúng không?")}</li>
              <li>
                {t("devices:onboarding.troubleshoot_mqtt_host", "MQTT_HOST có phải là IP LAN thực của server không? (")}
                <code className="bg-slate-200 dark:bg-surface-muted px-1 rounded">localhost</code>{t("devices:onboarding.troubleshoot_not_work", " không hoạt động từ ESP32)")}
              </li>
              <li>{t("devices:onboarding.troubleshoot_firewall", "MQTT port mở firewall chưa?")}</li>
              <li>
                {t("devices:onboarding.troubleshoot_flash_check", "ESP32 đã được flash firmware chưa? Chạy")} <code>idf.py monitor</code> {t("devices:onboarding.to_view_log", "để xem log.")}
              </li>
            </ul>
          </div>
          <div className="flex justify-between">
            <button type="button" className="btn-ghost flex items-center gap-1" onClick={onBack}>
              <ChevronLeft className="h-4 w-4" /> {t("devices:onboarding.review_guide", "Xem lại hướng dẫn")}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setSeconds(0);
                setStatus("waiting");
              }}
            >
              {t("common:actions.retry", "Thử lại")}
            </button>
          </div>
        </div>
      )}

      {status === "waiting" && (
        <div className="flex justify-between">
          <button type="button" className="btn-ghost flex items-center gap-1" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" /> {t("common:actions.back", "Quay lại")}
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => navigate(resolveLink("/devices"))}
          >
            {t("devices:onboarding.skip_to_list", "Bỏ qua, về danh sách")}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export function ClientDeviceOnboarding() {
  const { t } = useTranslation(["devices", "common"]);
  const { resolveLink } = useProjectScope();
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [device, setDevice] = useState<Device | null>(null);
  const [mqttCfg, setMqttCfg] = useState<MqttConfig | null>(null);

  // Lifted from Step1 to enable dirty-state detection from the top level
  const [name, setName] = useState("");
  const [uid, setUid] = useState("");
  const [hardwareModel, setHardwareModel] = useState("");
  const [description, setDescription] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [authTokenHash, setAuthTokenHash] = useState("");
  const [existingDevices, setExistingDevices] = useState<Device[]>([]);
  const [checkingUid, setCheckingUid] = useState(true);

  // Whether the confirm-discard dialog is showing
  const [showBackConfirm, setShowBackConfirm] = useState(false);

  const isDirty =
    name.trim().length > 0 ||
    uid.trim().length > 0 ||
    hardwareModel.trim().length > 0 ||
    description.trim().length > 0;

  useEffect(() => {
    let cancelled = false;
    setCheckingUid(true);
    listClientDevices()
      .then((devices) => {
        if (!cancelled) setExistingDevices(devices);
      })
      .catch(() => {
        if (!cancelled) setExistingDevices([]);
      })
      .finally(() => {
        if (!cancelled) setCheckingUid(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const normalizedUid = uid.trim().toLowerCase();
  const duplicateUid = normalizedUid
    ? existingDevices.some((item) => item.device_uid.toLowerCase() === normalizedUid)
    : false;
  const uidError = duplicateUid ? t("devices:onboarding.err_duplicate_uid", "UID trùng với một thiết bị khác") : null;

  /** Handle back navigation - always go to devices page */
  function handleBack() {
    if (isDirty) {
      setShowBackConfirm(true);
    } else {
      doNavigateBack();
    }
  }

  function doNavigateBack() {
    if (projectId) {
      navigate(`/client/workspace/${projectId}/devices`);
    } else {
      navigate("/client/devices");
    }
  }

  const stepTitles: Record<Step, string> = {
    1: t("devices:onboarding.step1_title", "Device information"),
    2: t("devices:onboarding.step2_title", "Connection configuration"),
    3: t("devices:onboarding.step3_title", "Flash firmware"),
    4: t("devices:onboarding.step4_title", "Verify connection"),
  };

  // Suppress unused mqttCfg warning — kept in state for future use (e.g. download)
  void mqttCfg;

  return (
    <>
      {showBackConfirm && (
        <BackConfirmDialog
          onStay={() => setShowBackConfirm(false)}
          onLeave={() => {
            setShowBackConfirm(false);
            doNavigateBack();
          }}
        />
      )}

      <div className="w-full space-y-5 pb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <PageHeader
            title={t("devices:onboarding.title", "Thêm thiết bị ESP32 mới")}
            subtitle={t("devices:onboarding.subtitle", "Hướng dẫn từng bước để kết nối thiết bị vào hệ thống")}
            className="mb-0 min-w-0 flex-1"
          />
          <button type="button" className="btn-secondary flex h-9 shrink-0 items-center gap-1.5 self-start text-xs sm:self-auto" onClick={handleBack}>
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("devices:onboarding.back_to_devices", "Quay lại thiết bị")}
          </button>
        </div>
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12 lg:gap-6">
          <div className="order-first lg:order-last lg:col-span-4 lg:sticky lg:top-6">
            <StepIndicator current={step} />
          </div>
          <div className="min-w-0 lg:col-span-8">
            <Card className="w-full rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-border-subtle dark:bg-surface sm:p-6">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-border-subtle">
                <div>
                  <p className="section-label">{t("devices:onboarding.step_prefix", "Bước")} {step} / 4</p>
                  <h2 className="mt-1 text-base font-semibold tracking-tight text-slate-900 dark:text-text-primary">{stepTitles[step]}</h2>
                </div>
                <span className="chip tone-neutral-chip">{t("devices:onboarding.in_progress", "Đang thực hiện")}</span>
              </div>
              {step === 1 && (
                <Step1
                  name={name}
                  uid={uid}
                  hardwareModel={hardwareModel}
                  description={description}
                  onNameChange={setName}
                  onUidChange={setUid}
                  onHardwareModelChange={setHardwareModel}
                  onDescriptionChange={setDescription}
                  uidError={uidError}
                  checkingUid={checkingUid}
                  onNext={async () => {
                    const tokenData = await generateDeviceToken();
                    setAuthToken(tokenData.auth_token);
                    setAuthTokenHash(tokenData.auth_token_hash);
                    setStep(2);
                  }}
                />
              )}
              {step === 2 && (
                <Step2
                  uid={uid}
                  authToken={authToken}
                  onNext={(cfg) => {
                    setMqttCfg(cfg);
                    setStep(3);
                  }}
                  onBack={() => setStep(1)}
                />
              )}
              {step === 3 && (
                <Step3 onNext={() => setStep(4)} onBack={() => setStep(2)} />
              )}
              {step === 4 && (
                <Step4
                  device={device}
                  name={name}
                  uid={uid}
                  hardwareModel={hardwareModel}
                  description={description}
                  authTokenHash={authTokenHash}
                  projectId={projectId}
                  onDeviceReady={setDevice}
                  onBack={() => setStep(3)}
                />
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
