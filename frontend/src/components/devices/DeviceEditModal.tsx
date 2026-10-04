import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listClientDeviceModels } from "../../services/clientApi";
import { Modal } from "../ui/Modal";
import type { Device, DeviceModel } from "../../types";

export type DeviceEditPayload = {
  name: string;
  hardware_model: string | null;
  mac_address: string | null;
  description: string | null;
};

/** Map API-stored hardware_model (model.name after create, or model.key after some updates) to select option value (model.key). */
export function resolveHardwareModelSelectValue(
  models: DeviceModel[],
  stored: string | null | undefined,
): string {
  if (!stored) return "";
  const trimmed = stored.trim();
  if (!trimmed) return "";
  if (models.some((model) => model.key === trimmed)) return trimmed;
  const byName = models.find((model) => model.name === trimmed);
  if (byName) return byName.key;
  return trimmed;
}

export function DeviceEditModal({
  open,
  device,
  loading,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  device: Device;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (data: DeviceEditPayload) => void;
}) {
  const { t } = useTranslation(["devices", "common"]);
  const [name, setName] = useState(device.name);
  const [hardwareModel, setHardwareModel] = useState(device.hardware_model ?? "");
  const [macAddress, setMacAddress] = useState(device.mac_address ?? "");
  const [description, setDescription] = useState(device.description ?? "");
  const [validationError, setValidationError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!open) return;
    setName(device.name);
    setMacAddress(device.mac_address ?? "");
    setDescription(device.description ?? "");
    setValidationError(null);
    setHardwareModel(
      models.length > 0
        ? resolveHardwareModelSelectValue(models, device.hardware_model)
        : (device.hardware_model ?? ""),
    );
  }, [open, device.name, device.hardware_model, device.mac_address, device.description, models]);

  function submit() {
    const nextName = name.trim();
    if (!nextName) {
      setValidationError(t("devices:edit_modal.name_required", "Device name is required."));
      return;
    }
    setValidationError(null);
    onSubmit({
      name: nextName,
      hardware_model: hardwareModel.trim() || null,
      mac_address: macAddress.trim() || null,
      description: description.trim() || null,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("devices:edit_modal.title", "Edit device")}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={loading}>
            {t("common:actions.cancel", "Cancel")}
          </button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading ? t("common:saving", "Saving...") : t("common:actions.save_changes", "Save changes")}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("devices:detail.device_uid", "Device UID")}</label>
          <div className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600 dark:border-border-subtle dark:bg-surface-elevated dark:text-text-muted">
            {device.device_uid}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("devices:detail.name", "Name")}</label>
          <input className="input mt-1" value={name} onChange={(event) => setName(event.target.value)} disabled={loading} />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("devices:detail.hardware_model", "Hardware model")}</label>
          <select
            className="input mt-1"
            value={hardwareModel}
            onChange={(event) => setHardwareModel(event.target.value)}
            disabled={loading || loadingModels}
          >
            <option value="">{t("devices:edit_modal.unspecified_model", "-- Not specified --")}</option>
            {models.map((m) => (
              <option key={m.id} value={m.key}>
                {m.name} {m.platform ? `(${m.platform.name})` : ""}
              </option>
            ))}
            {/* Legacy/orphan stored value not in catalog still visible in the select */}
            {hardwareModel && !models.some((m) => m.key === hardwareModel) && (
              <option value={hardwareModel}>{hardwareModel}</option>
            )}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("devices:edit_modal.mac_address", "MAC address")}</label>
          <input className="input mt-1 font-mono text-sm" value={macAddress} onChange={(event) => setMacAddress(event.target.value)} disabled={loading} />
        </div>
        <div>
          <label className="text-xs font-medium uppercase tracking-wide text-slate-500">{t("devices:detail.description", "Description")}</label>
          <textarea className="input mt-1 min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} disabled={loading} />
        </div>
        {(validationError || error) && (
          <div className="text-xs text-rose-600 dark:text-rose-400">{validationError ?? error}</div>
        )}
      </div>
    </Modal>
  );
}
