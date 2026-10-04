import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle,
  CircuitBoard,
  Cpu,
  Edit2,
  HardDrive,
  Plus,
  Search,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { Modal } from "../../components/ui/Modal";
import { EmptyState } from "../../components/ui/EmptyState";
import { AdminMetric, AdminReadOnlyNote } from "./adminPresentation";
import { PageHeader } from "../../components/ui/PageHeader";
import {
  createCapabilityTemplate,
  createDeviceModel,
  createPlatform,
  deleteCapabilityTemplate,
  deleteDeviceModel,
  deletePlatform,
  listCapabilityTemplates,
  listDeviceModels,
  listPlatforms,
  updateCapabilityTemplate,
  updateDeviceModel,
  updatePlatform,
  type CapabilityTemplateInput,
  type DeviceModelInput,
  type DevicePlatformInput,
} from "../../services/platformApi";
import type { CapabilityTemplate, DeviceModel, DevicePlatform } from "../../types";

type RegistryTab = "platforms" | "models" | "capabilities";

const DEFAULT_PLATFORM: DevicePlatformInput = {
  key: "",
  name: "",
  sdk_toolchain: "",
  description: "",
  wifi_required: true,
  supports_mqtt: true,
  supports_ota: true,
  supports_gpio_config: true,
};

const DEFAULT_MODEL: DeviceModelInput = {
  platform_id: "",
  key: "",
  name: "",
  description: "",
  gpio_pins_json: {},
  default_capabilities_json: [],
};

const DEFAULT_CAPABILITY: CapabilityTemplateInput = {
  device_model_id: "",
  capability_key: "",
  capability_type: "relay",
  label: "",
  gpio_pin: null,
  channel: "",
  command_name: "",
  telemetry_state_key: "",
  is_bindable: true,
  config_json: {},
};

function FeatureBadge({ supported, label }: { supported: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        supported
          ? "bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
          : "bg-slate-100 text-slate-500 dark:bg-surface-elevated dark:text-text-muted"
      }`}
    >
      {supported ? <CheckCircle size={12} /> : <XCircle size={12} />}
      {label}
    </span>
  );
}

function parseJsonField(value: string, fallback: unknown) {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return JSON.parse(trimmed);
}

function compactNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

export function Platforms({ readOnly = false }: { readOnly?: boolean } = {}) {
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [tab, setTab] = useState<RegistryTab>("platforms");
  const [editingPlatformId, setEditingPlatformId] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [editingCapabilityId, setEditingCapabilityId] = useState<string | null>(null);
  const [platformForm, setPlatformForm] = useState<DevicePlatformInput>(DEFAULT_PLATFORM);
  const [modelForm, setModelForm] = useState<DeviceModelInput>(DEFAULT_MODEL);
  const [capabilityForm, setCapabilityForm] = useState<CapabilityTemplateInput>(DEFAULT_CAPABILITY);
  const [gpioJson, setGpioJson] = useState("{}");
  const [defaultCapsJson, setDefaultCapsJson] = useState("[]");
  const [configJson, setConfigJson] = useState("{}");
  const [formError, setFormError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const platformsQuery = useQuery({ queryKey: ["admin-platforms"], queryFn: listPlatforms });
  const modelsQuery = useQuery({ queryKey: ["admin-device-models"], queryFn: () => listDeviceModels() });
  const capabilitiesQuery = useQuery({
    queryKey: ["admin-capability-templates"],
    queryFn: () => listCapabilityTemplates(),
  });

  const platforms = platformsQuery.data ?? [];
  const models = modelsQuery.data ?? [];
  const capabilities = capabilitiesQuery.data ?? [];
  const isLoading = platformsQuery.isLoading || modelsQuery.isLoading || capabilitiesQuery.isLoading;
  const loadError = platformsQuery.error || modelsQuery.error || capabilitiesQuery.error;

  const platformMap = useMemo(
    () => new Map<string, DevicePlatform>(platforms.map((platform) => [platform.id, platform])),
    [platforms],
  );
  const modelMap = useMemo(
    () => new Map<string, DeviceModel>(models.map((model) => [model.id, model])),
    [models],
  );

  function refreshRegistry() {
    queryClient.invalidateQueries({ queryKey: ["admin-platforms"] });
    queryClient.invalidateQueries({ queryKey: ["admin-device-models"] });
    queryClient.invalidateQueries({ queryKey: ["admin-capability-templates"] });
  }

  const platformMutation = useMutation({
    mutationFn: (payload: DevicePlatformInput) =>
      editingPlatformId ? updatePlatform(editingPlatformId, payload) : createPlatform(payload),
    onSuccess: () => {
      setPlatformForm(DEFAULT_PLATFORM);
      setEditingPlatformId(null);
      setFormError(null);
      setFormOpen(false);
      refreshRegistry();
    },
  });

  const modelMutation = useMutation({
    mutationFn: (payload: DeviceModelInput) =>
      editingModelId ? updateDeviceModel(editingModelId, payload) : createDeviceModel(payload),
    onSuccess: () => {
      setModelForm(DEFAULT_MODEL);
      setGpioJson("{}");
      setDefaultCapsJson("[]");
      setEditingModelId(null);
      setFormError(null);
      setFormOpen(false);
      refreshRegistry();
    },
  });

  const capabilityMutation = useMutation({
    mutationFn: (payload: CapabilityTemplateInput) =>
      editingCapabilityId
        ? updateCapabilityTemplate(editingCapabilityId, payload)
        : createCapabilityTemplate(payload),
    onSuccess: () => {
      setCapabilityForm(DEFAULT_CAPABILITY);
      setConfigJson("{}");
      setEditingCapabilityId(null);
      setFormError(null);
      setFormOpen(false);
      refreshRegistry();
    },
  });

  const deletePlatformMutation = useMutation({
    mutationFn: deletePlatform,
    onSuccess: refreshRegistry,
  });
  const deleteModelMutation = useMutation({
    mutationFn: deleteDeviceModel,
    onSuccess: refreshRegistry,
  });
  const deleteCapabilityMutation = useMutation({
    mutationFn: deleteCapabilityTemplate,
    onSuccess: refreshRegistry,
  });

  async function submitPlatform(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      await platformMutation.mutateAsync({
        ...platformForm,
        key: platformForm.key.trim(),
        name: platformForm.name.trim(),
        sdk_toolchain: compactNullable(platformForm.sdk_toolchain ?? ""),
        description: compactNullable(platformForm.description ?? ""),
      });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  async function submitModel(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      await modelMutation.mutateAsync({
        ...modelForm,
        key: modelForm.key.trim(),
        name: modelForm.name.trim(),
        description: compactNullable(modelForm.description ?? ""),
        gpio_pins_json: parseJsonField(gpioJson, {}),
        default_capabilities_json: parseJsonField(defaultCapsJson, []),
      });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  async function submitCapability(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    try {
      await capabilityMutation.mutateAsync({
        ...capabilityForm,
        capability_key: capabilityForm.capability_key.trim(),
        capability_type: capabilityForm.capability_type.trim(),
        label: capabilityForm.label.trim(),
        channel: compactNullable(capabilityForm.channel ?? ""),
        command_name: capabilityForm.command_name.trim(),
        telemetry_state_key: compactNullable(capabilityForm.telemetry_state_key ?? ""),
        gpio_pin: capabilityForm.gpio_pin ?? null,
        config_json: parseJsonField(configJson, {}),
      });
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  async function removePlatform(platform: DevicePlatform) {
    if (!window.confirm(`Delete platform ${platform.name}?`)) return;
    setFormError(null);
    try {
      await deletePlatformMutation.mutateAsync(platform.id);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  async function removeModel(model: DeviceModel) {
    if (!window.confirm(`Delete model ${model.name}?`)) return;
    setFormError(null);
    try {
      await deleteModelMutation.mutateAsync(model.id);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  async function removeCapability(template: CapabilityTemplate) {
    if (!window.confirm(`Delete capability ${template.label}?`)) return;
    setFormError(null);
    try {
      await deleteCapabilityMutation.mutateAsync(template.id);
    } catch (error) {
      setFormError(errorMessage(error));
    }
  }

  function startEditPlatform(platform: DevicePlatform) {
    if (readOnly) return;
    setFormOpen(true);
    setTab("platforms");
    setEditingPlatformId(platform.id);
    setPlatformForm({
      key: platform.key,
      name: platform.name,
      sdk_toolchain: platform.sdk_toolchain ?? "",
      description: platform.description ?? "",
      wifi_required: platform.wifi_required,
      supports_mqtt: platform.supports_mqtt,
      supports_ota: platform.supports_ota,
      supports_gpio_config: platform.supports_gpio_config,
    });
  }

  function startEditModel(model: DeviceModel) {
    if (readOnly) return;
    setFormOpen(true);
    setTab("models");
    setEditingModelId(model.id);
    setModelForm({
      platform_id: model.platform_id,
      key: model.key,
      name: model.name,
      description: model.description ?? "",
      gpio_pins_json: model.gpio_pins_json,
      default_capabilities_json: model.default_capabilities_json,
    });
    setGpioJson(JSON.stringify(model.gpio_pins_json ?? {}, null, 2));
    setDefaultCapsJson(JSON.stringify(model.default_capabilities_json ?? [], null, 2));
  }

  function startEditCapability(template: CapabilityTemplate) {
    if (readOnly) return;
    setFormOpen(true);
    setTab("capabilities");
    setEditingCapabilityId(template.id);
    setCapabilityForm({
      device_model_id: template.device_model_id,
      capability_key: template.capability_key,
      capability_type: template.capability_type,
      label: template.label,
      gpio_pin: template.gpio_pin ?? null,
      channel: template.channel ?? "",
      command_name: template.command_name,
      telemetry_state_key: template.telemetry_state_key ?? "",
      is_bindable: template.is_bindable,
      config_json: template.config_json,
    });
    setConfigJson(JSON.stringify(template.config_json ?? {}, null, 2));
  }

  function cancelEdit() {
    setFormOpen(false);
    setEditingPlatformId(null);
    setEditingModelId(null);
    setEditingCapabilityId(null);
    setPlatformForm(DEFAULT_PLATFORM);
    setModelForm(DEFAULT_MODEL);
    setCapabilityForm(DEFAULT_CAPABILITY);
    setGpioJson("{}");
    setDefaultCapsJson("[]");
    setConfigJson("{}");
    setFormError(null);
  }

  return (
    <div className="flex flex-col flex-1 min-h-full space-y-6">
      <PageHeader
        title="Platform Registry"
        description="Manage device platforms, hardware models, and default capability templates in one place."
        actions={
          <div className="flex flex-wrap gap-2"><button onClick={refreshRegistry} className="btn-secondary"><RefreshCw className="h-4 w-4" />Refresh</button>{!readOnly && <button className="btn-primary" onClick={() => { cancelEdit(); setFormOpen(true); }}><Plus className="h-4 w-4" />{tab === "platforms" ? "New Platform" : tab === "models" ? "New Device Model" : "New Capability"}</button>}</div>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3"><AdminMetric label="Platforms" value={loadError ? "—" : platforms.length} icon={<Cpu className="h-5 w-5" />} loading={isLoading} /><AdminMetric label="Device Models" value={loadError ? "—" : models.length} icon={<HardDrive className="h-5 w-5" />} loading={isLoading} index={1} /><AdminMetric label="Capabilities" value={loadError ? "—" : capabilities.length} icon={<CircuitBoard className="h-5 w-5" />} loading={isLoading} index={3} /></div>
      {readOnly && <AdminReadOnlyNote>Read-only platform registry. Platform administrators manage hardware definitions.</AdminReadOnlyNote>}
      <div className="relative max-w-lg"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input className="input w-full pl-9" aria-label="Search platform registry" placeholder="Search names, keys, models or commands..." value={search} onChange={(event) => setSearch(event.target.value)} /></div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-border-subtle">
        {[
          { id: "platforms", label: "Platforms", icon: Cpu, count: platforms.length },
          { id: "models", label: "Device Models", icon: HardDrive, count: models.length },
          { id: "capabilities", label: "Capabilities", icon: CircuitBoard, count: capabilities.length },
        ].map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => { setTab(item.id as RegistryTab); setSearch(""); cancelEdit(); }}
              aria-pressed={active}
              className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-slate-500 hover:text-slate-800 dark:text-text-muted dark:hover:text-text-primary"
              }`}
            >
              <Icon size={16} />
              {item.label}
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs dark:bg-surface-elevated">
                {item.count}
              </span>
            </button>
          );
        })}
      </div>

      {loadError && (
        <div className="rounded-lg bg-red-50 p-4 text-red-600 dark:bg-red-900/20 dark:text-red-400">
          Failed to load platform registry: {(loadError as Error).message}
        </div>
      )}
      {(tab === "platforms" ? platforms : tab === "models" ? models : capabilities).length === 0 && !isLoading && !loadError && <EmptyState title="Registry is empty" description="No definitions have been registered in this section." />}
      {formError && !formOpen && (
        <div className="rounded-lg bg-red-50 p-4 text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {formError}
        </div>
      )}

      {search.trim() && !isLoading && !(tab === "platforms" ? platforms.some((item) => matches(search, item.name, item.key, item.description, item.sdk_toolchain)) : tab === "models" ? models.some((item) => matches(search, item.name, item.key, item.description, platformMap.get(item.platform_id)?.name)) : capabilities.some((item) => matches(search, item.label, item.capability_key, item.command_name, modelMap.get(item.device_model_id)?.name))) && <EmptyState title="No matching definitions" description="Try another name, key, model or command." />}

      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-slate-500">
          <div className="mr-2 h-6 w-6 animate-spin rounded-full border-b-2 border-primary" />
          Loading platform registry...
        </div>
      ) : (
        <>
          {tab === "platforms" && (
            <section className="grid grid-cols-1 gap-4 ">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {platforms.filter((platform) => matches(search, platform.name, platform.key, platform.description, platform.sdk_toolchain)).map((platform) => (
                  <article
                    key={platform.id}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-brand-300 dark:border-border-subtle dark:bg-surface dark:hover:border-brand-500/30"
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-800 dark:text-text-primary">{platform.name}</h3>
                        <code className="text-xs text-slate-500">{platform.key}</code>
                      </div>
                      {!readOnly && <div className="flex gap-1">
                        <button aria-label={"Edit " + platform.name} className="btn-ghost px-2" onClick={() => startEditPlatform(platform)}>
                          <Edit2 size={14} />
                        </button>
                        <button
                          className="btn-ghost px-2 text-red-500"
                          aria-label={"Delete " + platform.name}
                          disabled={deletePlatformMutation.isPending}
                          onClick={() => void removePlatform(platform)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>}
                    </div>
                    {platform.description && (
                      <p className="mb-3 text-sm text-slate-600 dark:text-text-muted">{platform.description}</p>
                    )}
                    <div className="mb-3 text-xs text-slate-500">SDK: {platform.sdk_toolchain || "Not set"}</div>
                    <div className="flex flex-wrap gap-1.5">
                      <FeatureBadge supported={platform.wifi_required} label="WiFi" />
                      <FeatureBadge supported={platform.supports_mqtt} label="MQTT" />
                      <FeatureBadge supported={platform.supports_ota} label="OTA" />
                      <FeatureBadge supported={platform.supports_gpio_config} label="GPIO" />
                    </div>
                  </article>
                ))}
              </div>
              {!readOnly && <Modal open={formOpen} onClose={cancelEdit} title={editingPlatformId ? "Edit Platform" : "New Platform"} size="lg"><form onSubmit={submitPlatform} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-brand-300 dark:border-border-subtle dark:bg-surface dark:hover:border-brand-500/30">
                {formError && <p role="alert" className="mb-4 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">{formError}</p>}
                <TextInput label="Key" value={platformForm.key} onChange={(key) => setPlatformForm({ ...platformForm, key })} required />
                <TextInput label="Name" value={platformForm.name} onChange={(name) => setPlatformForm({ ...platformForm, name })} required />
                <TextInput label="SDK/toolchain" value={platformForm.sdk_toolchain ?? ""} onChange={(sdk_toolchain) => setPlatformForm({ ...platformForm, sdk_toolchain })} />
                <TextArea label="Description" value={platformForm.description ?? ""} onChange={(description) => setPlatformForm({ ...platformForm, description })} />
                <CheckInput label="WiFi required" checked={platformForm.wifi_required} onChange={(wifi_required) => setPlatformForm({ ...platformForm, wifi_required })} />
                <CheckInput label="Supports MQTT" checked={platformForm.supports_mqtt} onChange={(supports_mqtt) => setPlatformForm({ ...platformForm, supports_mqtt })} />
                <CheckInput label="Supports OTA" checked={platformForm.supports_ota} onChange={(supports_ota) => setPlatformForm({ ...platformForm, supports_ota })} />
                <CheckInput label="Supports GPIO config" checked={platformForm.supports_gpio_config} onChange={(supports_gpio_config) => setPlatformForm({ ...platformForm, supports_gpio_config })} />
                <FormActions editing={Boolean(editingPlatformId)} saving={platformMutation.isPending} onCancel={cancelEdit} />
              </form></Modal>}
            </section>
          )}

          {tab === "models" && (
            <section className="grid grid-cols-1 gap-4 ">
              <div className="space-y-3">
                {models.filter((model) => matches(search, model.name, model.key, model.description, platformMap.get(model.platform_id)?.name)).map((model) => {
                  const platform = model.platform ?? platformMap.get(model.platform_id);
                  return (
                    <article key={model.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-brand-300 dark:border-border-subtle dark:bg-surface dark:hover:border-brand-500/30">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-slate-800 dark:text-text-primary">{model.name}</h3>
                            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-surface-elevated">{model.key}</code>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{platform?.name ?? "Unknown platform"}</p>
                          {model.description && <p className="mt-2 text-sm text-slate-600 dark:text-text-muted">{model.description}</p>}
                        </div>
                        {!readOnly && <div className="flex gap-1">
                          <button aria-label={"Edit " + model.name} className="btn-ghost px-2" onClick={() => startEditModel(model)}>
                            <Edit2 size={14} />
                          </button>
                          <button
                            className="btn-ghost px-2 text-red-500"
                            aria-label={"Delete " + model.name}
                          disabled={deleteModelMutation.isPending}
                            onClick={() => void removeModel(model)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>}
                      </div>
                    </article>
                  );
                })}
              </div>
              {!readOnly && <Modal open={formOpen} onClose={cancelEdit} title={editingModelId ? "Edit Device Model" : "New Device Model"} size="lg"><form onSubmit={submitModel} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-brand-300 dark:border-border-subtle dark:bg-surface dark:hover:border-brand-500/30">
                {formError && <p role="alert" className="mb-4 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">{formError}</p>}
                <SelectInput
                  label="Platform"
                  value={modelForm.platform_id}
                  onChange={(platform_id) => setModelForm({ ...modelForm, platform_id })}
                  options={platforms.filter((platform) => matches(search, platform.name, platform.key, platform.description, platform.sdk_toolchain)).map((platform) => ({ value: platform.id, label: platform.name }))}
                  required
                />
                <TextInput label="Key" value={modelForm.key} onChange={(key) => setModelForm({ ...modelForm, key })} required />
                <TextInput label="Name" value={modelForm.name} onChange={(name) => setModelForm({ ...modelForm, name })} required />
                <TextArea label="Description" value={modelForm.description ?? ""} onChange={(description) => setModelForm({ ...modelForm, description })} />
                <TextArea label="GPIO pins JSON" value={gpioJson} onChange={setGpioJson} rows={5} />
                <TextArea label="Default capabilities JSON" value={defaultCapsJson} onChange={setDefaultCapsJson} rows={5} />
                <FormActions editing={Boolean(editingModelId)} saving={modelMutation.isPending} onCancel={cancelEdit} />
              </form></Modal>}
            </section>
          )}

          {tab === "capabilities" && (
            <section className="grid grid-cols-1 gap-4 ">
              <div className="space-y-3">
                {capabilities.filter((template) => matches(search, template.label, template.capability_key, template.command_name, modelMap.get(template.device_model_id)?.name)).map((template) => {
                  const model = modelMap.get(template.device_model_id);
                  return (
                    <article key={template.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-brand-300 dark:border-border-subtle dark:bg-surface dark:hover:border-brand-500/30">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-slate-800 dark:text-text-primary">{template.label}</h3>
                            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-surface-elevated">{template.capability_key}</code>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            {template.capability_type} · {model?.name ?? "Unknown model"}
                          </p>
                          <p className="mt-2 text-sm text-slate-600 dark:text-text-muted">
                            Command `{template.command_name}`{template.gpio_pin !== null ? ` · GPIO ${template.gpio_pin}` : ""}
                          </p>
                        </div>
                        {!readOnly && <div className="flex gap-1">
                          <button aria-label={"Edit " + template.label} className="btn-ghost px-2" onClick={() => startEditCapability(template)}>
                            <Edit2 size={14} />
                          </button>
                          <button
                            className="btn-ghost px-2 text-red-500"
                            aria-label={"Delete " + template.label}
                          disabled={deleteCapabilityMutation.isPending}
                            onClick={() => void removeCapability(template)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>}
                      </div>
                    </article>
                  );
                })}
              </div>
              {!readOnly && <Modal open={formOpen} onClose={cancelEdit} title={editingCapabilityId ? "Edit Capability" : "New Capability"} size="lg"><form onSubmit={submitCapability} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-brand-300 dark:border-border-subtle dark:bg-surface dark:hover:border-brand-500/30">
                {formError && <p role="alert" className="mb-4 rounded-xl bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-400">{formError}</p>}
                <SelectInput
                  label="Device model"
                  value={capabilityForm.device_model_id}
                  onChange={(device_model_id) => setCapabilityForm({ ...capabilityForm, device_model_id })}
                  options={models.map((model) => ({ value: model.id, label: `${model.name} (${platformMap.get(model.platform_id)?.name ?? "Platform"})` }))}
                  required
                />
                <TextInput label="Capability key" value={capabilityForm.capability_key} onChange={(capability_key) => setCapabilityForm({ ...capabilityForm, capability_key })} required />
                <TextInput label="Type" value={capabilityForm.capability_type} onChange={(capability_type) => setCapabilityForm({ ...capabilityForm, capability_type })} required />
                <TextInput label="Label" value={capabilityForm.label} onChange={(label) => setCapabilityForm({ ...capabilityForm, label })} required />
                <TextInput label="Command" value={capabilityForm.command_name} onChange={(command_name) => setCapabilityForm({ ...capabilityForm, command_name })} required />
                <TextInput label="GPIO pin" type="number" value={capabilityForm.gpio_pin?.toString() ?? ""} onChange={(value) => setCapabilityForm({ ...capabilityForm, gpio_pin: value ? Number(value) : null })} />
                <TextInput label="Channel" value={capabilityForm.channel ?? ""} onChange={(channel) => setCapabilityForm({ ...capabilityForm, channel })} />
                <TextInput label="Telemetry state key" value={capabilityForm.telemetry_state_key ?? ""} onChange={(telemetry_state_key) => setCapabilityForm({ ...capabilityForm, telemetry_state_key })} />
                <CheckInput label="Bindable" checked={capabilityForm.is_bindable} onChange={(is_bindable) => setCapabilityForm({ ...capabilityForm, is_bindable })} />
                <TextArea label="Config JSON" value={configJson} onChange={setConfigJson} rows={5} />
                <FormActions editing={Boolean(editingCapabilityId)} saving={capabilityMutation.isPending} onCancel={cancelEdit} />
              </form></Modal>}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function FormTitle({ title }: { title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-text-primary">
      <Plus size={16} />
      {title}
    </div>
  );
}

function FormActions({
  editing,
  saving,
  onCancel,
}: {
  editing: boolean;
  saving: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="mt-4 flex gap-2">
      <button type="submit" className="btn-primary" disabled={saving}>
        {saving ? "Saving..." : editing ? "Save changes" : "Create"}
      </button>
      {editing && (
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="mb-3 block text-sm">
      <span className="mb-1 block text-slate-600 dark:text-text-muted">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-border-subtle dark:bg-surface-elevated"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className="mb-3 block text-sm">
      <span className="mb-1 block text-slate-600 dark:text-text-muted">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs dark:border-border-subtle dark:bg-surface-elevated"
      />
    </label>
  );
}

function SelectInput({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  return (
    <label className="mb-3 block text-sm">
      <span className="mb-1 block text-slate-600 dark:text-text-muted">{label}</span>
      <select
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-border-subtle dark:bg-surface-elevated"
      >
        <option value="">Select...</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckInput({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="mb-2 flex items-center gap-2 text-sm text-slate-600 dark:text-text-muted">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export default Platforms;

function matches(query: string, ...values: Array<string | null | undefined>) { return values.filter(Boolean).join(" ").toLowerCase().includes(query.trim().toLowerCase()); }
